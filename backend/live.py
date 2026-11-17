"""Single-shop live preparation. No platform calls or stock/payment execution."""
from copy import deepcopy
from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException
from pydantic import AwareDatetime, Field, model_validator

from backend.main import (Input, Idempotent, ProductInput, GenerateInput, all_records, get,
                          put, once, uid, now, log, money, model_operation, creative_record)


class SKU(Input):
    id: str = Field(default="", max_length=100)
    label: str = Field(min_length=1, max_length=100)
    capacity: str = Field(min_length=1, max_length=40)
    color: str = Field(min_length=1, max_length=40)
    price: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    price_source: str = Field(min_length=1, max_length=1000)
    stock: int | None = Field(default=None, ge=0, le=10000000, strict=True)
    stock_source: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def source_required(self):
        if self.stock is not None and not self.stock_source:
            raise ValueError("录入库存时必须填写来源；这是人工参考库存，不会自动扣减")
        return self


class CatalogInput(ProductInput):
    request_id: str = Field(default_factory=lambda: uid("req"), max_length=128)
    expected_version: int | None = Field(default=None, ge=1)
    skus: list[SKU] = Field(min_length=1, max_length=30)


class LineInput(Input):
    id: str = Field(default="", max_length=100)
    product_id: str = Field(min_length=1, max_length=100)
    sku_id: str = Field(min_length=1, max_length=100)
    talking_points: str = Field(default="", max_length=1000)
    promotion: str = Field(default="", max_length=1000)
    promotion_source: str = Field(default="", max_length=1000)


