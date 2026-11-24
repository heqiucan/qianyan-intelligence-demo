"""Configure the official DeepSeek endpoint without exposing credentials."""
from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.configure_zhipu import write_settings
from scripts.start_demo import load_environment

KEYS = ('MODEL_PROVIDER', 'MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY')


def main():
    parser = argparse.ArgumentParser(description='配置 DeepSeek 官方 Flash 模型；密钥不输出')
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--key-file', type=Path, help='读取用户指定的纯密钥文件，文件内容不输出')
    action.add_argument('--check', action='store_true', help='实际发送一次简短连接测试，可能产生账户费用')
    args = parser.parse_args()
    if args.check:
        from backend.model_adapter import ModelAdapter, ModelFailure
        for name in KEYS:
            os.environ.pop(name, None)
        load_environment()
        adapter = ModelAdapter()
        if adapter.mode != 'deepseek' or adapter.configuration_error():
            print('DeepSeek 配置未就绪，未发送请求。')
            return 1
        print('测试官方 deepseek-flash；仅发送简短 JSON 连接验证，不发送业务数据。', flush=True)
        try:
            adapter.check_connection()
        except ModelFailure as error:
            print('连接未通过：' + str(error))
            return 1
        print('DeepSeek 连接成功，已返回有效 JSON；本次未验证完整业务生成效果。')
        return 0
    ignored = subprocess.run(['git', 'check-ignore', '-q', '.env'], cwd=ROOT, capture_output=True)
    if ignored.returncode != 0:
        print('.env 未被 Git 忽略，停止写入。')
        return 1
    if args.key_file:
        secret = args.key_file.read_text(encoding='utf-8-sig').strip()
    elif sys.stdin.isatty():
        secret = getpass.getpass('DeepSeek API Key（输入隐藏）：').strip()
    else:
        print('请指定 --key-file，或在交互终端输入密钥。')
        return 2
    if not re.fullmatch(r'[A-Za-z0-9._\-]{16,512}', secret):
        print('文件需要仅包含一个有效格式的 API Key；未保存，内容未显示。')
        return 1
    write_settings(ROOT / '.env', {
        'MODEL_PROVIDER': 'deepseek', 'MODEL_BASE_URL': 'https://api.deepseek.com',
        'MODEL_NAME': 'deepseek-flash', 'MODEL_API_KEY': secret,
    })
    print('已写入本机 .env：DeepSeek / deepseek-flash。密钥未显示，未调用模型。')
    print('此别名当前对应 V4.1-Flash-1017；服务商未来可能升级，按账户规则计费。')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        raise SystemExit(main())
    except (OSError, UnicodeError):
        print('无法读取密钥文件或保存配置；未输出文件内容。')
        raise SystemExit(1)
