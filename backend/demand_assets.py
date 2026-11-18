"""Demand materials are immutable inputs, never approved institutional facts.

Imports retain physical cell locations. Cleaning changes only the normalized
field; merging semantically similar questions is always a human decision.
"""
from __future__ import annotations

import csv
from copy import deepcopy
from datetime import date, datetime, timezone
from hashlib import sha256
from io import BytesIO, StringIO
import json
from pathlib import PurePosixPath
import re
from typing import Literal
import unicodedata
from zipfile import ZipFile

from fastapi import File, HTTPException, UploadFile
from pydantic import ConfigDict, Field, model_validator

from backend.demand_schemas import Filters, TaskKind
from backend.knowledge import Input, Operation, DocumentInput, get, identifier, put, records, stamp, save_document

MAX_UPLOAD = 5 * 1024 * 1024
MAX_EXPANDED = 50 * 1024 * 1024
MAX_ROWS = 2000
MAX_COLS = 20
MAX_CHARS = 120_000


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip().casefold()


def filename_only(value: str) -> str:
    return PurePosixPath(value.replace("\\", "/")).name[:180] or "粘贴素材"


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def formula(value: str) -> bool:
    return bool(re.match(r"^(?:[=+@]|-[A-Za-z_]+\s*\()", value.lstrip()))


def check_sheet_xml(archive):
    """Bound sparse physical coordinates before openpyxl expands empty cells."""
    from defusedxml.ElementTree import iterparse
    for member in archive.namelist():
        if not member.startswith("xl/worksheets/") or not member.endswith(".xml"):
            continue
        with archive.open(member) as stream:
            for _, element in iterparse(stream, events=("end",)):
                name = element.tag.rsplit("}", 1)[-1]
                if name == "row":
                    if int(element.get("r", "0")) > MAX_ROWS:
                        raise HTTPException(422, "单表最多 2,000 行（含表头），请移除多余空行或格式后重试。")
                elif name == "c":
                    coordinate = re.fullmatch(r"([A-Z]+)(\d+)", element.get("r", ""))
                    if coordinate:
                        column = 0
                        for letter in coordinate.group(1):
                            column = column * 26 + ord(letter) - ord("A") + 1
                        if column > MAX_COLS or int(coordinate.group(2)) > MAX_ROWS:
                            raise HTTPException(422, "单表最多 2,000 行、20 列，请移除多余空行列或格式后重试。")
                element.clear()


def _sheet(name: str, raw_rows: list[dict], warnings: list[str]) -> dict:
    rows = []
    total = 0
    for row in raw_rows:
        if len(row["values"]) > MAX_COLS:
            raise HTTPException(422, "每张表最多 20 列，请删去无关列后导入。")
        values = []
        for col, value in enumerate(row["values"]):
            value = str(value) if value is not None else ""
            if len(value) > 6000:
                raise HTTPException(422, f"{name} 第 {row['row']} 行单元格超过 6,000 字，请拆分。")
            if formula(value):
                warnings.append(f"{name} 第 {row['row']} 行第 {col + 1} 列为公式，已跳过；请导出核实后的纯文本值。")
                value = ""
            total += len(value)
            values.append(value)
        if total > MAX_CHARS:
            raise HTTPException(422, "每张表最多 12 万字，请拆分素材。")
        if any(v.strip() for v in values):
            rows.append({"row": row["row"], "values": values})
    width = max((len(r["values"]) for r in rows), default=0)
    first = rows[0]["values"] if rows else []
    headers = [{"column": i, "label": (first[i].strip() if i < len(first) and first[i].strip() else f"第 {i + 1} 列")[:120]} for i in range(width)]
    return {"name": name, "headers": headers, "rows": rows}


