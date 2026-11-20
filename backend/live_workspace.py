"""Persisted, manual Douyin simulation. No platform, audio or background jobs."""
from typing import Literal
from fastapi import HTTPException
from pydantic import Field
from backend.main import Idempotent, all_records, get, put, once, now, uid
from backend.live import catalog


class WorkspaceCommand(Idempotent):
    expected_revision: int = Field(ge=0)
    action: Literal['configure', 'start', 'pause', 'stop', 'event']
    account: str = Field(default='', max_length=80)
    room: str = Field(default='', max_length=120)
    kind: Literal['comment', 'enter', 'follow'] = 'comment'
    viewer: str = Field(default='模拟观众', min_length=1, max_length=60)
    text: str = Field(default='', max_length=500)


def read_workspace(db, session_id):
    get(db, 'live_sessions', session_id)
    return next((r for r in all_records(db, 'live_workspaces') if r['id'] == session_id),
                dict(id=session_id, revision=0, account='', room='', status='idle',
                     session_version=0, events=[], logs=[], simulated=True))


def stale_items(db, session):
    products = {p['id']: p for p in catalog(db)}
    return [i['product_snapshot']['name'] for i in session['items']
            if i['product_id'] not in products or
            products[i['product_id']]['version'] != i['product_snapshot']['version'] or
            not any(s['id'] == i['sku_id'] and s['price'] == i['product_snapshot']['price']
                    for s in products[i['product_id']]['skus'])]


def register_workspace(app, store):
    @app.get('/api/live/workspace/{session_id}')
    def read(session_id: str):
        with store.read() as db:
            s = get(db, 'live_sessions', session_id)
            return {**read_workspace(db, session_id), 'stale_products': stale_items(db, s),
                    'needs_restart': s['version'] != read_workspace(db, session_id)['session_version']}

    @app.post('/api/live/workspace/{session_id}')
    def command(session_id: str, body: WorkspaceCommand):
        with store.transaction() as db:
            def run():
                s = get(db, 'live_sessions', session_id)
                r = read_workspace(db, session_id)
                if r['revision'] != body.expected_revision:
                    raise HTTPException(409, '其他页面已修改控制台，请刷新状态后重试')
                if body.action == 'configure':
                    if r['status'] in ('running', 'paused'):
                        raise HTTPException(409, '请先停止模拟，再修改模拟账号与直播间')
                    if not body.account.strip() or not body.room.strip():
                        raise HTTPException(422, '请填写模拟账号和直播间名称')
                    r.update(account=body.account.strip(), room=body.room.strip())
                    detail = '保存模拟账号与直播间（未登录抖音）'
                elif body.action in ('start', 'event'):
                    if s['status'] != 'ready' or stale_items(db, s):
                        raise HTTPException(409, '请先更新并确认本场货盘，商品资料必须为当前版本')
                    if not r['account'] or not r['room']:
                        raise HTTPException(409, '请先保存模拟账号与直播间')
                    if body.action == 'start':
                        if r['status'] == 'running':
                            raise HTTPException(409, '模拟已经运行')
                        r.update(status='running', session_version=s['version'])
                        detail = '启动或恢复本地模拟；不会开播、推流或播报语音'
                    else:
                        if r['status'] != 'running' or r['session_version'] != s['version']:
                            raise HTTPException(409, '模拟未运行或场次已更新，请重新启动模拟')
                        if not body.viewer.strip() or (body.kind == 'comment' and not body.text.strip()):
                            raise HTTPException(422, '请填写观众昵称和弹幕内容')
                        event = dict(id=uid('live-event'), kind=body.kind, viewer=body.viewer.strip(),
                                     text=body.text.strip() if body.kind == 'comment' else '',
                                     created_at=now(), session_version=s['version'], simulated=True)
                        r['events'] = (r['events'] + [event])[-200:]
                        from backend.live_interaction import decide, record_result
                        result=decide(db,s,event)
                        record_result(db,session_id,result)
                        event['reply']=result
                        detail = '收到模拟' + {'comment':'弹幕', 'enter':'进场', 'follow':'关注'}[body.kind]
                elif body.action == 'pause':
                    if r['status'] != 'running':
                        raise HTTPException(409, '仅运行中的模拟可以暂停')
                    r['status'] = 'paused'
                    detail = '暂停本地模拟'
                else:
                    r['status'] = 'stopped'
                    detail = '停止本地模拟'
                r['revision'] += 1
                r['logs'] = (r['logs'] + [dict(id=uid('live-log'), text=detail, created_at=now())])[-200:]
                put(db, 'live_workspaces', r)
                return r
            return once(db, 'live-workspace:' + session_id, body, run)
