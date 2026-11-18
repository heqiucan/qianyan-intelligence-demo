"""Backend unit/integration tests never depend on downloaded models or network services."""
import pytest


@pytest.fixture(autouse=True)
def offline_semantic_default(monkeypatch):
    # Semantic-specific tests explicitly opt in and inject a fake encoder/ranker.
    # Real CPU/model acceptance is a separate, explicit local command.
    monkeypatch.setenv('KB_SEMANTIC_ENABLED', '0')