def preview_import(filename: str, content: bytes):
    if not content or len(content) > MAX_UPLOAD:
        raise HTTPException(413, "文件为空或超过 5 MB，请拆分后重试。")
    filename = filename_only(filename)
    suffix = PurePosixPath(filename).suffix.lower()
    warnings = []
    sheets = []
    if suffix in {".csv", ".txt", ".tsv"}:
        decoded = None
        for encoding in ("utf-8-sig", "gb18030"):
            try:
                decoded = content.decode(encoding)
                if encoding == "gb18030":
                    warnings.append("文件按 GB18030 解码，请核对预览中的中文。")
                break
            except UnicodeDecodeError:
                continue
        if decoded is None or "\x00" in decoded:
            raise HTTPException(422, "无法读取文本编码，请另存为 UTF-8 CSV 或 TXT。")
        raw_rows = []
        try:
            if suffix == ".txt":
                raw_rows = [{"row": i, "values": [line]} for i, line in enumerate(decoded.splitlines(), 1)]
            else:
                delimiter = "\t" if suffix == ".tsv" else ","
                try:
                    delimiter = csv.Sniffer().sniff(decoded[:8192], delimiters=",\t;").delimiter
                except csv.Error:
                    pass
                reader = csv.reader(StringIO(decoded, newline=""), delimiter=delimiter, strict=True)
                for values in reader:
                    # For quoted multiline cells preserve the physical start line.
                    physical = raw_rows[-1]["end_line"] + 1 if raw_rows else 1
                    raw_rows.append({"row": physical, "end_line": reader.line_num, "values": values})
                    if len(raw_rows) > MAX_ROWS:
                        raise HTTPException(422, "单表最多 2,000 行（含表头），请拆分导入。")
        except csv.Error:
            raise HTTPException(422, "CSV 格式不正确，请检查引号并重新导出。") from None
        if len(raw_rows) > MAX_ROWS:
            raise HTTPException(422, "单表最多 2,000 行（含表头），请拆分导入。")
        sheets.append(_sheet("文本" if suffix == ".txt" else "CSV", raw_rows, warnings))
    elif suffix == ".xlsx":
        try:
            with ZipFile(BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 3000 or sum(i.file_size for i in entries) > MAX_EXPANDED:
                    raise HTTPException(413, "工作簿解压内容超过限制，请移除图片和无关工作表后重试。")
                if any(i.flag_bits & 1 for i in entries):
                    raise HTTPException(422, "不支持加密工作簿，请先导出无密码版本。")
                check_sheet_xml(archive)
            from openpyxl import load_workbook
            # openpyxl uses defusedxml when installed; root pins both dependencies.
            from openpyxl.xml import DEFUSEDXML
            if not DEFUSEDXML:
                raise HTTPException(503, "缺少安全表格解析依赖 defusedxml，请安装后重试。")
            workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
            try:
                if len(workbook.worksheets) > 10:
                    raise HTTPException(422, "工作簿最多 10 张工作表，请拆分导入。")
                for worksheet in workbook.worksheets:
                    # Never trust worksheet dimension metadata; bound actual XML rows.
                    worksheet.reset_dimensions()
                    raw_rows = []
                    for number, cells in enumerate(worksheet.iter_rows(), 1):
                        if number > MAX_ROWS:
                            raise HTTPException(422, "单表最多 2,000 行（含表头），请拆分导入。")
                        values = []
                        for cell in cells:
                            value = cell.value
                            if isinstance(value, (date, datetime)):
                                value = value.isoformat()
                            if cell.data_type == "f" or (isinstance(value, str) and formula(value)):
                                warnings.append(f"{worksheet.title} 第 {number} 行第 {len(values) + 1} 列为公式，已跳过。")
                                value = ""
                            values.append("" if value is None else str(value))
                        raw_rows.append({"row": number, "values": values})
                    sheets.append(_sheet(worksheet.title, raw_rows, warnings))
            finally:
                workbook.close()
        except HTTPException:
            raise
        except ImportError:
            raise HTTPException(503, "表格读取依赖尚未安装，请先安装 openpyxl 和 defusedxml。") from None
        except Exception:
            raise HTTPException(422, "无法读取 XLSX，请重新导出有效的无密码工作簿。") from None
    else:
        raise HTTPException(422, "需求素材支持 CSV、TSV、TXT、XLSX；请先转换其他格式。")
    if not any(s["rows"] for s in sheets):
        raise HTTPException(422, "文件中没有可导入的非公式文本。")
    if sum(sum(len(v) for v in row['values']) for s in sheets for row in s['rows']) > MAX_CHARS:
        raise HTTPException(422, "工作簿文本合计最多 12 万字，请拆分导入。")
    if len(warnings) > 100:
        warnings = warnings[:100] + [f"其余 {len(warnings) - 100} 条公式跳过提示已省略；所有公式均未作为素材。"]
    return {"filename": filename, "sheets": sheets, "warnings": warnings,
            "note": "每个所选文本单元格分别保存为一条需求素材；表头和时间列不会作为需求事实。"}


class Column(Input):
    column: int = Field(ge=0, lt=MAX_COLS)
    label: str = Field(default="", max_length=120)


class ImportRow(Input):
    model_config = ConfigDict(str_strip_whitespace=False, extra="forbid")
    row: int = Field(ge=1, le=100_000)
    values: list[str] = Field(min_length=1, max_length=MAX_COLS)


class BatchInput(Operation):
    space_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=500)
    sheet: str = Field(default="文本", min_length=1, max_length=120)
    columns: list[Column] = Field(min_length=1, max_length=MAX_COLS)
    rows: list[ImportRow] = Field(min_length=1, max_length=MAX_ROWS)
    time_column: int | None = Field(default=None, ge=0, lt=MAX_COLS)
    has_header: bool = True

    @model_validator(mode="after")
    def valid_cells(self):
        selected = [c.column for c in self.columns]
        if len(set(selected)) != len(selected) or self.time_column in selected:
            raise ValueError("文本列不能重复，也不能与时间列相同")
        numbers = [r.row for r in self.rows]
        if numbers != sorted(set(numbers)):
            raise ValueError("行号必须严格递增且不能重复")
        if sum(len(v) for r in self.rows for v in r.values) > MAX_CHARS:
            raise ValueError("素材文本最多 12 万字")
        if any(len(v) > 6000 for r in self.rows for v in r.values):
            raise ValueError("单元格最多 6,000 字")
        width = max(len(r.values) for r in self.rows)
        if any(c >= width for c in selected) or (self.time_column is not None and self.time_column >= width):
            raise ValueError("所选列不存在，请重新预览")
        return self


