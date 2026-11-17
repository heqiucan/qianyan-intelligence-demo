import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, CircleAlert, FileText, LoaderCircle, RefreshCw, Send, Square } from 'lucide-react';
import { date } from '../../api';
import { Badge, Button, Field } from '../../components/ui';
import DraftEditor from '../knowledge/DraftEditor';
import { type Evidence, type KnowledgeDraft, sceneLabels } from '../knowledge/types';
import { type AgentTask, actionLabels, active, statusLabels } from './types';
import type { HandoffContext } from '../journey/CreativeHandoff';

export default function TaskDetail({ task, busy, act, refresh, changed, openSource, dirtyChanged, openKnowledge, handoff }: {
  task: AgentTask; busy: boolean;
  act: (action: string, data?: Record<string, unknown>) => Promise<boolean>;
  refresh: () => void; changed: (draft: KnowledgeDraft) => void;
  openSource: (source: Evidence) => void; dirtyChanged: (value: boolean) => void; openKnowledge: () => void;
  handoff?: HandoffContext;
}) {
  const [note, setNote] = useState(''), [editorDirty, setEditorDirty] = useState(false);
  const markEditor = useCallback((v: boolean) => setEditorDirty(v), []);
  useEffect(() => { dirtyChanged(editorDirty || Boolean(note)); return () => dirtyChanged(false); }, [editorDirty, note, dirtyChanged]);
  const running = active(task.status);
  const resumable = ['waiting_input', 'waiting_review', 'failed', 'interrupted'].includes(task.status);
  const resume = async () => { if (await act('continue', { note })) setNote(''); };
  const locked = busy || editorDirty;
  return <div className="agent-detail">
    <section className="panel agent-task-heading">
      <div className="panel-header"><div className="agent-tags"><Badge tone={task.status === 'completed' ? 'green' : 'purple'}>{statusLabels[task.status]}</Badge><span>{sceneLabels[task.scene]} · 第 {task.attempt} 轮</span></div><Button kind="ghost" disabled={locked || Boolean(note)} onClick={refresh}><RefreshCw size={14}/>刷新任务</Button></div>
      <h3>{task.goal}</h3>
      <p className="muted">{task.space_name} · {task.channel === 'internal' ? '内部资料' : '抖音渠道资料'} · {date(task.created_at)}</p>
      <p className="muted">{task.campaign_id ? `关联活动：${task.campaign_name} · 商品：${task.product_name}` : '独立内容任务 · 不随上方活动筛选改变资料范围'}</p>
      {task.live_context&&<p className="notice">绑定场次：{task.live_context.session_title} · 货盘 V{task.live_context.session_version} · SKU：{task.live_context.sku_label}</p>}
      <div className="agent-provenance">{task.source === 'model' ? `智谱实际执行 · ${task.model_name}` : '规则演示 + 本地摘录回放 · 未调用模型'}{task.source_mode === 'demo' && ' · 全部为虚构示例'}</div>
      <div className={`agent-message ${task.status === 'waiting_input' || task.status === 'failed' ? 'attention' : ''}`} role="status">
        {running ? <LoaderCircle className="agent-spin" size={18}/> : task.status === 'completed' ? <Check size={18}/> : <CircleAlert size={18}/>}<span>{task.message}</span>
      </div>
      {task.completion_stale && <div className="kb-warning" role="alert">本任务确认的是草稿 V{task.completed_revision}。之后正文或依据有变化，当前内容不沿用当时的确认结果。</div>}
      {task.status==='completed'&&task.draft&&<Button disabled={locked||Boolean(note)} onClick={()=>act('reopen',{expected_revision:task.draft!.revision})}>重新打开审核</Button>}
      <div className="agent-counts"><span>本轮 {task.steps} / {task.limits.steps} 个处理步骤</span><span>本轮模型调用 {task.model_calls} / {task.limits.model_calls}</span><span>累计调用 {task.total_model_calls}</span></div>
      {running && <div className="row-actions"><Button disabled={busy} onClick={() => act('cancel')}><Square size={13}/>取消任务</Button><span className="muted">刷新或离开此页，任务仍由本机服务处理。</span></div>}
    </section>

    <div className="agent-inspection-grid">
      <section className="panel agent-trace" aria-label="Agent 执行记录">
        <div className="panel-header"><h3>它做了什么</h3><span className="muted">实际执行记录</span></div>
        <ol className="agent-events">{task.events.map(event => <li key={event.id} className={event.status}>
          <span className="agent-event-marker">{event.status === 'running' ? <LoaderCircle size={13} className="agent-spin"/> : event.status === 'done' ? <Check size={12}/> : <CircleAlert size={12}/>}</span>
          <div><div className="agent-event-title"><strong>{actionLabels[event.action] || event.action}</strong><time>{date(event.at)} · 第 {event.attempt} 轮</time></div><p>{event.detail}</p></div>
        </li>)}</ol>
      </section>
      <section className="panel agent-evidence" aria-label="Agent 参考依据">
        <div className="panel-header"><h3><BookOpen size={16}/>用到了哪些依据</h3><Badge tone="neutral">{task.evidence.length}</Badge></div>
        {task.evidence.length ? task.evidence.map(source => <button key={source.id} className="agent-source" onClick={() => openSource(source)}>
          <FileText size={16}/><span><strong>{source.title}</strong><small>V{source.version} · {source.locator}{source.is_demo ? ' · 虚构资料' : ''}</small></span>
        </button>) : <p className="muted">检索结果会显示在这里。资料不足时，任务会请求补充。</p>}
        {task.check && <div className="agent-check"><strong>{task.check.passed ? '生成草稿时的检查结果' : '需要核对的问题'}</strong><ul>{(task.check.passed ? task.check.checks : task.check.blocking).map((item, i) => <li key={i}>{item}</li>)}</ul><p>{task.check.note}</p></div>}
      </section>
    </div>

    {resumable && <section className="panel agent-followup">
      <div className="panel-header"><h3>{task.status === 'waiting_input' ? '补充后，让它继续' : task.status === 'waiting_review' ? '需要另一个版本？' : '从保留的进度继续'}</h3><Badge tone="neutral">最多 {task.limits.attempts} 轮</Badge></div>
      <p className="muted">写作要求可以直接补充；价格、资质、项目说明等业务事实，请先导入知识库并审核。继续执行会保留历史记录。</p>
      <Field label="补充要求"><textarea rows={3} maxLength={1500} value={note} onChange={e => setNote(e.target.value)} placeholder="例如：语气自然一些；只说明预约流程，未提供的价格列为待核实。"/></Field>
      <div className="row-actions"><Button kind="primary" disabled={locked || task.attempt >= task.limits.attempts || (task.status === 'waiting_review' && !note.trim())} onClick={resume}><Send size={14}/>{note.trim() ? '提交要求并继续' : '继续任务'}</Button><Button disabled={locked || Boolean(note)} onClick={openKnowledge}>去准备知识资料</Button><Button kind="ghost" disabled={locked} onClick={() => act('cancel')}>结束本次任务</Button></div>
    </section>}

    {task.draft && <DraftEditor key={task.draft.id} draft={task.draft} changed={changed} dirtyChanged={markEditor} openSource={openSource} handoff={handoff}/>}
    {task.status === 'waiting_review' && task.draft && <div className="agent-finish panel">
      <div><h3>{task.can_complete ? '内容已人工确认，可以完成任务' : '最后一步：由你核对并确认'}</h3><p className="muted">先在草稿中核对正文和引用，勾选并确认保存，再标记任务完成。</p></div>
      <Button kind="primary" disabled={!task.can_complete || locked || Boolean(note)} onClick={() => act('complete', { draft_id: task.draft!.id, draft_revision: task.draft!.revision })}><Check size={16}/>标记任务完成</Button>
    </div>}
  </div>;
}
