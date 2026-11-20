from backend.test_live_interaction import setup,client
from backend.main import get,put


def test_timer_requires_visible_client_owner_and_no_catchup(client,monkeypatch):
 s,b=setup(client);sid=s['id'];url='/api/live/interaction/'+sid+'/timer'
 b['rules']=[dict(id='clock',name='报时',kind='timer',template='现在是{当前时间}。',reviewed=True,source='模拟样例',mode='text',cooldown_seconds=0)]
 b.update(expected_version=1,timer_interval_seconds=5)
 assert client.put('/api/live/interaction/'+sid,json=b).status_code==200
 start=dict(action='start',run_id='page-a',expected_version=2)
 assert client.post(url,json=start).status_code==200
 assert client.post(url,json={**start,'run_id':'page-b'}).status_code==409
 tick=dict(action='tick',run_id='page-a',expected_version=2)
 assert client.post(url,json=tick).json()['status']=='waiting'
 with client.app.state.store.transaction() as db:
  state=get(db,'interaction_timer',sid);state['next_due']=0;put(db,'interaction_timer',state)
 fired=client.post(url,json={**tick,'request_id':'tick-once'}).json()
 assert fired['status']=='fired' and '点' in fired['result']['text'] and '{' not in fired['result']['text']
 assert client.post(url,json={**tick,'request_id':'tick-once'}).json()==fired
 assert client.post(url,json=tick).json()['status']=='waiting'
 with client.app.state.store.transaction() as db:
  state=get(db,'interaction_timer',sid);state['heartbeat']=0;put(db,'interaction_timer',state)
 assert client.post(url,json=tick).status_code==409


def test_timer_manual_or_pause_stops_work(client):
 s,b=setup(client);sid=s['id'];url='/api/live/interaction/'+sid+'/timer'
 b.update(expected_version=1,rules=[dict(id='line',name='场控',kind='timer',template='请核对商品资料。',reviewed=True,source='模拟')])
 assert client.put('/api/live/interaction/'+sid,json=b).status_code==200
 body=dict(action='start',run_id='a',expected_version=2)
 assert client.post(url,json=body).status_code==200
 from backend.test_live_workspace import command
 command(client,s,'pause')
 assert client.post(url,json={**body,'action':'tick'}).status_code==409
 assert client.post(url,json={**body,'action':'stop'}).status_code==200
 assert client.get('/api/live/interaction/'+sid).json()['results']==[]


def test_timer_run_cannot_silently_adopt_new_version(client):
 s,b=setup(client);sid=s['id'];url='/api/live/interaction/'+sid+'/timer'
 b.update(expected_version=1,rules=[dict(id='line',name='场控',kind='timer',template='请核对商品资料。',reviewed=True,source='模拟')])
 assert client.put('/api/live/interaction/'+sid,json=b).status_code==200
 assert client.post(url,json=dict(action='start',run_id='a',expected_version=2)).status_code==200
 b['expected_version']=2;assert client.put('/api/live/interaction/'+sid,json=b).status_code==200
 assert client.post(url,json=dict(action='tick',run_id='a',expected_version=3)).status_code==409
 with client.app.state.store.transaction() as db:
  session=get(db,'live_sessions',sid);session['version']+=1;put(db,'live_sessions',session)
 assert client.post(url,json=dict(action='start',run_id='b',expected_version=3)).status_code==409
