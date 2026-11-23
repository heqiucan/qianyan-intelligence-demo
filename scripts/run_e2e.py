"""Start one temporary replay server and run the demand browser acceptance.

No .env is loaded and no existing server is reused. The daily data directory
and port 8001 are never used. Browser reports stay under tmp for inspection.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    if port == 8001:
        return free_port()
    return port


def ready(base):
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(base + '/api/health', timeout=1) as response:
            health = json.load(response)
        with opener.open(base + '/api/state', timeout=1) as response:
            state = json.load(response)
        with opener.open(base + '/', timeout=1) as response:
            built_page = b'id="root"' in response.read(65536)
        return (health.get('service') == 'zheyan-demo' and health.get('status') == 'ok'
                and state.get('model', {}).get('mode') == 'replay' and built_page)
    except (OSError, ValueError):
        return False


def main():
    parser = argparse.ArgumentParser(description='在临时数据库和随机本机端口运行 replay 浏览器验收')
    parser.add_argument('--extensions', action='store_true', help='额外运行定时、图层、音频、素材与草稿验收（需要本机FFmpeg和中文系统音色）')
    parser.add_argument('--speech', action='store_true', help='额外运行 Windows 系统音色真实合成与浏览器播放验收')
    parser.add_argument('--scripts', nargs='+', help='仅运行指定的 scripts/browser_*.cjs 验收文件')
    parser.add_argument('--timeout', type=int, default=300, help='浏览器验收超时秒数（默认 300）')
    args = parser.parse_args()
    if args.timeout < 1:
        parser.error('--timeout 必须为正数')
    node = shutil.which('node')
    if not node:
        raise SystemExit('未找到 Node.js，请先安装 Node.js 24。')
    frontend = Path(os.environ.get('DEMO_FRONTEND_DIR', ROOT / 'frontend/dist'))
    if not (frontend / 'index.html').is_file():
        raise SystemExit('请先在 frontend 运行 npm ci 和 npm run build。')
    output = ROOT / 'tmp/demand-acceptance'
    output.mkdir(parents=True, exist_ok=True)
    log_path = output / 'isolated-server.log'
    base = f'http://127.0.0.1:{free_port()}'
    hidden = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    with tempfile.TemporaryDirectory(prefix='isolated-demand-', dir=ROOT / 'tmp') as temporary:
        environment = os.environ.copy()
        environment.update(DEMO_DATA_DIR=str(Path(temporary) / 'data'), MODEL_PROVIDER='replay',
            MODEL_BASE_URL='', MODEL_NAME='', MODEL_API_KEY='', DEMO_ACCESS_TOKEN='',
            DEMO_TEST_BASE=base, PYTHONIOENCODING='utf-8', KB_SEMANTIC_ENABLED='0',
            KB_EMBEDDING_MODEL_PATH='', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
            WEB_CONCURRENCY='1')
        environment.setdefault('PLAYWRIGHT_CHANNEL', 'msedge' if os.name == 'nt' else 'chromium')
        with log_path.open('w', encoding='utf-8') as log:
            server = subprocess.Popen([sys.executable, str(ROOT / 'scripts/isolated_test_server.py'),
                base.rsplit(':', 1)[1]], stdin=subprocess.PIPE,
                cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT, **hidden)
            try:
                deadline = time.monotonic() + 30
                while server.poll() is None and time.monotonic() < deadline:
                    if ready(base):
                        break
                    time.sleep(.2)
                if server.poll() is not None or not ready(base):
                    print(f'隔离服务未就绪；查看日志：{log_path}', file=sys.stderr)
                    return 1
                print(f'隔离 replay 验收：{base}；使用临时数据库，结束后清理。', flush=True)
                try:
                    selected = args.scripts or (('browser_live_speech.cjs', 'browser_live_interaction.cjs') if args.speech else ()) + ('browser_live_workspace.cjs', 'browser_live_preview.cjs', 'browser_navigation.cjs', 'browser_demand_workflow.cjs', 'browser_demand_regressions.cjs', 'browser_product_evidence.cjs', 'browser_campaign_product.cjs') + (('browser_live_timer.cjs','browser_video_layers.cjs','browser_audio_mixer.cjs','browser_live_media.cjs','browser_script_drafts.cjs') if args.extensions else ())
                    for script in selected:
                        if Path(script).name != script or not script.startswith('browser_') or not script.endswith('.cjs'):
                            raise ValueError('验收文件必须是 scripts 目录中的 browser_*.cjs')
                        result = subprocess.run([node, str(ROOT / 'scripts' / script)],
                            cwd=ROOT, env=environment, timeout=args.timeout, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding='utf-8', **hidden)
                        if result.stdout:
                            print(result.stdout, end='', flush=True)
                        if result.returncode:
                            return result.returncode
                    return 0
                except subprocess.TimeoutExpired:
                    print(f'浏览器验收超过 {args.timeout} 秒；查看 tmp/demand-acceptance。', file=sys.stderr)
                    return 1
            finally:
                if server.poll() is None:
                    try:
                        server.stdin.write(b'stop\n')
                        server.stdin.close()
                        server.wait(timeout=10)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                if server.poll() is None:
                    if os.name == 'nt':
                        # Windows venv launchers can spawn a child Python. Stop
                        # only the process tree we created before deleting its DB.
                        subprocess.run(['taskkill', '/PID', str(server.pid), '/T', '/F'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **hidden)
                    else:
                        server.terminate()
                    try:
                        server.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=5)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
