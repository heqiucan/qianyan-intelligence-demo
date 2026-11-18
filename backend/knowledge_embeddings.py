"""Optional offline BGE retrieval for the local knowledge library.

Only the explicit setup script downloads a model. Request-time loading always
uses local safetensors, CPU and local_files_only, without remote Python code.
The caller MUST pass only currently eligible documents; this module has no DB.
Window embeddings are cached by content, never by mutable document id alone.
"""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import logging
import math
import os
from pathlib import Path
import re
import threading

MODEL_ID = "BAAI/bge-small-zh-v1.5"
MODEL_REVISION = "7999e1d3359715c523056ef9478215996d62a620"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / ".models" / "bge-small-zh-v1.5"
DIMENSIONS = 512
WINDOW_TOKENS = 448
WINDOW_OVERLAP = 64
MAX_SENTENCE_WINDOWS = 30
CACHE_SIZE = 8192
_lock = threading.RLock()
_engines = OrderedDict()
_logger = logging.getLogger(__name__)


def token_windows(tokenizer, text: str, budget: int = WINDOW_TOKENS) -> list[str]:
    """Use tokenizer character offsets, so even the tail of a 600-char chunk is encoded.

    Original chunks/locators stay intact. Windows are an internal index detail;
    encoding their original substrings avoids reconstructing text from WordPieces.
    """
    if budget <= WINDOW_OVERLAP:
        raise ValueError("Token window must be larger than its overlap")
    encoded = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True, truncation=False, verbose=False)
    offsets = encoded["offset_mapping"]
    if not offsets:
        return []
    windows = []
    start = 0
    while start < len(offsets):
        end = min(start + budget, len(offsets))
        value = text[offsets[start][0]:offsets[end - 1][1]]
        # A WordPiece at the start of a new substring may tokenize differently
        # without its original left context. Check the actual window, too.
        while end > start + 1:
            actual = tokenizer(value, add_special_tokens=False, return_offsets_mapping=True, truncation=False, verbose=False)
            excess = len(actual["offset_mapping"]) - budget
            if excess <= 0:
                break
            end = max(start + 1, end - excess)
            value = text[offsets[start][0]:offsets[end - 1][1]]
        if value.strip():
            windows.append(value)
        if end == len(offsets):
            break
        start = max(start + 1, end - WINDOW_OVERLAP)
    return windows


