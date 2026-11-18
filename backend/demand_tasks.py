"""Local demand processing with immutable inputs and durable row checkpoints.

Demand rows describe questions, never people or institutional facts. All labels
are transparent rules awaiting human review. Semantic ranking is optional and
runs outside SQLite; a preview freezes the exact candidate list for execution.
"""
from __future__ import annotations

from copy import deepcopy
import csv
from datetime import datetime, timezone
import hashlib
from io import StringIO
import json
import logging
from threading import Event, Thread
from typing import Literal
import unicodedata

from fastapi import HTTPException, Query
from fastapi.responses import Response
from pydantic import Field

from backend.knowledge import Operation, get, put, records, stamp, identifier
from backend.knowledge_embeddings import rank_semantic
from backend.demand_schemas import (TaskConfig, PreviewInput, CreateDemandTask,
    TaskControl, ReviewResults, UndoReview, HandoffDemand, ResultSelection)

ACTIVE = {'queued', 'running'}
EDITABLE = {'waiting_review', 'waiting_input', 'completed'}
logger = logging.getLogger(__name__)


class ToPackInput(Operation):
    name: str = Field(min_length=1, max_length=100)
    selected: list[ResultSelection] = Field(min_length=1, max_length=2000)
    role: Literal['theme', 'intent', 'exclude'] = 'theme'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value)).casefold().split())


def capture_snapshot(db, config: TaskConfig):
    """Validate mutable references under lock; the caller ranks after release."""
    from backend.demand_assets import lookup_template, lookup_pack
    space = get(db, 'kb_spaces', config.space_id)
    if space['scene'] == 'medical' and config.channel != 'internal':
        raise HTTPException(422, '医美需求整理目前仅支持内部参考渠道。')
    batch = get(db, 'demand_batches', config.batch_id)
    if batch['space_id'] != config.space_id:
        raise HTTPException(422, '素材批次不属于当前空间。')
    snapshot = {'batch': batch}
    for key, lookup in (('template', lookup_template), ('pack', lookup_pack)):
        ref_id, version = getattr(config, key + '_id'), getattr(config, key + '_version')
        if ref_id:
            item = lookup(db, ref_id, config.space_id)
            if version != item['version']:
                raise HTTPException(409, '模板或词包版本已变化，请重新选择并预览。')
            snapshot[key] = item
        elif version is not None:
            raise HTTPException(422, '版本必须同时指定对应的模板或词包。')
    return snapshot


def classify(text):
    """Explicit, conservative rule hints, not inferred identity or intention."""
    value = normalized(text)
    flags = []
    if any(w in value for w in ('不想', '不需要', '不考虑', '不打算', '不做', '不要', '没兴趣', '不买')):
        flags.append('含否定表达，需人工核实')
    if any(w in value for w in ('同行', '代理', '招商', '培训', '招聘', '合作', '供应商')):
        flags.append('含同行、合作或培训等交流词，具体语境需人工核实')
    if any(w in value for w in ('做过', '买过', '体验过', '分享', '经验', '去年做', '以前做')):
        flags.append('含经历或分享表述，不推断当前意向，需人工核实')
    categories = [('价格咨询', ('多少钱', '价格', '费用', '预算', '收费')),
                  ('预约流程', ('预约', '怎么约', '到店', '地址', '营业时间')),
                  ('风险与恢复问题', ('恢复', '风险', '副作用', '疼', '痛', '安全')),
                  ('适用条件咨询', ('适合', '能做', '可以做', '禁忌', '条件'))]
    category = next((name for name, words in categories if any(word in value for word in words)), '待人工分类')
    return category, flags


def _date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).date()
    except (ValueError, TypeError):
        return None


