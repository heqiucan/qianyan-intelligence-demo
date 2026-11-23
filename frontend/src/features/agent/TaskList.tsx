import { useEffect, useState } from 'react';
import { ArrowRight, ListTodo, Search, X } from 'lucide-react';
import { date } from '../../api';
import { Badge, Button, Field } from '../../components/ui';
import { type Scene, sceneLabels } from '../knowledge/types';
import { type AgentTaskSummary, type TaskStatus, active, statusLabels, statusTone } from './types';

type StatusFilter = TaskStatus | 'attention' | '';
interface ListFilters { status: StatusFilter; scene: Scene | ''; query: string }
const attentionStatuses: TaskStatus[] = ['waiting_input', 'waiting_review', 'failed', 'interrupted'];

function readFilters(key: string, initialStatus?: 'attention'): ListFilters {
  const fallback: ListFilters = { status: initialStatus || '', scene: '', query: '' };
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const saved = value as Record<string, unknown>;
    return {
      status: typeof saved.status === 'string' && (saved.status === '' || saved.status === 'attention' || Object.hasOwn(statusLabels, saved.status)) ? saved.status as StatusFilter : fallback.status,
      scene: saved.scene === 'medical' || saved.scene === 'live' ? saved.scene : '',
      query: typeof saved.query === 'string' ? saved.query : '',
    };
  } catch { return fallback; }
}

export default function TaskList({ tasks, loaded, busy, failed, select, initialStatus }: {
  tasks: AgentTaskSummary[]; loaded: boolean; busy: boolean; failed: boolean; select: (id: string) => void;
  initialStatus?: 'attention';
}) {
  // Keep each entry's filters across detail navigation without persisting a selected task.
  const storageKey = 'marketing-agent-filters:v1:' + (initialStatus || 'all');
  const [filters, setFilters] = useState<ListFilters>(() => readFilters(storageKey, initialStatus));
  const { status, scene, query } = filters;
  const updateFilters = (patch: Partial<ListFilters>) => setFilters(current => ({ ...current, ...patch }));
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* Storage may be disabled. */ }
  }, [storageKey, filters]);
  const counts = Object.fromEntries(Object.keys(statusLabels).map(key => [key, tasks.filter(task => task.status === key).length])) as Record<TaskStatus, number>;
  const attentionCount = attentionStatuses.reduce((total, value) => total + counts[value], 0);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = tasks.filter(task => (!status || (status === 'attention' ? attentionStatuses.includes(task.status) : task.status === status)) && (!scene || task.scene === scene)
    && (!needle || [task.goal, task.id, task.campaign_name, task.product_name, task.space_name, task.live_context?.session_title, task.live_context?.sku_label].some(value => value?.toLocaleLowerCase().includes(needle))));
  if (!loaded) return <div className="agent-empty" role="status">{failed ? '任务列表读取失败，请重试。' : '正在读取任务列表…'}</div>;

  return <div className="agent-list">
    <dl className="agent-status-counts" aria-label="已加载任务状态计数">
      <div><dt>已加载任务</dt><dd>{tasks.length}</dd></div>
      <div><dt>排队 / 执行中</dt><dd>{tasks.filter(task => active(task.status)).length}</dd></div>
      <div><dt>需要补充</dt><dd>{counts.waiting_input}</dd></div>
      <div><dt>待审阅</dt><dd>{counts.waiting_review}</dd></div>
      <div><dt>已确认完成</dt><dd>{counts.completed}</dd></div>
    </dl>
    <div className="agent-list-filters">
      <Field label="搜索任务"><span className="agent-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="搜索任务" value={query} onChange={event => updateFilters({ query: event.target.value })} placeholder="任务、活动、场次或 SKU"/></span></Field>
      <Field label="任务状态"><select value={status} onChange={event => updateFilters({ status: event.target.value as StatusFilter })}><option value="">全部状态（{tasks.length}）</option><option value="attention">需要处理（{attentionCount}）</option>{(Object.keys(statusLabels) as TaskStatus[]).map(value => <option key={value} value={value}>{statusLabels[value]}（{counts[value]}）</option>)}</select></Field>
      <Field label="业务场景"><select value={scene} onChange={event => updateFilters({ scene: event.target.value as Scene | '' })}><option value="">全部场景</option>{(['medical', 'live'] as Scene[]).map(value => <option key={value} value={value}>{sceneLabels[value]}</option>)}</select></Field>
      {(status || scene || query) && <Button kind="ghost" onClick={() => setFilters({ status: '', scene: '', query: '' })}><X size={14}/>清除筛选</Button>}
    </div>
    <div className="agent-list-caption"><span role="status">显示 {filtered.length} / {tasks.length} 项</span><span>按创建时间排序</span></div>
    {filtered.length ? <>
      <div className="agent-list-columns" aria-hidden="true"><span>任务 / 关联业务</span><span>资料与执行来源</span><span>状态</span><span>更新时间</span><span/></div>
      <ul className="agent-task-list" aria-label="Agent 任务列表">{filtered.map(task => <li key={task.id}>
        <button type="button" className="agent-task-row" disabled={busy} onClick={() => select(task.id)}>
          <span className="agent-task-summary"><strong>{task.goal}</strong><small>{sceneLabels[task.scene]} · {task.campaign_name || '独立任务'}{task.product_name && ` · ${task.product_name}`}</small>{task.live_context && <small>{task.live_context.session_title} · {task.live_context.sku_label} · 货盘 V{task.live_context.session_version}</small>}</span>
          <span className="agent-task-source"><span>{task.space_name}</span><small>{task.source === 'replay' ? '规则演示 · 未调用模型' : task.model_name || '模型执行'}{task.source_mode === 'demo' && ' · 虚构示例'}{task.source_mode === 'catalog' && ' · 已确认货盘'}</small></span>
          <span className="agent-task-state"><Badge tone={statusTone(task.status)}>{statusLabels[task.status]}</Badge><small>第 {task.attempt} 轮</small></span>
          <time dateTime={task.updated_at} title={task.updated_at}>{date(task.updated_at)}</time><ArrowRight size={16} aria-hidden="true"/>
        </button>
      </li>)}</ul>
    </> : <div className="agent-empty"><ListTodo size={24}/><h3>{tasks.length ? '没有符合条件的任务' : '暂无任务'}</h3></div>}
    {tasks.length >= 100 && <p className="agent-boundary">接口返回最近 100 项任务；计数和筛选仅覆盖已加载记录。</p>}
  </div>;
}
