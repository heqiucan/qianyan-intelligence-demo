"""Temporary public demo session; separate data, no model credentials, no system service."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "tmp" / "share-runtime"
STATE = RUNTIME / "session.json"
STOP = RUNTIME / "stop.request"
LOG = RUNTIME / "tunnel.log"


def read_state():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(state):
    pending = STATE.with_suffix(".pending")
    pending.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    pending.replace(STATE)


def serve():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    binary = RUNTIME / "cloudflared.exe"
    if not binary.is_file() or not (ROOT / "frontend/dist/website.html").is_file():
        raise RuntimeError("Share tool or built website is missing.")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    STOP.unlink(missing_ok=True)
    token = secrets.token_urlsafe(12)
    state = {"status": "starting", "port": port, "access_code": token, "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    write_state(state)
    # Do not load the user's .env or use their working database in a public session.
    environment = os.environ.copy()
    environment.update({"MODEL_PROVIDER": "replay", "MODEL_API_KEY": "", "MODEL_BASE_URL": "", "MODEL_NAME": "", "DEMO_ACCESS_TOKEN": token, "DEMO_DATA_DIR": str(RUNTIME / "demo-data"), "PYTHONIOENCODING": "utf-8"})
    children = []
    hidden = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    opener = build_opener(ProxyHandler({}))
    try:
        with (RUNTIME / "server.log").open("w", encoding="utf-8") as server_log, LOG.open("w", encoding="utf-8") as tunnel_log:
            server = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT, env=environment, stdout=server_log, stderr=subprocess.STDOUT, **hidden)
            children.append(server)
            deadline = time.monotonic() + 25
            while True:
                if server.poll() is not None:
                    raise RuntimeError("Share server failed; inspect server.log.")
                try:
                    with opener.open(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                        if json.load(response).get("service") == "zheyan-demo":
                            break
                except (OSError, ValueError):
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError("Share server startup timed out.")
                time.sleep(.3)
            state.update({"status": "connecting", "server_pid": server.pid})
            write_state(state)
            tunnel = subprocess.Popen([str(binary), "tunnel", "--url", f"http://127.0.0.1:{port}", "--protocol", "http2", "--no-autoupdate"], cwd=RUNTIME, stdout=tunnel_log, stderr=subprocess.STDOUT, **hidden)
            children.append(tunnel)
            state["tunnel_pid"] = tunnel.pid
            write_state(state)
            while not STOP.exists():
                if server.poll() is not None or tunnel.poll() is not None:
                    raise RuntimeError("Share process exited; inspect local share logs.")
                log_text = LOG.read_text(encoding="utf-8", errors="replace")
                match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", log_text)
                if match and not state.get("website_url"):
                    state.update({"website_url": match.group(0) + "/website.html", "workspace_url": match.group(0) + "/index.html"})
                    write_state(state)
                if match and "Registered tunnel connection" in log_text and state["status"] != "running":
                    state["status"] = "running"
                    write_state(state)
                time.sleep(1)
            state["status"] = "stopped"
    except Exception as error:
        state.update({"status": "failed", "error": str(error)})
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        state["stopped_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_state(state)


def main():
    parser = argparse.ArgumentParser(description="Qianyan temporary share controls")
    parser.add_argument("action", choices=["serve", "status", "stop"])
    args = parser.parse_args()
    if args.action == "serve":
        serve()
        return
    state = read_state()
    if args.action == "stop" and state.get("status") not in {None, "stopped", "failed"}:
        STOP.write_text("stop", encoding="utf-8")
        for _ in range(40):
            if read_state().get("status") in {"stopped", "failed"}:
                break
            time.sleep(.25)
        state = read_state()
    print(json.dumps(state, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