def _instant(value):
    """Comparable UTC instants; date-only and naive imports mean UTC midnight."""
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def collect_candidates(snapshot, config: TaskConfig):
    """Pure bounded filtering except the optional offline encoder; no DB access."""
    filters = config.filters
    rows = snapshot['batch']['rows']
    theme = [(w, normalized(w)) for w in filters.theme_terms]
    intent = [(w, normalized(w)) for w in filters.intent_terms]
    excludes = [(w, normalized(w)) for w in filters.exclude_terms]
    accepted, exclusions, warnings = [], [], []
    eligible = []
    for row in rows:
        text = normalized(row.get('text', row['original']))
        hit_excludes = [word for word, match in excludes if match in text]
        day = _date(row.get('occurred_at'))
        reason = None
        if not text:
            reason = '空白内容'
        elif hit_excludes:
            reason = '排除词：' + '、'.join(hit_excludes)
        elif day is None and filters.missing_time == 'exclude':
            reason = '缺少有效时间，按设置排除'
        elif day and ((filters.date_from and day < filters.date_from) or (filters.date_to and day > filters.date_to)):
            reason = '不在所选日期范围'
        elif intent and not any(match in text for _, match in intent):
            reason = '未命中意图词'
        if reason:
            exclusions.append({'id': row['id'], 'original': row['original'], 'source': deepcopy(row.get('source', {})), 'reason': reason})
            continue
        eligible.append(row)
    retrieval = {'status': 'keyword', 'message': '按关键词和确定规则筛选；分类结果需人工确认。'}
    semantic_scores = {}
    if filters.semantic:
        if filters.match_mode == 'all':
            warnings.append('全部主题词模式不放宽硬性条件，未启用语义补充。')
        elif not theme:
            warnings.append('未设置主题词，未启用语义补充。')
        else:
            retrieval = rank_semantic(' '.join(filters.theme_terms), [
                {'id': row['id'], 'text': row.get('text', row['original'])} for row in eligible])
            semantic_scores = retrieval.get('scores', {})
            retrieval = {k: v for k, v in retrieval.items() if k != 'scores'}
            if retrieval.get('status') != 'ready':
                warnings.append(retrieval.get('message', '语义检索不可用，已使用关键词筛选。'))
    seen, duplicates = {}, 0
    for row in eligible:
        text = normalized(row.get('text', row['original']))
        hit_theme = [word for word, match in theme if match in text]
        literal = not theme or (len(hit_theme) == len(theme) if filters.match_mode == 'all' else bool(hit_theme))
        semantic = not literal and row['id'] in semantic_scores
        if not literal and not semantic:
            exclusions.append({'id': row['id'], 'original': row['original'], 'source': deepcopy(row.get('source', {})), 'reason': '未满足主题词条件'})
            continue
        if filters.dedupe and text in seen:
            duplicates += 1
            seen[text]['duplicate_sources'].append(deepcopy(row.get('source', {})))
            exclusions.append({'id': row['id'], 'original': row['original'], 'source': deepcopy(row.get('source', {})), 'reason': '规范词条完全一致，来源已合并；原文保留在素材批次', 'duplicate': True})
            continue
        category, flags = classify(row['original'])
        if _date(row.get('occurred_at')) is None and filters.missing_time == 'review':
            flags.append('缺少有效时间，保留待核实')
        reasons = ['规则初筛，尚未确认需求']
        if hit_theme:
            reasons.append('主题词：' + '、'.join(hit_theme))
        if intent:
            reasons.append('意图词：' + '、'.join(word for word, match in intent if match in text))
        if semantic:
            reasons.append('本地向量语义补充；相似度仅供参考，不代表购买意愿')
        if not theme:
            reasons.append('未限制主题词')
        candidate = {**deepcopy(row), 'normalized': text, 'category': category,
                     'flags': flags, 'reasons': reasons, 'duplicate_sources': [],
                     'semantic_score': semantic_scores.get(row['id']) if semantic else None}
        accepted.append(candidate)
        seen[text] = candidate
    if filters.sort != 'source':
        # Missing timestamps are always last, regardless of direction.
        timed = [item for item in accepted if _date(item.get('occurred_at'))]
        missing = [item for item in accepted if not _date(item.get('occurred_at'))]
        timed.sort(key=lambda item: (_instant(item['occurred_at']), item['id']), reverse=filters.sort == 'newest')
        accepted = timed + missing
    matched, limited = len(accepted), max(0, len(accepted) - filters.limit)
    candidates = accepted[:filters.limit]
    counts = {'input': len(rows), 'matched': matched,
              'excluded': len(exclusions) - duplicates, 'duplicates': duplicates, 'limited': limited}
    value = {'config': config.model_dump(mode='json'), 'snapshot': snapshot,
             'candidates': candidates, 'counts': counts}
    return {'signature': digest(value), 'counts': counts, 'sample': candidates[:20],
            'exclusions': exclusions, 'warnings': warnings, 'retrieval': retrieval,
            'candidates': candidates}