class ScopedOperation(Operation):
    space_id: str = Field(min_length=1, max_length=80)


class FromKnowledge(ScopedOperation):
    document_id: str = Field(min_length=1, max_length=100)
    expected_version: int | None = Field(default=None, ge=1)
    preview_signature: str | None = Field(default=None, min_length=64, max_length=64)
    reclassify: bool = False


class WordMetadata(Input):
    text: str = Field(min_length=1, max_length=60)
    role: Literal['theme', 'intent', 'exclude']
    status: Literal['pending', 'confirmed'] = 'pending'
    tags: list[str] = Field(default_factory=list, max_length=8)
    aliases: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode='after')
    def valid_words(self):
        if any(not word.strip() or len(word) > 60 for word in self.tags + self.aliases):
            raise ValueError('标签与近义词应为 1 至 60 字')
        return self


class PackInput(ScopedOperation):
    name: str = Field(min_length=1, max_length=100)
    theme_terms: list[str] = Field(default_factory=list, max_length=30)
    intent_terms: list[str] = Field(default_factory=list, max_length=30)
    exclude_terms: list[str] = Field(default_factory=list, max_length=30)
    source_batch_id: str | None = Field(default=None, max_length=100)
    entries: list[WordMetadata] | None = Field(default=None, max_length=90)

    @model_validator(mode="after")
    def bounds(self):
        if any(len(w) > 60 for key in ('theme_terms', 'intent_terms', 'exclude_terms') for w in getattr(self, key)):
            raise ValueError("单个关键词最多 60 字")
        return self


class PackUpdate(PackInput):
    expected_version: int = Field(ge=1)


class TemplateInput(ScopedOperation):
    name: str = Field(min_length=1, max_length=100)
    task_type: TaskKind
    filters: Filters = Field(default_factory=Filters)


class TemplateUpdate(TemplateInput):
    expected_version: int = Field(ge=1)


BUILTINS = [
    {"id": "builtin-" + kind, "space_id": None, "name": name, "version": 1, "task_type": kind,
     "description": description, "filters": Filters(**defaults).model_dump(mode="json"), "history": [], "builtin": True,
     "output_description": output}
    for kind, name, description, defaults, output in (
        ("organize", "整理词库", "保留原文与逐条来源，规范和去重后人工确认，再选入主题、意图或排除词包。", {"missing_time": "include", "limit": 2000}, "词条清单、重复来源、可转入词包的确认记录"),
        ("analyze", "分析需求记录", "核对主题与意图条件、否定和交流语境；不自动认定购买意愿。", {}, "命中与排除原因、人工分类与审核清单"),
        ("topics", "创建选题卡", "按已确认的主题组组织问题、受众问题及证据清单。", {"limit": 100, "missing_time": "include"}, "主题选题、问题集合、写作角度与证据缺口"),
        ("faq", "内部 FAQ", "逐条回应已确认问题，只使用已审核的原文事实，缺口留待补充。", {"limit": 50, "missing_time": "include"}, "问题与原文回答依据、引用、待补事项"),
    )
]


