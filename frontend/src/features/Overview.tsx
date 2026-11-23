import { useEffect, useState } from 'react';
import { ArrowRight, Bot, ChevronRight, FileCheck, ListTodo, Megaphone, Radio } from 'lucide-react';
import { api, type Analytics, type Campaign, type State } from '../api';
import { Button } from '../components/ui';
import OverviewStats from '../components/OverviewStats';
import type { AgentTask } from './agent/types';
import { active, statusLabels } from './agent/types';
import TrendChart from './live/TrendChart';

interface Props {
  state: State; campaign?: Campaign; campaignId: string; analytics: Analytics | null;
  go: (page: string) => void; inspect: (section: string) => void; setDialog: (dialog: string) => void;
}

export default function Overview({ state, campaignId, analytics, go }: Props) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [taskError, setTaskError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<AgentTask[]>('/agent/tasks').then(value => { if (!cancelled) setTasks(value); }).catch(error => { if (!cancelled) setTaskError(error.message); });
    return () => { cancelled = true; };
  }, []);
  const creatives = state.creatives.filter(c => c.campaign_id === campaignId && c.status === 'draft');
  const plans = state.plans.filter(p => p.campaign_id === campaignId && p.status === 'draft');
  const issues = state.tasks.filter(t => t.campaign_id === campaignId && !['resolved', 'ignored'].includes(t.status));
  const current = tasks.filter(task => active(task.status) || ['waiting_review', 'waiting_input', 'failed', 'interrupted'].includes(task.status));
  const pending = [
    { label: '创意待确认', count: creatives.length, route: 'tasks?view=creative', icon: FileCheck },
    { label: '计划待启动', count: plans.length, route: 'ads', icon: Megaphone },
    { label: '异常待处理', count: issues.length, route: 'tasks', icon: ListTodo },
  ];
  return <div className="workspace-overview">
    <OverviewStats analytics={analytics} onSelect={section => go('analytics?section=' + section)}/>
    <div className="workspace-overview-grid">
      <section className="workspace-section" aria-label="待处理事项">
        <div className="workspace-section-heading"><h2>待处理事项</h2><Button kind="ghost" onClick={() => go('tasks')}>全部待办<ArrowRight size={14}/></Button></div>
        {pending.map(item => <button className="workspace-action-row" key={item.label} onClick={() => go(item.route)}><item.icon size={19}/><span><strong>{item.label}</strong></span><b>{item.count}</b><ChevronRight size={16}/></button>)}
        <button className="workspace-action-row" onClick={() => go('live?pane=session')}><Radio size={19}/><span><strong>直播场次</strong><small>{state.live_sessions.filter(s => s.campaign_id === campaignId && s.status !== 'archived').length} 场待管理</small></span><ChevronRight size={16}/></button>
      </section>
      <section className="workspace-section" aria-label="当前 Agent 任务">
        <div className="workspace-section-heading"><h2>当前 Agent 任务</h2><Button kind="ghost" onClick={() => go('agent?agent=new')}><Bot size={15}/>新建任务</Button></div>
        {taskError ? <p role="alert">任务读取失败。<Button onClick={() => go('agent')}>进入任务页</Button></p> : current.length ? current.slice(0, 4).map(task => <button key={task.id} className="workspace-action-row" onClick={() => go('agent?agent=' + encodeURIComponent(task.id))}><Bot size={19}/><span><strong>{task.goal}</strong><small>{statusLabels[task.status]}</small></span><ChevronRight size={16}/></button>) : <p className="workspace-inline-note">暂无运行中或待处理的内容任务。</p>}
        <Button kind="ghost" onClick={() => go('agent')}>查看任务记录<ArrowRight size={14}/></Button>
      </section>
    </div>
    {analytics && Boolean(analytics.trend?.points.length) && <div className="workspace-overview-trend"><TrendChart analytics={analytics}/></div>}
  </div>;
}
