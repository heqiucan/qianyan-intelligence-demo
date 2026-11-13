"""V2 acceptance using isolated databases: state, scope, idempotency and snapshots."""
from datetime import date, timedelta
import time

import pytest
from fastapi.testclient import TestClient
from backend.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    with TestClient(create_app(tmp_path)) as session:
        yield session


def post(client, path, body=None):
    r = client.post('/api'+path, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def state(client):
    return client.get('/api/state').json()


def dates():
    return dict(start_date=date.today().isoformat(), end_date=(date.today()+timedelta(days=7)).isoformat())


def batch(client, scenario='no_conversion', **extra):
    return post(client, '/batches', dict(plan_id='plan-commute', scenario=scenario, **extra))


def adjustment(client, **extra):
    return post(client, '/plans/plan-commute/adjustments', dict(budget=250, reason='核对后调整测试预算', **dates(), **extra))


def test_campaign_strategy_versions_preserve_product_and_creatives(client):
    body = dict(name='策略活动', audience='通勤人群', selling_point='500 ml', goal='观察模拟订单', budget_limit=500, request_id='campaign-once', **dates())
    first = post(client, '/campaigns', body)
    assert post(client, '/campaigns', body) == first
    creatives = post(client, '/campaigns/'+first['id']+'/generate', dict(tone='简洁', angle='规格'))
    changed = client.put('/api/campaigns/'+first['id'], json={**body, 'goal':'观察新客', 'request_id':'edit'}).json()
    assert changed['strategy_version'] == 2
    assert changed['strategy_history'][0]['goal'] == '观察模拟订单'
    assert changed['product_snapshot'] == first['product_snapshot']
    assert next(c for c in state(client)['creatives'] if c['id']==creatives[0]['id'])['strategy_version'] == 1


def test_single_regenerate_family_and_idempotent_edit(client):
    before = state(client)
    body = dict(tone='简洁', angle='规格', request_id='regen')
    generated = post(client, '/creatives/creative-commute/regenerate', body)
    assert post(client, '/creatives/creative-commute/regenerate', body) == generated
    assert generated['family_id'] == 'creative-commute' and generated['version'] == 2
    other = next(c for c in state(client)['creatives'] if c['id']=='creative-capacity')
    assert other == before['creatives'][1]
    payload={k:generated[k] for k in ('title','body','cta','script')}
    payload.update(template='minimal',request_id='edit-once')
    edited=post(client,'/creatives/'+generated['id']+'/revise',payload)
    assert post(client,'/creatives/'+generated['id']+'/revise',payload)==edited
    assert edited['template']=='minimal' and edited['version']==3
    assert state(client)['plans'][0]['creative_snapshot']==before['plans'][0]['creative_snapshot']


def test_plan_copy_edit_and_stale_adjustments(client):
    copied=post(client,'/plans/plan-commute/copy',{'request_id':'copy'})
    assert copied==post(client,'/plans/plan-commute/copy',{'request_id':'copy'})
    assert copied['status']=='draft' and copied['config_version']==1
    edited=client.put('/api/plans/'+copied['id'],json=dict(name='修改副本',budget=350,**dates()))
    assert edited.status_code==200 and edited.json()['config_version']==2
    assert client.put('/api/plans/plan-commute',json=dict(name='非法直接修改',budget=350,**dates())).status_code==409
    a=adjustment(client,request_id='a')
    b=adjustment(client,request_id='b')
    applied=post(client,'/adjustments/'+a['id']+'/apply',{'request_id':'apply'})
    assert applied['status']=='applied'
    assert post(client,'/adjustments/'+a['id']+'/apply',{'request_id':'apply-again'})==applied
    assert client.post('/api/adjustments/'+b['id']+'/apply',json={}).status_code==409
    current=next(p for p in state(client)['plans'] if p['id']=='plan-commute')
    assert current['config_version']==2 and current['config_history'][0]['budget']==200
    assert state(client)['orders']==[] and state(client)['batches']==[]


def test_ended_and_outside_cycle_cannot_start_or_adjust(client):
    copied=post(client,'/plans/plan-commute/copy',{})
    old=date.today()-timedelta(days=3)
    r=client.put('/api/plans/'+copied['id'],json=dict(name='过期计划',budget=200,start_date=old.isoformat(),end_date=(old+timedelta(days=1)).isoformat()))
    assert r.status_code==200
    assert client.post('/api/plans/'+copied['id']+'/status',json={'status':'running'}).status_code==409
    post(client,'/plans/plan-commute/status',{'status':'ended'})
    assert client.post('/api/plans/plan-commute/adjustments',json=dict(budget=200,reason='修改',**dates())).status_code==409


def test_batch_pause_returns_per_plan_results(client):
    post(client,'/plans/plan-capacity/status',{'status':'ended'})
    body={'plan_ids':['plan-commute','plan-capacity','missing'], 'status':'paused','request_id':'batch-pause'}
    result=post(client,'/plans/batch-status',body)
    assert [r['ok'] for r in result['results']]==[True,False,False]
    assert post(client,'/plans/batch-status',body)==result
    assert client.post('/api/batches',json={'plan_id':'plan-commute','scenario':'no_conversion'}).status_code==409


def test_batch_preview_is_read_only_and_data_is_isolated(client):
    original=state(client)
    preview=post(client,'/batches/preview',{'plan_id':'plan-commute','scenario':'followup_orders'})
    assert preview['metrics']['orders']==3
    assert state(client)==original
    sample=batch(client,'followup_orders',request_id='batch-once')
    assert batch(client,'followup_orders',request_id='batch-once')==sample
    assert sample['metrics']['revenue']==297
    assert state(client)['orders']==[]
    assert client.get('/api/analytics?dataset=session').json()['metrics']['orders']==0
    assert client.get('/api/analytics?dataset=history').json()['metrics']['orders']==15
    selected=client.get('/api/analytics',params={'dataset':'batch','batch_id':sample['id'],'campaign_id':'campaign-demo','plan_id':'plan-commute'}).json()
    assert selected['metrics']['spend']==120 and len(selected['orders'])==3 and len(selected['spend_entries'])==1
    change=adjustment(client)
    post(client,'/adjustments/'+change['id']+'/apply',{})
    assert client.get('/api/analytics',params={'dataset':'batch','batch_id':sample['id']}).json()['metrics']==selected['metrics']
    assert next(b for b in state(client)['batches'] if b['id']==sample['id'])['plan_snapshot']['budget']==200


def test_analytics_scope_and_date_restrictions(client):
    other=post(client,'/campaigns',{'name':'其他活动'})
    sample=batch(client)
    for dataset,extra in [('history',{}),('batch',{'batch_id':sample['id']})]:
        assert client.get('/api/analytics',params={'dataset':dataset,'date_from':date.today().isoformat(),**extra}).status_code==422
    assert client.get('/api/analytics',params={'dataset':'session','date_from':'2026-11-11','date_to':'2026-11-10'}).status_code==422
    assert client.get('/api/analytics',params={'dataset':'session','campaign_id':other['id'],'plan_id':'plan-commute'}).status_code==409
    assert client.get('/api/analytics',params={'dataset':'batch','campaign_id':other['id'],'batch_id':sample['id']}).status_code==409
    assert client.get('/api/analytics',params={'dataset':'batch','plan_id':'plan-capacity','batch_id':sample['id']}).status_code==409
    rows=client.get('/api/analytics',params={'dataset':'history','plan_id':'history-A'}).json()
    assert rows['metrics']['orders']==9 and len(rows['orders'])==9


def test_quantity_price_is_server_calculated_and_scoped(client):
    body={'plan_id':'plan-commute','buyer_id':'new-001','quantity':3,'amount':1,'request_id':'qty'}
    order=post(client,'/orders',body)
    assert order['amount']==297 and order['unit_price']==99 and order['quantity']==3 and order['plan_config_version']==1
    assert post(client,'/orders',body)==order
    assert client.post('/api/orders',json={**body,'quantity':2}).status_code==409
    assert client.post('/api/orders',json={**body,'quantity':1.5,'request_id':'fraction'}).status_code==422
    excluded=client.get('/api/analytics',params={'dataset':'session','date_to':(date.today()-timedelta(days=1)).isoformat()}).json()
    assert excluded['orders']==[] and excluded['metrics']['revenue']==0
    selected=client.get('/api/analytics',params={'dataset':'session','plan_id':'plan-commute'}).json()
    assert selected['metrics']['orders']==1 and selected['metrics']['new_customers']==1 and selected['metrics']['spend'] is None


def test_tasks_dedup_state_and_cross_campaign_guard(client):
    sample=batch(client)
    payload={'campaign_id':'campaign-demo','batch_id':sample['id'],'spend_threshold':100}
    tasks=post(client,'/tasks/scan',{**payload,'request_id':'scan1'})
    assert len(tasks)==1 and tasks[0]['rule']=='spend-without-order'
    task=tasks[0]
    assert post(client,'/tasks/scan',{**payload,'request_id':'scan2'})==tasks
    assert client.post('/api/tasks/'+task['id']+'/status',json={'status':'ignored','note':''}).status_code==422
    closed=post(client,'/tasks/'+task['id']+'/status',{'status':'resolved','note':'已核对并创建后续观察任务'})
    rescanned=post(client,'/tasks/scan',{**payload,'request_id':'scan3'})
    assert rescanned==[closed] and closed['history'][0]['from']=='pending'
    other=post(client,'/campaigns',{'name':'其他活动'})
    assert client.post('/api/tasks/scan',json={**payload,'campaign_id':other['id']}).status_code==409


def test_insight_action_exclusion_and_rejection(client):
    first=post(client,'/insights',{'dataset':'history'})
    post(client,'/insights/'+first['id']+'/dismiss',{'reason':'缺少后续数据'})
    assert client.post('/api/insights/'+first['id']+'/accept',json={'creative_id':'creative-commute'}).status_code==409
    second=post(client,'/insights',{'dataset':'history'})
    change=adjustment(client,insight_id=second['id'])
    assert adjustment(client,insight_id=second['id'])==change
    assert client.post('/api/insights/'+second['id']+'/accept',json={'creative_id':'creative-commute'}).status_code==409
    assert client.post('/api/insights/'+second['id']+'/dismiss',json={'reason':'改主意'}).status_code==409
    third=post(client,'/insights',{'dataset':'history'})
    creative=post(client,'/insights/'+third['id']+'/accept',{'creative_id':'creative-commute'})
    assert creative['status']=='draft'
    assert client.post('/api/plans/plan-commute/adjustments',json=dict(budget=200,reason='重复动作',insight_id=third['id'],**dates())).status_code==409


def test_full_batch_observation_flow_with_stale_data_guard(client):
    baseline=batch(client)
    insight=post(client,'/insights',{'dataset':'batch','batch_id':baseline['id'],'campaign_id':'campaign-demo'})
    change=adjustment(client,insight_id=insight['id'])
    obs=next(o for o in state(client)['observations'] if o['insight_id']==insight['id'])
    assert obs['status']=='waiting_confirmation'
    assert client.post('/api/observations/'+obs['id']+'/start',json={'plan_id':'plan-commute'}).status_code==409
    post(client,'/adjustments/'+change['id']+'/apply',{})
    early=batch(client,'followup_orders')
    time.sleep(.003)
    started=post(client,'/observations/'+obs['id']+'/start',{'plan_id':'plan-commute'})
    assert started['status']=='observing'
    assert post(client,'/observations/'+obs['id']+'/review',{'batch_id':early['id']})['status']=='observing'
    assert post(client,'/observations/'+obs['id']+'/review',{})['status']=='observing'
    time.sleep(.003)
    later=batch(client,'followup_orders')
    reviewed=post(client,'/observations/'+obs['id']+'/review',{'batch_id':later['id'],'note':'仅模拟窗口对比'})
    assert reviewed['status']=='reviewed' and reviewed['comparison']['orders_delta']==3
    assert reviewed['comparison']['before']['orders']==0
    assert state(client)['orders']==[]


def test_history_observation_does_not_compare_batch_or_wrong_creative(client):
    insight=post(client,'/insights',{'dataset':'history'})
    creative=post(client,'/insights/'+insight['id']+'/accept',{'creative_id':'creative-commute'})
    obs=state(client)['observations'][0]
    assert client.post('/api/observations/'+obs['id']+'/start',json={'plan_id':'plan-capacity'}).status_code==409
    post(client,'/creatives/'+creative['id']+'/approve')
    plan=post(client,'/plans',dict(name='新素材观察',creative_id=creative['id'],budget=200,**dates()))
    post(client,'/plans/'+plan['id']+'/status',{'status':'running'})
    post(client,'/observations/'+obs['id']+'/start',{'plan_id':plan['id']})
    sample=post(client,'/batches',{'plan_id':plan['id'],'scenario':'followup_orders'})
    reviewed=post(client,'/observations/'+obs['id']+'/review',{'batch_id':sample['id']})
    assert reviewed['status']=='observing' and '不能' in reviewed['note']


def test_reports_are_immutable_and_isolated(client):
    other=post(client,'/campaigns',{'name':'不该进入报告的活动'})
    post(client,'/campaigns/'+other['id']+'/generate',{})
    payload=dict(campaign_id='campaign-demo',dataset='session',title='本轮报告',conclusion='人工结论',next_action='继续观察',request_id='report')
    report=post(client,'/reports',payload)
    assert post(client,'/reports',payload)==report
    assert report['snapshot']['analytics']['metrics']['orders']==0
    assert all(c['campaign_id']=='campaign-demo' for c in report['snapshot']['creatives'])
    post(client,'/orders',{'plan_id':'plan-commute','buyer_id':'new-001'})
    current=next(r for r in state(client)['reports'] if r['id']==report['id'])
    assert current==report and current['snapshot']['analytics']['metrics']['orders']==0
    assert client.put('/api/reports/'+report['id'],json={'conclusion':'不能覆写'}).status_code==404


def test_additive_migration_preserves_saved_records(tmp_path, monkeypatch):
    monkeypatch.delenv('DEMO_ACCESS_TOKEN',raising=False)
    monkeypatch.setenv('MODEL_PROVIDER','replay')
    app=create_app(tmp_path)
    with TestClient(app) as first:
        original=post(first,'/orders',{'plan_id':'plan-commute','buyer_id':'old-001','quantity':2})
        # Simulate a pre-V2 top-level plan while retaining all its original data.
        from backend.main import get,put
        with app.state.store.transaction() as db:
            plan=get(db,'plans','plan-commute')
            plan.pop('config_version');plan.pop('config_history')
            put(db,'plans',plan)
    with TestClient(create_app(tmp_path)) as second:
        restored=state(second)
        assert restored['orders']==[original]
        assert restored['plans'][0]['config_version']==1
        assert restored['plans'][0]['creative_snapshot']==plan['creative_snapshot']


def test_single_plan_report_uses_batch_configuration_snapshot(client):
    sample=batch(client)
    change=adjustment(client)
    post(client,'/adjustments/'+change['id']+'/apply',{})
    report=post(client,'/reports',dict(campaign_id='campaign-demo',dataset='batch',batch_id=sample['id'],title='批次报告'))
    assert [p['id'] for p in report['snapshot']['plans']]==['plan-commute']
    assert report['snapshot']['plans'][0]['budget']==200
    assert [c['id'] for c in report['snapshot']['creatives']]==['creative-commute']
    assert all(a['plan_id']=='plan-commute' for a in report['snapshot']['adjustments'])


def test_session_observation_rejects_aggregate_baseline_and_waits_for_window(client):
    insight=post(client,'/insights',dict(dataset='session',campaign_id='campaign-demo'))
    change=adjustment(client,insight_id=insight['id'])
    post(client,'/adjustments/'+change['id']+'/apply',{})
    obs=next(o for o in state(client)['observations'] if o['insight_id']==insight['id'])
    post(client,'/observations/'+obs['id']+'/start',{'plan_id':'plan-commute'})
    reviewed=post(client,'/observations/'+obs['id']+'/review',{})
    assert reviewed['status']=='observing' and '单一计划' in reviewed['note']
    yesterday=(date.today()-timedelta(days=1)).isoformat()
    single=post(client,'/insights',dict(dataset='session',campaign_id='campaign-demo',plan_id='plan-commute',date_from=yesterday,date_to=yesterday))
    change=adjustment(client,insight_id=single['id'])
    post(client,'/adjustments/'+change['id']+'/apply',{})
    obs=next(o for o in state(client)['observations'] if o['insight_id']==single['id'])
    post(client,'/observations/'+obs['id']+'/start',{'plan_id':'plan-commute'})
    reviewed=post(client,'/observations/'+obs['id']+'/review',{})
    assert reviewed['status']=='observing' and '窗口尚未结束' in reviewed['note']


def test_batch_insight_does_not_claim_missing_spend(client):
    sample=batch(client)
    insight=post(client,'/insights',dict(dataset='batch',batch_id=sample['id'],campaign_id='campaign-demo'))
    assert any('120' in fact for fact in insight['facts'])
    assert not any('没有对应的广告曝光和消耗' in text for text in insight['missing'])


def test_observation_cannot_review_different_plan_configuration(client):
    baseline=batch(client)
    insight=post(client,'/insights',dict(dataset='batch',batch_id=baseline['id'],campaign_id='campaign-demo'))
    first=adjustment(client,insight_id=insight['id'])
    post(client,'/adjustments/'+first['id']+'/apply',{})
    obs=state(client)['observations'][0]
    post(client,'/observations/'+obs['id']+'/start',dict(plan_id='plan-commute'))
    later_change=adjustment(client)
    post(client,'/adjustments/'+later_change['id']+'/apply',{})
    sample=batch(client,'followup_orders')
    reviewed=post(client,'/observations/'+obs['id']+'/review',dict(batch_id=sample['id']))
    assert reviewed['status']=='observing' and '版本' in reviewed['note']


def test_selected_plan_insight_cannot_act_on_another_plan(client):
    baseline=batch(client)
    insight=post(client,'/insights',dict(dataset='batch',batch_id=baseline['id'],campaign_id='campaign-demo'))
    assert client.post('/api/plans/plan-capacity/adjustments',json=dict(budget=200,reason='选错计划',insight_id=insight['id'],**dates())).status_code==409
    assert client.post('/api/insights/'+insight['id']+'/accept',json=dict(creative_id='creative-capacity')).status_code==409
    assert next(x for x in state(client)['insights'] if x['id']==insight['id'])['status']=='pending'