def lookup_template(db, template_id: str, space_id: str):
    get(db, "kb_spaces", space_id)
    for template in BUILTINS:
        if template["id"] == template_id:
            return json.loads(json.dumps(template))
    item = get(db, "demand_templates", template_id)
    if item["space_id"] != space_id:
        raise HTTPException(404, "当前空间没有此任务模板。")
    return item


def lookup_pack(db, pack_id: str, space_id: str):
    get(db, "kb_spaces", space_id)
    item = get(db, "demand_packs", pack_id)
    if item["space_id"] != space_id:
        raise HTTPException(404, "当前空间没有此词包。")
    return item


def parse_time(value: str):
    value = value.strip()
    if not value:
        return None, "未提供时间"
    try:
        parsed = datetime.fromisoformat(value.replace("/", "-").replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).isoformat(), None
    except ValueError:
        return None, f"时间无法识别：{value[:80]}（请使用 YYYY-MM-DD）"


def save_batch(db, space_id, title, source_kind, rows, identity, **extra):
    get(db, "kb_spaces", space_id)
    fingerprint = digest({"space_id": space_id, "source_kind": source_kind, **identity})
    batch_id = "demand-batch-" + fingerprint[:24]
    previous = db.execute("SELECT data FROM records WHERE collection='demand_batches' AND id=?", (batch_id,)).fetchone()
    if previous:
        return json.loads(previous[0])
    if not rows or len(rows) > MAX_ROWS:
        raise HTTPException(422, "请选择非空文本列；每批最多 2,000 条素材。")
    seen = {}
    duplicates = 0
    for i, row in enumerate(rows, 1):
        row.update(id=f"{batch_id}-r{i}", normalized=normalize(row.get('text', row["original"])), review_status="pending", tags=[])
        if row["normalized"] in seen:
            row["duplicate_of"] = seen[row["normalized"]]
            duplicates += 1
        else:
            seen[row["normalized"]] = row["id"]
    return put(db, "demand_batches", {"id": batch_id, "space_id": space_id, "title": title, "version": 1,
               "source_kind": source_kind, "rows": rows, "row_count": len(rows), "duplicate_count": duplicates,
               "created_at": stamp(), "fingerprint": fingerprint, "role": "demand",
               "warnings": ["需求素材保留原始表述，不作为机构事实；语义相似的词条不会自动合并。"], **extra})


def create_batch(db, body: BatchInput):
    filename = filename_only(body.filename)
    rows = []
    warnings = []
    source_rows = body.rows[1:] if body.has_header else body.rows
    for item in source_rows:
        time_value = item.values[body.time_column] if body.time_column is not None and body.time_column < len(item.values) else ""
        occurred_at, warning = parse_time(time_value)
        for column in body.columns:
            value = item.values[column.column] if column.column < len(item.values) else ""
            if not value.strip():
                continue
            if formula(value):
                warnings.append(f"第 {item.row} 行第 {column.column + 1} 列公式已跳过。")
                continue
            rows.append({"original": value, "source": {"filename": filename, "sheet": body.sheet,
                         "row": item.row, "column": column.column, "label": column.label},
                         "occurred_at": occurred_at, "warnings": [warning] if warning else []})
    identity = body.model_dump(mode="json", exclude={"request_id", "title", "filename"})
    identity["filename"] = filename
    return save_batch(db, body.space_id, body.title, "imported", rows, identity,
                      import_warnings=warnings, filename=filename, sheet=body.sheet,
                      columns=[c.model_dump() for c in body.columns], has_header=body.has_header, time_column=body.time_column)


