"""Manual rules for local events only. No platform messages, LLM or legal classifier."""
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from typing import Literal
from fastapi import HTTPException
from pydantic import Field, field_validator
from backend.main import Input, Idempotent, get, put, once, now, uid

VARIABLES={'商品名称','商品价格','商品规格','观众昵称','当前时间'}


def normalize(text):
    return unicodedata.normalize('NFKC',text).casefold()


def render_template(text, session, item_id='', viewer='这位朋友', blocked_words=(), utc_offset_minutes=480):
    names=re.findall(r'\{([^{}]+)\}',text)
    if set(names)-VARIABLES or text.count('{')!=len(names) or text.count('}')!=len(names):
        raise HTTPException(422,'存在未知或不完整变量，仅支持商品名称、商品价格、商品规格、观众昵称、当前时间。')
    item=next((i for i in session['items'] if i['id']==item_id),None)
    nickname=viewer if re.fullmatch(r'[\u4e00-\u9fffA-Za-z0-9]{1,12}',viewer or '') and not any(normalize(w) in normalize(viewer) for w in blocked_words) else '这位朋友'
    values={'观众昵称':nickname,'当前时间':datetime.now(timezone(timedelta(minutes=utc_offset_minutes))).strftime('%H点%M分')}
    if item:
        product=item['product_snapshot']
        values.update({'商品名称':product.get('name'),'商品规格':item.get('sku_label')})
        if product.get('price') is not None and item.get('price_source'):
            values['商品价格']=format(float(product['price']),'.2f').rstrip('0').rstrip('.')
    for name in names:
        if values.get(name) in (None,''):
            raise HTTPException(409,'缺少已确认的 '+name+'，请选择有效货盘商品或转人工。')
        text=text.replace('{'+name+'}',str(values[name]))
    return text


class Rule(Input):
    id:str=Field(min_length=1,max_length=60)
    name:str=Field(min_length=1,max_length=100)
    kind:Literal['comment','enter','follow','timer']
    keywords:list[str]=Field(default_factory=list,max_length=30)
    template:str=Field(min_length=1,max_length=600)
    mode:Literal['text','speech','both']='text'
    role:Literal['host','assistant']='assistant'
    cooldown_seconds:int=Field(default=30,ge=0,le=3600)
    enabled:bool=True
    reviewed:bool=False
    simulated:bool=False
    source:str=Field(min_length=1,max_length=300)
    expires_at:str=''

    @field_validator('keywords')
    @classmethod
    def keywords_valid(cls, values):
        if any(not v.strip() or len(v)>60 for v in values):raise ValueError('关键词不能为空或超过60字')
        return list(dict.fromkeys(v.strip() for v in values))

    @field_validator('expires_at')
    @classmethod
    def expiry_valid(cls,value):
        if value:
            parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
            if parsed.tzinfo is None:raise ValueError('有效期需要包含时区')
        return value


class RulesInput(Idempotent):
    expected_version:int=Field(ge=0)
    enabled:bool=False
    takeover:bool=True
    item_id:str=''
    timer_interval_seconds:int=Field(default=60,ge=5,le=3600)
    timer_mode:Literal['sequential','random']='sequential'
    utc_offset_minutes:int=Field(default=480,ge=-720,le=840)
    rules:list[Rule]=Field(default_factory=list,max_length=50)


def read_config(db,sid):
    from backend.speech.routes import optional
    return {**dict(timer_interval_seconds=60,timer_mode='sequential',utc_offset_minutes=480),**optional(db,'interaction_rules',sid,dict(id=sid,version=0,enabled=False,takeover=True,item_id='',rules=[],source_hash=''))}


def validate_rules(body):
    ids=[r.id for r in body.rules]
    if len(ids)!=len(set(ids)):raise HTTPException(422,'规则编号不能重复。')
    for rule in body.rules:
        if rule.kind=='comment' and not rule.keywords:raise HTTPException(422,'弹幕规则至少填写一个关键词。')
        # Validate variable syntax, without requiring a selected item.
        names=re.findall(r'\{([^{}]+)\}',rule.template)
        if set(names)-VARIABLES or rule.template.count('{')!=len(names) or rule.template.count('}')!=len(names):raise HTTPException(422,'话术含未知或不完整变量。')


