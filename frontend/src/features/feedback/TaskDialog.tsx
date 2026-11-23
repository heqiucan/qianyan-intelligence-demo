import { useState } from 'react';
import { ArrowRight, BrainCircuit, Check } from 'lucide-react';
import { api } from '../../api';
import { statusText } from './shared';
import { Btn, Dialog, Evidence, Field, Tag } from './sharedUI';
import type { FeedbackProps, FeedbackTask, TaskStatus } from './types';

const statuses: TaskStatus[] = ['pending', 'processing', 'review', 'resolved', 'ignored'];

export function TaskDialog({ task, props, close }: { task: FeedbackTask; props: FeedbackProps; close: () => void }) {
  const [nextStatus, setNextStatus] = useState<TaskStatus>(task.status);
  const [note, setNote] = useState(task.note || '');
  const [error, setError] = useState('');
  const isCreative = ['creative', 'creatives'].includes(task.object_type);

  const openObject = (diagnostic = false) => {
    if (task.batch_id) {
      props.setDataset('batch');
      props.setBatchId(task.batch_id);
    }
    props.setPlanId(task.plan_id || (['plan', 'plans'].includes(task.object_type) ? task.object_id : ''));
    if (!diagnostic) sessionStorage.setItem(isCreative ? 'focus-creative' : 'focus-plan', task.object_id);
    close();
    props.go(diagnostic ? 'analytics?view=optimize' : isCreative ? 'creative' : 'ads');
  };

  return (
    <Dialog title="异常与待办详情" close={close} busy={props.busy}>
      <div className="feedback-title-line"><h3>{task.title}</h3><Tag status={task.status} /></div>
      <p className="muted">{task.detail}</p>
      <details className="feedback-history">
        <summary>判断依据</summary>
        <Evidence value={task.evidence} />
        <p className="muted feedback-small">规则：{task.rule} · 事项编号：{task.id}</p>
      </details>
      <div className="feedback-actions">
        <Btn onClick={() => openObject()} disabled={props.busy}>打开相关{isCreative ? '素材' : '计划'}<ArrowRight size={14} /></Btn>
        {task.plan_id && <Btn onClick={() => openObject(true)} disabled={props.busy}><BrainCircuit size={15} />复盘相关计划</Btn>}
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        setError('');
        if (['resolved', 'ignored'].includes(nextStatus) && !note.trim()) {
          setError('解决或忽略事项前，请填写处理理由。');
          return;
        }
        void props.act(async () => {
          try {
            await api(`/tasks/${task.id}/status`, 'POST', { status: nextStatus, note: note.trim() });
            close();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
            throw cause;
          }
        }, '处理记录已保存');
      }}>
        <div className="form-grid">
          <Field label="处理状态">
            <select value={nextStatus} onChange={event => setNextStatus(event.target.value as TaskStatus)}>
              {statuses.map(status => <option value={status} key={status}>{statusText[status]}</option>)}
            </select>
          </Field>
          <Field label="处理备注 / 复查理由" full>
            <textarea rows={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="处理动作和复查依据" />
          </Field>
        </div>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <p className="feedback-caution">优化草稿不会自动解决事项；请核实结果后更新状态。</p>
        <div className="modal-footer">
          <Btn onClick={close} disabled={props.busy}>取消</Btn>
          <Btn type="submit" primary disabled={props.busy}><Check size={15} />保存处理记录</Btn>
        </div>
      </form>
      {!!task.history?.length && (
        <details className="feedback-history"><summary>处理历史（{task.history.length}）</summary><Evidence value={task.history} /></details>
      )}
    </Dialog>
  );
}
