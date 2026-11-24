"""Local, hidden key entry. No key in command arguments, output, or browser."""
from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.model_adapter import FREE_MODEL, FREE_MODELS, ZHIPU_BASE, ModelAdapter, ModelFailure
from scripts.start_demo import load_environment

MODEL_KEYS = ("MODEL_PROVIDER", "MODEL_BASE_URL", "MODEL_NAME", "MODEL_API_KEY")


def write_settings(path: Path, settings: dict):
    """Preserve unrelated configuration and comments; replace duplicate keys."""
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    kept = [line for line in lines if line.partition("=")[0].strip() not in settings]
    text = "\n".join(kept + [f"{key}={value}" for key, value in settings.items()]) + "\n"
    # No temporary/backup copies of the credential. Only .env contains the key.
    path.write_text(text, encoding="utf-8")


def verify():
    for key in MODEL_KEYS:
        os.environ.pop(key, None)
    load_environment()
    adapter = ModelAdapter()
    if adapter.mode == "replay":
        print("当前为演示回放。请先运行 configure-zhipu.cmd 填写 API Key。")
        return 1
    print(f"正在测试已配置型号 {adapter.info['model_name']}，只发送连接测试，不上传商品或订单；按提供者账户规则计费。")
    try:
        adapter.check_connection()
    except ModelFailure as exc:
        print(f"连接未通过：{exc}")
        return 1
    print(f"连接成功：{adapter.info['model_name']} 已返回正确 JSON。")
    print("此检查读取本机 .env。请重启 Demo，让运行中的服务载入配置。")
    return 0


def main():
    parser = argparse.ArgumentParser(description="智谱免费模型本机配置")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="显式调用免费模型检测连接")
    group.add_argument("--replay", action="store_true", help="切回离线演示回放，保留密钥")
    parser.add_argument("--model", choices=sorted(FREE_MODELS), default=FREE_MODEL, help="手动选择已核实的免费型号；没有自动回退")
    args = parser.parse_args()
    if args.check:
        return verify()
    if args.replay:
        write_settings(ROOT / ".env", {"MODEL_PROVIDER": "replay"})
        print("已设置为演示回放。重启 Demo 后生效；已有活动、素材、计划和订单保留。")
        return 0
    print(f"智谱免费模型配置：{FREE_MODELS[args.model]}（不是收费的 FlashX）")
    print("1. 注册 https://bigmodel.cn ，创建标准 API Key，无需购买 Coding Plan。")
    print("2. API Key 页面：https://bigmodel.cn/usercenter/proj-mgmt/apikeys")
    print("3. 官方免费定价：https://docs.bigmodel.cn/cn/guide/start/pricing")
    print("密钥仅写入本机 .env，不会显示或发送到聊天；本步骤不调用模型。")
    if not sys.stdin.isatty():
        print("请双击 configure-zhipu.cmd，在本机交互窗口中输入密钥。")
        return 2
    try:
        key = getpass.getpass("粘贴 API Key（输入不显示，回车保存；直接回车取消）：").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n已取消，没有修改配置。")
        return 0
    if not key:
        print("已取消，没有修改配置。")
        return 0
    if not re.fullmatch(r"[A-Za-z0-9._\-]{16,512}", key):
        print("密钥格式不正确。请仅复制 API Key，不要包含引号、空格或说明文字。未保存。")
        return 1
    write_settings(ROOT / ".env", {"MODEL_PROVIDER": "zhipu-free", "MODEL_BASE_URL": ZHIPU_BASE, "MODEL_NAME": args.model, "MODEL_API_KEY": key})
    print("已保存免费模型配置。下一步运行 check-zhipu.cmd 检测连接，再重启 Demo。")
    print("配置成功不代表已连接成功。原有业务数据和网页布局均保留。")
    if any(os.getenv(key) for key in MODEL_KEYS):
        print("检测到当前进程有 MODEL_* 环境变量。启动时环境变量优先，请清除旧值以使用 .env。")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except OSError:
        print("无法读写本机配置文件，请检查项目目录权限。密钥未显示。")
        raise SystemExit(1)
