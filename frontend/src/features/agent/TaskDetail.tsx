import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { BookOpen, Check, CircleAlert, ClipboardCheck, Clock3, FileText, LoaderCircle, RefreshCw, Send, Square } from 'lucide-react';
import { date } from '../../api';
import { Badge, Button, Field } from '../../components/ui';
import DraftEditor from '../knowledge/DraftEditor';
import { type Evidence, type KnowledgeDraft, sceneLabels } from '../knowledge/types';
import { type AgentTask, actionLabels, active, statusLabels, statusTone } from './types';
import type { HandoffContext } from '../journey/CreativeHandoff';

const tabs = [
  { id: 'review', label: '结果审阅', icon: ClipboardCheck },
  { id: 'events', label: '执行记录', icon: Clock3 },
  { id: 'sources', label: '引用', icon: BookOpen },
] as const;
const eventStatusLabels: Record<string, string> = { running: '执行中', done: '已完成', failed: '失败', attention: '需处理', cancelled: '已取消', interrupted: '已中断' };
const eventTime = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

export default function TaskDetail({ task, busy, act, refresh, changed, openSource, dirtyChanged, openKnowledge, handoff }: {
  task: AgentTask; busy: boolean;
  act: (action: string, data?: Record<string, unknown>) => Promise<boolean>;
  refresh: () => void; changed: (draft: KnowledgeDraft) => void;
  openSource: (source: Evidence) => void; dirtyChanged: (value: boolean) => void; openKnowledge: () => void;
  handoff?: HandoffContext;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('review');
  const [note, setNote] = useState(''), [editorDirty, setEditorDirty] = useState(false);
  const tabPrefix = useId();
  const markEditor = useCallback((value: boolean) => setEditorDirty(value), []);
  useEffect(() => { dirtyChanged(editorDirty || Boolean(note)); }, [editorDirty, note, dirtyChanged]);
  useEffect(() => () => dirtyChanged(false), [dirtyChanged]);
  const running = active(task.status);
  const resumable = ['waiting_input', 'waiting_review', 'failed', 'interrupted'].includes(task.status);
  const locked = busy || editorDirty;
  const resume = async () => { if (await act('continue', { note })) setNote(''); };
  const cancel = async () => {
    if (note && !confirm('取消任务并放弃尚未提交的补充要求？已保存的草稿与记录会保留。')) return;
    if (await act('cancel')) setNote('');
  };
  const switchTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); setTab(tabs[next].id);
    document.getElementById(`${tabPrefix}-${tabs[next].id}`)?.focus({ preventScroll: true });
  };

  return <div className="agent-detail">
    <section className="agent-task-heading">
      <div className="agent-section-heading"><div className="agent-tags"><Badge tone={statusTone(task.status)}>{statusLabels[task.status]}</Badge><span>{sceneLabels[task.scene]} · 第 {task.attempt} 轮</span></div><Button kind="ghost" disabled={locked || Boolean(note)} onClick={refresh}><RefreshCw size={14}/>刷新任务</Button></div>
      <h3>{task.goal}</h3>
      <p className="muted">{task.space_name} · {task.channel === 'internal' ? '内部资料' : '抖音渠道资料'} · 创建于 {date(task.created_at)}</p>
      {task.campaign_id && <p className="muted">关联活动：{task.campaign_name} · 商品：{task.product_name}</p>}
      {task.live_context && <p className="agent-binding">绑定场次：{task.live_context.session_title} · 货盘 V{task.live_context.session_version} · SKU：{task.live_context.sku_label}</p>}
      <p className="agent-provenance">{task.source === 'model' ? `智谱实际执行 · ${task.model_name}` : '规则演示 + 本地摘录回放 · 未调用模型'}{task.source_mode === 'demo' && ' · 全部为虚构示例'}{task.source_mode === 'catalog' && ' · 已人工确认货盘快照'}</p>
      <div className={`agent-message ${['waiting_input', 'failed', 'interrupted'].includes(task.status) ? 'attention' : ''}`} role="status">
        {running ? <LoaderCircle size={17}/> : task.status === 'completed' ? <Check size={17}/> : <CircleAlert size={17}/>}<span>{task.message}</span>
      </div>
      {task.completion_stale && <div className="kb-warning" role="alert">完成时确认的是草稿 V{task.completed_revision}；正文或依据已变化，当前版本需重新审核。</div>}
      <div className="agent-task-actions">
        <div className="agent-counts"><span>本轮步骤 {task.steps} / {task.limits.steps}</span><span>本轮模型调用 {task.model_calls} / {task.limits.model_calls}</span><span>累计调用 {task.total_model_calls}</span></div>
        {task.status === 'completed' && task.draft && <Button disabled={locked || Boolean(note)} onClick={() => act('reopen', { expected_revision: task.draft!.revision })}><RefreshCw size={14}/>重新打开审核</Button>}
        {running && <Button disabled={locked} onClick={() => void cancel()}><Square size={13}/>取消任务</Button>}
      </div>
      {running && <p className="agent-boundary">离开页面后，任务仍由本机服务处理。</p>}
    </section>

    <div className="agent-detail-tabs" role="tablist" aria-label="任务详情">
      {tabs.map(({ id, label, icon: Icon }, index) => <button type="button" role="tab" key={id} id={`${tabPrefix}-${id}`} aria-selected={tab === id} aria-controls={`${tabPrefix}-${id}-panel`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => switchTab(event, index)}>
        <Icon size={15}/>{label}{id === 'events' && <span>{task.events.length}</span>}{id === 'sources' && <span>{task.evidence.length}</span>}{id === 'review' && (editorDirty || note) && <span className="agent-unsaved" title="有未保存修改" aria-label="有未保存修改"/>}
      </button>)}
    </div>

    {/* Keep the editor, acknowledgement, handoff form and follow-up mounted across tabs. */}
    <div id={`${tabPrefix}-review-panel`} role="tabpanel" aria-labelledby={`${tabPrefix}-review`} hidden={tab !== 'review'} className="agent-tab-panel">
      {task.draft ? <fieldset className="agent-editor-lock" disabled={busy || running}>
        <DraftEditor key={task.draft.id} draft={task.draft} changed={changed} dirtyChanged={markEditor} openSource={openSource} handoff={handoff}/>
      </fieldset> : <div className="agent-empty" role="status"><FileText size={24}/><h3>{running ? '正在处理任务' : '暂无草稿'}</h3></div>}
      {task.status === 'waiting_review' && task.draft && <section className="agent-finish">
        <div><h3>{task.can_complete ? '已人工确认，可完成任务' : '待核对正文与引用'}</h3><p className="muted">保存修订并人工确认后，才能标记完成。</p></div>
        <Button kind="primary" disabled={!task.can_complete || locked || Boolean(note)} onClick={() => act('complete', { draft_id: task.draft!.id, draft_revision: task.draft!.revision })}><Check size={16}/>标记任务完成</Button>
      </section>}
      {resumable && <section className="agent-followup">
        <div className="agent-section-heading"><h3>{task.status === 'waiting_input' ? '补充资料与要求' : task.status === 'waiting_review' ? '补充修改要求' : '恢复任务'}</h3><Badge tone="neutral">第 {task.attempt} / {task.limits.attempts} 轮</Badge></div>
        <p className="muted">写作要求可直接补充；价格、资质等业务事实须先导入知识库并审核。</p>
        <Field label="补充要求"><textarea rows={3} maxLength={1500} disabled={busy} value={note} onChange={event => setNote(event.target.value)}/></Field>
        {task.attempt >= task.limits.attempts && <p className="agent-boundary">已达到继续次数上限，请整理要求后新建任务。</p>}
        <div className="row-actions"><Button kind="primary" disabled={locked || task.attempt >= task.limits.attempts || (task.status === 'waiting_review' && !note.trim())} onClick={() => void resume()}><Send size={14}/>{note.trim() ? '提交要求并继续' : '继续任务'}</Button><Button disabled={locked || Boolean(note)} onClick={openKnowledge}><BookOpen size={14}/>去准备知识资料</Button><Button kind="ghost" disabled={locked} onClick={() => void cancel()}><Square size={13}/>结束本次任务</Button></div>
      </section>}
    </div>

    <section id={`${tabPrefix}-events-panel`} role="tabpanel" aria-labelledby={`${tabPrefix}-events`} hidden={tab !== 'events'} className="agent-tab-panel agent-trace">
      <div className="agent-section-heading"><h3>执行记录</h3><span className="muted">服务记录的时间 · {task.events.length} 条</span></div>
      {task.events.length ? <ol className="agent-events">{task.events.map(event => <li key={event.id} className={event.status}>
        <span className="agent-event-marker">{event.status === 'running' ? <LoaderCircle size={13}/> : event.status === 'done' ? <Check size={12}/> : <CircleAlert size={12}/>}</span>
        <div><div className="agent-event-title"><strong>{actionLabels[event.action] || event.action}</strong><span>{eventStatusLabels[event.status] || event.status} · 第 {event.attempt} 轮</span></div>
          <time dateTime={event.at} title={event.at}>{eventTime(event.at)}</time>{event.ended_at && <span className="agent-event-end">结束于 <time dateTime={event.ended_at} title={event.ended_at}>{eventTime(event.ended_at)}</time></span>}
          <p>{event.detail}</p>
          {!!event.source_ids?.length && <div className="agent-event-sources">{event.source_ids.map(id => {
            const source = task.evidence.find(item => item.id === id) || task.draft?.sources.find(item => item.id === id);
            return source && <Button key={id} kind="ghost" onClick={() => openSource(source)}><FileText size={13}/>{source.title} · V{source.version}</Button>;
          })}</div>}
        </div>
      </li>)}</ol> : <p className="agent-empty">暂无执行事件。</p>}
      {!!task.notes.length && <details className="agent-saved-notes"><summary>已提交的补充要求（{task.notes.length}）</summary><ol>{task.notes.map((entry, index) => <li key={index}>{entry}</li>)}</ol></details>}
    </section>

    <section id={`${tabPrefix}-sources-panel`} role="tabpanel" aria-labelledby={`${tabPrefix}-sources`} hidden={tab !== 'sources'} className="agent-tab-panel agent-evidence">
      <div className="agent-section-heading"><h3>引用依据</h3><Badge tone="neutral">{task.evidence.length} 条</Badge></div>
      {task.evidence.length ? task.evidence.map(source => <button type="button" key={source.id} className="agent-source" onClick={() => openSource(source)}>
        <FileText size={16}/><span><strong>{source.title}</strong><small>V{source.version} · {source.locator}{source.is_demo ? ' · 虚构资料' : ''}</small></span><BookOpen size={15}/>
      </button>) : <p className="agent-empty">暂无引用依据。</p>}
      {task.check && <div className="agent-check"><strong>{task.check.passed ? '生成时的检查记录' : '需要核对的问题'}</strong><ul>{(task.check.passed ? task.check.checks : task.check.blocking).map((item, index) => <li key={index}>{item}</li>)}</ul><p>{task.check.note}</p></div>}
    </section>
  </div>;
}
