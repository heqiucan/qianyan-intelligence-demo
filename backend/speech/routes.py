"""Versioned scripts and immutable speech snapshots; playback stays in the client."""
import re
import unicodedata
from typing import Literal
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import Field
from backend.main import Idempotent, Input, get, put, all_records, once, now, uid
from backend.live_workspace import stale_items
from backend.speech.provider import SapiProvider


class Line(Input):
    text: str = Field(min_length=1, max_length=1000)
    role: Literal['host', 'assistant'] = 'host'


class Group(Idempotent):
    campaign_id: str
    id: str = ''
    expected_version: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=100)
    lines: list[Line] = Field(default_factory=list, max_length=100)
    deleted: bool = False


class Voice(Input):
    voice: str = Field(default='', max_length=160)
    rate: int = Field(default=0, ge=-10, le=10)
    volume: int = Field(default=100, ge=0, le=100)


class Settings(Idempotent):
    expected_version: int = Field(ge=0)
    expected_blocks_version: int = Field(ge=0)
    host: Voice
    assistant: Voice
    gap_ms: int = Field(default=500, ge=0, le=10000)
    blocked_words: list[str] = Field(default_factory=list, max_length=200)


class QueueInput(Idempotent):
    group_id: str
    expected_group_version: int
    item_id: str = ''


class Interrupt(Idempotent):
    text: str = Field(min_length=1, max_length=1000)
    role: Literal['host', 'assistant'] = 'host'


class Preview(Voice):
    text: str = Field(min_length=1, max_length=200)


class Event(Idempotent):
    queue_id: str
    action: Literal['start','pause','resume','stop','skip','ended','interrupt','error','blocked']
    detail: str = Field(default='', max_length=250)


def optional(db, collection, key, default):
    return next((r for r in all_records(db, collection) if r['id'] == key), default)


def settings(db, sid):
    return optional(db, 'speech_settings', sid, dict(id=sid, version=0, host=dict(voice='',rate=0,volume=100), assistant=dict(voice='',rate=0,volume=100), gap_ms=500))


def blocks(db):
    return optional(db, 'speech_blocks', 'global', dict(id='global', version=0, words=[]))


def match_block(text, words):
    normalized = unicodedata.normalize('NFKC', text).casefold()
    return next((word for word in words if unicodedata.normalize('NFKC', word).casefold() in normalized), '')


def split_text(text):
    # Do not split decimal prices at a dot; bound fragment size for CPU synthesis.
    if not any(c.isalnum() for c in text):
        raise HTTPException(422, '话术不能只有标点、空格或表情。')
    sentences = re.findall(r'[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+', text)
    return [sentence[i:i+180].strip() for sentence in sentences for i in range(0, len(sentence), 180) if sentence[i:i+180].strip()]


def ensure_session(db, sid):
    session = get(db, 'live_sessions', sid)
    if session['status'] != 'ready' or stale_items(db, session):
        raise HTTPException(409, '请先更新并核对本场货盘，再准备或播放语音。')
    return session


def blocked_ids(q, words):
    bad_lines={entry['line_index'] for entry in q['entries'] if entry['blocked'] or match_block(entry['text'],words)}
    return [entry['id'] for entry in q['entries'] if entry['line_index'] in bad_lines]


def check_queue(db, q):
    if q.get('kind')=='interaction':
        from backend.live_interaction import read_config
        from backend.live_workspace import read_workspace
        from datetime import datetime, timezone
        expires=q.get('interaction_expires_at')
        if expires and datetime.fromisoformat(expires.replace('Z','+00:00'))<=datetime.now(timezone.utc):raise HTTPException(409,'互动规则已过期，请转人工。')
        cfg=read_config(db,q['session_id']);runtime=read_workspace(db,q['session_id'])
        if not cfg['enabled'] or cfg['takeover'] or cfg['version']!=q.get('interaction_version') or runtime['status']!='running':
            raise HTTPException(409,'自动互动已关闭、规则已变化或模拟暂停，请勿继续旧互动队列。')
    session = ensure_session(db, q['session_id'])
    if session['version'] != q['session_version']:
        raise HTTPException(409, '货盘版本已变化，请停止旧队列，重新确认货盘并准备新队列。')


