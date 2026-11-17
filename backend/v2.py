"""V2 operations: explicit simulations, auditable changes, immutable reports."""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
from typing import Literal

from fastapi import HTTPException
from pydantic import Field
from backend.main import (Input, Idempotent, CampaignInput, GenerateInput, get,
                          all_records, put, once, log, uid, now, money, ratios,
                          creative_record, next_version, model_operation)


def migrate_defaults(db):
    """Additive migration only; original content and embedded snapshots stay intact."""
    defaults = {
        "product": {"evidence": ""},
        "campaigns": {"audience": "", "selling_point": "", "goal": "", "budget_limit": None,
                      "start_date": None, "end_date": None, "strategy_version": 1, "strategy_history": []},
        "plans": {"config_version": 1, "config_history": []},
        "creatives": {"template": "classic", "tone": "自然", "angle": "场景"},
    }
    for collection, values in defaults.items():
        records = all_records(db, collection)
        by_id = {x["id"]: x for x in records}
        for record in records:
            before = deepcopy(record)
            for key, value in values.items():
                record.setdefault(key, deepcopy(value))
            if collection == "creatives":
                root = record
                seen = set()
                while root.get("parent_id") in by_id and root["id"] not in seen:
                    seen.add(root["id"])
                    root = by_id[root["parent_id"]]
                record["family_id"] = root["id"]
            if record != before:
                put(db, collection, record)


def campaign_fields(body):
    data = body.model_dump(mode="json", exclude={"request_id"})
    if data["start_date"] and data["end_date"] and data["end_date"] < data["start_date"]:
        raise HTTPException(422, "活动结束日期不能早于开始日期。")
    return data


def generate_fields(adapter, campaign, body):
    product = campaign["product_snapshot"]
    brief = {k: campaign.get(k, "") for k in ("name", "audience", "selling_point", "goal")}
    if adapter.mode == "replay" and body.recipe != "classic":
        from backend.replay_copy import replay_copies
        items = replay_copies(product, body.recipe, body.tone)
    else:
        items = adapter.creatives(product, {**brief, "tone": body.tone, "angle": body.angle, "writing_structure": body.recipe})
    for index, item in enumerate(items):
        item.update(tone=body.tone, angle=body.angle, template="classic",
                    strategy_version=campaign.get("strategy_version", 1),
                    strategy_snapshot={k: campaign.get(k, "") for k in ("audience", "selling_point", "goal")})
        if adapter.mode == "replay" and body.recipe == "classic":
            if body.angle == "规格":
                item["title"] = (f'{product["capacity"]}，认识日常随行搭子' if index == 0 else f'{product["color"]}，看得见的日常细节')
            if body.tone == "简洁":
                item["body"] = f'{product["name"]} · {product["capacity"]} · {product["color"]}。演示售价 ¥{product["price"]:g}。查看规格再选择。'
    return items


def scope_dates(start, end):
    start = start.isoformat() if isinstance(start, date) else start or None
    end = end.isoformat() if isinstance(end, date) else end or None
    if start and end and end < start:
        raise HTTPException(422, "统计结束日期不能早于开始日期。")
    return start, end


def session_metrics(orders, events):
    return ratios({"impressions": None, "clicks": sum(e["type"] == "click" for e in events), "spend": None,
                   "orders": len(orders), "buyers": len({o["buyer_id"] for o in orders}),
                   "new_customers": len({o["buyer_id"] for o in orders if o["buyer_type"] == "new"}),
                   "unknown_buyers": len({o["buyer_id"] for o in orders if o["buyer_type"] == "unknown"}),
                   "revenue": money(sum(Decimal(str(o["amount"])) for o in orders))})


def query_analytics(db, dataset, campaign_id=None, plan_id=None, batch_id=None, date_from=None, date_to=None):
    from backend.trends import with_trend
    return with_trend(_query_analytics(db, dataset, campaign_id, plan_id, batch_id, date_from, date_to))