def add_event(run, action, detail):
    run.setdefault('events', []).append({'id': identifier('dstep'), 'action': action,
                                       'detail': detail, 'at': stamp()})
    run['updated_at'] = stamp()


def results_for(db, run):
    return [json.loads(r[0]) for r in db.execute("""SELECT data FROM records
        WHERE collection='demand_results' AND json_extract(data, '$.task_id')=?
        AND json_extract(data, '$.space_id')=? ORDER BY rowid""", (run['id'], run['space_id']))]


def refresh_counts(db, run):
    rows = results_for(db, run)
    run['counts'].update(processed=len(rows), pending=sum(r['status'] == 'pending' for r in rows),
        confirmed=sum(r['status'] == 'confirmed' for r in rows),
        excluded_manual=sum(r['status'] == 'excluded' for r in rows),
        transferred=sum(bool(r.get('downstream_task_ids')) for r in rows))


def missing_content(db, run):
    return any(r['status'] == 'confirmed' and r.get('evidence_missing') for r in results_for(db, run))


def upstream_warnings(db, run, visited=None):
    visited = set(visited or ())
    if run['id'] in visited:
        return ['上游任务关联异常，请重新建立任务。']
    visited.add(run['id'])
    warnings = []
    for snapshot in run.get('upstream', []):
        try:
            current = get(db, 'demand_results', snapshot['id'])
            if current['revision'] != snapshot['revision'] or current['status'] != 'confirmed':
                warnings.append('上游需求已修改或撤回确认：' + snapshot['id'] + '；当前任务保留原始快照，请重新交接。')
        except HTTPException:
            warnings.append('上游需求不存在：' + snapshot['id'])
    batch = run.get('config_snapshot', {}).get('batch', {})
    checked_documents = set()
    for source in (row.get('source', {}) for row in batch.get('rows', [])):
        doc_id = source.get('document_id')
        reference = (doc_id, source.get('version'))
        if not doc_id or reference in checked_documents:
            continue
        checked_documents.add(reference)
        try:
            doc = get(db, 'kb_documents', doc_id)
            if doc['version'] != source.get('version'):
                warnings.append('来源资料已有新版本；此任务继续保留导入时的原文。')
        except HTTPException:
            warnings.append('来源资料已移除；此任务保留导入时的原文。')
    if run.get('parent_task_id'):
        try:
            warnings.extend(upstream_warnings(db, get(db, 'demand_runs', run['parent_task_id']), visited))
        except HTTPException:
            warnings.append('上游任务不存在。')
    return list(dict.fromkeys(warnings))


def run_view(db, run, summary=False, offset=0, limit=None):
    omitted = {'candidates'} | ({'config_snapshot', 'results'} if summary else set())
    view = {key: deepcopy(value) for key, value in run.items() if key not in omitted}
    if not summary:
        rows = results_for(db, run)
        view['results'] = rows[offset:offset + limit] if limit is not None else rows[offset:]
        if limit is not None or offset:
            view['result_page'] = {'offset': offset, 'limit': limit, 'total': len(rows)}
    view['upstream_warnings'] = upstream_warnings(db, run)
    return view


def new_run(config, snapshot, preview, **extra):
    run = {'id': identifier('demand'), 'space_id': config.space_id, 'name': config.name,
           'goal': config.goal, 'task_type': config.task_type, 'channel': config.channel,
           'revision': 1, 'status': 'queued', 'stage': '等待处理', 'attempt': 1,
           'config': config.model_dump(mode='json'), 'config_snapshot': deepcopy(snapshot),
           'candidates': deepcopy(preview['candidates']), 'counts': {**preview['counts'],
               'processed': 0, 'pending': 0, 'confirmed': 0, 'excluded_manual': 0, 'transferred': 0},
           'warnings': deepcopy(preview['warnings']), 'retrieval': preview['retrieval'],
           'upstream': [], 'events': [], 'created_at': stamp(), 'updated_at': stamp(), **extra}
    add_event(run, 'queued', '已保存任务配置、素材与预览候选快照。')
    return run


