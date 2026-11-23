"""Local-first marketing demo: explicit simulations, immutable snapshots, SQLite.

Run: python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, ConfigDict, field_validator

from backend.model_adapter import ModelAdapter, ModelFailure
from backend.claims import inspect_claims
from backend.creative_handoff import check_origin
from backend.core.storage import SQLiteStore, put, get, all_records

ROOT = Path(__file__).resolve().parents[1]
COLLECTIONS = ("product", "campaigns", "creatives", "plans", "orders", "events", "logs", "insights", "datasets")
BUYERS = {"new-001": "新买家 小禾", "old-001": "老买家 阿青", "unknown-001": "历史未知 小白"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def uid(prefix):
    return f"{prefix}-{uuid4().hex[:12]}"


def money(value):
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class Idempotent(Input):
    request_id: str = Field(default_factory=lambda: uuid4().hex, min_length=1, max_length=128)


class ClaimEvidenceInput(Input):
    id: str = Field(min_length=1, max_length=80)
    category: Literal['shipping', 'performance']
    claim: str = Field(min_length=1, max_length=400)
    source: str = Field(min_length=1, max_length=300)
    conditions: str = Field(default='', max_length=300)
    confirmed: Literal[True]


class ProductInput(Input):
    name: str = Field(min_length=1, max_length=100)
    price: float = Field(ge=0.01, le=1000000, allow_inf_nan=False)
    capacity: str = Field(min_length=1, max_length=40)
    color: str = Field(min_length=1, max_length=40)
    brand: str = Field(default="青禾生活", min_length=1, max_length=100)
    description: str = Field(default="", max_length=6000)
    restrictions: str = Field(default="不得编造保温时长、检测报告、销量和评价。", max_length=4000)
    image_url: str = Field(default="/assets/product.svg", max_length=300)
    video_url: str = Field(default="", max_length=300)
    evidence: str = Field(default="", max_length=4000)
    claim_evidence: list[ClaimEvidenceInput] = Field(default_factory=list, max_length=20)

    @field_validator("image_url", "video_url")
    @classmethod
    def local_media_only(cls, value):
        if value and (not re.fullmatch(r"/(assets|uploads)/[A-Za-z0-9_.-]+", value) or ".." in value):
            raise ValueError("请上传本地媒体文件，不能使用外部地址。")
        return value


class CampaignInput(Idempotent):
    name: str = Field(min_length=1, max_length=120)
    expected_product_version: int | None = Field(default=None, ge=1)
    audience: str = Field(default="", max_length=1000)
    selling_point: str = Field(default="", max_length=2000)
    goal: str = Field(default="", max_length=1000)
    budget_limit: float | None = Field(default=None, ge=0.01, le=1000000, allow_inf_nan=False)
    start_date: date | None = None
    end_date: date | None = None


class GenerateInput(Idempotent):
    tone: Literal["自然", "简洁"] = "自然"
    angle: Literal["场景", "规格"] = "场景"
    recipe: Literal["classic", "spec", "questions", "walkthrough"] = "classic"


class ReviseInput(Idempotent):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=6000)
    cta: str = Field(min_length=1, max_length=100)
    script: str = Field(default="", max_length=6000)
    direction: str | None = Field(default=None, max_length=100)
    template: Literal["classic", "minimal"] = "classic"


class ClaimCheckInput(BaseModel):
    # Keep input whitespace intact: returned offsets refer to the editor text.
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=200)
    body: str = Field(max_length=6000)
    cta: str = Field(max_length=100)
    script: str = Field(default="", max_length=6000)


class PlanInput(Idempotent):
    creative_id: str
    name: str = Field(min_length=1, max_length=120)
    budget: float = Field(ge=0.01, le=1000000, allow_inf_nan=False)
    start_date: date
    end_date: date


class StatusInput(Input):
    status: Literal["draft", "running", "paused", "ended"]


class EventInput(Idempotent):
    plan_id: str
    type: Literal["view", "click"]


class OrderInput(Idempotent):
    plan_id: str
    buyer_id: Literal["new-001", "old-001", "unknown-001"]
    quantity: int = Field(default=1, ge=1, le=20, strict=True)


class InsightInput(Idempotent):
    dataset: Literal["history", "session", "batch"]
    campaign_id: str | None = None
    batch_id: str | None = None
    plan_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None


class AcceptInput(Idempotent):
    creative_id: str


class Store(SQLiteStore):
    def initialize(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / "uploads").mkdir(exist_ok=True)
        with self.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id))")
            db.execute("CREATE TABLE IF NOT EXISTS requests (scope TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,request_id))")
            db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
            if not db.execute('SELECT 1 FROM schema_migrations WHERE version=1').fetchone():
                db.execute("CREATE INDEX IF NOT EXISTS records_scope_idx ON records(collection,json_extract(data,'$.space_id'),json_extract(data,'$.status'),json_extract(data,'$.channel'))")
                db.execute("CREATE INDEX IF NOT EXISTS records_task_idx ON records(collection,json_extract(data,'$.task_id'))")
                db.execute('INSERT INTO schema_migrations VALUES(1,?)', (now(),))
            if not db.execute("SELECT 1 FROM records WHERE collection='product'").fetchone():
                seed(db)
            from backend.v2 import migrate_defaults
            migrate_defaults(db)
            from backend.knowledge import initialize_knowledge
            initialize_knowledge(db)


def log(db, action, detail):
    return put(db, "logs", {"id": uid("log"), "action": action, "detail": detail, "created_at": now()})


def request_fingerprint(payload):
    data = payload.model_dump(mode="json")
    key = data.pop("request_id")
    # Preserve successful request fingerprints created before this optional
    # concurrency guard existed. Explicit expected versions remain fingerprinted.
    if isinstance(payload, CampaignInput) and data.get('expected_product_version') is None:
        data.pop('expected_product_version', None)
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return key, fingerprint


def cached_request(db, scope, payload):
    key, fingerprint = request_fingerprint(payload)
    previous = db.execute("SELECT fingerprint,result FROM requests WHERE scope=? AND request_id=?", (scope, key)).fetchone()
    if previous:
        if previous[0] != fingerprint:
            raise HTTPException(409, "重复请求标识对应了不同操作，请刷新后重试。")
        return json.loads(previous[1])
    return None


def once(db, scope, payload, execute):
    previous = cached_request(db, scope, payload)
    if previous is not None:
        return previous
    key, fingerprint = request_fingerprint(payload)
    result = execute()
    db.execute("INSERT INTO requests VALUES (?,?,?,?)", (scope, key, fingerprint, json.dumps(result, ensure_ascii=False)))
    return result


def model_operation(store, adapter, scope, payload, prepare, produce, save):
    """Release SQLite before remote I/O. One model operation per demo process.

    Successful retries return the persisted response. Busy duplicates fail fast;
    no automatic model retries/fallbacks. Save revalidates mutable business state.
    """
    with store.transaction() as db:
        previous = cached_request(db, scope, payload)
    if previous is not None:
        return previous
    if not adapter.operation_lock.acquire(blocking=False):
        raise HTTPException(409, "已有 AI 任务正在生成，请等待完成后再操作；没有重复发送模型请求。")
    try:
        with store.transaction() as db:
            previous = cached_request(db, scope, payload)
            if previous is not None:
                return previous
            context = prepare(db)
        adapter.operation_started(scope)
        content = produce(context)
        with store.transaction() as db:
            result = once(db, scope, payload, lambda: save(db, context, content))
        adapter.operation_finished(success=True)
        return result
    except HTTPException:
        adapter.operation_finished(error_kind='conflict')
        raise
    except ModelFailure:
        adapter.operation_finished(error_kind='validation')
        raise
    finally:
        try:
            if adapter.current_operation:
                adapter.operation_finished()
        finally:
            adapter.operation_lock.release()


def creative_record(campaign, fields, source="replay", parent=None):
    result = {"id": uid("creative"), "campaign_id": campaign["id"], **fields, "version": (parent["version"] + 1) if parent else 1, "status": "draft", "source": source, "product_snapshot": parent["product_snapshot"] if parent else campaign["product_snapshot"], "parent_id": parent["id"] if parent else None, "created_at": now()}
    result["family_id"] = (parent.get("family_id") or parent["id"]) if parent else result["id"]
    result.setdefault("template", parent.get("template", "classic") if parent else "classic")
    if parent and parent.get("knowledge_origin"):
        result["knowledge_origin"] = parent["knowledge_origin"]
    from backend.live import context_fields
    result.update(context_fields(parent or campaign))
    return result


def next_version(db, parent):
    """Version numbers remain unique even when two edits branch from V1."""
    records = {c["id"]: c for c in all_records(db, "creatives")}
    def root_id(item):
        while item.get("parent_id"):
            item = records[item["parent_id"]]
        return item["id"]
    family = root_id(parent)
    return max(c["version"] for c in records.values() if root_id(c) == family) + 1


def seed(db):
    product = {"id": "product-demo", "name": "青禾随行保温杯", "price": 99.0, "capacity": "500 ml", "color": "奶油白", "brand": "青禾生活", "description": "将喜欢的日常，轻轻握在手心。适合桌面展示与日常携带的演示商品。", "restrictions": "不得编造保温时长、检测报告、销量、用户评价；禁止全网第一、100%保证等表达。", "image_url": "/assets/product.svg", "video_url": "", "version": 1, "created_at": now(), "source": "虚构演示商品资料"}
    put(db, "product", product)
    campaign = put(db, "campaigns", {"id": "campaign-demo", "name": "青禾 · 把日常带在身边", "product_snapshot": product, "created_at": now()})
    adapter = ModelAdapter()
    adapter.mode = "replay"  # Initial fixtures never call a remote provider.
    for index, fields in enumerate(adapter.creatives(product)):
        suffix = ("commute", "capacity")[index]
        creative = creative_record(campaign, fields)
        creative.update(id=f"creative-{suffix}", status="approved", approved_at=now())
        put(db, "creatives", creative)
        put(db, "plans", {"id": f"plan-{suffix}", "campaign_id": campaign["id"], "creative_id": creative["id"], "creative_snapshot": creative, "name": f'现场演示 · {fields["direction"]}', "budget": 200.0 if index == 0 else 300.0, "start_date": datetime.now(timezone.utc).date().isoformat(), "end_date": (datetime.now(timezone.utc).date() + timedelta(days=7)).isoformat(), "status": "running", "created_at": now(), "account": "青禾演示账户", "objective": "商品成交", "simulation": True})
    history = {"id": "D0", "campaign_id": campaign["id"], "source": "固定虚构历史样例", "window": "D0 固定历史演示窗口（与现场互动独立）", "rows": [
        {"name": "历史 A · 通勤携带", "creative_id": "creative-commute", "plan_id": "history-A", "impressions": 4000, "clicks": 120, "spend": 120.0, "orders": 9, "buyers": 9, "new_customers": 5, "unknown_buyers": 0, "revenue": 891.0},
        {"name": "历史 B · 容量展示", "creative_id": "creative-capacity", "plan_id": "history-B", "impressions": 6000, "clicks": 180, "spend": 180.0, "orders": 6, "buyers": 6, "new_customers": 4, "unknown_buyers": 0, "revenue": 594.0},
    ], "orders": []}
    for row in history["rows"]:
        for index in range(row["orders"]):
            history["orders"].append({"id": f'D0-{row["plan_id"]}-{index+1}', "buyer_id": f'D0-buyer-{row["plan_id"]}-{index+1}', "buyer_type": "new" if index < row["new_customers"] else "returning", "amount": 99.0, "plan_id": row["plan_id"], "creative_id": row["creative_id"], "campaign_id": campaign["id"], "created_at": "D0 固定演示窗口", "simulation": True})
    put(db, "datasets", history)
    log(db, "初始化演示", "已载入虚构商品、两组已确认素材与两个模拟运行计划；历史 D0 与现场互动分别统计。")


def check_claims(creative):
    report = inspect_claims(creative)
    if not report["can_approve"]:
        labels = {"conflict": "与资料冲突", "missing_evidence": "缺少依据", "manual_review": "需人工核查"}
        problems = [f'{labels[item["kind"]]}：{item["text"]}' for item in report["findings"] if item["kind"] != "consistent"]
        raise HTTPException(422, "；".join(dict.fromkeys(problems)) + "。请在事实核对中查看依据并修改后再确认；不支持跳过提示。")
    return report


def ratios(metrics):
    def ratio(num, den):
        return round(num / den, 6) if num is not None and den else None
    return {**metrics, "ctr": ratio(metrics["clicks"], metrics["impressions"]), "roi": ratio(metrics["revenue"], metrics["spend"]), "cpa": ratio(metrics["spend"], metrics["orders"]), "cac": None if metrics["unknown_buyers"] else ratio(metrics["spend"], metrics["new_customers"])}


def analytics(db, dataset, campaign_id=None, plan_id=None, batch_id=None, date_from=None, date_to=None):
    from backend.v2 import query_analytics
    return query_analytics(db, dataset, campaign_id, plan_id, batch_id, date_from, date_to)


def create_app(data_dir=None):
    store = Store(data_dir or os.getenv("DEMO_DATA_DIR", str(ROOT / "data")))
    adapter = ModelAdapter()
    from backend.agents.runner import AgentRunner
    runner = AgentRunner(store, adapter)
    from backend.demand_tasks import DemandRunner
    demand_runner = DemandRunner(store)

    @asynccontextmanager
    async def lifespan(app):
        from backend.runtime import InstanceLease
        lease = InstanceLease(store.directory)
        lease.acquire()
        try:
            store.initialize()
            adapter.bind_store(store)
            runner.start()
            demand_runner.start()
            try:
                yield
            finally:
                media_runner.shutdown()
                demand_runner.stop()
                runner.stop()
        finally:
            lease.release()

    public_demo = os.getenv('DEMO_SHARE_MODE') == '1'
    app = FastAPI(title="浙衍 AI · 演示 API", version="1.0.0", lifespan=lifespan,
                 docs_url=None if public_demo else '/docs', redoc_url=None if public_demo else '/redoc',
                 openapi_url=None if public_demo else '/openapi.json')
    hosts = ['localhost', '127.0.0.1', '::1', '[::1]', 'testserver']
    hosts.extend(h.strip() for h in os.getenv('DEMO_ALLOWED_HOSTS', '').split(',') if h.strip() and h.strip() != '*')
    if public_demo:
        hosts.append('*.trycloudflare.com')
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts, www_redirect=False)
    app.state.store = store
    app.state.model_adapter = adapter
    app.state.agent_runner = runner
    app.state.demand_runner = demand_runner

    @app.middleware("http")
    async def access_gate(request: Request, call_next):
        token = os.getenv("DEMO_ACCESS_TOKEN", "")
        if token and (request.url.path.startswith("/api/") or request.url.path in {'/docs', '/redoc', '/openapi.json'}) and request.url.path != "/api/health":
            supplied = request.headers.get("X-Demo-Token", "")
            if not hmac.compare_digest(supplied.encode(), token.encode()):
                return JSONResponse({"detail": "请输入演示访问码。"}, status_code=401)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers['Content-Security-Policy'] = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ModelFailure)
    async def model_failure(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exc):
        if request.url.path.startswith(("/api/knowledge/", "/api/agent/", "/api/demand/")):
            problems = []
            for error in exc.errors():
                field = ".".join(str(x) for x in error["loc"][1:]) or "资料"
                reason = str(error.get("ctx", {}).get("error", "")) if error["type"] == "value_error" else "请检查必填内容、类型和长度限制"
                problems.append(f"{field}：{reason}")
            label = "需求工作台" if request.url.path.startswith("/api/demand/") else ("Agent 任务" if request.url.path.startswith("/api/agent/") else "知识库")
            return JSONResponse({"detail": label + "输入不正确。" + "；".join(problems)}, status_code=422)
        fields = ", ".join(".".join(str(x) for x in error["loc"][1:]) for error in exc.errors())
        return JSONResponse({"detail": f"输入格式不正确，请检查：{fields}。请核对必填内容、类型和取值范围。"}, status_code=422)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "zheyan-demo", "simulation": True}

    @app.get("/api/state")
    def state():
        with store.read() as db:
            values = {key: all_records(db, key) for key in ("campaigns", "creatives", "plans", "orders", "events", "logs", "insights", "adjustments", "batches", "tasks", "observations", "reports", "live_sessions")}
            return {"product": all_records(db, "product")[0], **values, "model": adapter.info, "buyers": [{"id": k, "name": v} for k, v in BUYERS.items()]}

    @app.get("/api/model/status")
    def model_status():
        return adapter.info

    @app.post("/api/model/check")
    def model_check():
        if not adapter.operation_lock.acquire(blocking=False):
            raise HTTPException(409, "已有 AI 任务正在生成，请等待完成后再测试连接。")
        try:
            adapter.operation_started('model-check')
            adapter.check_connection()
            adapter.operation_finished(success=True)
            return adapter.info
        finally:
            try:
                if adapter.current_operation:
                    adapter.operation_finished()
            finally:
                adapter.operation_lock.release()

    @app.put("/api/product")
    def update_product(body: ProductInput):
        with store.transaction() as db:
            old = all_records(db, "product")[0]
            for field in ("image_url", "video_url"):
                url = getattr(body, field)
                if url.startswith("/uploads/") and not (store.directory / "uploads" / Path(url).name).is_file():
                    raise HTTPException(422, "上传文件不存在，请重新上传。")
            product = {**old, **body.model_dump(), "price": money(body.price), "version": old["version"] + 1, "updated_at": now()}
            put(db, "product", product)
            log(db, "更新商品资料", f'保存资料 V{product["version"]}，既有活动和素材快照保持不变。')
            return product

    @app.post("/api/campaigns")
    def create_campaign(body: CampaignInput):
        from backend.v2 import campaign_fields
        with store.transaction() as db:
            def run():
                fields = campaign_fields(body)
                product = all_records(db, "product")[0]
                if body.expected_product_version is not None and product['version'] != body.expected_product_version:
                    raise HTTPException(409, f'商品资料已更新为 V{product["version"]}，请重新核对最新商品资料后再创建活动。')
                campaign = put(db, "campaigns", {"id": uid("campaign"), **fields, "product_snapshot": product, "created_at": now(), "strategy_version": 1, "strategy_history": []})
                log(db, "创建营销活动", campaign["name"])
                return campaign
            return once(db, "campaign", body, run)

    @app.post("/api/campaigns/{campaign_id}/generate")
    def generate(campaign_id: str, body: GenerateInput):
        from backend.v2 import generate_fields
        def save(db, campaign, content):
            if get(db, "campaigns", campaign_id) != campaign:
                raise HTTPException(409, "生成期间活动策略已变化，请按新策略重新生成。旧素材未改动。")
            result = []
            for item in content:
                existing = next((c for c in all_records(db, "creatives") if adapter.mode == "replay" and c["campaign_id"] == campaign_id and not c.get("live_context") and c["source"] == "replay" and c["product_snapshot"] == campaign["product_snapshot"] and all(c.get(k) == item.get(k) for k in ("title", "body", "script", "cta", "strategy_version"))), None)
                result.append(existing or put(db, "creatives", creative_record(campaign, item, "replay" if adapter.mode == "replay" else "model")))
            log(db, "生成创意", f'{campaign["name"]}：两份草稿，来源 {adapter.info["label"]}，等待人工确认。')
            return result
        return model_operation(store, adapter, "generate:" + campaign_id, body,
                               lambda db: get(db, "campaigns", campaign_id),
                               lambda campaign: generate_fields(adapter, campaign, body), save)

    @app.post("/api/creatives/{creative_id}/revise")
    def revise(creative_id: str, body: ReviseInput):
        with store.transaction() as db:
            def run():
                parent = get(db, "creatives", creative_id)
                fields = body.model_dump(exclude_none=True, exclude={"request_id"})
                fields["direction"] = fields.get("direction") or parent["direction"]
                for key in ("tone", "angle", "strategy_version", "strategy_snapshot", "model_name", "model_provider"):
                    if key in parent:
                        fields[key] = parent[key]
                revised = creative_record(get(db, "campaigns", parent["campaign_id"]), fields, parent["source"], parent)
                revised["version"] = next_version(db, parent)
                revised["edited_by"] = "演示运营"
                put(db, "creatives", revised)
                log(db, "创建素材版本", f'{parent["direction"]} V{parent["version"]} → V{revised["version"]}，原版本未覆盖。')
                return revised
            return once(db, "revise:" + creative_id, body, run)

    @app.post("/api/creatives/{creative_id}/check")
    def check_creative(creative_id: str, body: ClaimCheckInput):
        with store.transaction() as db:
            creative = get(db, "creatives", creative_id)
            return inspect_claims(creative, body.model_dump())

    @app.post("/api/creatives/{creative_id}/approve")
    def approve(creative_id: str):
        with store.transaction() as db:
            creative = get(db, "creatives", creative_id)
            check_origin(db, creative)
            if creative["status"] == "approved":
                return creative
            report = check_claims(creative)
            creative.update(status="approved", approved_at=now(), approval_check=report)
            put(db, "creatives", creative)
            log(db, "确认素材", f'{creative["direction"]} V{creative["version"]} 已人工确认；规则检查不替代完整合规审核。')
            return creative

    @app.post("/api/plans")
    def create_plan(body: PlanInput):
        with store.transaction() as db:
            def run():
                if body.end_date < body.start_date:
                    raise HTTPException(422, "结束日期不能早于开始日期。")
                creative = get(db, "creatives", body.creative_id)
                if creative["status"] != "approved":
                    raise HTTPException(409, "请先确认素材，再创建投放计划。")
                check_origin(db, creative)
                plan = put(db, "plans", {"id": uid("plan"), "campaign_id": creative["campaign_id"], "creative_id": creative["id"], "creative_snapshot": creative, **context_fields(creative), "name": body.name, "budget": money(body.budget), "start_date": body.start_date.isoformat(), "end_date": body.end_date.isoformat(), "status": "draft", "created_at": now(), "account": "青禾演示账户", "objective": "商品成交", "simulation": True, "config_version": 1, "config_history": []})
                log(db, "创建计划草稿", f'{plan["name"]} · 预算 ¥{plan["budget"]:g}，等待人工确认模拟启动。')
                return plan
            return once(db, "plan", body, run)

    @app.post("/api/plans/{plan_id}/status")
    def plan_status(plan_id: str, body: StatusInput):
        with store.transaction() as db:
            plan = get(db, "plans", plan_id)
            if plan["status"] == body.status:
                return plan
            transitions = {"draft": {"running", "ended"}, "running": {"paused", "ended"}, "paused": {"running", "ended"}, "ended": set()}
            if body.status not in transitions[plan["status"]]:
                raise HTTPException(409, "当前计划状态不允许该操作；已结束计划不能重新启动。")
            if body.status == "running" and not plan["start_date"] <= datetime.now(timezone.utc).date().isoformat() <= plan["end_date"]:
                raise HTTPException(409, "当前日期不在计划周期内，请先调整周期。日期不会自动启动计划。")
            if body.status == "running":
                check_origin(db, plan["creative_snapshot"])
            old = plan["status"]
            plan.update(status=body.status, updated_at=now())
            put(db, "plans", plan)
            log(db, "模拟投放操作", f'{plan["name"]}：{old} → {body.status}，没有真实广告花费。')
            return plan

    def running_plan(db, plan_id):
        plan = get(db, "plans", plan_id)
        if plan["status"] != "running":
            raise HTTPException(409, "仅模拟运行中的计划可以记录互动或下单。")
        return plan

    @app.post("/api/events")
    def event(body: EventInput):
        with store.transaction() as db:
            def run():
                plan = running_plan(db, body.plan_id)
                return put(db, "events", {"id": uid("event"), "plan_id": plan["id"], "creative_id": plan["creative_id"], "campaign_id": plan["campaign_id"], "type": body.type, **context_fields(plan), "plan_config_version": plan.get("config_version", 1), "created_at": now(), "source": "本地测试互动"})
            return once(db, "event", body, run)

    @app.post("/api/orders")
    def order(body: OrderInput):
        with store.transaction() as db:
            def run():
                plan = running_plan(db, body.plan_id)
                previous = any(o["buyer_id"] == body.buyer_id for o in all_records(db, "orders"))
                buyer_type = "unknown" if body.buyer_id == "unknown-001" else "returning" if body.buyer_id == "old-001" or previous else "new"
                result = put(db, "orders", {"id": uid("order"), "plan_id": plan["id"], "creative_id": plan["creative_id"], "campaign_id": plan["campaign_id"], "buyer_id": body.buyer_id, "buyer_name": BUYERS[body.buyer_id], **context_fields(plan), "buyer_type": buyer_type, "unit_price": plan["creative_snapshot"]["product_snapshot"]["price"], "quantity": body.quantity, "plan_config_version": plan.get("config_version", 1), "amount": money(Decimal(str(plan["creative_snapshot"]["product_snapshot"]["price"])) * body.quantity), "created_at": now(), "simulation": True, "attribution": "显式绑定当前演示计划，非平台真实归因"})
                log(db, "模拟订单完成", f'{result["id"]} · {BUYERS[body.buyer_id]} · ¥{result["amount"]:g} · {plan["name"]}')
                return result
            return once(db, "order", body, run)

    @app.get("/api/analytics")
    def get_analytics(dataset: Literal["history", "session", "batch"] = "history", campaign_id: str | None = None, plan_id: str | None = None, batch_id: str | None = None, date_from: date | None = None, date_to: date | None = None):
        with store.read() as db:
            return analytics(db, dataset, campaign_id, plan_id, batch_id, date_from, date_to)

    @app.post("/api/insights")
    def create_insight(body: InsightInput):
        campaign_id = body.campaign_id or "campaign-demo"
        def save(db, data, content):
            result = put(db, "insights", {"id": uid("insight"), "source": "replay" if adapter.mode == "replay" else "model", "dataset": body.dataset, "batch_id": body.batch_id, "campaign_id": campaign_id, "analytics_snapshot": data, **content, "created_at": now(), "status": "pending", "observation": "等待运营确认调整草稿，尚无后续效果数据。"})
            log(db, "生成复盘", f'{data["label"]} · {adapter.info["label"]}，区分事实、假设与缺失信息。')
            return result
        return model_operation(store, adapter, "insight", body,
                               lambda db: analytics(db, body.dataset, campaign_id, body.plan_id, body.batch_id, body.date_from, body.date_to),
                               adapter.insight, save)

    @app.get("/api/insights")
    def list_insights():
        with store.read() as db:
            return all_records(db, "insights")

    @app.post("/api/insights/{insight_id}/accept")
    def accept(insight_id: str, body: AcceptInput):
        def prepare(db):
            insight = get(db, "insights", insight_id)
            parent = get(db, "creatives", body.creative_id)
            if insight.get("campaign_id") and insight["campaign_id"] != parent["campaign_id"]:
                raise HTTPException(409, "该素材不属于复盘所选活动。")
            from backend.v2 import check_insight_scope
            check_insight_scope(db, insight, creative=parent)
            existing = None
            if insight.get("result_creative_id"):
                if insight.get("source_creative_id") != parent["id"]:
                    raise HTTPException(409, "本条建议已为另一份素材创建草稿，请重新生成复盘后再操作。")
                existing = get(db, "creatives", insight["result_creative_id"])
            elif insight.get("status") != "pending":
                raise HTTPException(409, "该建议已处理，请创建新的复盘。")
            return {"insight": insight, "parent": parent, "existing": existing}

        def save(db, context, fields):
            current = prepare(db)
            if current["existing"]:
                return current["existing"]
            if current != context:
                raise HTTPException(409, "生成期间复盘或素材状态已变化，请重新核对后操作。")
            insight, parent = context["insight"], context["parent"]
            for key in ("tone", "angle", "strategy_version", "strategy_snapshot", "template"):
                if key in parent:
                    fields[key] = parent[key]
            revised = creative_record(get(db, "campaigns", parent["campaign_id"]), fields, "replay" if adapter.mode == "replay" else "model", parent)
            revised["version"] = next_version(db, parent)
            revised.update(insight_id=insight_id, observation="待确认、待投放，尚无 V2 效果数据。")
            put(db, "creatives", revised)
            insight.update(status="accepted", source_creative_id=parent["id"], result_creative_id=revised["id"], observation="已创建调整草稿，等待确认与后续数据。")
            put(db, "insights", insight)
            from backend.v2 import make_observation
            make_observation(db, parent["campaign_id"], insight=insight, creative_id=revised["id"])
            log(db, "采纳复盘建议", f'创建 {parent["direction"]} V{revised["version"]} 草稿，未自动投放，也未生成改善结果。')
            return revised
        return model_operation(store, adapter, "accept:" + insight_id, body, prepare,
                               lambda c: None if c["existing"] else adapter.optimize(c["parent"]["product_snapshot"], c["parent"], c["insight"]), save)

    @app.post("/api/uploads")
    async def upload(file: UploadFile = File(...)):
        allowed = {"image/png": (".png", lambda x: x.startswith(b"\x89PNG\r\n\x1a\n")), "image/jpeg": (".jpg", lambda x: x.startswith(b"\xff\xd8\xff")), "image/webp": (".webp", lambda x: x[:4] == b"RIFF" and x[8:12] == b"WEBP"), "video/mp4": (".mp4", lambda x: x[4:8] == b"ftyp"), "video/webm": (".webm", lambda x: x.startswith(b"\x1a\x45\xdf\xa3"))}
        try:
            if file.content_type not in allowed:
                raise HTTPException(415, "只支持 PNG、JPEG、WebP 图片和 MP4、WebM 视频。")
            content = await file.read(20 * 1024 * 1024 + 1)
            if len(content) > 20 * 1024 * 1024:
                raise HTTPException(413, "文件不能超过 20 MB。")
            suffix, valid = allowed[file.content_type]
            if not valid(content):
                raise HTTPException(415, "文件内容与声明的媒体格式不匹配。")
            name = uuid4().hex + suffix
            path = store.directory / "uploads" / name
            path.write_bytes(content)
            return {"url": "/uploads/" + name, "type": file.content_type, "size": len(content)}
        finally:
            await file.close()

    @app.get("/uploads/{filename}")
    def media(filename: str):
        if not re.fullmatch(r"[a-f0-9]{32}\.(png|jpg|webp|mp4|webm)", filename):
            raise HTTPException(404, "文件不存在。")
        path = store.directory / "uploads" / filename
        if not path.is_file():
            raise HTTPException(404, "文件不存在。")
        return FileResponse(path)

    from backend.v2 import register_v2
    register_v2(app, store, adapter)
    from backend.knowledge import register_knowledge
    register_knowledge(app, store, adapter)
    from backend.agents.routes import register_agents
    register_agents(app, store, adapter, runner)
    from backend.creative_handoff import register_handoff
    register_handoff(app, store)
    from backend.live import register_live, context_fields
    register_live(app, store, adapter)
    from backend.live_workspace import register_workspace
    register_workspace(app, store)
    from backend.live_interaction import register_interaction
    register_interaction(app, store)
    from backend.live_timer import register_timer
    register_timer(app, store)
    from backend.media_tools import register_media_tools
    media_runner = register_media_tools(app, store)
    from backend.speech.routes import register_speech
    register_speech(app, store)
    from backend.live_script_drafts import register_script_drafts
    register_script_drafts(app, store, adapter)
    from backend.demand_assets import register_demand_assets
    from backend.demand_tasks import register_demand_tasks
    from backend.demand_content import register_demand_content
    register_demand_assets(app, store)
    register_demand_tasks(app, store, demand_runner)
    register_demand_content(app, store, adapter)

    @app.api_route("/api", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api(path: str = ""):
        raise HTTPException(404, "API 不存在。")

    @app.get("/{path:path}")
    def frontend(path: str):
        dist = Path(os.getenv("DEMO_FRONTEND_DIR", str(ROOT / "frontend" / "dist")))
        target = (dist / path).resolve()
        if not target.is_relative_to(dist.resolve()):
            raise HTTPException(404, "页面不存在。")
        if target.is_file():
            return FileResponse(target)
        if path.startswith("assets/") or Path(path).suffix:
            raise HTTPException(404, "资源不存在。")
        if (dist / "index.html").is_file():
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
        raise HTTPException(503, "前端尚未构建，请先运行 npm run build。")

    return app


app = create_app()
