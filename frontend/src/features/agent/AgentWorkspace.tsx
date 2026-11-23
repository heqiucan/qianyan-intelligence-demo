import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CornerUpLeft, Plus, RefreshCw } from 'lucide-react';
import { api, requestId, type ModelInfo } from '../../api';
import { Badge, Button, Modal } from '../../components/ui';
import { type Evidence, type KnowledgeDraft, type Space } from '../knowledge/types';
import type { HandoffContext } from '../journey/CreativeHandoff';
import TaskCreate from './TaskCreate';
import TaskDetail from './TaskDetail';
import TaskList from './TaskList';
import { type AgentIntent, type AgentTask, type AgentTaskSummary, type CreateTaskInput, active } from './types';
import '../knowledge/knowledge.css';
import './agent.css';

export interface AgentWorkspaceProps {
  model: ModelInfo;
  dirtyChanged: (value: boolean) => void;
  openKnowledge: (spaceId?: string) => void;
  handoff: HandoffContext;
  intent?: AgentIntent;
  initialStatus?: 'attention';
  taskSelected: (id: string) => void;
  onReturn?: () => void;
  returnLabel?: string;
}

export default function AgentWorkspace({ model, dirtyChanged, openKnowledge, handoff, intent, initialStatus, taskSelected, onReturn, returnLabel = '返回来源业务' }: AgentWorkspaceProps) {
  const pageId = intent?.taskId || '';
  const selected = pageId === 'new' ? '' : pageId;
  const createToken = pageId === 'new' ? intent?.token : undefined;
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]), [spaces, setSpaces] = useState<Space[]>([]);
  const [task, setTask] = useState<AgentTask | null>(null), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [source, setSource] = useState<Evidence | null>(null);
  const [formDirty, setFormDirty] = useState(false), [taskDirty, setTaskDirty] = useState(false);
  const lock = useRef(false), selectedRef = useRef(selected), dirtyRef = useRef(false), taskRequest = useRef(0);
  selectedRef.current = selected;
  dirtyRef.current = formDirty || taskDirty || busy;
  const markTaskDirty = useCallback((value: boolean) => setTaskDirty(value), []);
  const markFormDirty = useCallback((value: boolean) => setFormDirty(value), []);

  useEffect(() => { dirtyChanged(formDirty || taskDirty || busy); }, [formDirty, taskDirty, busy, dirtyChanged]);
  useEffect(() => () => dirtyChanged(false), [dirtyChanged]);
  useEffect(() => {
    setFormDirty(false); setTaskDirty(false); setError(''); setSource(null);
  }, [pageId, createToken]);

  const refreshTasks = useCallback(async () => {
    const next = await api<AgentTaskSummary[]>('/agent/tasks');
    setTasks(next); setLoaded(true);
  }, []);
  const refreshLists = useCallback(async () => {
    await Promise.all([refreshTasks(), api<Space[]>('/knowledge/spaces').then(setSpaces)]);
  }, [refreshTasks]);
  const readTask = useCallback(async (id: string) => {
    const request = ++taskRequest.current;
    const next = await api<AgentTask>('/agent/tasks/' + encodeURIComponent(id));
    if (selectedRef.current === id && request === taskRequest.current) setTask(next);
  }, []);
  useEffect(() => { void refreshLists().catch(e => setError(e.message)); }, [refreshLists]);
  useEffect(() => {
    setTask(null);
    if (selected) void readTask(selected).catch(e => { if (selectedRef.current === selected) setError(e.message); });
    return () => { taskRequest.current += 1; };
  }, [selected, readTask]);

  const polling = selected ? task?.id === selected && active(task.status) : pageId === '' && tasks.some(item => active(item.status));
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        // Never replace an editor with unsaved input while polling a running task.
        if (!dirtyRef.current) {
          if (selected) await readTask(selected);
          if (!stopped) await refreshTasks();
        }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      if (!stopped) timer = setTimeout(poll, 1400);
    };
    timer = setTimeout(poll, 900);
    return () => { stopped = true; clearTimeout(timer); };
  }, [polling, selected, readTask, refreshTasks]);

  const navigate = (next: () => void) => {
    if (lock.current) return;
    if (dirtyRef.current && !confirm('当前输入尚未保存，确定离开并放弃这些修改？')) return;
    setFormDirty(false); setTaskDirty(false); dirtyChanged(false);
    next();
  };
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      await operation();
      // A failed list refresh must not report an accepted mutation as a failed submission.
      await refreshTasks().catch(e => setError(e.message));
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const create = (input: CreateTaskInput) => run(async () => {
    const result = await api<{ id: string }>('/agent/tasks', 'POST', { request_id: requestId(), ...input });
    setFormDirty(false); setTaskDirty(false); dirtyChanged(false);
    taskSelected(result.id);
  });
  const act = (action: string, data: Record<string, unknown> = {}) => run(async () => {
    if (!task || task.id !== selected) throw new Error('请先读取当前任务。');
    await api('/agent/tasks/' + encodeURIComponent(task.id) + '/' + action, 'POST', { request_id: requestId(), expected_attempt: task.attempt, ...data });
    await readTask(task.id).catch(e => setError('操作已保存，请重新读取任务。' + e.message));
  });
  const changed = (draft: KnowledgeDraft) => {
    setTask(current => current?.draft?.id === draft.id ? {
      ...current, draft,
      can_complete: current.status === 'waiting_review' && draft.status === 'confirmed' && !draft.source_warnings.length,
      completion_stale: current.status === 'completed' && (current.completed_revision !== draft.revision || Boolean(draft.source_warnings.length)),
    } : current);
  };
  const refreshCurrent = () => run(async () => { if (selected) await readTask(selected); else await refreshLists(); });
  const currentTask = task?.id === selected ? task : null;

  return <section id="agent-workspace" className="agent-workspace kb-workspace" aria-label="营销任务 Agent">
    <header className="agent-page-header">
      <div className="agent-page-title">
        {pageId && <Button kind="ghost" disabled={busy} onClick={() => navigate(() => taskSelected(''))}><ArrowLeft size={16}/>任务列表</Button>}
        <h2>{pageId === 'new' ? '新建 Agent 任务' : selected ? '任务详情' : 'Agent 任务'}</h2>
        {!selected && <Badge tone="neutral">{model.mode === 'replay' ? '规则演示 · 未调用模型' : model.model_name || '模型模式'}</Badge>}
      </div>
      <div className="row-actions">
        {onReturn && <Button kind="ghost" disabled={busy} onClick={() => navigate(onReturn)}><CornerUpLeft size={15}/>{returnLabel}</Button>}
        {!pageId && <Button disabled={busy} onClick={() => void refreshCurrent()} title="刷新任务列表"><RefreshCw size={15}/>刷新</Button>}
        {pageId !== 'new' && <Button kind="primary" disabled={busy} onClick={() => navigate(() => taskSelected('new'))}><Plus size={15}/>新建任务</Button>}
      </div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><Button disabled={busy || formDirty || taskDirty} onClick={() => void refreshCurrent()}>重新读取</Button></div>}
    {!pageId ? <TaskList key={initialStatus || 'all'} initialStatus={initialStatus} tasks={tasks} loaded={loaded} busy={busy} failed={Boolean(error)} select={id => navigate(() => taskSelected(id))}/>
      : pageId === 'new' ? <TaskCreate key={intent?.token || 'new'} model={model} spaces={spaces} handoff={handoff} intent={intent} busy={busy} create={create} dirtyChanged={markFormDirty}/>
      : currentTask ? <TaskDetail key={currentTask.id} task={currentTask} busy={busy} act={act} refresh={refreshCurrent} changed={changed} openSource={setSource} dirtyChanged={markTaskDirty} openKnowledge={() => openKnowledge(currentTask.space_id)} handoff={handoff}/>
      : !error && <div className="agent-empty" role="status">正在读取已保存的任务…</div>}
    {source && <Modal title="Agent 引用原文快照" wide onClose={() => setSource(null)}><div className="kb-source-preview"><Badge>{source.is_demo ? '虚构示例资料' : '资料引用'}</Badge><h3>{source.title}</h3><p className="muted">版本 {source.version} · {source.locator}</p><blockquote>{source.text}</blockquote><p className="muted">任务读取时的原文快照；资料更新或失效后，旧草稿需重新核对。</p></div></Modal>}
  </section>;
}