def decide(db,session,event):
    from backend.speech.routes import blocks, match_block, settings, snapshot
    from backend.live_workspace import stale_items
    cfg=read_config(db,session['id'])
    result=dict(id=uid('reply'),event_id=event['id'],created_at=now(),status='disabled',text='',reason='自动互动未开启',rule_id='',rule_version=cfg['version'],simulated=True,queue=None)
    if not cfg['enabled']:return result
    if cfg['takeover']:
        result.update(status='manual',reason='人工接管中');return result
    if session['status']!='ready' or stale_items(db,session):
        result.update(status='manual',reason='商品资料未确认或已变化');return result
    rule=next((r for r in cfg['rules'] if r['enabled'] and r['kind']==event['kind'] and (not event.get('rule_id') or r['id']==event['rule_id']) and (r['kind']!='comment' or any(normalize(k) in normalize(event['text']) for k in r['keywords']))),None)
    if not rule:
        result.update(status='manual' if event['kind']=='comment' else 'ignored',reason='没有匹配规则，需人工处理' if event['kind']=='comment' else '没有配置该事件规则');return result
    result['rule_id']=rule['id'];result['simulated']=rule.get('simulated',False)
    if not rule['reviewed']:
        result.update(status='manual',reason='规则尚未人工确认');return result
    if rule['expires_at'] and datetime.fromisoformat(rule['expires_at'].replace('Z','+00:00'))<=datetime.now(timezone.utc):
        result.update(status='manual',reason='规则已过期');return result
    from backend.speech.routes import optional
    history=optional(db,'interaction_history',session['id'],dict(id=session['id'],results=[]))
    last=next((r for r in reversed(history['results']) if r.get('rule_id')==rule['id'] and r['status']=='replied'),None)
    if last and (datetime.now(timezone.utc)-datetime.fromisoformat(last['created_at'])).total_seconds()<rule['cooldown_seconds']:
        result.update(status='cooldown',reason='冷却窗口内合并/抑制重复事件，本次不再次回复');return result
    words=blocks(db)['words']
    try:
        text=render_template(rule['template'],session,cfg['item_id'],event['viewer'],words,cfg['utc_offset_minutes'])
        if match_block(event['text'],words) or match_block(text,words):
            result.update(status='manual',reason='输入或回复命中屏蔽词，转人工');return result
        result.update(status='replied',text=text,reason='本地规则匹配',mode=rule['mode'],source=rule['source'],item_id=cfg['item_id'],session_version=session['version'])
        if rule['mode'] in ('speech','both'):
            q=snapshot(db,session['id'],[dict(text=text,role=rule['role'])],settings(db,session['id']),kind='interaction')
            q.update(interaction_version=cfg['version'],interaction_event_id=event['id'],interaction_expires_at=rule['expires_at']);put(db,'speech_queues',q);result['queue']=q
    except HTTPException as exc:
        result.update(status='manual',text='',queue=None,reason=str(exc.detail))
    return result


def record_result(db,sid,result):
    from backend.speech.routes import optional
    history=optional(db,'interaction_history',sid,dict(id=sid,results=[]))
    history['results']=(history['results']+[result])[-200:];put(db,'interaction_history',history)


def register_interaction(app,store):
    @app.get('/api/live/interaction/{sid}')
    def read(sid:str):
        from backend.speech.routes import optional
        with store.read() as db:
            get(db,'live_sessions',sid)
            return dict(config=read_config(db,sid),results=optional(db,'interaction_history',sid,dict(results=[]))['results'])

    @app.put('/api/live/interaction/{sid}')
    def save(sid:str,body:RulesInput):
        validate_rules(body)
        with store.transaction() as db:
            def run():
                session=get(db,'live_sessions',sid);old=read_config(db,sid)
                if old['version']!=body.expected_version:raise HTTPException(409,'规则已被其他页面修改，请重新读取。')
                if body.item_id and not any(i['id']==body.item_id for i in session['items']):raise HTTPException(422,'所选商品不属于当前货盘。')
                cfg=dict(id=sid,version=old['version']+1,enabled=body.enabled,takeover=body.takeover,item_id=body.item_id,timer_interval_seconds=body.timer_interval_seconds,timer_mode=body.timer_mode,utc_offset_minutes=body.utc_offset_minutes,rules=[r.model_dump() for r in body.rules],updated_at=now())
                if old['version']:put(db,'interaction_rule_versions',{**old,'id':sid+':'+str(old['version'])})
                return put(db,'interaction_rules',cfg)
            return once(db,'interaction-save:'+sid,body,run)

    @app.get('/api/live/interaction-samples')
    def samples():
        path=Path(__file__).resolve().parents[1]/'docs/live-knowledge/rules/模拟互动规则.md'
        text=path.read_text(encoding='utf-8-sig');match=re.search(r'```json\s*([\s\S]*?)```',text)
        try:
            data=json.loads(match.group(1));rules=[Rule.model_validate(r).model_dump() for r in data['rules']]
        except (ValueError,AttributeError,KeyError):raise HTTPException(422,'Markdown 样例数据格式错误，请检查规则文件。')
        for rule in rules:rule.update(reviewed=False,simulated=True)
        return dict(rules=rules,source='docs/live-knowledge/rules/模拟互动规则.md',sha256=hashlib.sha256(text.encode()).hexdigest())