def create_result(run, candidate):
    result = {**deepcopy(candidate), 'id': 'dresult-' + digest([run['id'], candidate['id']])[:24],
        'source_row_id': candidate['id'], 'task_id': run['id'], 'space_id': run['space_id'],
        'revision': 1, 'status': 'pending', 'group': candidate.get('group', ''), 'created_at': stamp(), 'updated_at': stamp()}
    if run['task_type'] in {'topics', 'faq'}:
        category = result['category']
        required = {'价格咨询': ['已审核的项目价格、收费范围与适用条件'],
                    '预约流程': ['已审核的预约流程、联系方式及营业安排'],
                    '风险与恢复问题': ['已审核的风险说明和专业咨询边界'],
                    '适用条件咨询': ['已审核的适用条件与专业评估要求']}.get(category, ['与原文问题相关的已审核机构事实'])
        members = result.get('members', [result])
        result['topic'] = {'title': '待核实问题：' + (result.get('group') or result.get('text', result['original']))[:100],
                           'format': '内部 FAQ' if run['task_type'] == 'faq' else '内容选题',
                           'questions': [member.get('text', member['original']) for member in members],
                           'audience': '关注这些问题的读者；实际受众需人工核对',
                           'angle': '围绕原文问题核对范围、条件与证据，避免推断个人意向',
                           'outline': ['原文问题与不同关注点', '可引用的已审核事实', '证据缺口与待补问题'],
                           'needed_evidence': required, 'missing': required,
                           'method': '根据原文整理的问题标题，未生成事实或答案'}
    return result