class SessionInput(Idempotent):
    expected_version: int | None = Field(default=None, ge=1)
    campaign_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=120)
    host: str = Field(min_length=1, max_length=100)
    scheduled_start: AwareDatetime
    scheduled_end: AwareDatetime
    goal: str = Field(default="", max_length=1500)
    items: list[LineInput] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def period(self):
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError("场次结束时间必须晚于开始时间")
        keys = [(x.product_id, x.sku_id) for x in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("同一 SKU 在本场货盘中只能出现一次")
        if any(x.promotion and not x.promotion_source for x in self.items):
            raise ValueError("优惠说明必须同时填写依据，空白表示尚未提供优惠")
        return self


class SessionStatus(Idempotent):
    expected_version: int = Field(ge=1)
    status: Literal["ready", "archived"]
    acknowledged: bool = False


class ReviewInput(Idempotent):
    dataset: Literal["session", "batch"] = "session"
    batch_id: str | None = None


class LiveReportInput(ReviewInput):
    title: str = Field(min_length=1, max_length=200)
    conclusion: str = Field(default="", max_length=6000)
    next_action: str = Field(default="", max_length=6000)


def catalog(db):
    # The legacy product is projected, never migrated or rewritten on read/startup.
    legacy = deepcopy(all_records(db, "product")[0])
    legacy.update(legacy=True, skus=[dict(id="default", label=legacy["capacity"] + " · " + legacy["color"],
        capacity=legacy["capacity"], color=legacy["color"], price=legacy["price"],
        price_source=legacy.get("evidence") or legacy.get("source") or "原演示商品设定",
        stock=None, stock_source="", recorded_at=legacy.get("updated_at", legacy.get("created_at")))])
    return [legacy, *all_records(db, "live_products")]


def session_context(db, session_id, item_id, campaign_id=None):
    session = get(db, "live_sessions", session_id)
    if campaign_id and session["campaign_id"] != campaign_id:
        raise HTTPException(422, "场次不属于目标营销活动")
    if session["status"] == "archived":
        raise HTTPException(409, "场次已归档，请新建场次准备下一轮内容")
    item = next((i for i in session["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "找不到本场货盘条目")
    return {"session_id": session_id, "session_version": session["version"], "session_title": session["title"],
            "campaign_id": session["campaign_id"], "item_id": item_id, "product_id": item["product_id"],
            "sku_id": item["sku_id"], "sku_label": item["sku_label"], "product_snapshot": deepcopy(item["product_snapshot"]),
            "price_source": item["price_source"], "promotion": item["promotion"], "promotion_source": item["promotion_source"]}


def check_live(db, record, require_ready=True):
    context = record.get("live_context")
    if not context:
        return
    current = session_context(db, context["session_id"], context["item_id"], record.get("campaign_id") or context["campaign_id"])
    if current != context:
        raise HTTPException(409, "场次货盘已修订，请从当前货盘重新准备内容；旧快照继续保留")
    if require_ready and get(db, "live_sessions", context["session_id"])["status"] != "ready":
        raise HTTPException(409, "请先在直播场次中人工确认货盘与价格，再确认素材或启动模拟计划")


def context_fields(record):
    context = record.get("live_context") or record.get("creative_snapshot", {}).get("live_context")
    return {"live_context": deepcopy(context)} if context else {}


def ensure_live_space(db, context):
    """Materialize only an explicitly confirmed SKU snapshot, isolated by revision."""
    from backend.knowledge import DocumentInput, Page, save_document
    space_id = f"{context['session_id']}-{context['item_id']}-v{context['session_version']}"
    existing = next((s for s in all_records(db, "kb_spaces") if s["id"] == space_id), None)
    if existing:
        return existing
    p = context["product_snapshot"]
    space = put(db, "kb_spaces", {"id": space_id, "scene": "live", "name": (context["session_title"] + " · " + p["name"])[:60],
                                 "is_demo": "虚构" in context["price_source"], "created_at": now(), "live_context": context})
    text = (f"直播货盘商品：{p['name']}。品牌：{p['brand']}。规格：{p['capacity']}。颜色：{p['color']}。\n"
            f"本场人工记录价格：¥{p['price']:g}。价格依据：{context['price_source']}。\n"
            f"商品已知资料：{p['description']}\n资料来源：{p.get('evidence') or '人工货盘记录，未独立核验'}。\n"
            f"本场优惠说明：{context['promotion'] or '未提供，不作优惠承诺'}。依据：{context['promotion_source'] or '无'}。")
    for title, kind, content in ((p["name"][:95] + " · 本场商品事实", "facts", text),
                                  ("本场讲解与人工核对要求", "rules", p["restrictions"] + "。仅用于内部直播准备；库存未连接平台，禁止承诺剩余库存、销量或效果。")):
        doc = save_document(db, DocumentInput(space_id=space_id, title=title, kind=kind, pages=[Page(text=content)]), is_demo=space["is_demo"])
        doc.update(status="approved", reviewed_by="沿用运营人工确认的货盘版本（非平台审核）", reviewed_at=now())
        put(db, "kb_documents", doc)
    return space


def session_analytics(db, session_id, dataset="session", batch_id=None):
    from backend.v2 import query_analytics, session_metrics
    from backend.trends import with_trend
    session = get(db, "live_sessions", session_id)
    a = query_analytics(db, dataset, session["campaign_id"], batch_id=batch_id)
    if dataset == "batch":
        context = get(db, "batches", batch_id)["plan_snapshot"]["creative_snapshot"].get("live_context", {})
        if context.get("session_id") != session_id:
            raise HTTPException(409, "该模拟批次不属于此直播场次")
    elif dataset == "session":
        plans = [p for p in all_records(db, "plans") if p["creative_snapshot"].get("live_context", {}).get("session_id") == session_id]
        ids = {p["id"] for p in plans}
        a["orders"] = [o for o in a["orders"] if o["plan_id"] in ids]
        events = [e for e in all_records(db, "events") if e["plan_id"] in ids]
        a["rows"] = [r for r in a["rows"] if r["plan_id"] in ids]
        a["metrics"] = session_metrics(a["orders"], events)
        a["views"] = sum(e["type"] == "view" for e in events)
    else:
        raise HTTPException(422, "历史 D0 没有直播场次归属，不能计入本场")
    a["filters"]["live_session_id"] = session_id
    m = a["metrics"]
    a["identification_coverage"] = (m["buyers"] - m["unknown_buyers"])/m["buyers"] if m["buyers"] else None
    a["label"] += " · " + session["title"]
    a["missing_live_metrics"] = ["平台在线人数", "观看时长", "平台直播成交与归因"]
    plans = {p["id"]: p for p in all_records(db, "plans")}
    for row in a["rows"]:
        row["live_context"] = plans[row["plan_id"]]["creative_snapshot"].get("live_context")
    return with_trend(a)


def register_live(app, store, adapter):
    @app.get("/api/live/catalog")
    def read_catalog():
        with store.transaction() as db:
            return catalog(db)

    def save_product(db, body, product_id=None):
        old = get(db, "live_products", product_id) if product_id else None
        if old and old["version"] != body.expected_version:
            raise HTTPException(409, "商品资料已变化，请刷新后编辑")
        for url in (body.image_url, body.video_url):
            if url.startswith("/uploads/") and not (store.directory / "uploads" / url.split("/")[-1]).is_file():
                raise HTTPException(422, "上传素材不存在")
        labels = [s.label for s in body.skus]
        ids = [s.id for s in body.skus if s.id]
        if len(set(labels)) != len(labels) or len(set(ids)) != len(ids):
            raise HTTPException(422, "SKU 名称或编号不能重复")
        old_ids = {s["id"] for s in old["skus"]} if old else set()
        if any(i not in old_ids for i in ids):
            raise HTTPException(422, "新 SKU 请留空编号，由服务端分配")
        fields = body.model_dump(exclude={"request_id", "expected_version", "skus"})
        skus = [{**s.model_dump(exclude={"request_id"}), "id": s.id or uid("sku"), "price": money(s.price), "recorded_at": now()} for s in body.skus]
        record = {**fields, "id": product_id or uid("product"), "price": skus[0]["price"], "skus": skus,
                  "version": old["version"] + 1 if old else 1, "created_at": old["created_at"] if old else now(), "updated_at": now()}
        put(db, "live_products", record)
        log(db, "保存直播商品", record["name"] + "；既有货盘快照保持不变")
        return record

    @app.post("/api/live/catalog")
    def create_product(body: CatalogInput):
        with store.transaction() as db:
            return once(db, "live-product", body, lambda: save_product(db, body))

    @app.put("/api/live/catalog/{product_id}")
    def update_product(product_id: str, body: CatalogInput):
        with store.transaction() as db:
            return once(db, "live-product:" + product_id, body, lambda: save_product(db, body, product_id))

    @app.get("/api/live/sessions")
    def read_sessions(campaign_id: str | None = None):
        with store.transaction() as db:
            return [s for s in all_records(db, "live_sessions") if not campaign_id or s["campaign_id"] == campaign_id]

    def save_session(db, body, session_id=None):
        campaign = get(db, "campaigns", body.campaign_id)
        old = get(db, "live_sessions", session_id) if session_id else None
        if old and (old["version"] != body.expected_version or old["status"] == "archived" or old["campaign_id"] != body.campaign_id):
            raise HTTPException(409, "场次版本或状态已变化；已归档场次和所属活动不能改写")
        products = {p["id"]: p for p in catalog(db)}
        old_lines = {i["id"] for i in old["items"]} if old else set()
        items = []
        seen = set()
        for line in body.items:
            if line.id and (line.id not in old_lines or line.id in seen):
                raise HTTPException(422, "货盘条目编号无效")
            seen.add(line.id)
            product = products.get(line.product_id)
            sku = next((s for s in product["skus"] if s["id"] == line.sku_id), None) if product else None
            if not sku:
                raise HTTPException(422, "所选商品或 SKU 已不存在，请重新选择")
            snapshot = {k: deepcopy(v) for k, v in product.items() if k not in {"skus", "legacy"}}
            snapshot.update(price=sku["price"], capacity=sku["capacity"], color=sku["color"], sku_id=sku["id"], sku_label=sku["label"])
            items.append({**line.model_dump(exclude={"request_id"}), "id": line.id or uid("line"), "sku_label": sku["label"],
                          "product_snapshot": snapshot, "price_source": sku["price_source"], "stock": sku["stock"],
                          "stock_source": sku["stock_source"], "recorded_at": sku.get("recorded_at")})
        record = {**body.model_dump(mode="json", exclude={"request_id", "expected_version", "items"}), "items": items,
                  "id": session_id or uid("live"), "campaign_name": campaign["name"], "version": old["version"] + 1 if old else 1,
                  "status": "draft", "created_at": old["created_at"] if old else now(), "updated_at": now(),
                  "history": (old.get("history", []) + [{k: deepcopy(v) for k, v in old.items() if k != "history"}]) if old else []}
        put(db, "live_sessions", record)
        log(db, "保存直播筹备场次", record["title"] + "；待人工核对货盘，未操作直播平台")
        return record

    @app.post("/api/live/sessions")
    def create_session(body: SessionInput):
        with store.transaction() as db:
            return once(db, "live-session", body, lambda: save_session(db, body))

    @app.put("/api/live/sessions/{session_id}")
    def update_session(session_id: str, body: SessionInput):
        with store.transaction() as db:
            return once(db, "live-session:" + session_id, body, lambda: save_session(db, body, session_id))

    @app.post("/api/live/sessions/{session_id}/status")
    def status(session_id: str, body: SessionStatus):
        with store.transaction() as db:
            def run():
                s = get(db, "live_sessions", session_id)
                if s["version"] != body.expected_version or s["status"] == "archived":
                    raise HTTPException(409, "场次版本或状态已变化，请刷新")
                if not body.acknowledged:
                    raise HTTPException(422, "请人工核对货盘价格、优惠与资料来源")
                if s["status"] == body.status:
                    return s
                s.setdefault("status_history", []).append({"from": s["status"], "to": body.status, "at": now(), "by": "演示运营"})
                s.update(status=body.status, updated_at=now())
                if body.status == "ready":
                    s.update(confirmed_at=now(), confirmed_by="演示运营")
                else:
                    s["archived_at"] = now()
                put(db, "live_sessions", s)
                log(db, "确认直播筹备状态", s["title"] + " → " + body.status + "；不代表平台开播或停播")
                return s
            return once(db, "live-status:" + session_id, body, run)

    @app.post("/api/live/sessions/{session_id}/items/{item_id}/generate")
    def generate(session_id: str, item_id: str, body: GenerateInput):
        from backend.v2 import generate_fields
        def prepare(db):
            context = session_context(db, session_id, item_id)
            c = get(db, "campaigns", context["campaign_id"])
            c.update(product_snapshot=context["product_snapshot"], live_context=context)
            return c
        def save(db, campaign, content):
            if prepare(db) != campaign:
                raise HTTPException(409, "生成期间场次或策略已变化，请重新生成")
            result = []
            for fields in content:
                # A finite replay should reuse an identical draft, not fill the library.
                existing = next((c for c in all_records(db, "creatives") if adapter.mode == "replay" and c.get("live_context") == campaign["live_context"] and c["source"] == "replay" and all(c.get(k) == fields.get(k) for k in ("title", "body", "script", "cta"))), None)
                result.append(existing or put(db, "creatives", creative_record(campaign, fields, "replay" if adapter.mode == "replay" else "model")))
            return result
        return model_operation(store, adapter, "live-generate:" + session_id + ":" + item_id, body, prepare,
                               lambda c: generate_fields(adapter, c, body), save)

    @app.get("/api/live/sessions/{session_id}/analytics")
    def analytics(session_id: str, dataset: Literal["session", "batch"] = "session", batch_id: str | None = None):
        with store.transaction() as db:
            return session_analytics(db, session_id, dataset, batch_id)

    @app.post("/api/live/sessions/{session_id}/reviews")
    def review(session_id: str, body: ReviewInput):
        def prepare(db):
            return session_analytics(db, session_id, body.dataset, body.batch_id)
        def save(db, snapshot, content):
            return put(db, "live_reviews", {"id": uid("review"), "live_session_id": session_id, "created_at": now(),
                       "source": "replay" if adapter.mode == "replay" else "model", "analytics_snapshot": snapshot, **content})
        return model_operation(store, adapter, "live-review:" + session_id, body, prepare, adapter.insight, save)

    @app.get("/api/live/reports")
    def reports():
        with store.transaction() as db:
            return all_records(db, "live_reports")

    @app.post("/api/live/sessions/{session_id}/reports")
    def save_report(session_id: str, body: LiveReportInput):
        with store.transaction() as db:
            def run():
                return put(db, "live_reports", {"id": uid("live-report"), "live_session_id": session_id, "created_at": now(),
                    "title": body.title, "conclusion": body.conclusion, "next_action": body.next_action,
                    "session_snapshot": get(db, "live_sessions", session_id),
                    "analytics_snapshot": session_analytics(db, session_id, body.dataset, body.batch_id)})
            return once(db, "live-report:" + session_id, body, run)
