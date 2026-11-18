"""Explicit, one-time download of the pinned public BGE model (no user documents).

Usage: .venv/Scripts/python.exe scripts/setup_knowledge_embeddings.py
Optional local dependencies: pip install -r backend/requirements-semantic.txt
Normal app startup and searches NEVER execute this downloader.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.knowledge_embeddings import DEFAULT_MODEL_PATH, MODEL_ID, MODEL_REVISION

FILES = (
    "1_Pooling/config.json", "README.md", "config.json", "config_sentence_transformers.json",
    "model.safetensors", "modules.json", "sentence_bert_config.json", "special_tokens_map.json",
    "tokenizer.json", "tokenizer_config.json", "vocab.txt",
)


def main():
    parser = argparse.ArgumentParser(description="下载固定版本的本地中文语义检索模型，约 96 MB 模型权重。")
    parser.add_argument("--directory", type=Path, default=DEFAULT_MODEL_PATH)
    args = parser.parse_args()
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        raise SystemExit("请先运行 .venv/Scripts/python.exe -m pip install -r backend/requirements-semantic.txt") from None
    directory = args.directory.expanduser().resolve()
    print(f"Downloading {MODEL_ID} @ {MODEL_REVISION} (MIT)", flush=True)
    snapshot_download(
        repo_id=MODEL_ID, revision=MODEL_REVISION, local_dir=str(directory),
        allow_patterns=list(FILES), token=False, max_workers=4,
    )
    hashes = {}
    for name in FILES:
        path = directory / name
        if not path.is_file() or not path.stat().st_size:
            raise SystemExit("模型文件不完整，请重新运行安装脚本。")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        hashes[name] = digest.hexdigest()
    manifest = {"model": MODEL_ID, "revision": MODEL_REVISION, "license": "MIT",
                "source": f"https://huggingface.co/{MODEL_ID}/tree/{MODEL_REVISION}", "sha256": hashes}
    temp = directory / "download-manifest.tmp"
    temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(directory / "download-manifest.json")
    print(f"Ready: {directory}\nNo user documents were uploaded. Runtime loading stays offline.", flush=True)


if __name__ == "__main__":
    main()
