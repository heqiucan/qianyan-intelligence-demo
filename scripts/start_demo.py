"""Start the built demo without downloading anything or changing existing data."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
import webbrowser
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[1]
ENV_KEYS = {"MODEL_PROVIDER", "MODEL_BASE_URL", "MODEL_NAME", "MODEL_API_KEY", "DEMO_ACCESS_TOKEN", "DEMO_DATA_DIR",
            "KB_SEMANTIC_ENABLED", "KB_EMBEDDING_MODEL_PATH", "KB_SEMANTIC_MIN_SCORE", "DEMO_ALLOWED_HOSTS", "DEMO_SHARE_MODE"}


def demo_ready(url):
    """Identify this app, and wait for its built page as well as its API."""
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(url + "/api/health", timeout=1) as response:
            health = json.load(response)
        if health.get("service") != "zheyan-demo" or health.get("status") != "ok":
            return False
        with opener.open(url + "/", timeout=1) as response:
            return response.status == 200 and b'id="root"' in response.read(65536)
    except (OSError, ValueError, AttributeError):
        return False


def open_demo(url):
    print(f"正在打开浏览器：{url}", flush=True)
    try:
        if webbrowser.open(url):
            return
    except webbrowser.Error:
        pass
    print(f"未能自动打开浏览器，请手动访问：{url}", flush=True)


def load_environment():
    """Accept simple KEY=value lines; do not evaluate shell expressions."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key.strip() not in ENV_KEYS:
            print(f"提示：.env 第 {number} 行不是支持的配置，已忽略。")
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def main():
    parser = argparse.ArgumentParser(description="启动浙衍 AI 本地业务 Demo（不自动下载依赖）")
    parser.add_argument("--host", default="127.0.0.1", help="本机默认 127.0.0.1；局域网演示可用 0.0.0.0")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--build", action="store_true", help="使用已安装的 npm 依赖重新构建前端")
    parser.add_argument("--check", action="store_true", help="只检查运行准备情况，不启动服务")
    parser.add_argument("--open-browser", action="store_true", help="服务就绪后自动打开浏览器；已运行时直接打开")
    parser.add_argument("--page", choices=("workspace", "website"), default="workspace", help="打开工作台或 Qianyan Intelligence 官网")
    parser.add_argument('--fresh-demo', action='store_true', help='新建独立回放演示库，不使用日常资料或模型密钥')
    args = parser.parse_args()
    os.chdir(ROOT)
    candidate = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if candidate.exists() and Path(sys.executable).resolve() != candidate.resolve():
        return subprocess.call([str(candidate), str(Path(__file__).resolve()), *sys.argv[1:]])
    load_environment()
    if args.fresh_demo:
        from uuid import uuid4
        directory = ROOT / 'tmp' / 'fresh-demo' / (datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid4().hex[:6])
        os.environ.update(DEMO_DATA_DIR=str(directory), MODEL_PROVIDER='replay', MODEL_API_KEY='', KB_SEMANTIC_ENABLED='0')
    if args.host not in {'127.0.0.1', 'localhost', '::1'}:
        if not os.getenv('DEMO_ACCESS_TOKEN') or not os.getenv('DEMO_ALLOWED_HOSTS'):
            print('局域网监听前请设置 DEMO_ACCESS_TOKEN 和 DEMO_ALLOWED_HOSTS（实际访问的 IP 或域名，用逗号分隔，不能用 *）。')
            return 1
    missing = [name for name in ("fastapi", "uvicorn", "httpx", "python_multipart", "jieba", "pypdf", "openpyxl", "defusedxml") if importlib.util.find_spec(name) is None]
    if missing:
        print("后端依赖未准备好：" + ", ".join(missing))
        print('请运行：python -m venv .venv')
        print(r'Windows：.venv\Scripts\python.exe -m pip install -r backend/requirements.txt')
        print('macOS/Linux：.venv/bin/python -m pip install -r backend/requirements.txt')
        return 1
    if args.build:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm or not (ROOT / "frontend/node_modules").is_dir():
            print("前端依赖未准备好。请安装 Node.js 24，然后在 frontend 目录运行 npm ci。")
            return 1
        if subprocess.call([npm, "run", "build"], cwd=ROOT / "frontend"):
            return 1
    if not (ROOT / "frontend/dist/index.html").is_file():
        print("前端尚未构建。请在 frontend 目录运行 npm ci，然后运行 npm run build。")
        return 1
    if args.page == "website" and not (ROOT / "frontend/dist/website.html").is_file():
        print("官网尚未构建，请在 frontend 目录运行 npm run build，或附加 --build。")
        return 1
    if not 1 <= args.port <= 65535:
        print("端口必须在 1 到 65535 之间。")
        return 1
    data = Path(os.environ.get("DEMO_DATA_DIR") or ROOT / "data").resolve()
    os.environ["DEMO_DATA_DIR"] = str(data)
    print("运行检查通过：前端构建与后端依赖已就绪。", flush=True)
    print(f"数据目录：{data}", flush=True)
    if os.getenv("MODEL_PROVIDER", "replay") == "replay":
        print("AI 使用演示回放；投放与支付均为模拟。", flush=True)
    else:
        print("AI 已选择智谱免费模型接口模式；首次调用才会验证配置，投放与支付均为模拟。", flush=True)
    if args.check:
        return 0
    url_host = "127.0.0.1" if args.host == "0.0.0.0" else args.host
    if ":" in url_host:
        url_host = f"[{url_host}]"
    url = f"http://{url_host}:{args.port}"
    open_url = url + "/website.html" if args.page == "website" else url
    if demo_ready(url):
        print(f"Demo 已经运行，继续使用：{url}", flush=True)
        print("如果刚修改模型配置，请先关闭原启动窗口停止服务，再重新启动；本次不会替换运行中的配置。", flush=True)
        if args.open_browser:
            open_demo(open_url)
        return 0
    try:
        with socket.socket(socket.AF_INET6 if ":" in args.host else socket.AF_INET) as probe:
            if os.name == "nt":
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            probe.bind((args.host, args.port))
    except OSError:
        print(f"端口 {args.port} 无法使用，且未检测到可用的 Demo。请检查已有服务，或增加参数 --port 8001。")
        return 1
    print(f"正在启动 Demo：{url}", flush=True)
    if args.host == "0.0.0.0":
        print("已选择局域网监听；同网设备需使用本机局域网 IP，并允许相应防火墙端口。", flush=True)
    print("保持本窗口打开；按 Ctrl+C 停止服务。", flush=True)
    server = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", args.host, "--port", str(args.port)], cwd=ROOT)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if server.poll() is not None:
                print("Demo 启动失败，请查看本窗口上方的错误信息。", flush=True)
                return server.returncode or 1
            if demo_ready(url):
                print(f"Demo 已就绪：{url}", flush=True)
                if args.open_browser:
                    open_demo(open_url)
                return server.wait()
            time.sleep(0.25)
        print("启动等待超时，请查看本窗口上方的错误信息。", flush=True)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
