"""Offline unit checks. Real BGE quality is validated by separate acceptance data."""
from collections import OrderedDict
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from backend import knowledge_embeddings as embeddings


class CharacterTokenizer:
    def __call__(self, text, **kwargs):
        assert kwargs == {"add_special_tokens": False, "return_offsets_mapping": True, "truncation": False, "verbose": False}
        return {"offset_mapping": [(i, i + 1) for i in range(len(text))]}


@pytest.fixture
def encoder(monkeypatch):
    np = pytest.importorskip("numpy")

    class FakeModel:
        def __init__(self):
            self.texts = []

        def encode(self, texts, **kwargs):
            assert kwargs["normalize_embeddings"] is True
            assert kwargs["show_progress_bar"] is False
            self.texts.extend(texts)
            vectors = np.zeros((len(texts), embeddings.DIMENSIONS), dtype=np.float32)
            for index, text in enumerate(texts):
                assert len(text) + 2 <= 512
                vectors[index, 0 if "尾部锚点" in text else 1] = 1
            return vectors

    monkeypatch.delenv("KB_SEMANTIC_MIN_SCORE", raising=False)
    instance = object.__new__(embeddings.LocalEncoder)
    instance.model = FakeModel()
    instance.tokenizer = CharacterTokenizer()
    instance.cache = OrderedDict()
    return instance


def test_token_windows_preserve_every_character_and_tail():
    text = "甲" * 720 + "末尾特有词"
    windows = embeddings.token_windows(CharacterTokenizer(), text)
    assert len(windows) == 2
    assert all(len(window) <= embeddings.WINDOW_TOKENS for window in windows)
    assert windows[-1].endswith("末尾特有词")
    assert windows[0] + windows[1][embeddings.WINDOW_OVERLAP:] == text
    assert embeddings.token_windows(CharacterTokenizer(), "") == []
    with pytest.raises(ValueError):
        embeddings.token_windows(CharacterTokenizer(), "x", budget=64)


def test_long_chunk_tail_matches_without_changing_citation(encoder):
    candidates = [
        {"id": "doc-v1-c1", "title": "资料", "text": "甲" * 580 + "尾部锚点"},
        {"id": "other", "title": "无关资料", "text": "乙乙乙"},
    ]
    assert encoder.rank("尾部锚点", candidates) == {"doc-v1-c1": 1.0}
    assert len(candidates[0]["text"]) == 584
    count = len(encoder.model.texts)
    assert encoder.rank("尾部锚点", candidates) == {"doc-v1-c1": 1.0}
    assert len(encoder.model.texts) == count


def test_content_cache_is_not_keyed_only_by_document_id(encoder):
    assert encoder.rank("尾部锚点", [{"id": "same", "text": "尾部锚点"}])
    assert encoder.rank("尾部锚点", [{"id": "same", "text": "资料已改成不相关信息"}]) == {}


def test_lru_bounded_even_when_one_request_exceeds_cache(encoder, monkeypatch):
    monkeypatch.setattr(embeddings, "CACHE_SIZE", 2)
    vectors = encoder.encode_cached(["甲", "乙", "丙", "甲"])
    assert vectors.shape == (4, embeddings.DIMENSIONS)
    assert len(encoder.cache) == 2


@pytest.mark.parametrize("value,expected", [("0.7", 0.7), ("nan", 0.45), ("inf", 0.45), ("abc", 0.45), ("-1", 0.45), ("2", 0.45)])
def test_threshold_configuration_rejects_invalid_values(monkeypatch, value, expected):
    monkeypatch.setenv("KB_SEMANTIC_MIN_SCORE", value)
    assert embeddings._threshold() == expected


def test_threshold_and_top_k_are_applied(encoder, monkeypatch):
    candidates = [{"id": str(i).zfill(3), "text": "尾部锚点"} for i in range(80)]
    result = encoder.rank("尾部锚点", candidates)
    assert len(result) == 64
    assert list(result) == [str(i).zfill(3) for i in range(64)]
    monkeypatch.setenv("KB_SEMANTIC_MIN_SCORE", "1")
    assert len(encoder.rank("尾部锚点", candidates)) == 64


def test_long_document_sentence_windows_are_bounded_and_preserve_tail():
    text = "".join(f"编号{i:03d}的虚构说明只是测试占位资料，原始句子必须可以定位。" for i in range(80))
    tokenizer = CharacterTokenizer()
    coverage = embeddings.token_windows(tokenizer, text)
    windows = embeddings.document_windows(tokenizer, text)
    assert all(window in windows for window in coverage)
    assert len(windows) <= len(coverage) + embeddings.MAX_SENTENCE_WINDOWS
    assert any(window.startswith("编号079") for window in windows)
    short = "本条简短资料不会额外拆句，保留完整原文作为语义输入。"
    assert embeddings.document_windows(tokenizer, short) == [short]


def test_disabled_empty_and_missing_model_never_construct_encoder(monkeypatch, tmp_path):
    monkeypatch.setattr(embeddings, "LocalEncoder", lambda *_: pytest.fail("Must not load a model"))
    monkeypatch.setenv("KB_EMBEDDING_MODEL_PATH", str(tmp_path / "missing"))
    monkeypatch.setenv("KB_SEMANTIC_ENABLED", "0")
    candidates = [{"id": "source", "text": "文本"}]
    assert embeddings.rank_semantic("查询", candidates)["status"] == "disabled"
    monkeypatch.setenv("KB_SEMANTIC_ENABLED", "1")
    assert embeddings.rank_semantic("查询", [])["status"] == "empty"
    result = embeddings.rank_semantic("查询", candidates)
    assert result["status"] == "unavailable" and not result["scores"]


def test_local_model_constructor_never_enables_network_or_remote_code(monkeypatch, tmp_path):
    calls = {}

    def construct(path, **kwargs):
        calls.update(path=path, **kwargs)
        return SimpleNamespace(tokenizer=CharacterTokenizer())

    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=construct))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(set_num_threads=lambda _: None))
    embeddings.LocalEncoder(tmp_path)
    assert calls == {"path": str(tmp_path), "device": "cpu", "local_files_only": True,
                     "trust_remote_code": False, "model_kwargs": {"use_safetensors": True}}


def test_load_failure_is_explicit_fallback_without_sensitive_error(monkeypatch, tmp_path):
    for name in ("config.json", "model.safetensors", "tokenizer.json", "modules.json", "1_Pooling/config.json"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("KB_EMBEDDING_MODEL_PATH", str(tmp_path))
    monkeypatch.setenv("KB_SEMANTIC_ENABLED", "1")

    def fail(_):
        raise OSError("sensitive file path or user text")

    monkeypatch.setattr(embeddings, "LocalEncoder", fail)
    result = embeddings.rank_semantic("查询", [{"id": "source", "text": "文本"}])
    assert result["status"] == "unavailable" and not result["scores"]
    assert "sensitive" not in str(result)
