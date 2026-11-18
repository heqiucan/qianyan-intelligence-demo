"""Explicit, versioned handoff from reviewed knowledge content to campaign drafts."""
from copy import deepcopy

from fastapi import HTTPException
from pydantic import Field

from backend.knowledge import Operation, get, put, records, source_warnings, stamp


class HandoffInput(Operation):
    campaign_id: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=1)
    expected_product_version: int = Field(ge=1)
    acknowledged: bool = False
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=6000)
    script: str = Field(default="", max_length=6000)
    cta: str = Field(default="查看商品详情", min_length=1, max_length=100)
    live_session_id: str | None = None
    live_item_id: str | None = None


def handoff_status(db, draft):
    if draft["scene"] != "live":
        return False, "医美 FAQ 供内部沟通使用，当前商品成交活动不接收医美内容。可确认并导出草稿。"
    if draft["status"] != "confirmed":
        return False, "请先逐段核对引用，人工确认并保存知识草稿。"
    if source_warnings(db, draft):
        return False, "引用资料已更新或不可用，请重新检索生成并确认草稿。"
    if draft.get("agent_task_id"):
        task = get(db, "agent_runs", draft["agent_task_id"])
        if (task["status"] != "completed" or task.get("draft_id") != draft["id"]
                or task.get("completed_revision") != draft["revision"]):
            return False, "请先在 Agent 任务中完成当前草稿的人工确认并标记任务完成。"
        if task.get("live_context"):
            from backend.live import check_live
            try:
                check_live(db, task)
            except HTTPException as error:
                return False, str(error.detail)
    return True, "可以转为活动创意草稿；转入后仍需核对商品事实并确认素材。"


def origin_view(db, creative):
    origin = creative.get("knowledge_origin")
    if not origin:
        return {"origin": None, "warnings": []}
    # Read current availability, while keeping the imported text and citations immutable.
    return {"origin": origin, "warnings": source_warnings(db, origin)}


def check_origin(db, creative):
    from backend.live import check_live
    check_live(db, creative)
    warnings = origin_view(db, creative)["warnings"]
    if warnings:
        raise HTTPException(409, "知识引用已更新或不可用，请重新生成并转入新草稿：" + "；".join(warnings))


def register_handoff(app, store):
    from backend.main import creative_record, log, once, uid

    @app.get("/api/creatives/{creative_id}/knowledge-origin")
    def read_origin(creative_id: str):
        with store.read() as db:
            return origin_view(db, get(db, "creatives", creative_id))

    @app.post("/api/knowledge/drafts/{draft_id}/creative")
    def transfer(draft_id: str, body: HandoffInput):
        with store.transaction() as db:
            def run():
                draft = get(db, "kb_drafts", draft_id)
                campaign = get(db, "campaigns", body.campaign_id)
                from backend.live import session_context, check_live
                task = get(db, "agent_runs", draft["agent_task_id"]) if draft.get("agent_task_id") else None
                context = task.get("live_context") if task else None
                if bool(body.live_session_id) != bool(body.live_item_id):
                    raise HTTPException(422, "请同时选择场次与货盘商品")
                if body.live_session_id:
                    selected = session_context(db, body.live_session_id, body.live_item_id, body.campaign_id)
                    if context and context != selected:
                        raise HTTPException(422, "任务已固定货盘版本，不能转入其他商品或场次")
                    context = selected
                if context:
                    check_live(db, {"live_context": context, "campaign_id": body.campaign_id})
                    campaign.update(product_snapshot=deepcopy(context["product_snapshot"]), live_context=context)
                if not body.acknowledged:
                    raise HTTPException(422, "请核对内容属于当前活动商品，并确认仅创建待审核草稿。")
                if draft["revision"] != body.expected_revision:
                    raise HTTPException(409, "知识草稿已更新，请重新打开转入窗口。")
                if campaign["product_snapshot"]["version"] != body.expected_product_version:
                    raise HTTPException(409, "目标活动商品版本已变化，请重新核对。")
                ready, note = handoff_status(db, draft)
                if not ready:
                    raise HTTPException(409 if draft["scene"] == "live" else 422, note)
                task_id = draft.get("agent_task_id")
                task = get(db, "agent_runs", task_id) if task_id else None
                if task and task.get("campaign_id") and task["campaign_id"] != campaign["id"]:
                    raise HTTPException(422, "该 Agent 任务已关联其他活动，请转入任务原活动。")
                # Also deduplicate a second click with a new request ID or a page reload.
                previous = next((item for item in records(db, "kb_transfers")
                                 if item["draft_id"] == draft_id and item["revision"] == draft["revision"]
                                 and item["campaign_id"] == campaign["id"] and item.get("live_context") == context), None)
                if previous:
                    return {"creative": get(db, "creatives", previous["creative_id"]), "reused": True}
                space = get(db, "kb_spaces", draft["space_id"])
                origin = {key: deepcopy(draft.get(key)) for key in (
                    "id", "title", "revision", "blocks", "sources", "missing", "space_id", "scene", "channel",
                    "source", "model_name", "writing_mode", "edited_by", "confirmed_at", "confirmed_by")}
                origin.update(draft_id=draft_id, agent_task_id=task_id, space_name=space["name"],
                              transferred_at=stamp(), target_product_version=body.expected_product_version,
                              target_product_name=campaign["product_snapshot"]["name"])
                fields = {key: getattr(body, key) for key in ("title", "body", "script", "cta")}
                fields.update(direction="Agent 直播内容" if task_id else "知识库内容转入", knowledge_origin=origin)
                creative = creative_record(campaign, fields, "knowledge")
                put(db, "creatives", creative)
                put(db, "kb_transfers", {"id": uid("transfer"), "draft_id": draft_id, "revision": draft["revision"],
                                        "campaign_id": campaign["id"], "campaign_name": campaign["name"],
                                        "creative_id": creative["id"], "created_at": stamp()})
                if context:
                    transfer = records(db, "kb_transfers")[-1]
                    transfer["live_context"] = deepcopy(context)
                    put(db, "kb_transfers", transfer)
                log(db, "知识内容转为创意草稿", f"{draft['title']} V{draft['revision']} → {campaign['name']}；保留引用，待素材核对，未投放。")
                return {"creative": creative, "reused": False}
            return once(db, "kb-to-creative:" + draft_id, body, run)
