"""Knowledge milestone: scoped FTS5 retrieval, immutable evidence and review.

This local single-operator demo uses spaces for content isolation, not tenant auth.
No network request runs while a SQLite transaction is held.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib
import json
import re
from typing import Literal
from uuid import uuid4

from fastapi import HTTPException, UploadFile, File
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.knowledge_text import MAX_CHARS, MAX_UPLOAD, extract_text, indexed, split_pages, terms
from backend.knowledge_samples import SAMPLES


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def today():
    return datetime.now(timezone.utc).date().isoformat()


def identifier(prefix):
    return prefix + "-" + uuid4().hex[:12]


def put(db, collection, item):
    db.execute("INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data", (collection, item["id"], json.dumps(item, ensure_ascii=False)))
    return item


def records(db, collection):
    return [json.loads(row[0]) for row in db.execute("SELECT data FROM records WHERE collection=? ORDER BY rowid", (collection,))]


def get(db, collection, key):
    row = db.execute("SELECT data FROM records WHERE collection=? AND id=?", (collection, key)).fetchone()
    if not row:
        raise HTTPException(404, "资料、空间或草稿不存在，请刷新列表。")
    return json.loads(row[0])


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class Operation(Input):
    request_id: str = Field(default_factory=lambda: uuid4().hex, min_length=1, max_length=128)


class SpaceInput(Operation):
    name: str = Field(min_length=1, max_length=60)
    scene: Literal["medical", "live"]


class Page(Input):
    page: int | None = Field(default=None, ge=1, le=50)
    text: str = Field(max_length=MAX_CHARS)


class DocumentInput(Operation):
    space_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["facts", "rules", "script"] = "facts"
    channel: Literal["internal", "douyin"] = "internal"
    valid_from: date | None = None
    valid_until: date | None = None
    pages: list[Page] = Field(min_length=1, max_length=50)
    filename: str = Field(default="粘贴文本", max_length=180)
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def content_bounds(self):
        if self.valid_from and self.valid_until and self.valid_from > self.valid_until:
            raise ValueError("生效日期不能晚于失效日期")
        text = "\n\n".join(p.text for p in self.pages)
        if not text.strip() or len(text) > MAX_CHARS:
            raise ValueError("正文不能为空且最多12万字")
        return self


class ReviewInput(Operation):
    expected_version: int = Field(ge=1)
    status: Literal["approved", "archived"]


class SearchInput(Input):
    space_id: str = Field(min_length=1, max_length=80)
    query: str = Field(min_length=1, max_length=500)
    channel: Literal["internal", "douyin"] = "internal"


class GenerateInput(SearchInput, Operation):
    task: Literal["answer", "script"] = "answer"
    signature: str = Field(min_length=1, max_length=64)


class Block(Input):
    text: str = Field(min_length=1, max_length=2400)
    citation_ids: list[str] = Field(min_length=1, max_length=6)


class DraftEdit(Operation):
    expected_revision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    blocks: list[Block] = Field(min_length=1, max_length=12)


class ConfirmInput(Operation):
    expected_revision: int = Field(ge=1)
    acknowledged: Literal[True]


def initialize_knowledge(db):
    db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(chunk_id UNINDEXED, doc_id UNINDEXED, title, body, tokenize='unicode61')")
    for key, name, scene in (("kb-medical", "澄光机构 · 医美演示空间", "medical"), ("kb-live", "青禾品牌 · 直播演示空间", "live")):
        db.execute("INSERT OR IGNORE INTO records VALUES(?,?,?)", ("kb_spaces", key, json.dumps({"id": key, "name": name, "scene": scene, "is_demo": True, "created_at": stamp()}, ensure_ascii=False)))


def availability(doc):
    if doc["status"] != "approved":
        return "已归档" if doc["status"] == "archived" else "待人工审核"
    if doc.get("valid_from") and doc["valid_from"] > today():
        return "尚未生效"
    if doc.get("valid_until") and doc["valid_until"] < today():
        return "已过期"
    return "可检索"


def summary(doc):
    return {k: v for k, v in {**doc, "availability": availability(doc)}.items() if k not in {"pages", "chunks"}}


def save_document(db, body, old=None, is_demo=False):
    space = get(db, "kb_spaces", body.space_id)
    if old and (old["space_id"] != body.space_id or old["version"] != body.expected_version):
        raise HTTPException(409, "资料已更新或空间不匹配，请重新打开后编辑。")
    data = body.model_dump(mode="json", exclude={"request_id", "expected_version"})
    data["filename"] = data["filename"].replace("\\", "/").split("/")[-1]
    item = {**data, "id": old["id"] if old else identifier("doc"), "version": old["version"] + 1 if old else 1,
            "scene": space["scene"], "status": "draft", "is_demo": old.get("is_demo", False) if old else is_demo,
            "created_at": old["created_at"] if old else stamp(), "updated_at": stamp()}
    chunks = split_pages(item["pages"])
    if not chunks:
        raise HTTPException(422, "资料没有可检索的文字。")
    item["chunks"] = [{**c, "id": f"{item['id']}-v{item['version']}-c{i + 1}"} for i, c in enumerate(chunks)]
    item["chunk_count"] = len(chunks)
    db.execute("DELETE FROM kb_fts WHERE doc_id=?", (item["id"],))
    for chunk in item["chunks"]:
        # A standalone disclaimer/heading is visible in the document, but not an
        # answer-bearing chunk. Otherwise title matches crowd useful text out.
        if re.fullmatch(r"(?:【[^\n]+】|#{1,6}[^\n]+)", chunk["text"]):
            continue
        db.execute("INSERT INTO kb_fts VALUES(?,?,?,?)", (chunk["id"], item["id"], indexed(item["title"]), indexed(chunk["text"])))
    put(db, "kb_versions", {**item, "id": f"{item['id']}:v{item['version']}", "document_id": item["id"]})
    return put(db, "kb_documents", item)


def search(db, body):
    space = get(db, "kb_spaces", body.space_id)
    tokens = terms(body.query)[:32]
    hits = []
    if tokens:
        match = " OR ".join('"' + t + '"' for t in tokens)
        # Apply the content scope and effective status BEFORE LIMIT, not after it.
        rows = db.execute("""SELECT f.chunk_id, r.data, bm25(kb_fts,0,0,3,1) AS score
          FROM kb_fts AS f JOIN records AS r ON r.collection='kb_documents' AND r.id=f.doc_id
          WHERE kb_fts MATCH ? AND json_extract(r.data,'$.space_id')=?
          AND json_extract(r.data,'$.status')='approved'
          AND json_extract(r.data,'$.channel')=?
          AND (json_extract(r.data,'$.valid_from') IS NULL OR json_extract(r.data,'$.valid_from')<=?)
          AND (json_extract(r.data,'$.valid_until') IS NULL OR json_extract(r.data,'$.valid_until')>=?)
          ORDER BY score, f.chunk_id LIMIT 40""", (match, body.space_id, body.channel, today(), today())).fetchall()
        count = {}
        for row in rows:
            doc = json.loads(row["data"])
            if count.get(doc["id"], 0) >= 2:
                continue
            chunk = next(c for c in doc["chunks"] if c["id"] == row["chunk_id"])
            # Title-only matches are allowed and explicitly highlighted as such.
            matched = [t for t in tokens if t in set(terms(doc["title"] + " " + chunk["text"]))]
            hits.append({"id": chunk["id"], "document_id": doc["id"], "title": doc["title"], "version": doc["version"],
                         "kind": doc["kind"], "channel": doc["channel"], "filename": doc["filename"],
                         "text": chunk["text"], "locator": chunk["locator"], "matched_terms": matched,
                         "valid_until": doc.get("valid_until"), "is_demo": doc.get("is_demo", False)})
            count[doc["id"]] = count.get(doc["id"], 0) + 1
            if len(hits) == 6:
                break
    fingerprint = json.dumps({"space": space["id"], "query": body.query, "channel": body.channel, "hits": hits}, ensure_ascii=False, sort_keys=True)
    return {"space": space, "query": body.query, "channel": body.channel, "terms": tokens, "hits": hits,
            "signature": hashlib.sha256(fingerprint.encode()).hexdigest(),
            "can_generate": any(hit["kind"] != "script" for hit in hits),
            "note": "按关键词相关性排序，不是事实置信度；仅检索当前空间、渠道下已审核且有效的资料。"}


def source_warnings(db, draft):
    warnings = []
    for source in draft["sources"]:
        doc = get(db, "kb_documents", source["document_id"])
        if doc["version"] != source["version"] or availability(doc) != "可检索":
            text = f"{source['title']} V{source['version']} 已更新或不可用（当前 V{doc['version']}，{availability(doc)}）"
            if text not in warnings:
                warnings.append(text)
    return warnings


def draft_view(db, draft):
    warnings = source_warnings(db, draft)
    from backend.creative_handoff import handoff_status
    ready, note = handoff_status(db, draft)
    transfers = [item for item in records(db, "kb_transfers") if item["draft_id"] == draft["id"] and item["revision"] == draft["revision"]]
    task = get(db, "agent_runs", draft["agent_task_id"]) if draft.get("agent_task_id") else {}
    return {**draft, "source_warnings": warnings, "can_confirm": not warnings and draft["status"] == "draft",
            "can_transfer": ready, "transfer_note": note, "transfers": transfers,
            "linked_campaign_id": task.get("campaign_id")}


def check_blocks(blocks, sources):
    allowed = {source["id"]: source for source in sources}
    for block in blocks:
        refs = block["citation_ids"]
        if any(key not in allowed for key in refs) or not any(allowed[key]["kind"] != "script" for key in refs):
            raise HTTPException(422, "每段内容必须引用本次检索的有效资料，不能只用历史脚本作事实依据。")


def register_knowledge(app, store, adapter):
    from backend.main import once, model_operation, log

    @app.get("/api/knowledge/spaces")
    def spaces():
        with store.transaction() as db:
            return records(db, "kb_spaces")

    @app.post("/api/knowledge/spaces")
    def create_space(body: SpaceInput):
        with store.transaction() as db:
            return once(db, "kb-space", body, lambda: put(db, "kb_spaces", {"id": identifier("space"), "name": body.name, "scene": body.scene, "is_demo": False, "created_at": stamp()}))

    @app.get("/api/knowledge/documents")
    def documents(space_id: str):
        with store.transaction() as db:
            get(db, "kb_spaces", space_id)
            return [summary(d) for d in records(db, "kb_documents") if d["space_id"] == space_id]

    @app.get("/api/knowledge/documents/{doc_id}")
    def document(doc_id: str):
        with store.transaction() as db:
            doc = get(db, "kb_documents", doc_id)
            return {**doc, "availability": availability(doc)}

    @app.post("/api/knowledge/documents")
    def create_document(body: DocumentInput):
        with store.transaction() as db:
            def run():
                doc = save_document(db, body)
                log(db, "导入知识资料", f"{doc['title']} V{doc['version']}，待人工审核。")
                return doc
            return once(db, "kb-create", body, run)

    @app.put("/api/knowledge/documents/{doc_id}")
    def edit_document(doc_id: str, body: DocumentInput):
        with store.transaction() as db:
            return once(db, "kb-edit:" + doc_id, body, lambda: save_document(db, body, get(db, "kb_documents", doc_id)))

    @app.post("/api/knowledge/documents/{doc_id}/review")
    def review_document(doc_id: str, body: ReviewInput):
        with store.transaction() as db:
            def run():
                doc = get(db, "kb_documents", doc_id)
                if doc["version"] != body.expected_version:
                    raise HTTPException(409, "资料版本已变化，请重新打开核对。")
                doc.update(status=body.status, reviewed_at=stamp(), reviewed_by="本地演示运营员")
                log(db, "知识资料审核", f"{doc['title']} V{doc['version']}：{body.status}；不表示获准公开发布。")
                return put(db, "kb_documents", doc)
            return once(db, "kb-review:" + doc_id, body, run)

    @app.post("/api/knowledge/extract")
    def extract(file: UploadFile = File(...)):
        try:
            return extract_text(file.filename or "", file.file.read(MAX_UPLOAD + 1))
        finally:
            file.file.close()

    @app.post("/api/knowledge/spaces/{space_id}/samples")
    def samples(space_id: str):
        with store.transaction() as db:
            space = get(db, "kb_spaces", space_id)
            if not space.get("is_demo"):
                raise HTTPException(422, "示例只载入内置演示空间，不写入你的机构或品牌空间。")
            existing = [d for d in records(db, "kb_documents") if d["space_id"] == space_id and d.get("sample_key")]
            for i, sample in enumerate(SAMPLES[space["scene"]]):
                key = space_id + ":" + str(i)
                if any(d["sample_key"] == key for d in existing):
                    continue
                doc = save_document(db, DocumentInput(space_id=space_id, title=sample["title"], kind=sample["kind"], pages=[Page(text=sample["text"])]), is_demo=True)
                doc.update(sample_key=key)
                put(db, "kb_documents", doc)
            log(db, "载入知识库演示资料", space["name"] + "；均为虚构，待人工审核。")
            return [summary(d) for d in records(db, "kb_documents") if d["space_id"] == space_id]

    @app.post("/api/knowledge/search")
    def retrieve(body: SearchInput):
        with store.transaction() as db:
            return search(db, body)

    @app.post("/api/knowledge/drafts")
    def generate(body: GenerateInput):
        def prepare(db):
            result = search(db, body)
            if body.signature != result["signature"]:
                raise HTTPException(409, "资料、渠道或关键词已变化，请重新检索并核对来源。")
            if not result["can_generate"]:
                raise HTTPException(422, "没有找到可作为依据的资料。请补充事实或审核要求并重新检索；未调用模型。")
            return result

        def save(db, context, content):
            if search(db, body)["signature"] != context["signature"]:
                raise HTTPException(409, "生成期间资料发生变化，请重新检索；未保存过时草稿。")
            check_blocks(content["blocks"], context["hits"])
            used = {key for block in content["blocks"] for key in block["citation_ids"]}
            draft = {**content, "id": identifier("rag"), "space_id": body.space_id, "scene": context["space"]["scene"],
                     "query": body.query, "channel": body.channel, "task": body.task, "created_at": stamp(),
                     "status": "draft", "revision": 1, "history": [], "sources": [s for s in context["hits"] if s["id"] in used],
                     "source": "replay" if adapter.mode == "replay" else "model", **adapter.provenance}
            put(db, "kb_drafts", draft)
            log(db, "生成知识草稿", f"{draft['title']}；{adapter.info['label']}，需人工核对引用。")
            return draft_view(db, draft)
        return model_operation(store, adapter, "kb-generate", body, prepare,
                               lambda context: adapter.knowledge_draft(context, body.task), save)

    @app.get("/api/knowledge/drafts")
    def drafts(space_id: str):
        with store.transaction() as db:
            get(db, "kb_spaces", space_id)
            return [draft_view(db, d) for d in reversed(records(db, "kb_drafts")) if d["space_id"] == space_id]

    @app.put("/api/knowledge/drafts/{draft_id}")
    def edit_draft(draft_id: str, body: DraftEdit):
        with store.transaction() as db:
            def run():
                item = get(db, "kb_drafts", draft_id)
                if item["revision"] != body.expected_revision:
                    raise HTTPException(409, "草稿已在其他页面更新，请重新打开。")
                blocks = [b.model_dump() for b in body.blocks]
                check_blocks(blocks, item["sources"])
                item["history"].append({k: item.get(k) for k in ("revision", "title", "blocks", "status", "confirmed_at")})
                item.update(title=body.title, blocks=blocks, revision=item["revision"] + 1, status="draft", edited_by="本地演示运营员", updated_at=stamp())
                item.pop("confirmed_at", None)
                put(db, "kb_drafts", item)
                return draft_view(db, item)
            return once(db, "kb-draft-edit:" + draft_id, body, run)

    @app.post("/api/knowledge/drafts/{draft_id}/confirm")
    def confirm_draft(draft_id: str, body: ConfirmInput):
        with store.transaction() as db:
            def run():
                item = get(db, "kb_drafts", draft_id)
                if item["revision"] != body.expected_revision or source_warnings(db, item):
                    raise HTTPException(409, "草稿或引用资料已变化，请重新核对并生成。")
                if item["status"] != "confirmed":
                    item.update(status="confirmed", confirmed_at=stamp(), confirmed_by="本地演示运营员")
                    put(db, "kb_drafts", item)
                    log(db, "确认知识草稿", item["title"] + "；确认内容与引用，不代表广告审核通过，未执行发布。")
                return draft_view(db, item)
            return once(db, "kb-confirm:" + draft_id, body, run)
