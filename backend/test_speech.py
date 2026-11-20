from copy import deepcopy
from backend.test_live import client, product, session, product_body
from backend.speech.routes import split_text


def setup(client, monkeypatch):
    monkeypatch.setattr(client.app.state.speech_provider, 'voices', lambda: [dict(id='中文一'),dict(id='中文二')])
    monkeypatch.setattr(client.app.state.speech_provider, 'synthesize', lambda *args: dict(id='abc',url='/audio/test',duration=1,cached=False))
    s=session(client,product(client));root='/api/live/speech/'+s['id']
    cfg=dict(expected_version=0,expected_blocks_version=0,host=dict(voice='中文一',rate=0,volume=100),assistant=dict(voice='中文二',rate=1,volume=80),gap_ms=200,blocked_words=['禁用词'])
    assert client.put(root+'/settings',json=cfg).status_code==200
    g=client.post('/api/live/speech/groups',json=dict(campaign_id=s['campaign_id'],name='测试话术',lines=[dict(text='价格129.50元。请核对规格。',role='host'),dict(text='禁用词不应播出。',role='assistant')])).json()
    return s,root,cfg,g


def test_snapshot_cache_idempotency_and_versions(client,monkeypatch):
    s,root,cfg,g=setup(client,monkeypatch)
    body=dict(group_id=g['id'],expected_group_version=1,request_id='queue-once')
    q=client.post(root+'/queue',json=body).json()
    assert client.post(root+'/queue',json=body).json()==q
    assert len(q['entries'])==3 and q['entries'][0]['text']=='价格129.50元。'
    assert q['entries'][-1]['blocked'] and q['entries'][-1]['voice']=='中文二'
    edited={**g,'expected_version':1,'name':'新版话术','lines':[dict(text='新版价格')],'request_id':'edit'}
    assert client.post('/api/live/speech/groups',json=edited).status_code==200
    assert client.post(root+'/queue',json=dict(group_id=g['id'],expected_group_version=1)).status_code==409
    workspace=client.get(root+'/workspace').json()
    assert workspace['queue']['entries'][0]['text']=='价格129.50元。'
    assert client.post('/api/live/speech/groups',json={**edited,'request_id':'stale'}).status_code==409
    assert client.post('/api/live/speech/queues/'+q['id']+'/clips/'+q['entries'][-1]['id']).json()=={'blocked':True}


def test_global_blocks_and_stale_product_protect_playback(client,monkeypatch):
    s,root,cfg,g=setup(client,monkeypatch)
    q=client.post(root+'/queue',json=dict(group_id=g['id'],expected_group_version=1)).json();base='/api/live/speech/queues/'+q['id']
    assert client.post(base+'/clips/'+q['entries'][0]['id']).status_code==200
    updated={**cfg,'expected_version':1,'expected_blocks_version':1,'blocked_words':['价格']}
    assert client.put(root+'/settings',json=updated).status_code==200
    assert q['entries'][0]['id'] in client.get(base+'/check').json()['blocked']
    assert client.post(base+'/clips/'+q['entries'][0]['id']).json()=={'blocked':True}
    p=client.get('/api/live/catalog').json();p=next(x for x in p if x['id']==s['items'][0]['product_id'])
    body=product_body();body.update(expected_version=p['version'],name='改变的商品')
    assert client.put('/api/live/catalog/'+p['id'],json=body).status_code==200
    assert client.get(base+'/check').status_code==409
    assert client.post(root+'/interrupt',json=dict(text='临时说明')).status_code==409


def test_validation_settings_conflict_and_cross_session(client,monkeypatch):
    s,root,cfg,g=setup(client,monkeypatch)
    assert client.put(root+'/settings',json=cfg).status_code==409
    assert client.put(root+'/settings',json={**cfg,'host':dict(voice='不存在')}).status_code==422
    assert client.put(root+'/settings',json={**cfg,'host':dict(voice='中文一',rate=50)}).status_code==422
    for text in ['','   ','。。。','🙂']:
        assert client.post('/api/live/speech/groups',json=dict(campaign_id=s['campaign_id'],name='bad',lines=[dict(text=text)])).status_code==422
    assert client.post(root+'/preview',json=dict(text='禁用词',voice='中文一')).status_code==422
    q=client.post(root+'/queue',json=dict(group_id=g['id'],expected_group_version=1)).json()
    s2=session(client,product(client));assert client.post('/api/live/speech/'+s2['id']+'/events',json=dict(queue_id=q['id'],action='start')).status_code==409
    assert client.get('/api/live/speech/audio/not-a-hash').status_code==404
    deleted=client.post('/api/live/speech/groups',json={**g,'deleted':True,'expected_version':1}).json()
    assert deleted['deleted'];assert not client.get(root+'/workspace').json()['groups']
    assert client.get('/api/live/speech/queues/'+q['id']+'/check').status_code==200


def test_long_text_splits_without_losing_characters():
    text='这是一段中文。价格29.99元！'+('内容'*200)
    parts=split_text(text);assert ''.join(parts)==text and max(map(len,parts))<=180