def sample_batch(db, space_id):
    space = get(db, "kb_spaces", space_id)
    if space["scene"] == "medical":
        values = ["超声炮怎么预约咨询？", "超声炮价格是多少？", "我暂时不想做超声炮，只是看看", "同行交流：超声炮咨询怎么解答？", "分享一次超声炮咨询经历", "超声炮怎么预约咨询？", "新西兰旅游路线推荐", "热玛吉前需要准备哪些资料？"]
    else:
        values = ["保温杯怎么买？", "保温杯支持退换货吗？", "暂时不想买保温杯", "同行交流：保温杯直播怎么讲？", "分享保温杯使用体验", "保温杯怎么买？", "新西兰旅游路线推荐", "保温杯有哪些颜色？"]
    rows = [{"original": text, "source": {"filename": "虚构需求示例", "sheet": "示例", "row": i + 1, "column": 0, "label": "需求表述"},
             "occurred_at": "2026-11-01T10:00:00+00:00" if i % 3 else None,
             "warnings": ["虚构示例，不代表真实用户或意向。"]} for i, text in enumerate(values)]
    return save_batch(db, space_id, "虚构需求示例 · " + ("医美" if space["scene"] == "medical" else "直播"), "demo", rows, {"sample_version": 1}, is_demo=True)


NUMBERED = re.compile(r'^\s*(\d{1,5})([.．](?!\d)|[、)）])\s*(\S.*)$')
HEADING = re.compile(r'^(?:#{1,6}\s|[一二三四五六七八九十百]+[、．.]|[（(][一二三四五六七八九十]+[）)]|【[^】]+】$)')


def split_knowledge_rows(document):
    """Split original pages, never the 600-character retrieval chunks.

    Numbered lists keep their untouched source lines and merge only explicit
    continuation lines. The separate text field removes enumeration for exact
    normalization; it never rewrites the preserved original.
    """
    pages = document.get('pages', [])
    numbered = sum(bool(NUMBERED.match(line)) for page in pages for line in page['text'].splitlines()) >= 2
    rows, skipped, category = [], [], ''
    for page_index, page in enumerate(pages, 1):
        page_number = page.get('page') or page_index
        previous = None
        source_lines = page['text'].splitlines()
        for line_number, raw in enumerate(source_lines, 1):
            value = raw.strip()
            source = {'filename': document['filename'], 'document_id': document['id'], 'version': document['version'],
                      'page': page_number, 'row': line_number, 'line': line_number, 'end_line': line_number,
                      'label': document['title'], 'category': category,
                      'locator': f'第 {page_number} 页 · 第 {line_number} 行'}
            if not value:
                continue
            is_heading = value == document['title'].strip() or bool(HEADING.match(value)) or bool(re.search(r'共\s*\d+\s*条', value))
            if is_heading and len(value) <= 160:
                category = value
                source['category'] = category
                skipped.append({'original': raw, 'reason': '标题或分类说明，不作为词条', 'source': source})
                previous = None
                continue
            match = NUMBERED.match(raw)
            text = match.group(3).strip() if match else value
            if numbered and not match and previous is not None and not re.match(r'^[-*•]\s+', value):
                previous['original'] = '\n'.join(source_lines[previous['source']['line'] - 1:line_number])
                previous['raw_original'] = previous['original']
                previous['text'] += '\n' + value
                previous['source']['end_line'] = line_number
                previous['source']['locator'] = f"第 {page_number} 页 · 第 {previous['source']['line']}–{line_number} 行"
                continue
            if match:
                source['ordinal'] = match.group(1)
            chunk = next((chunk for chunk in document.get('chunks', []) if value in chunk['text']), None)
            if chunk:
                source['chunk_id'] = chunk['id']
            row = {'original': raw, 'raw_original': raw, 'text': text, 'source': source, 'occurred_at': None,
                   'warnings': ['由原始页面逐条拆分，保留编号和行号；不作为机构事实。']}
            rows.append(row)
            previous = row if match else None
    if not rows or len(rows) > MAX_ROWS or sum(len(r['original']) for r in rows) > MAX_CHARS:
        raise HTTPException(422, '资料拆分后必须为 1 至 2,000 条、12 万字以内，请按分类拆分导入。')
    seen = {}
    for i, row in enumerate(rows, 1):
        row.update(id=f"preview-{document['id']}-v{document['version']}-r{i}", normalized=normalize(row['text']))
        if row['normalized'] in seen:
            row['duplicate_of'] = seen[row['normalized']]
        else:
            seen[row['normalized']] = row['id']
    return rows, skipped


def preview_knowledge(db, body):
    document = get(db, "kb_documents", body.document_id)
    if document["space_id"] != body.space_id:
        raise HTTPException(404, "该资料不属于当前空间。")
    rows, skipped = split_knowledge_rows(document)
    return {'document_id': document['id'], 'document_version': document['version'], 'document_kind': document['kind'],
            'signature': digest({'document': document, 'rows': rows}), 'rows': rows, 'skipped': skipped,
            'counts': {'records': len(rows), 'skipped': len(skipped), 'duplicates': sum('duplicate_of' in r for r in rows)},
            'warnings': ['请核对逐条原文及标题排除；修改用途会建立需求素材新版本、保留旧版本，并使旧事实引用提示过期。']}