def save_log(db, sid, action, detail, queue_id=''):
    logs = optional(db, 'speech_logs', sid, dict(id=sid, entries=[]))
    logs['entries'] = (logs['entries'] + [dict(id=uid('speech-log'), action=action, detail=detail, queue_id=queue_id, created_at=now())])[-200:]
    put(db, 'speech_logs', logs)


def snapshot(db, sid, lines, cfg, group=None, kind='queue'):
    session = ensure_session(db, sid)
    words = blocks(db)['words']
    entries = []
    for line_index, line in enumerate(lines):
        voice = cfg[line['role']]
        if not voice['voice']:
            raise HTTPException(422, '请先为主播和助播选择并保存可用音色。')
        blocked = match_block(line['text'], words)
        for text in split_text(line['text']):
            entries.append(dict(id=uid('speech-clip'), line_index=line_index, text=text, role=line['role'], **voice, gap_ms=cfg['gap_ms'], blocked=bool(blocked)))
    if not entries:
        raise HTTPException(422, '请至少保存一条有效话术。')
    q=dict(id=uid('speech-queue'),session_id=sid,session_version=session['version'],group_id=group['id'] if group else '',group_version=group['version'] if group else 0,group_name=group['name'] if group else '临时插话',kind=kind,settings_version=cfg['version'],entries=entries,created_at=now())
    put(db,'speech_queues',q)
    save_log(db,sid,'prepare','已固定话术与音色版本；命中屏蔽词的内容不会合成。',q['id'])
    return q


