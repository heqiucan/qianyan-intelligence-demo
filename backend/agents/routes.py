from fastapi import HTTPException
from backend.knowledge import get, put, records, stamp, identifier, draft_view
from backend.agents.schemas import CreateTask, ContinueTask, ControlTask, FinishTask, ReopenTask, ACTIVE, RESUMABLE, LIMITS
from backend.agents.runner import event, AgentRunner
from backend.agents.tools import ensure_demo_space


def public_task(db, task, detail=True):
    result = {k: v for k, v in task.items() if k != "scratch"}
    result["limits"] = LIMITS
    if detail:
        scratch = task["scratch"]
        result["evidence"] = scratch.get("sources", scratch.get("candidates", []))
        result["check"] = scratch.get("check")
        result["draft"] = draft_view(db, get(db, "kb_drafts", task["draft_id"])) if task.get("draft_id") else None
        result["can_complete"] = bool(result["draft"] and result["draft"]["status"] == "confirmed" and not result["draft"]["source_warnings"] and task["status"] == "waiting_review")
        if result["draft"] and task["status"] == "completed":
            result["completion_stale"] = result["draft"]["revision"] != task.get("completed_revision") or bool(result["draft"]["source_warnings"])
    else:
        result.pop("events", None)
    return result


def register_agents(app, store, adapter, runner):
    from backend.main import once

    def queue_capacity(db):
        if sum(t["status"] in ACTIVE for t in records(db, "agent_runs")) >= 4:
            raise HTTPException(409, "已有 4 项待处理任务，请等待或取消后再创建。")

    @app.get("/api/agent/tasks")
    def list_tasks():
        with store.transaction() as db:
            tasks = sorted(records(db, "agent_runs"), key=lambda t: t["created_at"], reverse=True)
            return [public_task(db, t, False) for t in tasks[:100]]

    @app.get("/api/agent/tasks/{task_id}")
    def read_task(task_id: str):
        with store.transaction() as db:
            return public_task(db, get(db, "agent_runs", task_id))

    @app.post("/api/agent/tasks", status_code=202)
    def create_task(body: CreateTask):
        if adapter.configuration_error():
            raise HTTPException(422, adapter.configuration_error())
        with store.transaction() as db:
            def create():
                queue_capacity(db)
                from backend.live import session_context, check_live, ensure_live_space
                context = session_context(db, body.live_session_id, body.live_item_id, body.campaign_id) if body.live_session_id else None
                if context:
                    check_live(db, {"live_context": context})
                space = ensure_live_space(db, context) if body.source_mode == "catalog" else ensure_demo_space(db, body.scene) if body.source_mode == "demo" else get(db, "kb_spaces", body.space_id)
                if space["scene"] != body.scene:
                    raise HTTPException(422, "所选资料空间与业务场景不一致。")
                campaign = get(db, "campaigns", body.campaign_id) if body.campaign_id else None
                task = {"id": identifier("agent"), "scene": body.scene, "goal": body.goal, "source_mode": body.source_mode,
                        "space_id": space["id"], "space_name": space["name"], "channel": body.channel,
                        "campaign_id": body.campaign_id, "campaign_name": campaign["name"] if campaign else None,
                        "product_name": campaign["product_snapshot"]["name"] if campaign else None,
                        "source": "replay" if adapter.mode == "replay" else "model", "model_name": adapter.info["model_name"],
                        "status": "queued", "stage": "decide", "attempt": 1, "steps": 0, "model_calls": 0,
                        "total_model_calls": 0, "scratch": {}, "notes": [], "events": [], "result_ids": [], "draft_id": None,
                        "created_at": stamp(), "updated_at": stamp(), "message": "任务已保存，等待执行。"}
                if context:
                    task.update(live_context=context, product_name=context["product_snapshot"]["name"])
                event(task, "created", "使用已人工确认的本场货盘快照；不是平台核验。" if body.source_mode == "catalog" else "使用独立虚构示例资料。" if body.source_mode == "demo" else "只使用所选知识库中已审核且有效的资料。")
                put(db, "agent_runs", task)
                return {"id": task["id"]}
            result = once(db, "agent-create", body, create)
        runner.notify()
        return result

    @app.post("/api/agent/tasks/{task_id}/continue", status_code=202)
    def continue_task(task_id: str, body: ContinueTask):
        if adapter.configuration_error():
            raise HTTPException(422, adapter.configuration_error())
        with store.transaction() as db:
            def resume():
                task = get(db, "agent_runs", task_id)
                if task["attempt"] != body.expected_attempt or task["status"] not in RESUMABLE:
                    raise HTTPException(409, "任务状态已变化，请刷新后继续。")
                if task["attempt"] >= LIMITS["attempts"]:
                    raise HTTPException(422, "该任务已达到继续次数上限，请整理要求后新建任务。")
                if task["status"] == "waiting_review" and not body.note:
                    raise HTTPException(422, "已有待审阅草稿，请填写新的修改要求再继续。")
                if task["source"] != ("replay" if adapter.mode == "replay" else "model") or task["model_name"] != adapter.info["model_name"]:
                    raise HTTPException(409, "模型模式已变化，请新建任务；不会将旧回放标成模型执行。")
                queue_capacity(db)
                # New user information or stale evidence starts a fresh retrieval;
                # a transient failure can resume a persisted generation/check step.
                if body.note or task["status"] in {"waiting_input", "waiting_review"}:
                    task["scratch"] = {}; task["stage"] = "decide"; task["draft_id"] = None
                if body.note:
                    task["notes"].append(body.note)
                task.update(attempt=task["attempt"] + 1, status="queued", steps=0, model_calls=0, message="已保存补充要求，等待继续。")
                AgentRunner.close_running(task, "interrupted")
                event(task, "resume", "重新检索，并使用补充要求。" if body.note else "继续任务，保存已有执行记录。")
                put(db, "agent_runs", task)
                return {"id": task_id}
            result = once(db, "agent-continue:" + task_id, body, resume)
        runner.notify()
        return result

    @app.post("/api/agent/tasks/{task_id}/cancel")
    def cancel_task(task_id: str, body: ControlTask):
        with store.transaction() as db:
            def cancel():
                task = get(db, "agent_runs", task_id)
                if task["attempt"] != body.expected_attempt or task["status"] in {"completed", "cancelled"}:
                    raise HTTPException(409, "任务状态已变化，不能重复取消。")
                task.update(status="cancelled", message="已取消后续步骤。已发出的模型请求可能仍在返回，但结果不会继续保存；既有草稿保留。")
                AgentRunner.close_running(task, "cancelled")
                event(task, "cancel", task["message"], "cancelled")
                put(db, "agent_runs", task)
                return {"id": task_id}
            return once(db, "agent-cancel:" + task_id, body, cancel)

    @app.post("/api/agent/tasks/{task_id}/reopen")
    def reopen_task(task_id: str, body: ReopenTask):
        with store.transaction() as db:
            def reopen():
                task = get(db, "agent_runs", task_id)
                if task["status"] != "completed" or task["attempt"] != body.expected_attempt or not task.get("draft_id"):
                    raise HTTPException(409, "仅已完成的内容任务可以重新打开审核")
                draft = get(db, "kb_drafts", task["draft_id"])
                if draft["revision"] != body.expected_revision:
                    raise HTTPException(409, "草稿版本已变化，请刷新再打开")
                task.setdefault("completion_history", []).append({"revision": task["completed_revision"], "completed_at": task["completed_at"], "reopened_at": stamp()})
                task.update(status="waiting_review", message="已重新打开人工审核。请确认当前草稿；引用失效时补充要求重新检索。未调用模型。")
                event(task, "reopen", task["message"])
                put(db, "agent_runs", task)
                return {"id": task_id}
            return once(db, "agent-reopen:" + task_id, body, reopen)

    @app.post("/api/agent/tasks/{task_id}/complete")
    def complete_task(task_id: str, body: FinishTask):
        with store.transaction() as db:
            def finish():
                task = get(db, "agent_runs", task_id)
                if task["attempt"] != body.expected_attempt or task["status"] != "waiting_review" or task["draft_id"] != body.draft_id:
                    raise HTTPException(409, "任务或产物已变化，请重新查看。")
                draft = draft_view(db, get(db, "kb_drafts", body.draft_id))
                if draft["status"] != "confirmed" or draft["revision"] != body.draft_revision or draft["source_warnings"]:
                    raise HTTPException(409, "草稿尚未确认或引用已变化，不能标记完成。")
                task.update(status="completed", completed_revision=draft["revision"], completed_at=stamp(), message="已完成人工确认的内容任务，未执行发布或广告投放。")
                event(task, "complete", f"草稿 V{draft['revision']} 已由人工确认，任务完成。")
                put(db, "agent_runs", task)
                return {"id": task_id}
            return once(db, "agent-complete:" + task_id, body, finish)
