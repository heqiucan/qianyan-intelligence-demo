"""Bounded free-model acceptance using isolated fictional examples, never user data."""
from pathlib import Path
import json
import os
import sys
import tempfile
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.start_demo import load_environment
from backend.model_adapter import ModelAdapter
from backend.main import create_app
from fastapi.testclient import TestClient


def main():
    load_environment()
    adapter = ModelAdapter()
    if adapter.mode == "replay" or adapter.configuration_error():
        print("未配置可用的智谱免费模式，未调用外部服务。", flush=True)
        return 1
    os.environ["DEMO_ACCESS_TOKEN"] = ""
    out = ROOT / "tmp/agent-acceptance"
    out.mkdir(parents=True, exist_ok=True)
    report = {"model": adapter.info["model_name"], "data": "isolated fictional examples", "tasks": [], "passed": False}
    with tempfile.TemporaryDirectory(prefix="live-", dir=out) as directory:
        with TestClient(create_app(directory)) as client:
            for scene, goal in [
                ("medical", "根据机构资料，整理咨询预约的内部 FAQ，说明预约流程、接待时间，以及预约和专业评估的区别。缺少的信息列为待核实。"),
                ("live", "为青禾保温杯写一份约一分钟的直播口语讲解脚本，分开场、规格展示、收尾三段。只使用有依据的规格，不写未经核实的价格和优惠。"),
            ]:
                started = time.monotonic()
                response = client.post("/api/agent/tasks", json={"request_id": uuid4().hex, "scene": scene, "goal": goal})
                response.raise_for_status()
                task_id = response.json()["id"]
                print(json.dumps({"scene": scene, "id": task_id, "status": "started"}, ensure_ascii=False), flush=True)
                previous = ""
                acceptance_resumes = 0
                while time.monotonic() - started < 280:
                    task = client.get("/api/agent/tasks/" + task_id).json()
                    event = task["events"][-1] if task["events"] else {}
                    if event.get("id") != previous:
                        previous = event.get("id")
                        print(json.dumps({"scene": scene, "step": event.get("action"), "status": task["status"], "calls": task["model_calls"]}, ensure_ascii=False), flush=True)
                    if task["status"] not in {"queued", "running"}:
                        # Exercise the explicit continuation endpoint once after a
                        # transient response/format failure. This is acceptance
                        # code, not an automatic retry policy in the product.
                        if task["status"] == "failed" and acceptance_resumes == 0 and any(word in task["message"] for word in ("JSON", "知识草稿或引用无效", "连接失败", "响应超时")):
                            acceptance_resumes += 1
                            print(json.dumps({"scene": scene, "acceptance_action": "explicit_continue_after_failure", "reason": task["message"]}, ensure_ascii=False), flush=True)
                            continued = client.post(f"/api/agent/tasks/{task_id}/continue", json={"request_id": uuid4().hex, "expected_attempt": task["attempt"]})
                            continued.raise_for_status()
                            continue
                        break
                    time.sleep(.5)
                if task["status"] in {"queued", "running"}:
                    client.post(f"/api/agent/tasks/{task_id}/cancel", json={"expected_attempt": task["attempt"]})
                    task = client.get("/api/agent/tasks/" + task_id).json()
                task["elapsed_seconds"] = round(time.monotonic() - started, 2)
                task["acceptance_resumes"] = acceptance_resumes
                report["tasks"].append(task)
                print(json.dumps({"scene": scene, "status": task["status"], "seconds": task["elapsed_seconds"], "calls": task["model_calls"], "message": task["message"]}, ensure_ascii=False), flush=True)
            report["passed"] = len(report["tasks"]) == 2 and all(t["status"] == "waiting_review" and t["draft"]["source"] == "model" and t["draft"]["sources"] for t in report["tasks"])
    (out / "live-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
