"""Live workflow contracts, source boundaries and backward compatibility."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from backend.main import create_app, all_records, put
from backend.test_agents import create, wait, command
from backend.test_creative_handoff import knowledge_draft, payload, plan

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        yield c

def product_body():
    return dict(name="星野旅行杯", brand="星野测试品牌", price=89, capacity="350 ml", color="蓝色",
                description="商品测试设定：旅行杯，350 ml 或 600 ml 两种规格。", evidence="虚构验收资料",
                skus=[dict(label="蓝色350",capacity="350 ml",color="蓝色",price=89,price_source="虚构验收价格"),
                      dict(label="白色600",capacity="600 ml",color="白色",price=129,price_source="虚构验收价格")])

def product(c):
    r=c.post("/api/live/catalog", json=product_body())
    assert r.status_code==200,r.text
    return r.json()

def session_body(p, **extra):
    start=datetime.now(timezone.utc)
    return dict(campaign_id="campaign-demo", title="周末双规格场",host="测试主播",goal="核对商品内容与模拟成交",
                scheduled_start=start.isoformat(),scheduled_end=(start+timedelta(hours=2)).isoformat(),
                items=[dict(product_id=p["id"],sku_id=s["id"]) for s in p["skus"]],**extra)

def session(c,p,ready=True):
    r=c.post("/api/live/sessions",json=session_body(p))
    assert r.status_code==200,r.text
    s=r.json()
    if ready:
        r=c.post(f"/api/live/sessions/{s['id']}/status",json=dict(expected_version=1,status="ready",acknowledged=True))
        assert r.status_code==200,r.text
        s=r.json()
    return s

def generate(c,s,index=0,recipe="spec"):
    r=c.post(f"/api/live/sessions/{s['id']}/items/{s['items'][index]['id']}/generate",json=dict(recipe=recipe))
    assert r.status_code==200,r.text
    return r.json()[0]

def approve_plan(c,creative):
    r=c.post(f"/api/creatives/{creative['id']}/approve")
    assert r.status_code==200,r.text
    p=plan(c,creative)
    assert p.status_code==200,p.text
    p=p.json()
    assert c.post(f"/api/plans/{p['id']}/status",json={"status":"running"}).status_code==200
    return p

def order(c,p):
    r=c.post("/api/orders",json={"plan_id":p["id"],"buyer_id":"new-001","quantity":2})
    assert r.status_code==200,r.text
    return r.json()

def edit_body(s,**extra):
    return {k:deepcopy(s[k]) for k in ("campaign_id","title","host","scheduled_start","scheduled_end","goal")} | {
        "expected_version":s["version"],"items":[{k:i[k] for k in ("id","product_id","sku_id","talking_points","promotion","promotion_source")} for i in s["items"]]} | extra

def test_read_only_catalog_does_not_migrate_legacy_records(client):
    with client.app.state.store.transaction() as db:
        before=list(db.execute("select collection,id,data from records"))
        before=[tuple(x) for x in before]
    assert client.get("/api/live/catalog").json()[0]["legacy"]
    assert client.get("/api/live/sessions").json()==[]
    with client.app.state.store.transaction() as db:
        assert before==[tuple(x) for x in db.execute("select collection,id,data from records")]

@pytest.mark.parametrize("mutation",["negative","no_price_source","no_stock_source","duplicate_label","duplicate_id","unknown_id"])
def test_catalog_rejects_invalid_skus(client,mutation):
    b=product_body()
    if mutation=="negative": b["skus"][0]["price"]=-1
    if mutation=="no_price_source": b["skus"][0]["price_source"]=" "
    if mutation=="no_stock_source": b["skus"][0]["stock"]=3
    if mutation=="duplicate_label": b["skus"][1]["label"]=b["skus"][0]["label"]
    if mutation=="duplicate_id":
        for s in b["skus"]:s["id"]="same"
    if mutation=="unknown_id":b["skus"][0]["id"]="invented"
    assert client.post("/api/live/catalog",json=b).status_code==422
    assert len(client.get("/api/live/catalog").json())==1

def test_catalog_optimistic_update_preserves_existing_session_snapshot(client):
    p=product(client);s=session(client,p)
    b=product_body();b.update(expected_version=1,skus=p["skus"])
    b["skus"][0]["price"]=199
    updated=client.put("/api/live/catalog/"+p["id"],json=b)
    assert updated.status_code==200,updated.text
    assert updated.json()["version"]==2
    assert client.put("/api/live/catalog/"+p["id"],json=b).status_code==409
    assert client.get("/api/live/sessions").json()[0]["items"][0]["product_snapshot"]["price"]==89
    refreshed=client.put("/api/live/sessions/"+s["id"],json=edit_body(s)).json()
    assert refreshed["status"]=="draft" and refreshed["items"][0]["product_snapshot"]["price"]==199
    assert refreshed["history"][0]["items"][0]["product_snapshot"]["price"]==89

@pytest.mark.parametrize("mutation",["duplicate","missing_sku","bad_time","naive_time","promotion","foreign_line"])
def test_session_rejects_invalid_lineup(client,mutation):
    p=product(client);b=session_body(p)
    if mutation=="duplicate":b["items"].append(b["items"][0])
    if mutation=="missing_sku":b["items"][0]["sku_id"]="unknown"
    if mutation=="bad_time":b["scheduled_end"]=b["scheduled_start"]
    if mutation=="naive_time":b["scheduled_start"]="2026-11-13T12:00:00"
    if mutation=="promotion":b["items"][0]["promotion"]="减10元"
    if mutation=="foreign_line":b["items"][0]["id"]="foreign"
    assert client.post("/api/live/sessions",json=b).status_code==422
    assert client.get("/api/live/sessions").json()==[]

def test_double_submit_product_session_report_is_idempotent(client):
    b=product_body()|{"request_id":uuid4().hex}
    p=client.post("/api/live/catalog",json=b).json()
    assert client.post("/api/live/catalog",json=b).json()==p
    sb=session_body(p,request_id=uuid4().hex);s=client.post("/api/live/sessions",json=sb).json()
    assert client.post("/api/live/sessions",json=sb).json()==s
    rb={"title":"双击测试","request_id":uuid4().hex}
    r=client.post(f"/api/live/sessions/{s['id']}/reports",json=rb).json()
    assert client.post(f"/api/live/sessions/{s['id']}/reports",json=rb).json()==r

def test_two_skus_order_attribution_and_campaign_isolation(client):
    p=product(client);s=session(client,p);other=session(client,p)
    first=approve_plan(client,generate(client,s,0));second=approve_plan(client,generate(client,s,1))
    a=order(client,first);b=order(client,second)
    assert (a["amount"],b["amount"])==(178,258)
    assert a["live_context"]["sku_id"]!=b["live_context"]["sku_id"]
    assert first["creative_snapshot"]["product_snapshot"]["price"]==89
    result=client.get(f"/api/live/sessions/{s['id']}/analytics").json()
    assert result["metrics"]["revenue"]==436 and result["metrics"]["orders"]==2
    assert result["metrics"]["buyers"]==1 and result["metrics"]["new_customers"]==1
    assert result["metrics"]["spend"] is None and result["metrics"]["roi"] is None
    assert result["trend"]["points"][0]["revenue"]==436
    assert client.get(f"/api/live/sessions/{other['id']}/analytics").json()["metrics"]["orders"]==0
    assert client.get(f"/api/live/sessions/{s['id']}/analytics?dataset=history").status_code==422

def test_draft_confirmation_and_version_checks(client):
    p=product(client);s=session(client,p,ready=False);c=generate(client,s)
    assert client.post(f"/api/creatives/{c['id']}/approve").status_code==409
    assert client.post(f"/api/live/sessions/{s['id']}/status",json=dict(status="ready",expected_version=1)).status_code==422
    assert client.post(f"/api/live/sessions/{s['id']}/status",json=dict(status="ready",expected_version=2,acknowledged=True)).status_code==409

def test_session_revision_blocks_new_use_without_stopping_running_plan(client):
    p=product(client);s=session(client,p);c=generate(client,s);pl=approve_plan(client,c)
    revised=client.post(f"/api/creatives/{c['id']}/revise",json={k:c[k] for k in ("title","body","cta","script")}).json()
    assert revised["live_context"]==c["live_context"]
    assert client.put("/api/live/sessions/"+s["id"],json=edit_body(s,title="新版场次")).status_code==200
    assert client.post(f"/api/creatives/{c['id']}/approve").status_code==409
    assert plan(client,c).status_code==409
    assert order(client,pl)["live_context"]["session_version"]==1
    client.post(f"/api/plans/{pl['id']}/status",json={"status":"paused"})
    assert client.post(f"/api/plans/{pl['id']}/status",json={"status":"running"}).status_code==409

def test_archived_session_still_has_history_but_no_new_content(client):
    p=product(client);s=session(client,p)
    assert client.post(f"/api/live/sessions/{s['id']}/status",json=dict(status="archived",expected_version=1,acknowledged=True)).status_code==200
    assert client.put("/api/live/sessions/"+s["id"],json=edit_body(s)).status_code==409
    assert client.post(f"/api/live/sessions/{s['id']}/items/{s['items'][0]['id']}/generate",json={}).status_code==409
    assert client.get(f"/api/live/sessions/{s['id']}/analytics").status_code==200

def test_batch_cannot_leak_between_sessions_and_never_gets_fake_timeline(client):
    p=product(client);s=session(client,p);other=session(client,p);pl=approve_plan(client,generate(client,s))
    response=client.post("/api/batches",json=dict(plan_id=pl["id"],scenario="followup_orders"))
    assert response.status_code==200,response.text
    batch=response.json()
    a=client.get(f"/api/live/sessions/{s['id']}/analytics?dataset=batch&batch_id={batch['id']}")
    assert a.status_code==200,a.text
    assert a.json()["metrics"]["orders"]==3 and a.json()["trend"]["points"]==[]
    assert client.get(f"/api/live/sessions/{other['id']}/analytics?dataset=batch&batch_id={batch['id']}").status_code==409
    assert client.get(f"/api/live/sessions/{s['id']}/analytics").json()["metrics"]["orders"]==0

def test_report_snapshot_and_review_are_source_bound(client):
    p=product(client);s=session(client,p);pl=approve_plan(client,generate(client,s))
    order(client,pl)
    report=client.post(f"/api/live/sessions/{s['id']}/reports",json={"title":"第一份报告"}).json()
    review=client.post(f"/api/live/sessions/{s['id']}/reviews",json={}).json()
    assert review["source"]=="replay"
    assert review["analytics_snapshot"]["filters"]["live_session_id"]==s["id"]
    order(client,pl)
    stored=client.get("/api/live/reports").json()[0]
    assert stored==report and stored["analytics_snapshot"]["metrics"]["orders"]==1

def test_catalog_agent_handoff_and_reopen_are_bound_to_current_version(client):
    p=product(client);s=session(client,p)
    task=wait(client,create(client,scene="live",goal="整理星野旅行杯直播讲解规格",source_mode="catalog",
              campaign_id=s["campaign_id"],live_session_id=s["id"],live_item_id=s["items"][1]["id"]))
    assert task["status"]=="waiting_review",task
    draft=task["draft"]
    assert any("人工确认的货盘快照" in note for note in draft["missing"])
    assert draft["linked_live_context"]["sku_id"]==p["skus"][1]["id"]
    assert all("星野" in d["text"] or d["kind"]=="rules" for d in task["evidence"])
    assert client.post(f"/api/knowledge/drafts/{draft['id']}/confirm",json=dict(expected_revision=1,acknowledged=True)).status_code==200
    assert command(client,task,"complete",draft_id=draft["id"],draft_revision=1).status_code==200
    transfer=client.post(f"/api/knowledge/drafts/{draft['id']}/creative",json=payload(draft,title="星野旅行杯",body="星野旅行杯，600 ml，白色。记录售价 ¥129。",script="展示商品规格。"))
    assert transfer.status_code==200,transfer.text
    creative=transfer.json()["creative"];assert creative["product_snapshot"]["price"]==129
    pl=approve_plan(client,creative);assert order(client,pl)["amount"]==258
    edit=client.put(f"/api/knowledge/drafts/{draft['id']}",json=dict(expected_revision=1,title="修订稿",blocks=draft["blocks"]))
    assert edit.status_code==200
    assert command(client,task,"reopen",expected_revision=1).status_code==409
    assert command(client,task,"reopen",expected_revision=2).status_code==200
    assert command(client,task,"complete",draft_id=draft["id"],draft_revision=2).status_code==409
    assert client.post(f"/api/knowledge/drafts/{draft['id']}/confirm",json=dict(expected_revision=2,acknowledged=True)).status_code==200
    assert command(client,task,"complete",draft_id=draft["id"],draft_revision=2).status_code==200
    current=client.get("/api/agent/tasks/"+task["id"]).json()
    assert current["completed_revision"]==2 and current["total_model_calls"]==0
    assert current["completion_history"][0]["revision"]==1

def test_rag_can_target_a_live_item_and_cannot_escape_linked_task(client):
    p=product(client);s=session(client,p);draft=knowledge_draft(client)
    r=client.post(f"/api/knowledge/drafts/{draft['id']}/creative",json=payload(draft,live_session_id=s["id"],live_item_id=s["items"][0]["id"]))
    assert r.status_code==200,r.text
    assert r.json()["creative"]["live_context"]["sku_id"]==p["skus"][0]["id"]
    # The human ack is deliberately still required: references alone do not prove product equality.
    assert client.post(f"/api/knowledge/drafts/{draft['id']}/creative",json=payload(draft,live_session_id=s["id"])).status_code==422

def test_replay_structures_are_distinct_and_duplicate_generation_reuses_records(client):
    state=client.get("/api/state").json()
    seen=set()
    for recipe in ("spec","questions","walkthrough"):
        data={"recipe":recipe}
        one=client.post("/api/campaigns/campaign-demo/generate",json=data).json()
        two=client.post("/api/campaigns/campaign-demo/generate",json=data).json()
        assert [c["id"] for c in one]==[c["id"] for c in two]
        assert all(c["source"]=="replay" for c in one)
        seen.update(c["title"] for c in one)
    assert len(seen)==6
    assert len(client.get("/api/state").json()["creatives"])==len(state["creatives"])+6
    assert client.get("/api/analytics?dataset=history").json()["trend"]["points"]==[]

def test_trend_uses_utc_dates_and_filtered_orders(client):
    with client.app.state.store.transaction() as db:
        for id,time,amount in [("a","2026-11-12T23:30:00-02:00",10),("b","2026-11-13T12:00:00+00:00",20)]:
            put(db,"orders",dict(id=id,created_at=time,amount=amount,plan_id="plan-commute",creative_id="creative-commute",campaign_id="campaign-demo",buyer_id=id,buyer_type="new"))
    a=client.get("/api/analytics?dataset=session&plan_id=plan-commute").json()
    assert a["trend"]["points"]==[dict(date="2026-11-13",revenue=30.0,orders=2,spend=None)]
    filtered=client.get("/api/analytics?dataset=session&date_from=2026-11-13&date_to=2026-11-13").json()
    assert filtered["metrics"]["orders"]==2
