import { useEffect, useState } from 'react';
import { AlertCircle, ChevronRight, SearchCheck } from 'lucide-react';
import { readableTime, useSubmit } from './shared';
import { Btn, Empty, Field, Tag } from './sharedUI';
import { TaskDialog } from './TaskDialog';
import { records, type FeedbackProps } from './types';

type TaskFilter = 'active' | 'closed' | 'all';
const filters: { id: TaskFilter; label: string }[] = [
  { id: 'active', label: '待推进' }, { id: 'closed', label: '已处理' }, { id: 'all', label: '全部' },
];

export function TasksPage(props: FeedbackProps) {
  const { state, campaignId, busy, act } = props;
  const tasks = records(state, 'tasks').filter(task => task.campaign_id === campaignId);
  const batches = records(state, 'batches').filter(batch => batch.campaign_id === campaignId);
  const [scanBatch, setScanBatch] = useState(props.dataset === 'batch' ? props.batchId : '');
  const [threshold, setThreshold] = useState('100');
  const [filter, setFilter] = useState<TaskFilter>('active');
  const [taskId, setTaskId] = useState('');
  const submit = useSubmit();

  useEffect(() => {
    if (props.dataset === 'batch') setScanBatch(props.batchId);
  }, [props.batchId, props.dataset]);

  const task = tasks.find(item => item.id === taskId);
  const activeCount = tasks.filter(item => !['resolved', 'ignored'].includes(item.status)).length;
  const visible = tasks.filter(item => {
    const closed = ['resolved', 'ignored'].includes(item.status);
    return filter === 'all' || (filter === 'closed' ? closed : !closed);
  }).slice().reverse();

  return (
    <div className="feedback-page">
      <section className="feedback-section" aria-label="检查活动待办">
        <div className="feedback-section-heading">
          <h2>检查活动</h2><span className="badge amber">{activeCount} 项待推进</span>
        </div>
        <form className="feedback-scan" onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            await submit('/tasks/scan', {
              campaign_id: campaignId,
              ...(scanBatch ? { batch_id: scanBatch } : {}),
              spend_threshold: Number(threshold),
            });
          }, '检查完成，重复问题已去重');
        }}>
          <Field label="检查数据批次">
            <select value={scanBatch} onChange={event => setScanBatch(event.target.value)}>
              <option value="">只检查业务待办</option>
              {batches.map(batch => <option key={batch.id} value={batch.id}>{batch.label} · {readableTime(batch.created_at)}</option>)}
            </select>
          </Field>
          <Field label="无成交消耗阈值 / 元">
            <input type="number" min="1" max="1000000" step="1" required value={threshold} onChange={event => setThreshold(event.target.value)} />
          </Field>
          <Btn type="submit" primary disabled={busy || !campaignId}><SearchCheck size={16} />检查当前活动</Btn>
          <p className="muted feedback-scan-note">消耗检查仅使用选定模拟批次；现场互动不含广告消耗。</p>
        </form>
      </section>

      <section className="feedback-section" aria-label="活动待办">
        <div className="feedback-section-heading">
          <h2>活动待办 <span className="subtle">{visible.length} 项</span></h2>
          <div className="tabs" role="group" aria-label="待办状态筛选">
            {filters.map(item => (
              <button type="button" className={`tab ${filter === item.id ? 'active' : ''}`} aria-pressed={filter === item.id} key={item.id} onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="feedback-task-list">
          {visible.map(item => (
            <article className="feedback-task" key={item.id}>
              <div className="feedback-task-icon"><AlertCircle size={20} /></div>
              <div className="feedback-task-copy">
                <div className="feedback-title-line"><h3>{item.title}</h3><Tag status={item.status} /></div>
                <p>{item.detail}</p>
                <div className="feedback-meta">
                  <span>{item.batch_id ? '模拟批次检查' : '业务待办'}</span>
                  <span>{readableTime(item.created_at)}</span><span>{item.rule}</span>
                </div>
                {item.note && <p className="feedback-note">处理备注：{item.note}</p>}
              </div>
              <Btn onClick={() => setTaskId(item.id)}>查看与处理<ChevronRight size={15} /></Btn>
            </article>
          ))}
        </div>
        {!visible.length && <Empty>{filter === 'active' ? '当前没有待推进事项，可检查当前活动。' : '此筛选下暂无事项。'}</Empty>}
      </section>
      {task && <TaskDialog key={task.id} task={task} props={props} close={() => setTaskId('')} />}
    </div>
  );
}
