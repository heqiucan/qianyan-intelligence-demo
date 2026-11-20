from backend.test_live import client, product, session
from backend.test_live_workspace import command
from backend.main import put


def setup(c):
 s=session(c,product(c));command(c,s,'configure',account='账号',room='房间');command(c,s,'start')
 rules=c.get('/api/live/interaction-samples').json()['rules']
 for r in rules:r['reviewed']=True
 body=dict(expected_version=0,enabled=True,takeover=False,item_id=s['items'][0]['id'],rules=rules)
 assert c.put('/api/live/interaction/'+s['id'],json=body).status_code==200
 return s,body


def fire(c,s,text='',kind='comment',viewer='测试观众',**extra):
 r=command(c,s,'event',kind=kind,viewer=viewer,text=text,**extra)
 assert r.status_code==200,r.text
 return r.json()['events'][-1]['reply']


def test_price_cooldown_takeover_and_idempotency(client):
 s,b=setup(client);a=fire(client,s,'多少钱',request_id='first')
 assert a['status']=='replied' and '89' in a['text'] and '{' not in a['text']
 assert fire(client,s,'价格')['status']=='cooldown'
 assert len(client.get('/api/live/interaction/'+s['id']).json()['results'])==2
 assert client.put('/api/live/interaction/'+s['id'],json={**b,'expected_version':1,'takeover':True}).status_code==200
 assert fire(client,s,'你好')['status']=='manual'
 assert client.put('/api/live/interaction/'+s['id'],json=b).status_code==409


def test_missing_expired_unreviewed_blocked_and_nickname(client):
 s,b=setup(client)
 def save(**changes):
  version=client.get('/api/live/interaction/'+s['id']).json()['config']['version']
  r=client.put('/api/live/interaction/'+s['id'],json={**b,'expected_version':version,**changes});assert r.status_code==200,r.text
 save(item_id='');assert fire(client,s,'价格')['status']=='manual'
 b['rules'][0]['reviewed']=False;save();assert '人工确认' in fire(client,s,'价格')['reason']
 b['rules'][0]['reviewed']=True;b['rules'][0]['expires_at']='2020-01-01T00:00:00+00:00';save();assert '过期' in fire(client,s,'价格')['reason']
 r=fire(client,s,kind='enter',viewer='坏昵称😀');assert '这位朋友' in r['text']
 with client.app.state.store.transaction() as db:put(db,'speech_blocks',dict(id='global',version=1,words=['感谢']))
 assert fire(client,s,kind='follow')['status']=='manual'
 assert fire(client,s,'未知产品效果')['status']=='manual'


def test_voice_rule_creates_snapshot_and_manual_invalidates_it(client):
 s,b=setup(client)
 with client.app.state.store.transaction() as db:put(db,'speech_settings',dict(id=s['id'],version=1,host=dict(voice='测试',rate=0,volume=100),assistant=dict(voice='测试',rate=0,volume=100),gap_ms=0))
 b['rules'][0]['mode']='both';b['expected_version']=1
 assert client.put('/api/live/interaction/'+s['id'],json=b).status_code==200
 reply=fire(client,s,'多少钱');assert reply['queue']['kind']=='interaction'
 q=reply['queue'];assert client.get('/api/live/speech/queues/'+q['id']+'/check').status_code==200
 assert client.put('/api/live/interaction/'+s['id'],json={**b,'expected_version':2,'takeover':True}).status_code==200
 assert client.get('/api/live/speech/queues/'+q['id']+'/check').status_code==409
 other=session(client,product(client));assert client.get('/api/live/interaction/'+other['id']).json()['config']['enabled'] is False


def test_rule_validation_and_sample_not_reviewed(client):
 s,b=setup(client);sample=client.get('/api/live/interaction-samples').json();assert all(not r['reviewed'] and r['simulated'] for r in sample['rules'])
 for template in ['{未知}','{商品价格','正常}']:
  b['rules'][0]['template']=template
  assert client.put('/api/live/interaction/'+s['id'],json={**b,'expected_version':1}).status_code==422


def test_event_retry_does_not_duplicate_reply_or_cooldown(client):
 s,b=setup(client)
 url='/api/live/workspace/'+s['id'];rev=client.get(url).json()['revision']
 payload=dict(action='event',expected_revision=rev,kind='comment',text='价格',viewer='观众',request_id='retry-event')
 a=client.post(url,json=payload);c=client.post(url,json=payload)
 assert a.status_code==200 and a.json()==c.json()
 assert len(client.get('/api/live/interaction/'+s['id']).json()['results'])==1


def test_variable_queue_unknown_and_price_snapshot(client,monkeypatch):
 s,b=setup(client)
 with client.app.state.store.transaction() as db:put(db,'speech_settings',dict(id=s['id'],version=1,host=dict(voice='测试',rate=0,volume=100),assistant=dict(voice='测试',rate=0,volume=100),gap_ms=0))
 g=client.post('/api/live/speech/groups',json=dict(campaign_id=s['campaign_id'],name='变量',lines=[dict(text='{商品名称}的价格为{商品价格}元。')])).json()
 url='/api/live/speech/'+s['id']+'/queue';body=dict(group_id=g['id'],expected_group_version=1)
 assert client.post(url,json=body).status_code==409
 q=client.post(url,json={**body,'item_id':s['items'][0]['id']}).json()
 assert q['item_id']==s['items'][0]['id'] and '89' in q['entries'][0]['text'] and '{' not in q['entries'][0]['text']
 assert client.post(url,json={**body,'item_id':'other-session-item'}).status_code==409


def test_edit_resets_review_in_ui_and_backend_respects_unreviewed(client):
 s,b=setup(client);b['rules'][0]['reviewed']=False
 assert client.put('/api/live/interaction/'+s['id'],json={**b,'expected_version':1}).status_code==200
 assert fire(client,s,'多少钱')['queue'] is None
 assert client.get('/api/live/interaction/'+s['id']).json()['results'][-1]['status']=='manual'