def copy_knowledge(db, body):
    preview = preview_knowledge(db, body)
    document = get(db, 'kb_documents', body.document_id)
    if body.expected_version is not None and document['version'] != body.expected_version:
        raise HTTPException(409, '资料版本已变化，请重新预览。')
    if body.preview_signature and body.preview_signature != preview['signature']:
        raise HTTPException(409, '资料内容已变化，请重新预览。')
    if body.reclassify and (body.expected_version is None or not body.preview_signature):
        raise HTTPException(422, '调整资料用途前必须预览并核对资料版本。')
    origin = {'document_id': document['id'], 'version': document['version'], 'kind': document['kind']}
    if body.reclassify and document['kind'] != 'demand':
        # Reviews update the current document independently of its initial
        # version snapshot. Archive its latest approval state before the
        # purpose change creates a fresh draft version.
        put(db, 'kb_versions', {**deepcopy(document), 'id': f"{document['id']}:v{document['version']}",
                              'document_id': document['id']})
        payload = {k: document[k] for k in ('space_id', 'title', 'channel', 'pages', 'filename')}
        payload.update(kind='demand', expected_version=document['version'], valid_from=document.get('valid_from'), valid_until=document.get('valid_until'))
        document = save_document(db, DocumentInput(**payload), old=document)
    rows, skipped = split_knowledge_rows(document)
    for row in rows:
        row.pop('duplicate_of', None)
    return save_batch(db, body.space_id, document["title"] + " · 需求副本", "knowledge", rows,
                      {"document_id": document["id"], "document_version": document["version"], 'parser_version': 2},
                      document_id=document["id"], document_version=document["version"], skipped=skipped,
                      migration_origin=origin, reclassified=body.reclassify and origin['kind'] != 'demand')


def save_pack(db, body, old=None):
    get(db, "kb_spaces", body.space_id)
    if old and old["version"] != body.expected_version:
        raise HTTPException(409, "词包版本已更新，请刷新后编辑。")
    if body.source_batch_id:
        batch = get(db, "demand_batches", body.source_batch_id)
        if batch["space_id"] != body.space_id:
            raise HTTPException(404, "词包来源批次不属于当前空间。")
    data = body.model_dump(mode="json", exclude={"request_id", "expected_version", "entries"})
    originals = {}
    for key in ("theme_terms", "intent_terms", "exclude_terms"):
        originals[key] = data[key]
        data[key] = list(dict.fromkeys(normalize(w) for w in data[key] if normalize(w)))
    if not any(data[k] for k in ("theme_terms", "intent_terms", "exclude_terms")):
        raise HTTPException(422, "至少填写一个主题词、意向词或排除词。")
    conflicts = sorted(set(data["exclude_terms"]) & set(data["theme_terms"] + data["intent_terms"]))
    warnings = ["仅做空白、大小写及全半角规范化和精确去重；同义词需人工归并。"]
    if conflicts:
        warnings.append("同时出现在检索词和排除词中，运行时排除优先：" + "、".join(conflicts))
    metadata = {(entry.role, normalize(entry.text)): entry.model_dump() for entry in body.entries or []}
    allowed = {(role, word) for role in ('theme', 'intent', 'exclude') for word in data[role + '_terms']}
    if set(metadata) - allowed:
        raise HTTPException(422, '逐词信息必须对应当前三类关键词，请先核对词条。')
    entries = []
    for role, word in sorted(allowed, key=lambda pair: (('theme', 'intent', 'exclude').index(pair[0]), data[pair[0] + '_terms'].index(pair[1]))):
        previous = next((e for e in (old or {}).get('entries', []) if e['normalized'] == word and e['role'] == role), None)
        if previous is None:
            previous = next((e for e in (old or {}).get('entries', []) if e['normalized'] == word), {})
        entry = {'text': word, 'normalized': word, 'role': role, 'status': previous.get('status', 'pending'),
                 'tags': deepcopy(previous.get('tags', [])), 'aliases': deepcopy(previous.get('aliases', [])),
                 'sources': deepcopy(previous.get('sources', []))}
        if (role, word) in metadata:
            entry.update({k: metadata[(role, word)][k] for k in ('status', 'tags', 'aliases')})
        entries.append(entry)
    history = old.get("history", []) + [{k: v for k, v in old.items() if k != "history"}] if old else []
    return put(db, "demand_packs", {**data, "id": old["id"] if old else identifier("demand-pack"),
               "version": old["version"] + 1 if old else 1, "history": history, "original_terms": originals, 'entries': entries,
               "warnings": warnings, "created_at": old["created_at"] if old else stamp(), "updated_at": stamp()})


