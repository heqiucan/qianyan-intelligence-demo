"""Single-process background worker with durable checkpoints and bounded actions.

No remote I/O in a DB transaction. Cancellation/attempt fences prevent late writes.
On restart, pending runs become interrupted and require explicit continuation;
the worker never silently repeats a possibly completed model call.
"""
from datetime import datetime, timezone
from threading import Event, Thread
import logging

from fastapi import HTTPException
from backend.knowledge import get, put, records, stamp, identifier
from backend.model_adapter import ModelFailure
from backend.agents.schemas import ACTIVE, LIMITS
from backend.agents.policy import choose_action
from backend.agents import tools


class Aborted(Exception):
    pass


def event(task, action, detail, status="done", **values):
    task["events"].append({"id": identifier("step"), "action": action, "detail": detail,
                           "status": status, "at": stamp(), "attempt": task["attempt"], **values})
    task["updated_at"] = stamp()


class AgentRunner:
    def __init__(self, store, adapter):
        self.store, self.adapter = store, adapter
        self.stop_event, self.wake_event = Event(), Event()
        self.thread = None

    def start(self):
        with self.store.transaction() as db:
            for task in records(db, "agent_runs"):
                if task["status"] in ACTIVE:
                    task["status"] = "interrupted"
                    task["message"] = "服务曾中断，已保留任务和已完成步骤。请手动继续，未自动重发模型请求。"
                    self.close_running(task, "interrupted")
                    event(task, "interrupted", task["message"], "interrupted")
                    put(db, "agent_runs", task)
        self.thread = Thread(target=self.loop, name="marketing-agent-worker", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set(); self.wake_event.set()
        if self.thread:
            # The adapter's network request has a bounded timeout. A shutdown
            # fences the result immediately; no late save after the request ends.
            self.thread.join(timeout=1)

    def notify(self):
        self.wake_event.set()

    @staticmethod
    def close_running(task, status):
        for item in task["events"]:
            if item["status"] == "running":
                item.update(status=status, ended_at=stamp())

    def loop(self):
        while not self.stop_event.is_set():
            self.wake_event.wait(1); self.wake_event.clear()
            while not self.stop_event.is_set():
                with self.store.transaction() as db:
                    task = next((t for t in records(db, "agent_runs") if t["status"] == "queued"), None)
                    if task:
                        task.update(status="running", started_at=stamp(), message="开始处理任务。")
                        event(task, "start", "继续保留的步骤。" if task["attempt"] > 1 else "已接收任务，准备检索与生成。")
                        put(db, "agent_runs", task)
                if not task:
                    break
                self.execute(task["id"], task["attempt"])

    def current(self, db, task_id, attempt):
        if self.stop_event.is_set():
            raise Aborted()
        task = get(db, "agent_runs", task_id)
        if task["attempt"] != attempt or task["status"] != "running":
            raise Aborted()
        started = datetime.fromisoformat(task["started_at"])
        if (datetime.now(timezone.utc) - started).total_seconds() > LIMITS["seconds"]:
            raise ModelFailure("本轮已达到运行时长上限，保留进度；请检查后手动继续。", 408)
        return task

    def change(self, task_id, attempt, fn):
        with self.store.transaction() as db:
            task = self.current(db, task_id, attempt)
            fn(db, task)
            task["updated_at"] = stamp()
            put(db, "agent_runs", task)
            return task

    def model_call(self, task_id, attempt, label, fn):
        if not self.adapter.operation_lock.acquire(blocking=False):
            raise ModelFailure("另一个 AI 任务正在使用模型，当前进度已保存。请等待其结束后手动继续。", 409)
        try:
            def before(db, task):
                if task["model_calls"] >= LIMITS["model_calls"]:
                    raise ModelFailure("本轮模型调用次数已达上限，请查看执行记录后继续。", 429)
                if self.adapter.mode != "replay":
                    task["model_calls"] += 1; task["total_model_calls"] += 1
                event(task, label, "正在调用智谱，等待响应。" if self.adapter.mode != "replay" else "正在执行明确标注的规则演示。", "running")
            snapshot = self.change(task_id, attempt, before)
            value = fn(snapshot)
            def after(db, task):
                self.close_running(task, "done")
            self.change(task_id, attempt, after)
            return value
        finally:
            self.adapter.operation_lock.release()

    def execute(self, task_id, attempt):
        try:
            while True:
                with self.store.transaction() as db:
                    task = self.current(db, task_id, attempt)
                if task["steps"] >= LIMITS["steps"]:
                    raise ModelFailure("本轮工具步骤已达上限，任务已停止。请查看记录并调整要求。", 429)
                if task["stage"] == "generate":
                    # Revalidate sources immediately before any external generation.
                    self.change(task_id, attempt, lambda db, t: tools.validate_sources(db, t, t["scratch"]["sources"]))
                    content = self.model_call(task_id, attempt, "generate_draft", lambda t: tools.generate(self.adapter, t))
                    def produced(db, t):
                        t["scratch"]["content"] = content; t["stage"] = "check"
                        event(t, "generated", "已返回内容，下一步核对引用和指定表达规则。")
                    self.change(task_id, attempt, produced)
                    continue
                if task["stage"] == "check":
                    self.change(task_id, attempt, lambda db, t: tools.validate_sources(db, t, t["scratch"]["sources"]))
                    review = self.model_call(task_id, attempt, "review_evidence", lambda t: tools.review_evidence(self.adapter, t)) if self.adapter.mode != "replay" else None
                    def checked(db, t):
                        tools.validate_sources(db, t, t["scratch"]["sources"])
                        check = tools.check_content(t["scratch"]["content"], t["scratch"]["sources"], t["scene"])
                        if review is not None:
                            check["evidence_review"] = review
                            check["checks"].append("已调用模型逐段比对引用原文（仍需人工核对）")
                            check["blocking"].extend(f"第 {issue['block']} 段：{issue['claim']}；{issue['reason']}" for issue in review["issues"])
                            if t["scene"] == "live" and len(t["scratch"]["content"]["blocks"]) != 3:
                                check["blocking"].append("直播脚本应为开场、规格展示、收尾三段。")
                            check["note"] = "完成引用结构、资料状态、有限表达规则与模型依据复核；机器复核仍可能误判，人工核对后使用。"
                            check["passed"] = not check["blocking"]
                        t["scratch"]["check"] = check; t["steps"] += 1
                        event(t, "check_draft", "引用与有限规则检查通过，仍需人工核对。" if check["passed"] else "；".join(check["blocking"]), "done" if check["passed"] else "attention")
                        if check["passed"]:
                            t["stage"] = "save"
                        elif not t["scratch"].get("repair"):
                            t["scratch"]["repair"] = True; t["stage"] = "generate"
                            event(t, "repair", "依据检查结果重写一次，保留原始依据。")
                        else:
                            t.update(status="waiting_input", message="一次修订后仍有待核对表述，请补充要求或资料后继续。")
                    task = self.change(task_id, attempt, checked)
                    if task["status"] != "running":
                        return
                    continue
                if task["stage"] == "save":
                    def saved(db, t):
                        draft = tools.save_result(db, t, self.adapter)
                        t.update(draft_id=draft["id"], status="waiting_review", stage="review", message="草稿已保存，请逐段查看引用并人工确认。")
                        if draft["id"] not in t["result_ids"]:
                            t["result_ids"].append(draft["id"])
                        t["steps"] += 1
                        event(t, "save_draft", "已保存为待确认草稿；没有执行发布或投放。", artifact_id=draft["id"])
                    self.change(task_id, attempt, saved)
                    return
                action = self.model_call(task_id, attempt, "choose_action", lambda t: choose_action(self.adapter, t))
                def apply(db, t):
                    t["steps"] += 1
                    scratch = t["scratch"]
                    if action.action == "search_knowledge":
                        queries = scratch.setdefault("queries", [])
                        if len(queries) >= LIMITS["searches"] or action.query in queries:
                            t.update(status="waiting_input", message="已达到检索次数上限或重复了相同关键词。请补充相关资料或调整任务后继续。")
                            event(t, "request_input", t["message"], "attention")
                            return
                        result = tools.retrieve(db, t, action.query)
                        queries.append(action.query)
                        merged = {s["id"]: s for s in scratch.get("candidates", [])}
                        # Prefer newly retrieved snippets; keep the union bounded.
                        candidates = {s["id"]: s for s in result["hits"]}
                        candidates.update({k: v for k, v in merged.items() if k not in candidates})
                        scratch["candidates"] = list(candidates.values())[:8]
                        scratch.pop("sources", None)
                        event(t, "search_knowledge", f"检索“{action.query}”，命中 {len(result['hits'])} 个片段。", query=action.query, source_ids=[s["id"] for s in result["hits"]])
                    elif action.action == "read_evidence":
                        previous = {s["id"]: s for s in scratch.get("sources", [])}
                        if all(key in previous for key in action.source_ids):
                            raise HTTPException(422, "重复读取相同依据，任务已停止，请调整要求后继续。")
                        previous.update({s["id"]: s for s in tools.read_evidence(db, t, action.source_ids)})
                        scratch["sources"] = list(previous.values())
                        event(t, "read_evidence", f"已读取并核对 {len(scratch['sources'])} 个原文片段及其版本。", source_ids=action.source_ids)
                    elif action.action == "generate_draft":
                        if not any(s["kind"] == "facts" for s in scratch.get("sources", [])):
                            raise HTTPException(422, "尚未读取可支撑任务的事实资料，生成动作已拦截。")
                        tools.validate_sources(db, t, scratch["sources"])
                        t["stage"] = "generate"
                        event(t, "prepare_generation", "已选定生成所用依据，准备内部内容草稿。")
                    else:
                        t.update(status="waiting_input", message=action.message)
                        event(t, "request_input", action.message, "attention")
                task = self.change(task_id, attempt, apply)
                if task["status"] != "running":
                    return
        except Aborted:
            return
        except Exception as exc:
            safe_message = str(exc) if isinstance(exc, ModelFailure) else str(exc.detail) if isinstance(exc, HTTPException) else "任务执行出现异常，进度已保留。请重试或查看本机服务日志。"
            if not isinstance(exc, (ModelFailure, HTTPException)):
                logging.getLogger(__name__).error("Agent task failed: %s (%s)", task_id, type(exc).__name__)
            with self.store.transaction() as db:
                task = get(db, "agent_runs", task_id)
                if task["attempt"] == attempt and task["status"] == "running" and not self.stop_event.is_set():
                    task.update(status="waiting_input" if isinstance(exc, HTTPException) and exc.status_code == 409 else "failed", message=safe_message)
                    self.close_running(task, "failed")
                    event(task, "failure", safe_message, "failed")
                    put(db, "agent_runs", task)
