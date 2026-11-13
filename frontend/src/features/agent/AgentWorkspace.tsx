import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Clock3, Plus, Send, Sparkles } from 'lucide-react';
import { api, date, requestId, type ModelInfo } from '../../api';
import { Badge, Button, Field, Modal, Submit } from '../../components/ui';
import { type Evidence, type KnowledgeDraft, type Scene, type Space, sceneLabels } from '../knowledge/types';
import TaskDetail from './TaskDetail';
import { type AgentTask, active, presets, statusLabels } from './types';
import type { HandoffContext } from '../journey/CreativeHandoff';
import '../knowledge/knowledge.css';
import './agent.css';

export default function AgentWorkspace({ model, dirtyChanged, openKnowledge, handoff, intent, taskSelected }: {
  model: ModelInfo; dirtyChanged: (value: boolean) => void; openKnowledge: (spaceId?: string) => void;
  handoff: HandoffContext; intent?: { token: string; taskId: string; scene: Scene; campaignId: string };
  taskSelected: (id: string) => void;
}) {
  const [tasks, setTasks] = useState<AgentTask[]>([]), [spaces, setSpaces] = useState<Space[]>([]);
  const [selected, setSelected] = useState(localStorage.getItem('marketing-agent-task') || ''), [task, setTask] = useState<AgentTask | null>(null);
  const [scene, setScene] = useState<Scene>('medical'), [goal, setGoal] = useState(presets.medical);
  const [sourceMode, setSourceMode] = useState('demo'), [spaceId, setSpaceId] = useState(''), [channel, setChannel] = useState('internal');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [source, setSource] = useState<Evidence | null>(null);
  const [formDirty, setFormDirty] = useState(false), [taskDirty, setTaskDirty] = useState(false);
  const [linkedCampaign, setLinkedCampaign] = useState('');
  const lock = useRef(false), selectedRef = useRef(selected), dirtyRef = useRef(false);
  selectedRef.current = selected; dirtyRef.current = formDirty || taskDirty || busy;
  const markTaskDirty = useCallback((v: boolean) => setTaskDirty(v), []);
  useEffect(() => {
    if (!intent) return;
    setFormDirty(false); setTaskDirty(false); setError('');
    if (intent.taskId === 'new') {
      selectedRef.current = ''; setSelected(''); setTask(null); setScene(intent.scene);
      setGoal(presets[intent.scene]); setSourceMode('demo'); setSpaceId('');
      setLinkedCampaign(intent.scene === 'live' ? intent.campaignId : '');
    } else { selectedRef.current = intent.taskId; setSelected(intent.taskId); }
    const timer = setTimeout(() => document.getElementById('agent-workspace')?.scrollIntoView({ block: 'start' }), 100);
    return () => clearTimeout(timer);
  }, [intent?.token]);
  useEffect(() => { dirtyChanged(formDirty || taskDirty || busy); return () => dirtyChanged(false); }, [formDirty, taskDirty, busy, dirtyChanged]);
  const refreshLists = useCallback(async () => {
    const [nextTasks, nextSpaces] = await Promise.all([api<AgentTask[]>('/agent/tasks'), api<Space[]>('/knowledge/spaces')]);
    setTasks(nextTasks); setSpaces(nextSpaces);
  }, []);
  const readTask = useCallback(async (id: string) => {
    const next = await api<AgentTask>('/agent/tasks/' + encodeURIComponent(id));
    if (selectedRef.current === id) setTask(next);
    return next;
  }, []);
  useEffect(() => { refreshLists().catch(e => setError(e.message)); }, [refreshLists]);
  useEffect(() => {
    localStorage.setItem('marketing-agent-task', selected); setTask(null); setError('');
    if (selected) readTask(selected).catch(e => setError(e.message));
  }, [selected, readTask]);
  useEffect(() => {
    if (!selected || !task || !active(task.status)) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await readTask(selected); if (!stopped) await refreshLists(); }
      catch (e) { if (!stopped) setError((e as Error).message); }
      if (!stopped) timer = setTimeout(poll, 1400);
    };
    timer = setTimeout(poll, 900);
    return () => { stopped = true; clearTimeout(timer); };
  }, [selected, task?.status, readTask, refreshLists]);
  const select = (id: string) => {
    if (lock.current) return;
    if (id === selected) return;
    if (dirtyRef.current && !confirm('当前输入尚未保存，确定切换并放弃这些修改？')) return;
    setFormDirty(false); setTaskDirty(false); setSelected(id); setError('');
    taskSelected(id);
  };
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); await refreshLists(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const create = () => run(async () => {
    const result = await api<{ id: string }>('/agent/tasks', 'POST', {
      request_id: requestId(), scene, goal, source_mode: sourceMode,
      ...(scene === 'live' && linkedCampaign ? { campaign_id: linkedCampaign } : {}),
      ...(sourceMode === 'knowledge' ? { space_id: spaceId, channel } : { channel: 'internal' }),
    });
    setFormDirty(false); selectedRef.current = result.id; setSelected(result.id); await readTask(result.id); taskSelected(result.id);
  });
  const act = (action: string, data: Record<string, unknown> = {}) => run(async () => {
    if (!task) return;
    await api('/agent/tasks/' + task.id + '/' + action, 'POST', { request_id: requestId(), expected_attempt: task.attempt, ...data });
    await readTask(task.id);
  });
  const changed = (draft: KnowledgeDraft) => {
    setTask(current => current ? { ...current, draft, can_complete: current.status === 'waiting_review' && draft.status === 'confirmed' && !draft.source_warnings.length,
      completion_stale: current.status === 'completed' && (current.completed_revision !== draft.revision || Boolean(draft.source_warnings.length)) } : current);
  };
  const eligibleSpaces = spaces.filter(s => s.scene === scene);
  const refreshCurrent = () => run(async () => { if (selected) await readTask(selected); });
  return <section id="agent-workspace" className="agent-workspace kb-workspace" aria-label="营销任务 Agent">
    <header className="agent-intro">
      <div className="agent-intro-icon"><Bot size={27}/></div><div><div className="eyebrow">MARKETING TASK AGENT</div><h2>给一个目标，把依据和草稿一起交回来。</h2><p>医美预约 FAQ · 直播讲解脚本。检索资料、判断缺口、生成草稿，最后交给你确认。</p></div>
      <Badge>{model.mode === 'replay' ? '规则演示' : '智谱模型已接入'}</Badge>
    </header>
    <div className="agent-layout">
      <aside className="panel agent-history" aria-label="Agent 任务历史">
        <Button kind={selected ? 'secondary' : 'primary'} disabled={busy} onClick={() => select('')}><Plus size={15}/>新建 Agent 任务</Button>
        <div className="agent-history-title"><Clock3 size={14}/>任务记录<span>{tasks.length}</span></div>
        {tasks.length ? tasks.map(item => <button key={item.id} className={`agent-task-item ${selected === item.id ? 'selected' : ''}`} aria-pressed={selected === item.id} disabled={busy} onClick={() => select(item.id)}>
          <span>{sceneLabels[item.scene]}<small>{statusLabels[item.status]}</small></span><strong>{item.goal}</strong><time>{date(item.created_at)}</time>
        </button>) : <p className="muted">从一个小任务开始。过程和草稿都会保存，稍后可以回来查看。</p>}
      </aside>
      <div className="agent-main">
        {error && <div className="error-banner" role="alert"><span>{error}</span><Button disabled={busy} onClick={() => selected ? refreshCurrent() : run(refreshLists)}>重新读取</Button></div>}
        {!selected ? <form className="panel agent-composer" onSubmit={e => { e.preventDefault(); create(); }}>
          <div className="panel-header"><div><h3>这次，想让 AI 帮你完成什么？</h3><p className="muted">先选业务场景，再说清希望交付的内容。</p></div><Sparkles size={22}/></div>
          <div className="agent-scene-options">{(['medical', 'live'] as Scene[]).map(value => <button key={value} type="button" aria-pressed={scene === value} className={scene === value ? 'selected' : ''} disabled={busy} onClick={() => { setScene(value); setGoal(presets[value]); setSpaceId(''); setLinkedCampaign(''); setFormDirty(true); }}><span>{value === 'medical' ? '01' : '02'}</span><strong>{sceneLabels[value]}</strong><small>{value === 'medical' ? '预约沟通与内部 FAQ' : '有依据的直播讲解'}</small><ArrowRight size={16}/></button>)}</div>
          <Field label="希望 Agent 完成的任务"><textarea required minLength={4} maxLength={1500} rows={4} disabled={busy} value={goal} onChange={e => { setGoal(e.target.value); setFormDirty(true); }}/></Field>
          <div className="agent-form-grid"><Field label="使用哪些资料"><select value={sourceMode} disabled={busy} onChange={e => { setSourceMode(e.target.value); setFormDirty(true); }}><option value="demo">预置虚构示例 · 可以直接体验</option><option value="knowledge">选择我的知识库 · 仅使用已审核资料</option></select></Field>{sourceMode === 'knowledge' && <><Field label="资料空间"><select value={spaceId} disabled={busy} required onChange={e => { setSpaceId(e.target.value); setFormDirty(true); }}><option value="">请选择{sceneLabels[scene]}资料空间</option>{eligibleSpaces.map(space => <option key={space.id} value={space.id}>{space.name}{space.is_demo ? '（示例）' : ''}</option>)}</select></Field><Field label="资料渠道范围"><select value={channel} disabled={busy} onChange={e => { setChannel(e.target.value); setFormDirty(true); }}><option value="internal">内部资料</option><option value="douyin">抖音渠道资料</option></select></Field></>}</div>
          {scene === 'live' && <Field label="关联营销活动（可选）"><select disabled={busy} value={linkedCampaign} onChange={e => { setLinkedCampaign(e.target.value); setFormDirty(true); }}><option value="">独立内容任务，转入时再选择活动</option>{handoff.campaigns.map(c => <option key={c.id} value={c.id}>{c.name} · {c.product_snapshot.name}</option>)}</select></Field>}
          <div className="agent-scope-note"><BookNote/>{sourceMode === 'demo' ? '为本次场景准备独立的虚构资料空间，所有示例均会明确标记。后续可换成你导入的资料。' : '只检索所选机构 / 品牌和渠道内，已审核且有效的资料。业务事实不足时会请求补充。'}</div>
          <div className="agent-start"><div><strong>{model.mode === 'replay' ? '当前为本地规则演示' : `当前模型：${model.model_name}`}</strong><p>{model.mode === 'replay' ? '展示真实检索与流程，正文为资料摘录；不会伪装成模型生成。' : '模型选择动作与生成内容，后端限定执行范围。最多 7 次模型请求 / 轮。'}</p></div><Submit busy={busy}><Send size={15}/>开始任务</Submit></div>
          <p className="agent-boundary">资料范围由本任务固定，不随上方活动筛选切换。直播稿确认并完成任务后，可以转为关联活动的创意草稿。</p>
        </form> : task ? <TaskDetail key={task.id} task={task} busy={busy} act={act} refresh={refreshCurrent} changed={changed} openSource={setSource} dirtyChanged={markTaskDirty} openKnowledge={() => openKnowledge(task.space_id)} handoff={handoff}/> : !error && <div className="panel" role="status">正在读取已保存的任务…</div>}
      </div>
    </div>
    {source && <Modal title="Agent 引用原文快照" wide onClose={() => setSource(null)}><div className="kb-source-preview"><Badge>{source.is_demo ? '虚构示例资料' : '资料引用'}</Badge><h3>{source.title}</h3><p className="muted">版本 {source.version} · {source.locator}</p><blockquote>{source.text}</blockquote><p className="muted">这是任务当时读取的原文。资料更新或失效后，旧草稿会提示重新核对。</p></div></Modal>}
  </section>;
}

function BookNote() { return <span className="agent-note-dot" aria-hidden="true"/>; }