def save_template(db, body, old=None):
    get(db, "kb_spaces", body.space_id)
    if old and old.get("builtin"):
        raise HTTPException(422, "内置模板不可覆盖，请另存为当前空间的模板。")
    if old and old["version"] != body.expected_version:
        raise HTTPException(409, "模板版本已更新，请刷新后编辑。")
    data = body.model_dump(mode="json", exclude={"request_id", "expected_version"})
    history = old.get("history", []) + [{k: v for k, v in old.items() if k != "history"}] if old else []
    return put(db, "demand_templates", {**data, "id": old["id"] if old else identifier("demand-template"),
               "version": old["version"] + 1 if old else 1, "history": history, "builtin": False,
               "description": "自定义任务配置，不包含素材批次或客户记录。",
               "created_at": old["created_at"] if old else stamp(), "updated_at": stamp()})


def register_demand_assets(app, store):
    from backend.main import once

    @app.post("/api/demand/import/preview")
    def import_preview(file: UploadFile = File(...)):
        try:
            return preview_import(file.filename or "", file.file.read(MAX_UPLOAD + 1))
        finally:
            file.file.close()

    @app.get("/api/demand/batches")
    def batches(space_id: str):
        with store.read() as db:
            get(db, "kb_spaces", space_id)
            return [{k: v for k, v in b.items() if k != "rows"} for b in records(db, "demand_batches") if b["space_id"] == space_id]

    @app.get("/api/demand/batches/{batch_id}")
    def batch(batch_id: str):
        with store.read() as db:
            return get(db, "demand_batches", batch_id)

    @app.post("/api/demand/batches")
    def import_batch(body: BatchInput):
        with store.transaction() as db:
            return once(db, "demand-batch-import", body, lambda: create_batch(db, body))

    @app.post("/api/demand/batches/samples")
    def samples(body: ScopedOperation):
        with store.transaction() as db:
            return once(db, "demand-batch-samples", body, lambda: sample_batch(db, body.space_id))

    @app.post("/api/demand/batches/from-knowledge")
    def from_knowledge(body: FromKnowledge):
        with store.transaction() as db:
            return once(db, "demand-batch-knowledge", body, lambda: copy_knowledge(db, body))

    @app.post('/api/demand/batches/from-knowledge/preview')
    def knowledge_preview(body: FromKnowledge):
        with store.read() as db:
            return preview_knowledge(db, body)

    @app.get("/api/demand/packs")
    def packs(space_id: str):
        with store.read() as db:
            get(db, "kb_spaces", space_id)
            return [p for p in records(db, "demand_packs") if p["space_id"] == space_id]

    @app.post("/api/demand/packs")
    def new_pack(body: PackInput):
        with store.transaction() as db:
            return once(db, "demand-pack-create", body, lambda: save_pack(db, body))

    @app.put("/api/demand/packs/{pack_id}")
    def edit_pack(pack_id: str, body: PackUpdate):
        with store.transaction() as db:
            return once(db, "demand-pack-edit:" + pack_id, body, lambda: save_pack(db, body, lookup_pack(db, pack_id, body.space_id)))

    @app.get("/api/demand/templates")
    def templates(space_id: str):
        with store.read() as db:
            get(db, "kb_spaces", space_id)
            return BUILTINS + [t for t in records(db, "demand_templates") if t["space_id"] == space_id]

    @app.post("/api/demand/templates")
    def new_template(body: TemplateInput):
        with store.transaction() as db:
            return once(db, "demand-template-create", body, lambda: save_template(db, body))

    @app.put("/api/demand/templates/{template_id}")
    def edit_template(template_id: str, body: TemplateUpdate):
        with store.transaction() as db:
            return once(db, "demand-template-edit:" + template_id, body, lambda: save_template(db, body, lookup_template(db, template_id, body.space_id)))
