"""Explicit live acceptance using a temporary database and fictional fixtures.

Reads the server key without printing it. Four sequential free-model requests;
the user's live business database is never opened by this script.
"""
from pathlib import Path
import json
import os
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.start_demo import load_environment
from backend.model_adapter import ModelAdapter
from fastapi.testclient import TestClient
from backend.main import create_app


def main():
    load_environment()
    adapter = ModelAdapter()
    if adapter.mode == "replay" or adapter.configuration_error():
        print("需要先完成本机免费模型配置。未发起网络请求。")
        return 1
    os.environ["DEMO_ACCESS_TOKEN"] = ""
    out = ROOT / "tmp/zhipu-verification"
    out.mkdir(exist_ok=True)
    directory = tempfile.mkdtemp(prefix="live-", dir=out)
    result = {"model": adapter.info["model_name"], "real_provider": True, "data": "isolated fictional fixtures", "checks": []}
    with TestClient(create_app(directory)) as client:
        def post(path, body):
            started = time.monotonic()
            response = client.post("/api" + path, json=body)
            if response.status_code != 200:
                result["failure"] = {"path": path, "status": response.status_code, "detail": response.json().get("detail")}
                raise RuntimeError(f"{path}: {response.status_code}, {response.json().get('detail')}")
            data = response.json()
            result["checks"].append({"path": path, "seconds": round(time.monotonic() - started, 2), "status": 200})
            print(f"通过：{path}（{result['checks'][-1]['seconds']} 秒）", flush=True)
            return data
        try:
            body = {"tone": "自然", "angle": "场景", "request_id": "live-create"}
            creatives = post("/campaigns/campaign-demo/generate", body)
            assert len(creatives) == 2 and all(c["source"] == "model" and c["status"] == "draft" for c in creatives)
            assert client.post("/api/campaigns/campaign-demo/generate", json=body).json() == creatives
            revised = post(f"/creatives/{creatives[0]['id']}/regenerate", {"tone": "简洁", "angle": "规格", "request_id": "live-regenerate"})
            assert revised["parent_id"] == creatives[0]["id"] and revised["version"] == 2
            insight = post("/insights", {"dataset": "history", "campaign_id": "campaign-demo", "request_id": "live-insight"})
            assert insight["source"] == "model" and "15" in "".join(insight["facts"])
            optimized = post(f"/insights/{insight['id']}/accept", {"creative_id": revised["id"], "request_id": "live-optimize"})
            assert optimized["status"] == "draft" and optimized["source"] == "model" and optimized["version"] == 3
            current = client.get("/api/state").json()
            assert current["model"]["live_verified"] and len(current["plans"]) == 2 and len(current["orders"]) == 0
            report = client.post(f"/api/creatives/{optimized['id']}/check", json={k: optimized[k] for k in ("title", "body", "cta", "script")}).json()
            result.update(passed=True, creatives=creatives, regenerated=revised, insight=insight, optimized=optimized,
                          claim_check={k: report.get(k) for k in ("can_approve", "summary", "scope_note")}, model_info=current["model"])
            print("真实免费模型业务链路通过；没有修改用户现有数据，没有自动确认或投放。", flush=True)
        except Exception as exc:
            result["passed"] = False
            if isinstance(exc, RuntimeError):
                print(str(exc), flush=True)
            else:
                print(f"业务校验未通过：{type(exc).__name__}", flush=True)
        finally:
            (out / "live-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