def register_speech(app, store):
    provider = SapiProvider(store.directory)
    app.state.speech_provider = provider

    @app.get('/api/live/speech/voices')
    def voices():
        try:
            return dict(provider=provider.key, voices=provider.voices(), error='')
        except HTTPException as exc:
            return dict(provider=provider.key, voices=[], error=exc.detail)

    @app.get('/api/live/speech/audio/{audio_id}')
    def audio(audio_id: str):
        if not re.fullmatch(r'[0-9a-f]{64}', audio_id):
            raise HTTPException(404,'音频不存在')
        path = provider.directory / (audio_id + '.wav')
        if not path.is_file():
            raise HTTPException(404,'音频缓存不存在，请重新合成。')
        return FileResponse(path, media_type='audio/wav', filename=audio_id+'.wav')

    @app.get('/api/live/speech/{sid}/workspace')
    def workspace(sid: str):
        with store.read() as db:
            session = get(db,'live_sessions',sid)
            groups=[g for g in all_records(db,'speech_groups') if g['campaign_id']==session['campaign_id'] and not g.get('deleted')]
            queues=[q for q in all_records(db,'speech_queues') if q['session_id']==sid and q['kind']=='queue']
            return dict(groups=groups,settings=settings(db,sid),blocks=blocks(db),queue=queues[-1] if queues else None,logs=optional(db,'speech_logs',sid,dict(entries=[]))['entries'])

    @app.post('/api/live/speech/groups')
    def save_group(body: Group):
        with store.transaction() as db:
            def run():
                get(db,'campaigns',body.campaign_id)
                old=get(db,'speech_groups',body.id) if body.id else None
                if old and (old['campaign_id']!=body.campaign_id or old['version']!=body.expected_version or old.get('deleted')):
                    raise HTTPException(409,'话术组已变化，请刷新后重新编辑。')
                for line in body.lines:
                    split_text(line.text)
                g=dict(id=body.id or uid('script-group'),campaign_id=body.campaign_id,name=body.name,lines=[line.model_dump() for line in body.lines],version=(old['version'] if old else 0)+1,deleted=body.deleted,updated_at=now())
                if old:put(db,'speech_group_versions',dict(**{**old,'id':old['id']+':'+str(old['version'])},group_id=old['id']))
                return put(db,'speech_groups',g)
            return once(db,'speech-group',body,run)

    @app.put('/api/live/speech/{sid}/settings')
    def save_settings(sid: str, body: Settings):
        ids={v['id'] for v in provider.voices()}
        if any(v.voice not in ids for v in (body.host,body.assistant)):
            raise HTTPException(422,'请选择当前系统可用的主播和助播音色。')
        words=list(dict.fromkeys(w.strip() for w in body.blocked_words if w.strip()))
        if any(len(w)>80 for w in words):raise HTTPException(422,'单个屏蔽词不能超过 80 字。')
        with store.transaction() as db:
            def run():
                get(db,'live_sessions',sid);old=settings(db,sid);b=blocks(db)
                if body.expected_version!=old['version'] or body.expected_blocks_version!=b['version']:
                    raise HTTPException(409,'播报设置或全局屏蔽词已变化，请刷新后重试。')
                cfg=dict(id=sid,version=old['version']+1,host=body.host.model_dump(),assistant=body.assistant.model_dump(),gap_ms=body.gap_ms)
                put(db,'speech_settings',cfg);put(db,'speech_blocks',dict(id='global',version=b['version']+1,words=words))
                save_log(db,sid,'settings','已保存播报设置和全局屏蔽词；已有队列音色快照保持不变。')
                return cfg
            return once(db,'speech-settings:'+sid,body,run)

    @app.post('/api/live/speech/{sid}/queue')
    def prepare(sid: str, body: QueueInput):
        with store.transaction() as db:
            def run():
                session=get(db,'live_sessions',sid);g=get(db,'speech_groups',body.group_id)
                if g['campaign_id']!=session['campaign_id'] or g['version']!=body.expected_group_version or g.get('deleted'):
                    raise HTTPException(409,'话术组已变化或不属于当前活动，请重新选择。')
                from backend.live_interaction import render_template
                lines=[{**line,'text':render_template(line['text'],session,body.item_id,blocked_words=blocks(db)['words'])} for line in g['lines']]
                q=snapshot(db,sid,lines,settings(db,sid),g);q['item_id']=body.item_id;put(db,'speech_queues',q);return q
            return once(db,'speech-queue:'+sid,body,run)

    @app.post('/api/live/speech/{sid}/interrupt')
    def interrupt(sid: str, body: Interrupt):
        with store.transaction() as db:
            return once(db,'speech-interrupt:'+sid,body,lambda:snapshot(db,sid,[dict(text=body.text,role=body.role)],settings(db,sid),kind='interrupt'))

    @app.post('/api/live/speech/{sid}/preview')
    def preview(sid: str, body: Preview):
        with store.read() as db:
            get(db,'live_sessions',sid)
            if match_block(body.text,blocks(db)['words']):raise HTTPException(422,'试听文字命中全局屏蔽词，请修改后重试。')
        split_text(body.text)
        return provider.synthesize(body.text,body.voice,body.rate,body.volume)

    @app.get('/api/live/speech/queues/{qid}/check')
    def check(qid: str):
        with store.read() as db:
            q=get(db,'speech_queues',qid);check_queue(db,q)
            words=blocks(db)['words']
            return dict(blocked=blocked_ids(q, words))

    @app.post('/api/live/speech/queues/{qid}/clips/{clip_id}')
    def clip(qid: str, clip_id: str):
        with store.read() as db:
            q=get(db,'speech_queues',qid);check_queue(db,q)
            entry=next((e for e in q['entries'] if e['id']==clip_id),None)
            if not entry:raise HTTPException(404,'队列片段不存在')
            blocked=entry['id'] in blocked_ids(q,blocks(db)['words'])
        if blocked:
            with store.transaction() as db:save_log(db,q['session_id'],'blocked','跳过命中全局屏蔽词的话术。',qid)
            return dict(blocked=True)
        result=provider.synthesize(entry['text'],entry['voice'],entry['rate'],entry['volume'])
        # Recheck after slow synthesis; never return a now-stale clip for playback.
        with store.read() as db:
            check_queue(db,q)
            if entry['id'] in blocked_ids(q,blocks(db)['words']):return dict(blocked=True)
        return result

    @app.post('/api/live/speech/{sid}/events')
    def event(sid: str, body: Event):
        with store.transaction() as db:
            def run():
                q=get(db,'speech_queues',body.queue_id)
                if q['session_id']!=sid:raise HTTPException(409,'播报记录不属于当前场次。')
                save_log(db,sid,body.action,'客户端播放记录：'+body.detail,body.queue_id)
                return dict(ok=True)
            return once(db,'speech-events:'+sid,body,run)