def _query_analytics(db, dataset, campaign_id=None, plan_id=None, batch_id=None, date_from=None, date_to=None):
    date_from, date_to = scope_dates(date_from, date_to)
    if campaign_id:
        get(db, "campaigns", campaign_id)
    if dataset != "session" and (date_from or date_to):
        raise HTTPException(422, "固定历史或模拟批次使用自身观察窗口，不支持日期筛选。")
    filters = dict(campaign_id=campaign_id, plan_id=plan_id, batch_id=batch_id, date_from=date_from, date_to=date_to)
    if dataset == "batch":
        if not batch_id:
            raise HTTPException(422, "请先选择一个模拟数据批次。")
        batch = get(db, "batches", batch_id)
        if campaign_id and batch["campaign_id"] != campaign_id or plan_id and batch["plan_id"] != plan_id:
            raise HTTPException(409, "模拟批次不属于所选活动或计划。")
        metrics = batch["metrics"]
        return {"dataset": dataset, "dataset_id": batch_id, "label": batch["label"], "window": batch["window"],
                "metrics": metrics, "rows": [{"name": batch["plan_snapshot"]["name"], "plan_id": batch["plan_id"],
                "creative_id": batch["plan_snapshot"]["creative_id"], **metrics}], "orders": batch["orders"],
                "spend_entries": batch["spend_entries"], "views": None, "filters": filters,
                "identification_coverage": 1 if metrics["buyers"] else None,
                "note": "主动载入的固定模拟场景，非平台数据或预测；与现场互动、历史 D0 独立。支付 ROI 不代表利润。"}
    if dataset == "history":
        history = get(db, "datasets", "D0")
        rows = [r for r in history["rows"] if (not campaign_id or campaign_id == history["campaign_id"]) and (not plan_id or r["plan_id"] == plan_id)]
        keys = ("impressions", "clicks", "spend", "orders", "buyers", "new_customers", "unknown_buyers", "revenue")
        totals = {k: sum(r[k] for r in rows) for k in keys}
        if not rows:
            totals.update(impressions=None, spend=None)
        ids = {r["plan_id"] for r in rows}
        return {"dataset": dataset, "dataset_id": "D0", "label": "历史演示数据 D0", "window": history["window"],
                "metrics": ratios(totals), "rows": [ratios(r) for r in rows],
                "orders": [o for o in history["orders"] if o["plan_id"] in ids],
                "spend_entries": [{"id": "D0-spend-" + r["plan_id"], "plan_id": r["plan_id"], "amount": r["spend"], "source": "固定虚构历史样例", "created_at": history["window"]} for r in rows],
                "views": None, "filters": filters, "identification_coverage": 1.0 if rows else None,
                "note": "固定虚构样例，非随机对照实验，支付 ROI 不等于利润。" if rows else "所选活动没有历史演示数据，请切换到现场互动记录。"}
    if dataset != "session":
        raise HTTPException(422, "未知的数据来源。")
    if plan_id:
        selected = get(db, "plans", plan_id)
        if campaign_id and selected["campaign_id"] != campaign_id:
            raise HTTPException(409, "计划不属于所选活动。")
    plans = [p for p in all_records(db, "plans") if (not campaign_id or p["campaign_id"] == campaign_id) and (not plan_id or p["id"] == plan_id)]
    ids = {p["id"] for p in plans}
    def in_range(record):
        day = datetime.fromisoformat(record["created_at"].replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
        return record["plan_id"] in ids and (not date_from or day >= date_from) and (not date_to or day <= date_to)
    orders = list(filter(in_range, all_records(db, "orders")))
    events = list(filter(in_range, all_records(db, "events")))
    metrics = session_metrics(orders, events)
    return {"dataset": dataset, "dataset_id": "session", "label": "现场互动记录 · 模拟订单", "window": f'{date_from or "全部历史"} 至 {date_to or "当前"}（UTC 日期，含此前保存记录）',
            "metrics": metrics, "rows": [{"name": p["name"], "plan_id": p["id"], "creative_id": p["creative_id"], **session_metrics([o for o in orders if o["plan_id"] == p["id"]], [e for e in events if e["plan_id"] == p["id"]])} for p in plans],
            "orders": orders, "views": sum(e["type"] == "view" for e in events), "spend_entries": [], "filters": filters,
            "identification_coverage": (metrics["buyers"] - metrics["unknown_buyers"])/metrics["buyers"] if metrics["buyers"] else None,
            "note": "现场没有匹配的广告曝光和消耗，CTR、ROI、订单广告成本与新客成本不可计算；商品页浏览不代表平台广告曝光。"}


class PlanEdit(Input):
    name: str = Field(min_length=1, max_length=120)
    budget: float = Field(ge=.01, le=1000000, allow_inf_nan=False)
    start_date: date
    end_date: date


class AdjustmentInput(Idempotent):
    budget: float = Field(ge=.01, le=1000000, allow_inf_nan=False)
    start_date: date
    end_date: date
    reason: str = Field(min_length=1, max_length=2000)
    insight_id: str | None = None


class BatchStatus(Idempotent):
    plan_ids: list[str] = Field(min_length=1, max_length=100)
    status: Literal["paused"]


class ScenarioInput(Idempotent):
    plan_id: str
    scenario: Literal["no_conversion", "near_budget", "followup_orders", "followup_no_change"]


class ScanInput(Idempotent):
    campaign_id: str
    batch_id: str | None = None
    spend_threshold: float = Field(default=100, ge=.01, le=1000000, allow_inf_nan=False)


class TaskStatus(Input):
    status: Literal["pending", "processing", "review", "resolved", "ignored"]
    note: str = Field(default="", max_length=3000)


class DismissInput(Input):
    reason: str = Field(min_length=1, max_length=2000)


class ObserveStart(Input):
    plan_id: str


class ObserveReview(Input):
    batch_id: str | None = None
    note: str = Field(default="", max_length=3000)


class ReportInput(Idempotent):
    campaign_id: str
    dataset: Literal["history", "session", "batch"]
    batch_id: str | None = None
    plan_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    title: str = Field(min_length=1, max_length=200)
    conclusion: str = Field(default="", max_length=6000)
    next_action: str = Field(default="", max_length=6000)


SCENARIOS = [
    dict(id="no_conversion", label="有点击，暂未成交", description="固定 24 小时模拟窗口：120 元消耗、60 次点击、0 单。", impressions=3000, clicks=60, spend=120., orders=0, new_customers=0),
    dict(id="near_budget", label="预算接近上限", description="消耗为当前计划总预算的 95%；仅为阈值演示，不是预测。", impressions=5000, clicks=100, spend=None, orders=2, new_customers=1),
    dict(id="followup_orders", label="后续场景：产生订单", description="另一个独立 24 小时模拟窗口：120 元消耗、60 次点击、3 单。", impressions=3000, clicks=60, spend=120., orders=3, new_customers=2),
    dict(id="followup_no_change", label="后续场景：仍未成交", description="另一个独立 24 小时模拟窗口：120 元消耗、60 次点击、0 单。", impressions=3000, clicks=60, spend=120., orders=0, new_customers=0),
]


def valid_dates(start, end):
    if end < start:
        raise HTTPException(422, "结束日期不能早于开始日期。")


def plan_before(plan):
    return {k: plan.get(k, 1 if k == "config_version" else None) for k in ("budget", "start_date", "end_date", "config_version")}


def scenario_data(plan, scenario, batch_id="preview", timestamp=None):
    spec = next(s for s in SCENARIOS if s["id"] == scenario)
    timestamp = timestamp or now()
    spend = money(plan["budget"] * .95) if scenario == "near_budget" else spec["spend"]
    price = plan["creative_snapshot"]["product_snapshot"]["price"]
    orders = [{"id": f'{batch_id}-order-{i+1}', "buyer_id": f'{batch_id}-buyer-{i+1}', "buyer_type": "new" if i < spec["new_customers"] else "returning",
               "amount": price, "unit_price": price, "quantity": 1, "plan_id": plan["id"], "creative_id": plan["creative_id"], "campaign_id": plan["campaign_id"],
               "plan_config_version": plan.get("config_version", 1), "created_at": timestamp, "simulation": True, "source": "模拟场景批次"} for i in range(spec["orders"])]
    metrics = ratios({"impressions": spec["impressions"], "clicks": spec["clicks"], "spend": spend, "orders": len(orders), "buyers": len(orders), "new_customers": spec["new_customers"], "unknown_buyers": 0, "revenue": money(Decimal(str(price))*len(orders))})
    return {"id": batch_id, "campaign_id": plan["campaign_id"], "plan_id": plan["id"], "scenario": scenario, "label": spec["label"], "created_at": timestamp,
            "window": "独立模拟窗口 · 24 小时（固定场景，非实时流量）", "window_hours": 24, "plan_snapshot": deepcopy(plan), "metrics": metrics, "orders": orders,
            "spend_entries": [{"id": batch_id+"-spend", "plan_id": plan["id"], "amount": spend, "created_at": timestamp, "source": "预设模拟消耗", "config_version": plan.get("config_version", 1)}],
            "note": "确认后仅保存独立模拟批次；不产生实际广告花费，不合并现场订单。", "simulation": True}


def make_observation(db, campaign_id, insight=None, creative_id=None, adjustment=None):
    existing = next((o for o in all_records(db, "observations") if (insight and o.get("insight_id") == insight["id"]) or (adjustment and o.get("adjustment_id") == adjustment["id"])), None)
    if existing:
        return existing
    baseline = insight["analytics_snapshot"] if insight else query_analytics(db, "session", campaign_id, adjustment["plan_id"])
    return put(db, "observations", {"id": uid("observation"), "campaign_id": campaign_id, "insight_id": insight["id"] if insight else None,
               "adjustment_id": adjustment["id"] if adjustment else None, "creative_id": creative_id, "plan_id": adjustment["plan_id"] if adjustment else None,
               "baseline_dataset": baseline["dataset"], "baseline_batch_id": baseline.get("dataset_id") if baseline["dataset"] == "batch" else None,
               "baseline_snapshot": deepcopy(baseline), "status": "waiting_confirmation", "metric": "支付订单", "created_at": now(), "start_at": None,
               "note": "等待确认变更、选择运行计划并开始观察；不会自动填充改善结果。"})


def check_insight_scope(db, insight, plan=None, creative=None):
    snapshot = insight["analytics_snapshot"]
    target = snapshot.get("filters", {}).get("plan_id")
    if snapshot["dataset"] == "batch":
        target = get(db, "batches", snapshot["dataset_id"])["plan_id"]
    if not target or snapshot["dataset"] == "history":
        return
    if plan and plan["id"] != target:
        raise HTTPException(409, "复盘已限定具体计划，调整必须作用于该计划。")
    if creative:
        original = get(db, "creatives", get(db, "plans", target)["creative_id"])
        if (original.get("family_id") or original["id"]) != (creative.get("family_id") or creative["id"]):
            raise HTTPException(409, "所选素材不属于复盘计划的创意系列。")


def register_v2(app, store, adapter):
    @app.put("/api/campaigns/{campaign_id}")
    def edit_campaign(campaign_id: str, body: CampaignInput):
        with store.transaction() as db:
            def run():
                record = get(db, "campaigns", campaign_id)
                fields = campaign_fields(body)
                history = record.get("strategy_history", []) + [{k: deepcopy(v) for k, v in record.items() if k not in {"strategy_history", "product_snapshot"}}]
                record.update(**fields, strategy_version=record.get("strategy_version", 1)+1, strategy_history=history, updated_at=now())
                log(db, "调整活动策略", f'{record["name"]} · 策略 V{record["strategy_version"]}；已有素材和计划未覆盖。')
                return put(db, "campaigns", record)
            return once(db, "campaign-edit:"+campaign_id, body, run)

    @app.post("/api/creatives/{creative_id}/regenerate")
    def regenerate(creative_id: str, body: GenerateInput):
        def prepare(db):
            parent = get(db, "creatives", creative_id)
            from backend.live import check_live
            check_live(db, parent, require_ready=False)
            campaign = get(db, "campaigns", parent["campaign_id"])
            campaign["product_snapshot"] = parent["product_snapshot"]
            return {"parent": parent, "campaign": campaign}
        def save(db, context, fields):
            if prepare(db) != context:
                raise HTTPException(409, "生成期间活动或素材状态已变化，请重新生成。")
            parent, campaign = context["parent"], context["campaign"]
            fields["direction"] = parent["direction"]
            fields["template"] = parent.get("template", "classic")
            result = creative_record(campaign, fields, "replay" if adapter.mode == "replay" else "model", parent)
            result["version"] = next_version(db, parent)
            log(db, "单独重生成素材", f'{parent["direction"]} → V{result["version"]}；其他创意不变。')
            return put(db, "creatives", result)
        return model_operation(store, adapter, "regenerate:"+creative_id, body, prepare,
                               lambda c: generate_fields(adapter, c["campaign"], body)[0 if body.angle == "场景" else 1], save)

    @app.put("/api/plans/{plan_id}")
    def edit_plan(plan_id: str, body: PlanEdit):
        with store.transaction() as db:
            plan = get(db, "plans", plan_id)
            if plan["status"] != "draft":
                raise HTTPException(409, "仅草稿可直接编辑；运行或暂停计划请创建调整草稿。")
            valid_dates(body.start_date, body.end_date)
            values = body.model_dump(mode="json")
            if all(plan.get(k) == v for k, v in values.items()):
                return plan
            history = plan.get("config_history", []) + [{**plan_before(plan), "name": plan["name"], "recorded_at": now()}]
            plan.update(**values, config_version=plan.get("config_version", 1)+1, config_history=history, updated_at=now())
            log(db, "编辑计划草稿", f'{plan["name"]} · 配置 V{plan["config_version"]}')
            return put(db, "plans", plan)

    @app.post("/api/plans/{plan_id}/copy")
    def copy_plan(plan_id: str, body: Idempotent):
        with store.transaction() as db:
            def run():
                old = get(db, "plans", plan_id)
                copy = {k: deepcopy(old[k]) for k in ("campaign_id", "creative_id", "creative_snapshot", "budget", "start_date", "end_date", "account", "objective")}
                copy.update(id=uid("plan"), name=old["name"][:110]+" · 副本", status="draft", created_at=now(), config_version=1, config_history=[], simulation=True, copied_from=plan_id)
                log(db, "复制计划", f'{old["name"]} → 独立草稿；未复制成交或消耗。')
                return put(db, "plans", copy)
            return once(db, "copy:"+plan_id, body, run)

    @app.post("/api/plans/{plan_id}/adjustments")
    def create_adjustment(plan_id: str, body: AdjustmentInput):
        with store.transaction() as db:
            def run():
                plan = get(db, "plans", plan_id)
                if plan["status"] == "ended":
                    raise HTTPException(409, "已结束计划不能调整，请复制新计划。")
                valid_dates(body.start_date, body.end_date)
                insight = get(db, "insights", body.insight_id) if body.insight_id else None
                if insight:
                    if insight["campaign_id"] != plan["campaign_id"]:
                        raise HTTPException(409, "复盘与计划不属于同一活动。")
                    check_insight_scope(db, insight, plan=plan)
                    if insight.get("result_adjustment_id"):
                        existing = get(db, "adjustments", insight["result_adjustment_id"])
                        if existing["plan_id"] == plan_id:
                            return existing
                    if insight["status"] != "pending":
                        raise HTTPException(409, "该建议已经处理，不能再次创建不同动作。")
                result = put(db, "adjustments", {"id": uid("adjustment"), "campaign_id": plan["campaign_id"], "plan_id": plan_id, "before": plan_before(plan),
                             "after": {"budget": money(body.budget), "start_date": body.start_date.isoformat(), "end_date": body.end_date.isoformat()}, "reason": body.reason,
                             "status": "draft", "created_at": now(), "insight_id": body.insight_id})
                if insight:
                    insight.update(status="accepted", result_adjustment_id=result["id"], observation="调整草稿已生成，等待人工确认。")
                    put(db, "insights", insight)
                make_observation(db, plan["campaign_id"], insight=insight, adjustment=result)
                log(db, "生成计划调整草稿", f'{plan["name"]}；等待核对前后值并确认。')
                return result
            return once(db, "adjustment:"+plan_id, body, run)

    @app.post("/api/adjustments/{adjustment_id}/apply")
    def apply_adjustment(adjustment_id: str, body: Idempotent):
        with store.transaction() as db:
            def run():
                change = get(db, "adjustments", adjustment_id)
                if change["status"] == "applied":
                    return change
                plan = get(db, "plans", change["plan_id"])
                if plan["status"] == "ended":
                    raise HTTPException(409, "计划已结束，无法确认调整。")
                if plan.get("config_version", 1) != change["before"]["config_version"]:
                    raise HTTPException(409, "计划配置已变化，请重新创建调整草稿并核对。")
                if plan["status"] == "running" and not change["after"]["start_date"] <= date.today().isoformat() <= change["after"]["end_date"]:
                    raise HTTPException(409, "运行计划的新周期必须包含当前日期。")
                history = plan.get("config_history", []) + [{**plan_before(plan), "recorded_at": now(), "adjustment_id": adjustment_id}]
                plan.update(**change["after"], config_version=plan.get("config_version", 1)+1, config_history=history, updated_at=now())
                put(db, "plans", plan)
                change.update(status="applied", applied_at=now(), applied_config_version=plan["config_version"])
                put(db, "adjustments", change)
                insight = get(db, "insights", change["insight_id"]) if change.get("insight_id") else None
                make_observation(db, plan["campaign_id"], insight=insight, adjustment=change)
                log(db, "确认模拟计划调整", f'{plan["name"]} · 配置 V{plan["config_version"]}；未改变运行状态，未产生新效果数据。')
                return change
            return once(db, "apply:"+adjustment_id, body, run)

    @app.post("/api/plans/batch-status")
    def batch_status(body: BatchStatus):
        with store.transaction() as db:
            def run():
                results = []
                for plan_id in dict.fromkeys(body.plan_ids):
                    try:
                        plan = get(db, "plans", plan_id)
                        if plan["status"] != "running":
                            raise HTTPException(409, "仅运行中的计划可以批量暂停。")
                        plan.update(status="paused", updated_at=now())
                        put(db, "plans", plan)
                        log(db, "批量暂停计划", plan["name"])
                        results.append({"plan_id": plan_id, "ok": True})
                    except HTTPException as exc:
                        results.append({"plan_id": plan_id, "ok": False, "error": exc.detail})
                return {"results": results}
            return once(db, "batch-status", body, run)

    @app.get("/api/scenarios")
    def scenarios():
        return SCENARIOS

    @app.post("/api/batches/preview")
    def preview_batch(body: ScenarioInput):
        with store.transaction() as db:
            return scenario_data(get(db, "plans", body.plan_id), body.scenario)

    @app.post("/api/batches")
    def create_batch(body: ScenarioInput):
        with store.transaction() as db:
            def run():
                plan = get(db, "plans", body.plan_id)
                if plan["status"] != "running":
                    raise HTTPException(409, "仅运行中的计划可以载入新的模拟批次。")
                result = scenario_data(plan, body.scenario, uid("batch"))
                log(db, "载入模拟场景", f'{plan["name"]} · {result["label"]}；独立数据批次，非实际投放。')
                return put(db, "batches", result)
            return once(db, "batch", body, run)

    @app.post("/api/tasks/scan")
    def scan_tasks(body: ScanInput):
        with store.transaction() as db:
            def run():
                get(db, "campaigns", body.campaign_id)
                candidates = []
                for kind, title in (("creatives", "素材待确认"), ("plans", "计划待确认")):
                    for record in all_records(db, kind):
                        if record["campaign_id"] == body.campaign_id and record["status"] == "draft":
                            candidates.append(dict(rule="pending-"+kind, title=title, object_type=kind, object_id=record["id"], plan_id=record["id"] if kind == "plans" else None,
                                                   detail="该草稿尚未确认，请核对内容后继续。", evidence={"status": "draft", "name": record.get("name", record.get("title"))}))
                if body.batch_id:
                    batch = get(db, "batches", body.batch_id)
                    if batch["campaign_id"] != body.campaign_id:
                        raise HTTPException(409, "批次不属于当前活动。")
                    m = batch["metrics"]
                    evidence = {"source": "预设模拟场景", "window": batch["window"], "batch_id": batch["id"], "spend": m["spend"], "clicks": m["clicks"], "orders": m["orders"], "threshold": body.spend_threshold, "rule_version": 1}
                    base = dict(object_type="plans", object_id=batch["plan_id"], plan_id=batch["plan_id"], batch_id=batch["id"], evidence=evidence)
                    if m["spend"] >= body.spend_threshold and m["orders"] == 0:
                        candidates.append({**base, "rule": "spend-without-order", "title": "消耗达到观察阈值，尚无成交", "detail": "按用户设定阈值提示检查；不证明素材无效或广告因果效果。"})
                    if m["spend"] >= batch["plan_snapshot"]["budget"]*.9:
                        candidates.append({**base, "rule": "budget-near-limit", "title": "模拟消耗接近计划预算", "detail": "模拟批次消耗达到配置预算的 90%，请核对后决定下一步。", "evidence": {**evidence, "budget": batch["plan_snapshot"]["budget"], "budget_ratio_threshold": .9}})
                existing = {t["id"]: t for t in all_records(db, "tasks")}
                for item in candidates:
                    key = "task-"+hashlib.sha256(f'{body.campaign_id}:{item["rule"]}:{item["object_id"]}:{item.get("batch_id", "")}'.encode()).hexdigest()[:20]
                    if key not in existing:
                        put(db, "tasks", {"id": key, "campaign_id": body.campaign_id, **item, "status": "pending", "note": "", "created_at": now(), "history": []})
                return [t for t in all_records(db, "tasks") if t["campaign_id"] == body.campaign_id]
            return once(db, "scan", body, run)

    @app.post("/api/tasks/{task_id}/status")
    def task_status(task_id: str, body: TaskStatus):
        with store.transaction() as db:
            task = get(db, "tasks", task_id)
            if body.status in {"resolved", "ignored"} and not body.note:
                raise HTTPException(422, "解决或忽略事项时，请填写复查依据或理由。")
            if task["status"] == body.status and task.get("note") == body.note:
                return task
            task["history"].append({"from": task["status"], "to": body.status, "note": body.note, "created_at": now(), "operator": "演示运营员"})
            task.update(status=body.status, note=body.note, updated_at=now())
            log(db, "更新待办状态", f'{task["title"]} → {body.status}')
            return put(db, "tasks", task)

    @app.post("/api/insights/{insight_id}/dismiss")
    def dismiss_insight(insight_id: str, body: DismissInput):
        with store.transaction() as db:
            insight = get(db, "insights", insight_id)
            if insight["status"] not in {"pending", "dismissed"}:
                raise HTTPException(409, "已采纳的建议不能改为暂不采纳。")
            insight.update(status="dismissed", reason=body.reason, updated_at=now())
            log(db, "暂不采纳建议", body.reason)
            return put(db, "insights", insight)

    @app.post("/api/observations/{observation_id}/start")
    def start_observation(observation_id: str, body: ObserveStart):
        with store.transaction() as db:
            observation = get(db, "observations", observation_id)
            if observation["status"] != "waiting_confirmation":
                if observation.get("plan_id") == body.plan_id:
                    return observation
                raise HTTPException(409, "观察已开始，不能切换计划。")
            plan = get(db, "plans", body.plan_id)
            if plan["campaign_id"] != observation["campaign_id"] or plan["status"] != "running":
                raise HTTPException(409, "请选择同一活动中已运行的计划。")
            if observation.get("creative_id") and plan["creative_id"] != observation["creative_id"]:
                raise HTTPException(409, "计划必须使用本次建议生成并确认的素材。")
            if observation.get("adjustment_id"):
                adjustment = get(db, "adjustments", observation["adjustment_id"])
                if adjustment["status"] != "applied" or plan["id"] != adjustment["plan_id"] or plan.get("config_version", 1) != adjustment["applied_config_version"]:
                    raise HTTPException(409, "先确认对应调整，并选择仍使用该配置版本的计划。")
            observation.update(status="observing", plan_id=plan["id"], config_version=plan.get("config_version", 1), start_at=now(), note="观察已开始，等待同源后续数据；尚不能判断改善。")
            log(db, "开始观察", f'{plan["name"]} · {observation["metric"]}')
            return put(db, "observations", observation)

    @app.post("/api/observations/{observation_id}/review")
    def review_observation(observation_id: str, body: ObserveReview):
        with store.transaction() as db:
            observation = get(db, "observations", observation_id)
            if observation["status"] == "reviewed":
                return observation
            if observation["status"] != "observing":
                raise HTTPException(409, "请先完成确认并开始观察。")
            before = observation["baseline_snapshot"]
            after = None
            note = "缺少同源、同计划与配置的后续数据，继续观察。"
            if body.batch_id:
                batch = get(db, "batches", body.batch_id)
                if batch["campaign_id"] != observation["campaign_id"] or batch["plan_id"] != observation["plan_id"]:
                    raise HTTPException(409, "后续批次不属于观察计划。")
                if observation["baseline_dataset"] != "batch":
                    note = "基线不是模拟批次，不能与模拟批次进行前后比较。请使用相同来源建立观察。"
                elif batch["id"] == observation.get("baseline_batch_id") or batch["created_at"] <= observation["start_at"]:
                    note = "需要在观察开始后载入的独立批次，不能重复使用基线或之前的数据。"
                elif batch["plan_snapshot"].get("config_version", 1) != observation["config_version"]:
                    note = "后续批次的计划配置版本与观察目标不一致，请重新建立对应观察。"
                else:
                    after = query_analytics(db, "batch", observation["campaign_id"], observation["plan_id"], batch["id"])
            elif observation["baseline_dataset"] == "session":
                filters = before.get("filters", {})
                if not filters.get("plan_id") or not filters.get("date_from") or not filters.get("date_to"):
                    note = "现场基线需要指定单一计划和完整起止日期；不能把全活动累计值与单计划短窗口比较。请按明确范围重新生成复盘。"
                else:
                    baseline_start = datetime.fromisoformat(filters["date_from"]).replace(tzinfo=timezone.utc)
                    baseline_end = datetime.fromisoformat(filters["date_to"]).replace(tzinfo=timezone.utc) + timedelta(days=1)
                    observation_start = datetime.fromisoformat(observation["start_at"])
                    observation_end = observation_start + (baseline_end - baseline_start)
                    if baseline_end > observation_start:
                        note = "基线窗口尚未结束，不能与重叠的后续窗口比较。请在基线结束后重新生成复盘和观察任务。"
                    elif datetime.now(timezone.utc) < observation_end:
                        note = f'等长现场窗口尚未结束，需要观察至 {observation_end.isoformat()}；当前不输出优化结论。'
                    else:
                        def observed(record):
                            return (record["plan_id"] == observation["plan_id"]
                                    and observation_start <= datetime.fromisoformat(record["created_at"]) < observation_end
                                    and record.get("plan_config_version", 1) == observation["config_version"])
                        orders = list(filter(observed, all_records(db, "orders")))
                        events = list(filter(observed, all_records(db, "events")))
                        after = {"metrics": session_metrics(orders, events), "window": f'{observation_start.isoformat()} 至 {observation_end.isoformat()}（UTC，等长现场窗口）'}
            elif observation["baseline_dataset"] == "history":
                note = "D0 是固定历史样例，没有同源后续数据；不能与现场或场景批次混合判断改善。"
            if after:
                scope_label = "固定模拟窗口" if observation["baseline_dataset"] == "batch" else "等长现场互动窗口"
                observation.update(status="reviewed", end_at=now(), comparison={"before": before["metrics"], "after": after["metrics"], "before_window": before["window"], "after_window": after["window"], "orders_delta": after["metrics"]["orders"]-before["metrics"]["orders"], "message": f"{scope_label}的描述性对比，不证明策略因果效果或真实改善。"}, followup_batch_id=body.batch_id, note=body.note or f"已完成{scope_label}对比；不自动判定优化成功。")
            else:
                observation.update(note=note, review_note=body.note)
            log(db, "复查观察任务", observation["note"])
            return put(db, "observations", observation)

    @app.post("/api/reports")
    def create_report(body: ReportInput):
        with store.transaction() as db:
            def run():
                campaign = get(db, "campaigns", body.campaign_id)
                analytics = query_analytics(db, body.dataset, body.campaign_id, body.plan_id, body.batch_id, body.date_from, body.date_to)
                snapshot = {"campaign": campaign, "analytics": analytics, "model_label": adapter.info["label"]}
                selected_plan = body.plan_id
                selected_batch = get(db, "batches", body.batch_id) if body.dataset == "batch" else None
                if selected_batch:
                    selected_plan = selected_batch["plan_id"]
                for key in ("creatives", "plans", "tasks", "adjustments", "observations"):
                    records = [x for x in all_records(db, key) if x["campaign_id"] == body.campaign_id]
                    if selected_plan:
                        if key == "plans":
                            records = [deepcopy(selected_batch["plan_snapshot"])] if selected_batch else [x for x in records if x["id"] == selected_plan]
                        elif key == "creatives":
                            creative_ids = {r.get("creative_id") for r in analytics["rows"]}
                            records = [x for x in records if x["id"] in creative_ids]
                        else:
                            records = [x for x in records if x.get("plan_id") == selected_plan]
                    snapshot[key] = records
                record = {"id": uid("report"), "campaign_id": body.campaign_id, "title": body.title, "conclusion": body.conclusion,
                          "next_action": body.next_action, "created_at": now(), "simulation": True, "snapshot": deepcopy(snapshot)}
                log(db, "保存活动报告", f'{body.title} · {analytics["label"]}，已保存不可变快照。')
                return put(db, "reports", record)
            return once(db, "report", body, run)
