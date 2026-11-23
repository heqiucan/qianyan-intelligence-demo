import { useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { readableTime, sourceText } from './shared';
import { Btn, Evidence, Field, Tag } from './sharedUI';
import { records, type FeedbackObservation, type FeedbackProps } from './types';

export function ObservationCard({ observation, props }: { observation: FeedbackObservation; props: FeedbackProps }) {
  const adjustment = records(props.state, 'adjustments').find(item => item.id === observation.adjustment_id);
  const plans = props.state.plans.filter(item => (
    item.campaign_id === props.campaignId && item.status === 'running'
    && (!observation.creative_id || item.creative_id === observation.creative_id)
    && (!observation.adjustment_id || (
      item.id === observation.plan_id && adjustment?.status === 'applied'
      && (item.config_version || 1) === adjustment.applied_config_version
    ))
  ));
  const [plan, setPlan] = useState(observation.plan_id || '');
  const [batch, setBatch] = useState('');
  const [note, setNote] = useState('');
  const [operationError, setOperationError] = useState('');
  const selectedPlan = plans.find(item => item.id === plan) || plans[0];
  const batches = records(props.state, 'batches').filter(item => (
    item.campaign_id === props.campaignId && item.plan_id === observation.plan_id
    && item.id !== observation.baseline_batch_id
    && (!observation.start_at || item.created_at > observation.start_at)
    && (!observation.config_version || (item.plan_snapshot?.config_version || 1) === observation.config_version)
  ));
  const operate = async (path: string, payload: Record<string, unknown>) => {
    setOperationError('');
    try {
      return await api(path, 'POST', payload);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : '操作失败，请重试。');
      throw error;
    }
  };

  return (
    <article className="feedback-observation">
      <div className="feedback-title-line">
        <div>
          <h3><Clock3 size={15} />{observation.metric || '支付订单'} · {observation.id.slice(-6)}</h3>
          <p className="muted">基线：{sourceText(observation.baseline_dataset)} · 起点：{readableTime(observation.start_at)}</p>
        </div>
        <Tag status={observation.status} />
      </div>
      <p className="feedback-note">{observation.note || '等待确认调整与同源后续数据。'}</p>
      {observation.review_note && <p className="feedback-note">观察备注：{observation.review_note}</p>}

      {observation.status === 'waiting_confirmation' && (
        <div className="feedback-observe-form">
          <Field label={`观察计划 ${observation.id.slice(-6)}`}>
            <select value={selectedPlan?.id || ''} onChange={event => setPlan(event.target.value)}>
              {!plans.length && <option value="">{observation.adjustment_id ? '请先应用调整并运行对应配置的计划' : '请先确认素材并启动对应计划'}</option>}
              {plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Btn disabled={props.busy || !selectedPlan} onClick={() => {
            void props.act(async () => {
              await operate(`/observations/${observation.id}/start`, { plan_id: selectedPlan?.id });
            }, '观察起点已保存');
          }}>开始观察</Btn>
        </div>
      )}

      {observation.status === 'observing' && (
        <form onSubmit={event => {
          event.preventDefault();
          void props.act(async () => {
            await operate(`/observations/${observation.id}/review`, { ...(batch ? { batch_id: batch } : {}), note });
          }, '已检查后续数据');
        }}>
          <div className="form-grid">
            {observation.baseline_dataset === 'batch' && (
              <Field label={`后续模拟批次 ${observation.id.slice(-6)}`}>
                <select value={batch} onChange={event => setBatch(event.target.value)}>
                  <option value="">检查数据是否齐备</option>
                  {batches.map(item => <option key={item.id} value={item.id}>{item.label} · {readableTime(item.created_at)}</option>)}
                </select>
              </Field>
            )}
            <Field label={`观察备注 ${observation.id.slice(-6)}`}>
              <input value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
            </Field>
          </div>
          <div className="feedback-actions">
            <Btn type="submit" disabled={props.busy}><RefreshCw size={14} />检查后续数据</Btn>
            {observation.plan_id && <Btn onClick={() => { props.setPlanId(observation.plan_id!); props.go('ads'); }}>打开观察计划</Btn>}
          </div>
          <p className="feedback-caution">仅比较同源、同计划配置的后续窗口；数据不足时继续观察，不判定优化成功。</p>
        </form>
      )}
      {operationError && <p className="error-banner" role="alert">{operationError}</p>}
      {observation.comparison != null && (
        <details className="feedback-history"><summary>观察结果与口径</summary><Evidence value={observation.comparison} /></details>
      )}
    </article>
  );
}
