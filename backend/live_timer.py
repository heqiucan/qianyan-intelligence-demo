"""Explicit, browser-heartbeat driven schedules. No unattended background catch-up."""
import secrets
import time
from fastapi import HTTPException
from pydantic import Field
from typing import Literal
from backend.main import Idempotent, get, put, once, uid, now
from backend.live_interaction import read_config, decide, record_result
from backend.live_workspace import read_workspace, stale_items
from backend.speech.routes import optional

class TimerCommand(Idempotent):
    action:Literal['start','tick','stop']
    run_id:str=Field(min_length=1,max_length=80)
    expected_version:int=Field(ge=0)


def register_timer(app,store):
    @app.post('/api/live/interaction/{sid}/timer')
    def command(sid:str,body:TimerCommand):
        with store.transaction() as db:
            def run():
                session=get(db,'live_sessions',sid);cfg=read_config(db,sid);runtime=read_workspace(db,sid)
                state=optional(db,'interaction_timer',sid,dict(id=sid,owner='',heartbeat=0,next_due=0,index=0))
                clock=time.time()
                if body.action=='stop':
                    if state['owner']==body.run_id:
                        state.update(owner='',heartbeat=0,next_due=0);put(db,'interaction_timer',state)
                    return dict(status='stopped',result=None)
                if cfg['version']!=body.expected_version:raise HTTPException(409,'规则已变化，定时任务停止，请重新核对后启动。')
                if not cfg['enabled'] or cfg['takeover'] or runtime['status']!='running' or runtime['session_version']!=session['version'] or session['status']!='ready' or stale_items(db,session):
                    raise HTTPException(409,'请先确认货盘、启动模拟并恢复规则响应，再启动定时任务。')
                candidates=[r for r in cfg['rules'] if r['kind']=='timer' and r['enabled']]
                if not candidates:raise HTTPException(422,'请先添加并启用至少一条定时规则。')
                if state['owner'] and state['owner']!=body.run_id and clock-state['heartbeat']<10:
                    raise HTTPException(409,'另一个页面正在执行本场定时任务，请先停止它。')
                if body.action=='start':
                    state.update(owner=body.run_id,heartbeat=clock,next_due=clock+cfg['timer_interval_seconds'],version=cfg['version'],index=0)
                    put(db,'interaction_timer',state);return dict(status='waiting',next_due=state['next_due'],result=None)
                if state['owner']!=body.run_id or clock-state['heartbeat']>=10 or state.get('version')!=cfg['version']:
                    raise HTTPException(409,'定时页面已暂停或连接中断，请手动重新启动。')
                state['heartbeat']=clock
                if clock<state['next_due']:
                    put(db,'interaction_timer',state);return dict(status='waiting',next_due=state['next_due'],result=None)
                rule=secrets.choice(candidates) if cfg['timer_mode']=='random' else candidates[state['index']%len(candidates)]
                state['index']+=1;state['next_due']=clock+cfg['timer_interval_seconds']
                event=dict(id=uid('timer-event'),kind='timer',viewer='这位朋友',text='',rule_id=rule['id'],created_at=now())
                result=decide(db,session,event);record_result(db,sid,result);put(db,'interaction_timer',state)
                return dict(status='fired',next_due=state['next_due'],result=result)
            return once(db,'live-timer:'+sid,body,run)