def document_windows(tokenizer, text: str) -> list[str]:
    """Cover the whole original chunk, plus bounded sentence windows for long chunks.

    A short fact at the end of an otherwise unrelated long block can be diluted
    even when it is not truncated. Sentence windows complement full coverage;
    they never replace the original chunk stored as evidence.
    """
    windows = token_windows(tokenizer, text)
    if len(windows) > 1:
        sentences = [sentence.strip() for sentence in re.split(r"(?<=[。！？；])|\n+", text)
                     if len(sentence.strip()) >= 20]
        extra = list(dict.fromkeys(part for sentence in sentences for part in token_windows(tokenizer, sentence)))
        if len(extra) > MAX_SENTENCE_WINDOWS:
            extra = extra[:MAX_SENTENCE_WINDOWS // 2] + extra[-MAX_SENTENCE_WINDOWS // 2:]
        windows.extend(extra)
    return list(dict.fromkeys(windows))


def _threshold() -> float:
    try:
        value = float(os.environ.get("KB_SEMANTIC_MIN_SCORE", "0.45"))
        return value if math.isfinite(value) and 0 <= value <= 1 else 0.45
    except ValueError:
        return 0.45


class LocalEncoder:
    def __init__(self, directory: Path):
        # Lazy imports keep the normal keyword-only application lightweight.
        import torch
        from sentence_transformers import SentenceTransformer

        # Bound CPU fan-out for a small single-operator app. No CUDA runtime needed.
        torch.set_num_threads(min(4, max(1, os.cpu_count() or 1)))
        self.model = SentenceTransformer(
            str(directory), device="cpu", local_files_only=True, trust_remote_code=False,
            model_kwargs={"use_safetensors": True},
        )
        self.model.max_seq_length = 512
        self.tokenizer = self.model.tokenizer
        self.cache = OrderedDict()

    def encode_cached(self, texts: list[str]):
        import numpy as np

        keys = [hashlib.sha256(text.encode("utf-8")).hexdigest() for text in texts]
        pending = dict((key, text) for key, text in zip(keys, texts) if key not in self.cache)
        # Retain requested vectors locally: one search can exceed the LRU bound.
        requested = {key: self.cache[key] for key in keys if key in self.cache}
        pending_items = list(pending.items())
        for offset in range(0, len(pending_items), 32):
            batch = pending_items[offset:offset + 32]
            vectors = self.model.encode(
                [text for _, text in batch], batch_size=16, normalize_embeddings=True,
                convert_to_numpy=True, show_progress_bar=False,
            )
            vectors = np.asarray(vectors, dtype=np.float32)
            if vectors.shape != (len(batch), DIMENSIONS) or not np.isfinite(vectors).all():
                raise ValueError("Invalid local embedding output")
            for (key, _), vector in zip(batch, vectors):
                norm = float(np.linalg.norm(vector))
                if norm <= 0:
                    raise ValueError("Zero local embedding")
                requested[key] = vector / norm
                self.cache[key] = requested[key]
                self.cache.move_to_end(key)
                while len(self.cache) > CACHE_SIZE:
                    self.cache.popitem(last=False)
        for key in keys:
            if key in self.cache:
                self.cache.move_to_end(key)
        return np.stack([requested[key] for key in keys])

    def rank(self, query: str, candidates: list[dict]) -> dict[str, float]:
        import numpy as np

        # BGE v1.5 supports instruction-free retrieval. Fixed local acceptance
        # examples favored plain natural-language queries and body-only vectors;
        # titles still participate in BM25. This is not universal calibration.
        query_texts = token_windows(self.tokenizer, query)
        if not query_texts:
            return {}
        query_vectors = self.encode_cached(query_texts)
        texts, owners = [], []
        for item in candidates:
            windows = document_windows(self.tokenizer, item["text"])
            texts.extend(windows)
            owners.extend([item["id"]] * len(windows))
        if not texts:
            return {}
        scores = {}
        # Bound the temporary score matrix as well as the model batches.
        for offset in range(0, len(texts), 256):
            vectors = self.encode_cached(texts[offset:offset + 256])
            similarities = np.max(vectors @ query_vectors.T, axis=1)
            for key, similarity in zip(owners[offset:offset + 256], similarities):
                scores[key] = max(scores.get(key, -1.0), float(similarity))
        threshold = _threshold()
        return dict(sorted(((key, round(min(1.0, score), 6)) for key, score in scores.items()
                            if score >= threshold), key=lambda pair: (-pair[1], pair[0]))[:64])


def rank_semantic(query: str, candidates: list[dict]) -> dict:
    """Rank supplied eligible chunks; failures return an explicit keyword fallback."""
    def result(status, message, scores=None):
        return {"scores": scores or {}, "status": status, "model": MODEL_ID, "message": message}

    if os.environ.get("KB_SEMANTIC_ENABLED", "1").strip().lower() in {"0", "false", "off"}:
        return result("disabled", "本地语义检索已关闭，本次使用关键词检索。")
    if not candidates or not query.strip():
        return result("empty", "当前范围没有可用于语义检索的资料。")
    directory = Path(os.environ.get("KB_EMBEDDING_MODEL_PATH") or DEFAULT_MODEL_PATH).expanduser().resolve()
    required = ("config.json", "model.safetensors", "tokenizer.json", "modules.json", "1_Pooling/config.json")
    if not all((directory / name).is_file() for name in required):
        return result("unavailable", "本地语义模型尚未安装完整，本次使用关键词检索。")
    try:
        with _lock:
            key = str(directory)
            if key not in _engines:
                # No model id is supplied to the loader, so it cannot fetch a repo.
                _engines[key] = LocalEncoder(directory)
                while len(_engines) > 2:
                    _engines.popitem(last=False)
            _engines.move_to_end(key)
            scores = _engines[key].rank(query, candidates)
        return result("ready", "本机中文语义检索已就绪；相关度仅用于排序，不代表事实可靠性。", scores)
    except (ImportError, OSError, RuntimeError, ValueError, TypeError, KeyError, AttributeError) as error:
        # Do not put local paths, document contents, environment values or full
        # dependency exception messages in an API response or operational log.
        _logger.warning("Local semantic retrieval unavailable (%s)", type(error).__name__)
        return result("unavailable", "本地语义模型加载或计算失败，本次使用关键词检索；请检查本地模型安装。")