class DemandRunner:
    def __init__(self, store):
        self.store = store
        self.stop_event, self.wake_event = Event(), Event()
        self.thread = None

    def start(self):
        self.stop_event.clear()
        with self.store.transaction() as db:
            for run in records(db, 'demand_runs'):
                if run['status'] in ACTIVE:
                    run.update(status='interrupted', stage='服务曾中断，已保存进度，请手动继续', revision=run['revision'] + 1)
                    add_event(run, 'interrupted', '不会自动重跑；继续时从已保存的下一条开始。')
                    put(db, 'demand_runs', run)
        self.thread = Thread(target=self.loop, name='demand-worker', daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.wake_event.set()
        if self.thread:
            self.thread.join(timeout=2)

    def notify(self):
        self.wake_event.set()

    def loop(self):
        while not self.stop_event.is_set():
            self.wake_event.wait(1)
            self.wake_event.clear()
            while not self.stop_event.is_set():
                with self.store.transaction() as db:
                    run = next((r for r in records(db, 'demand_runs') if r['status'] == 'queued'), None)
                    if run:
                        run.update(status='running', stage='逐条整理与标注', revision=run['revision'] + 1)
                        add_event(run, 'start', '开始处理已预览的候选原文。')
                        put(db, 'demand_runs', run)
                if not run:
                    break
                self.execute(run['id'], run['attempt'])

    def process_candidate(self, run, candidate):
        """Separate from persistence to permit bounded work without DB lock."""
        return create_result(run, candidate)

    def execute(self, task_id, attempt):
        try:
            with self.store.transaction() as db:
                snapshot = get(db, 'demand_runs', task_id)
                done = {r['source_row_id'] for r in results_for(db, snapshot)}
            for candidate in snapshot['candidates']:
                if candidate['id'] in done:
                    continue
                if self.stop_event.is_set():
                    return
                # Check control before and after work. attempt fences late writes.
                with self.store.transaction() as db:
                    current = get(db, 'demand_runs', task_id)
                    if current['status'] != 'running' or current['attempt'] != attempt:
                        return
                result = self.process_candidate(snapshot, candidate)
                with self.store.transaction() as db:
                    current = get(db, 'demand_runs', task_id)
                    if self.stop_event.is_set() or current['status'] != 'running' or current['attempt'] != attempt:
                        return
                    put(db, 'demand_results', result)
                    # Row and counters commit together. No quadratic full scan
                    # for each checkpoint in a 2,000-row spreadsheet.
                    current['counts']['processed'] += 1
                    current['counts']['pending'] += 1
                    current['updated_at'] = stamp()
                    put(db, 'demand_runs', current)
            with self.store.transaction() as db:
                current = get(db, 'demand_runs', task_id)
                if self.stop_event.is_set() or current['status'] != 'running' or current['attempt'] != attempt:
                    return
                current.update(status='waiting_review', stage='整理完成，等待人工确认', revision=current['revision'] + 1)
                refresh_counts(db, current)
                add_event(current, 'waiting_review', f"已实际处理 {current['counts']['processed']} 条；尚未自动确认需求。")
                put(db, 'demand_runs', current)
        except Exception:
            logger.exception('Demand task failed: %s', task_id)
            with self.store.transaction() as db:
                current = get(db, 'demand_runs', task_id)
                if current['status'] == 'running' and current['attempt'] == attempt:
                    current.update(status='failed', stage='处理失败，已保留完成的记录；可重试剩余部分', revision=current['revision'] + 1)
                    add_event(current, 'failed', '当前批次处理失败，已保存原文、配置与逐条检查点。')
                    put(db, 'demand_runs', current)


def ensure_editable(run):
    if run['status'] not in EDITABLE:
        raise HTTPException(409, '请等待任务整理完毕后再审核或交接结果。')


def source_snapshot(row):
    return {key: deepcopy(row[key]) for key in ('id', 'revision', 'original', 'raw_original', 'text',
        'source', 'category', 'group', 'duplicate_sources', 'members') if key in row}


def handoff_candidates(selected):
    """Combine only explicit human topic groups, retaining every source identity."""
    candidates, groups = [], {}
    for row in selected:
        group = row.get('group', '').strip()
        member = source_snapshot(row)
        if group and group in groups:
            candidate = groups[group]
            candidate['members'].append(member)
            candidate['flags'] = list(dict.fromkeys(candidate['flags'] + row.get('flags', [])))
            if candidate['category'] != row['category']:
                candidate['category'] = '主题组合（人工分组）'
            candidate['source_record_count'] += 1
            continue
        candidate = {key: deepcopy(row[key]) for key in ('id', 'original', 'raw_original', 'text', 'normalized',
            'source', 'category', 'reasons', 'flags', 'duplicate_sources', 'occurred_at') if key in row}
        candidate.update(group=group, members=[member], source_record_count=1)
        if group:
            candidate.update(id='group-' + digest(group)[:24], original=group, text=group, normalized=normalized(group))
            candidate.pop('raw_original', None)
            candidate['reasons'] = ['人工确认的主题分组；各条原文与来源独立保存，不合并人员身份']
            groups[group] = candidate
        candidates.append(candidate)
    return candidates


def safe_csv_cell(value):
    text = '' if value is None else str(value)
    # Excel and other spreadsheet consumers can treat even quoted cells as
    # formulas. Preserve the text and prepend the literal-text marker.
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r')) else text


def export_results(run, rows):
    output = StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(['任务ID', '结果ID', '原文', '规范词条', '状态', '分类', '主题组', '结果版本',
                     '文件', '工作表', '页码', '行号', '列', '原始编号', '资料ID', '资料版本', '完整来源', '组内原文与来源'])
    for row in rows:
        source = row.get('source', {})
        values = [run['id'], row['id'], row['original'], row.get('text', row.get('normalized', '')),
            row['status'], row['category'], row.get('group', ''), row['revision'], source.get('filename'),
            source.get('sheet'), source.get('page'), source.get('row'), source.get('column'), source.get('ordinal'),
            source.get('document_id'), source.get('version'), json.dumps(source, ensure_ascii=False),
            json.dumps(row.get('members', []), ensure_ascii=False)]
        writer.writerow([safe_csv_cell(value) for value in values])
    return '\ufeff' + output.getvalue()


def register_demand_tasks(app, store, runner):
    from backend.main import once, cached_request

    @app.post('/api/demand/preview')
    def preview(body: PreviewInput):
        with store.read() as db:
            snapshot = capture_snapshot(db, body.config)
        result = collect_candidates(snapshot, body.config)
        return {k: v for k, v in result.items() if k != 'candidates'}

    @app.post('/api/demand/tasks', status_code=202)
    def create(body: CreateDemandTask):
        scope = 'demand:create'
        with store.read() as db:
            cached = cached_request(db, scope, body)
            if cached is not None:
                return run_view(db, get(db, 'demand_runs', cached['id']))
            snapshot = capture_snapshot(db, body.config)
        preview = collect_candidates(snapshot, body.config)
        if preview['signature'] != body.preview_signature:
            raise HTTPException(409, '筛选配置、素材或匹配结果已变化，请重新预览后启动。')
        with store.transaction() as db:
            if capture_snapshot(db, body.config) != snapshot:
                raise HTTPException(409, '资料已更新，请重新预览。')
            result = once(db, scope, body, lambda: put(db, 'demand_runs', new_run(body.config, snapshot, preview)))
            output = run_view(db, result)
        runner.notify()
        return output

    @app.get('/api/demand/tasks')
    def list_tasks(space_id: str, offset: int = Query(0, ge=0), limit: int | None = Query(None, ge=1, le=500)):
        with store.read() as db:
            get(db, 'kb_spaces', space_id)
            query = """SELECT data FROM records WHERE collection='demand_runs'
                       AND json_extract(data, '$.space_id')=? ORDER BY rowid DESC LIMIT ? OFFSET ?"""
            return [run_view(db, json.loads(row[0]), summary=True)
                    for row in db.execute(query, (space_id, limit if limit is not None else -1, offset))]

    @app.get('/api/demand/tasks/{task_id}')
    def detail(task_id: str, summary: bool = False, offset: int = Query(0, ge=0), limit: int | None = Query(None, ge=1, le=2000)):
        with store.read() as db:
            return run_view(db, get(db, 'demand_runs', task_id), summary=summary, offset=offset, limit=limit)

    @app.get('/api/demand/tasks/{task_id}/reviews')
    def reviews(task_id: str):
        with store.read() as db:
            run = get(db, 'demand_runs', task_id)
            return [json.loads(row[0]) for row in db.execute("""SELECT data FROM records
                WHERE collection='demand_reviews' AND json_extract(data, '$.task_id')=?
                AND json_extract(data, '$.space_id')=? ORDER BY rowid DESC""", (task_id, run['space_id']))]

    @app.get('/api/demand/tasks/{task_id}/export')
    def export(task_id: str, format: str = 'csv'):
        if format != 'csv':
            raise HTTPException(422, '目前支持 CSV 导出，请使用 format=csv。')
        with store.read() as db:
            run = get(db, 'demand_runs', task_id)
            content = export_results(run, results_for(db, run))
        return Response(content=content, media_type='text/csv; charset=utf-8', headers={
            'Content-Disposition': f'attachment; filename="{task_id}.csv"'})

    @app.post('/api/demand/tasks/{task_id}/to-pack')
    def to_pack(task_id: str, body: ToPackInput):
        from backend.demand_assets import PackInput, normalize, save_pack
        with store.transaction() as db:
            def apply():
                run = get(db, 'demand_runs', task_id)
                ensure_editable(run)
                selections = {item.id: item.revision for item in body.selected}
                if len(selections) > 30:
                    raise HTTPException(422, '每个词包每类最多 30 条，请分批选择并拆成多个词包；全部原文仍保留在素材和任务结果中。')
                if upstream_warnings(db, run):
                    raise HTTPException(409, '上游资料或需求已变化，请从最新版本重新确认后创建词包。')
                by_id = {row['id']: row for row in results_for(db, run)}
                selected = []
                for key, revision in selections.items():
                    row = by_id.get(key)
                    if not row or row['status'] != 'confirmed' or row['revision'] != revision:
                        raise HTTPException(409, '只能从当前任务已确认且版本未变化的记录创建词包；本次未部分保存。')
                    if len(row.get('text', row['original']).strip()) > 60:
                        raise HTTPException(422, '选中原文超过单个关键词 60 字限制，请保留原文并另行整理短词条；不会自动截断。')
                    selected.append(row)
                pack = save_pack(db, PackInput(space_id=run['space_id'], name=body.name,
                    source_batch_id=run['config']['batch_id'], **{body.role + '_terms': [row.get('text', row['original']) for row in selected]}))
                for entry in pack['entries']:
                    matches = [row for row in selected if normalize(row.get('text', row['original'])) == entry['normalized']]
                    entry.update(status='confirmed', tags=list(dict.fromkeys(
                        value for row in matches for value in (row.get('category'), row.get('group')) if value))[:8],
                        sources=[{**deepcopy(row.get('source', {})), 'task_id': task_id, 'result_id': row['id'],
                            'result_revision': row['revision'], 'original': row['original'],
                            'duplicate_sources': deepcopy(row.get('duplicate_sources', [])),
                            'members': deepcopy(row.get('members', []))} for row in matches])
                pack.update(source_task_id=task_id, selected_results=[source_snapshot(row) for row in selected])
                put(db, 'demand_packs', pack)
                add_event(run, 'to_pack', f'已将 {len(selected)} 条确认结果保存为词包：{pack["name"]}。')
                run['revision'] += 1
                put(db, 'demand_runs', run)
                return pack
            return once(db, 'demand:to-pack:' + task_id, body, apply)

    @app.post('/api/demand/tasks/{task_id}/control')
    def control(task_id: str, body: TaskControl):
        with store.transaction() as db:
            def apply():
                run = get(db, 'demand_runs', task_id)
                if run['revision'] != body.expected_revision:
                    raise HTTPException(409, '任务状态已更新，请刷新后重试。')
                old = run['status']
                if body.action == 'pause' and old in ACTIVE:
                    run.update(status='paused', stage='已暂停，保留已处理结果')
                elif body.action == 'resume' and old in {'paused', 'failed', 'interrupted'}:
                    run.update(status='queued', stage='等待继续剩余记录', attempt=run['attempt'] + 1)
                elif body.action == 'cancel' and old not in {'completed', 'cancelled'}:
                    run.update(status='cancelled', stage='已取消，保留已有记录供查看')
                elif body.action == 'complete' and old in {'waiting_review', 'waiting_input'}:
                    refresh_counts(db, run)
                    if run['counts']['pending']:
                        raise HTTPException(409, '仍有待确认记录，请先确认或排除。')
                    if missing_content(db, run):
                        raise HTTPException(409, '已确认内容仍缺少事实依据，请补充审核资料并重新生成，或排除该条需求。')
                    if upstream_warnings(db, run):
                        raise HTTPException(409, '上游需求已有变化，请重新交接后完成。')
                    run.update(status='completed', stage='已完成人工审核')
                else:
                    raise HTTPException(409, '当前任务状态不支持该操作。')
                run['revision'] += 1
                add_event(run, body.action, run['stage'])
                put(db, 'demand_runs', run)
                return run_view(db, run)
            result = once(db, 'demand:control:' + task_id, body, apply)
        runner.notify()
        return result

    @app.post('/api/demand/tasks/{task_id}/review')
    def review(task_id: str, body: ReviewResults):
        with store.transaction() as db:
            def apply():
                run = get(db, 'demand_runs', task_id)
                ensure_editable(run)
                if body.action == 'classify' and not body.category:
                    raise HTTPException(422, '请填写分类名称。')
                if body.action == 'group' and not body.group:
                    raise HTTPException(422, '请填写选题分组名称；此操作不会合并客户身份。')
                by_id = {row['id']: row for row in results_for(db, run)}
                applied, skipped, conflicts, changes, seen = [], [], [], [], set()
                for selection in body.selected:
                    key = selection.id
                    if key in seen:
                        skipped.append({'id': key, 'reason': '同一批次重复选择'})
                        continue
                    seen.add(key)
                    row = by_id.get(key)
                    if not row or row['revision'] != selection.revision:
                        conflicts.append({'id': key, 'reason': '记录不在当前任务或版本已变化'})
                        continue
                    updates = {'confirm': {'status': 'confirmed'}, 'exclude': {'status': 'excluded'},
                               'classify': {'category': body.category}, 'group': {'group': body.group}}[body.action]
                    if all(row.get(k) == v for k, v in updates.items()):
                        skipped.append({'id': key, 'reason': '已经是目标状态'})
                        continue
                    before = {k: row.get(k, '') for k in ('status', 'category', 'group')}
                    row.update(**updates, revision=row['revision'] + 1, updated_at=stamp())
                    put(db, 'demand_results', row)
                    changes.append({'id': key, 'before': before, 'after_revision': row['revision'],
                                    'after': {k: row[k] for k in before}})
                    applied.append(key)
                operation = {'id': identifier('review'), 'task_id': task_id, 'space_id': run['space_id'],
                             'action': body.action, 'reason': body.reason, 'changes': changes, 'created_at': stamp()}
                put(db, 'demand_reviews', operation)
                if applied:
                    run.update(revision=run['revision'] + 1, status='waiting_input' if missing_content(db, run) else 'waiting_review', stage='审核结果已更新')
                    refresh_counts(db, run)
                    add_event(run, 'review', f'{body.action}：成功 {len(applied)} 条，冲突 {len(conflicts)} 条。')
                    put(db, 'demand_runs', run)
                return {'operation_id': operation['id'], 'applied': applied, 'skipped': skipped,
                        'conflicts': conflicts, 'task': run_view(db, run)}
            return once(db, 'demand:review:' + task_id, body, apply)

    @app.post('/api/demand/tasks/{task_id}/undo')
    def undo(task_id: str, body: UndoReview):
        with store.transaction() as db:
            def apply():
                run = get(db, 'demand_runs', task_id)
                ensure_editable(run)
                operation = get(db, 'demand_reviews', body.operation_id)
                if operation['task_id'] != task_id or operation['space_id'] != run['space_id']:
                    raise HTTPException(422, '该操作不属于当前任务。')
                applied, conflicts, changes = [], [], []
                for change in operation['changes']:
                    row = get(db, 'demand_results', change['id'])
                    if row['revision'] != change['after_revision']:
                        conflicts.append({'id': row['id'], 'reason': '此记录在该操作之后已有变更，未覆盖'})
                        continue
                    before = {k: row[k] for k in ('status', 'category', 'group')}
                    row.update(**change['before'], revision=row['revision'] + 1, updated_at=stamp())
                    put(db, 'demand_results', row)
                    applied.append(row['id'])
                    changes.append({'id': row['id'], 'before': before, 'after_revision': row['revision'], 'after': change['before']})
                undo_operation = {'id': identifier('review'), 'task_id': task_id, 'space_id': run['space_id'],
                    'action': 'undo', 'undo_of': operation['id'], 'changes': changes, 'created_at': stamp()}
                put(db, 'demand_reviews', undo_operation)
                if applied:
                    run.update(revision=run['revision'] + 1, status='waiting_input' if missing_content(db, run) else 'waiting_review', stage='已撤销可恢复的审核操作')
                    refresh_counts(db, run)
                    add_event(run, 'undo', f'恢复 {len(applied)} 条；保留下游任务和引用关联。')
                    put(db, 'demand_runs', run)
                return {'operation_id': undo_operation['id'], 'applied': applied, 'skipped': [],
                        'conflicts': conflicts, 'task': run_view(db, run)}
            return once(db, 'demand:undo:' + task_id, body, apply)

    @app.post('/api/demand/tasks/{task_id}/handoff', status_code=202)
    def handoff(task_id: str, body: HandoffDemand):
        with store.transaction() as db:
            def apply():
                parent = get(db, 'demand_runs', task_id)
                ensure_editable(parent)
                if upstream_warnings(db, parent):
                    raise HTTPException(409, '上游需求已有变化，请先从最新确认版本重新交接。')
                by_id = {row['id']: row for row in results_for(db, parent)}
                selected = []
                for item in body.selected:
                    row = by_id.get(item.id)
                    if not row or row['status'] != 'confirmed' or row['revision'] != item.revision:
                        raise HTTPException(409, '交接只允许当前任务已确认且版本未变化的记录；本次未部分交接。')
                    if row['id'] not in {r['id'] for r in selected}:
                        selected.append(row)
                key = digest({'task': task_id, 'selected': sorted((r['id'], r['revision']) for r in selected),
                              'kind': body.task_type, 'note': body.note, 'handoff_version': 2})
                if not body.new_version:
                    previous = next((r for r in records(db, 'demand_runs') if r.get('handoff_signature') == key), None)
                    if previous:
                        return run_view(db, previous)
                config = TaskConfig.model_validate({**parent['config'], 'task_type': body.task_type,
                    'name': ('内部 FAQ · ' if body.task_type == 'faq' else '内容选题 · ') + parent['name'][:80],
                    'goal': (parent['goal'][:450] + ('\n内容备注：' + body.note if body.note else ''))[:1500]})
                candidates = handoff_candidates(selected)
                preview = {'candidates': candidates, 'warnings': [], 'retrieval': {'status': 'confirmed_selection',
                    'message': '使用人工确认的需求版本；不会自动生成机构事实。'}, 'counts': {
                    'input': len(selected), 'matched': len(candidates), 'excluded': 0, 'duplicates': 0, 'limited': 0}}
                run = new_run(config, parent['config_snapshot'], preview, parent_task_id=task_id,
                    handoff_signature=key, upstream=[source_snapshot(row) for row in selected])
                for row in selected:
                    row.setdefault('downstream_task_ids', []).append(run['id'])
                    # A lineage link is not a new human decision; do not stale its snapshot.
                    put(db, 'demand_results', row)
                put(db, 'demand_runs', run)
                refresh_counts(db, parent)
                parent['revision'] += 1
                add_event(parent, 'handoff', f'已交接 {len(selected)} 条确认需求到新任务 {run["id"]}。')
                put(db, 'demand_runs', parent)
                return run_view(db, run)
            result = once(db, 'demand:handoff:' + task_id, body, apply)
        runner.notify()
        return result
