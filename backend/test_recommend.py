"""Recommendation agent checks. Isolated temp database, no network, no model."""
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.recommend import library, match_term, normalize, risk_flags, unsafe


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        yield c


def ask(client, query, **extra):
    r = client.post("/api/recommend", json={"query": query, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_library_has_all_cleaned_terms():
    assert len(library()) == 795


def test_matcher_levels():
    assert match_term("双眼皮多少钱")[1] == "library-exact"
    assert match_term(" 双眼皮 多少钱？ ")[0]["service"] == "双眼皮"
    info, source = match_term("今天去哪里做重睑好")
    assert info["service"] == "双眼皮" and source != "library-exact"
    assert match_term("今天天气")[0]["service"] is None


def test_flags():
    assert "sensitive" in risk_flags("私密紧致")
    assert "brand" in risk_flags("艺星双眼皮")
    assert "price" in risk_flags("400元一针的除皱针")
    assert "city:广州" in risk_flags("广州隆鼻")


def test_guardrails():
    assert unsafe("只要980元")
    assert unsafe("效果永久保证")
    assert unsafe("比艺星好")
    assert not unsafe("需先面诊评估")


def test_auto_recommendation_is_cited_and_safe(client):
    r = ask(client, "双眼皮多少钱")
    assert r["handling"] == "auto"
    assert r["recommendation"]["ad_label"] == "广告"
    assert r["recommendation"]["benefits"]
    assert all(1 <= b["citation"] <= len(r["citations"]) for b in r["recommendation"]["benefits"])
    assert not unsafe(r["answer"])
    assert "面诊" in r["answer"]
    assert any("价格" in g for g in r["gaps"])


def test_sensitive_goes_to_human(client):
    r = ask(client, "私密紧致手术")
    assert r["handling"] == "handoff" and r["recommendation"] is None and r["citations"] == []


def test_competitor_is_not_echoed(client):
    r = ask(client, "艺星双眼皮怎么样")
    assert r["handling"] == "review"
    assert "艺星" not in r["answer"]
    assert r["recommendation"] is not None
    assert r["matched"]["intent"] == "找机构/口碑"


def test_service_without_facts_is_a_visible_gap(client):
    r = ask(client, "脱毛多少钱")
    assert r["handling"] == "review" and r["recommendation"] is None
    assert any("脱毛" in g for g in r["gaps"])


def test_unknown_query(client):
    r = ask(client, "今天天气怎么样")
    assert r["handling"] == "review" and r["matched"]["service"] is None and r["recommendation"] is None


def test_archived_facts_are_not_used(client):
    ask(client, "隆鼻")
    docs = client.get("/api/knowledge/documents", params={"space_id": "rec-demo-medical"}).json()
    d = docs[0]
    r = client.post(f"/api/knowledge/documents/{d['id']}/review", json={"status": "archived", "expected_version": d["version"]})
    assert r.status_code == 200, r.text
    assert ask(client, "隆鼻多少钱")["recommendation"] is None


def test_log_stats_click_and_idempotency(client):
    a = ask(client, "双眼皮多少钱", request_id="same")
    b = ask(client, "双眼皮多少钱", request_id="same")
    assert a["search_id"] == b["search_id"]
    ask(client, "私密紧致手术")
    assert client.post(f"/api/recommend/{a['search_id']}/click").json() == {"ok": True}
    s = client.get("/api/recommend/stats").json()
    assert s["kpi"]["searches"] == 2 and s["kpi"]["recommended"] == 1 and s["kpi"]["handoff"] == 1
    assert s["kpi"]["clicks"] == 1 and s["kpi"]["click_rate"] == 1
    assert s["library"]["total"] == 795 and s["library"]["handling"]["auto"] == 723
    assert [f["value"] for f in s["funnel"]] == [2, 2, 1, 1]


def test_log_row_has_only_the_fields_we_chose(client, tmp_path):
    ask(client, "双眼皮多少钱")
    import json, sqlite3
    row = json.loads(sqlite3.connect(tmp_path / "demo.sqlite3").execute("SELECT data FROM records WHERE collection='rec_searches'").fetchone()[0])
    assert set(row) == {"id", "created_at", "term", "matched_term", "service", "intent", "handling", "match_source",
                        "recommended", "citations", "gaps", "clicked"}
