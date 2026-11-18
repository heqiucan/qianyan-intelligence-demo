from backend.test_live import client, product, session, session_body, product_body


def command(c, s, action, **extra):
    url='/api/live/workspace/'+s['id']
    revision=c.get(url).json()['revision']
    return c.post(url, json=dict(action=action, expected_revision=revision, **extra))


def setup(c):
    p=product(c);s=session(c,p)
    assert command(c,s,'configure',account='测试账号',room='测试直播间').status_code==200
    return p,s


def test_persistence_events_and_transitions(client):
    _,s=setup(client)
    assert command(client,s,'start').status_code==200
    for kind in ('comment','enter','follow'):
        assert command(client,s,'event',kind=kind,viewer='测试观众',text='价格？').status_code==200
    assert command(client,s,'pause').status_code==200
    assert command(client,s,'event',text='不能发送').status_code==409
    assert command(client,s,'configure',account='其他',room='其他').status_code==409
    assert command(client,s,'start').status_code==200
    r=command(client,s,'stop').json()
    saved=client.get('/api/live/workspace/'+s['id']).json()
    assert saved['status']=='stopped' and saved['account']=='测试账号'
    assert len(saved['events'])==3 and len(saved['logs'])==8
    assert r['revision']==saved['revision']


def test_idempotency_and_stale_tabs(client):
    _,s=setup(client);url='/api/live/workspace/'+s['id']
    body=dict(action='start',expected_revision=1,request_id='same-start')
    a=client.post(url,json=body);b=client.post(url,json=body)
    assert a.status_code==200 and a.json()==b.json()
    assert client.post(url,json=dict(action='stop',expected_revision=1)).status_code==409


def test_product_change_blocks_simulation(client):
    p,s=setup(client)
    assert command(client,s,'start').status_code==200
    body=product_body();body.update(expected_version=p['version'],name='新版测试杯')
    assert client.put('/api/live/catalog/'+p['id'],json=body).status_code==200
    assert client.get('/api/live/workspace/'+s['id']).json()['stale_products']
    assert command(client,s,'event',text='价格').status_code==409
    assert command(client,s,'stop').status_code==200
    assert command(client,s,'start').status_code==409


def test_draft_archive_and_missing_account(client):
    p=product(client);s=session(client,p,ready=False)
    assert command(client,s,'start').status_code==409
    assert command(client,s,'configure',account=' ',room='x').status_code==422
    assert command(client,s,'configure',account='x',room='x').status_code==200
    assert command(client,s,'start').status_code==409


def test_session_changes_and_separation(client):
    p,s=setup(client);other=session(client,p)
    assert client.get('/api/live/workspace/'+other['id']).json()['account']==''
    assert command(client,s,'start').status_code==200
    body=session_body(p,expected_version=s['version'])
    updated=client.put('/api/live/sessions/'+s['id'],json=body).json()
    assert client.get('/api/live/workspace/'+s['id']).json()['needs_restart']
    assert command(client,s,'event',text='旧场次').status_code==409
    assert command(client,s,'stop').status_code==200
    assert client.post('/api/live/sessions/'+s['id']+'/status',json=dict(status='archived',expected_version=updated['version'],acknowledged=True)).status_code==200
    assert command(client,s,'start').status_code==409
