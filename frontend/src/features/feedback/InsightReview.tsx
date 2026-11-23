import { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, SearchCheck } from 'lucide-react';
import { api, generationSource } from '../../api';
import { sourceText, statusText, useSubmit } from './shared';
import { Btn, Dialog, Evidence, Field, Tag } from './sharedUI';
import { records, type FeedbackInsight, type FeedbackProps } from './types';

export function InsightReview({ insight, props }: { insight: FeedbackInsight; props: FeedbackProps }) {
  const { state, campaignId, busy, act } = props;
  const allCreatives = state.creatives.filter(item => item.campaign_id === campaignId);
  const plans = state.plans.filter(item => item.campaign_id === campaignId);
  const adjustments = records(state, 'adjustments').filter(item => item.campaign_id === campaignId);
  const [action, setAction] = useState<'creative' | 'plan'>('creative');
  const [creativeId, setCreativeId] = useState('');
  const [targetPlan, setTargetPlan] = useState('');
  const [budget, setBudget] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState(insight.recommendation || '');
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [confirmAction, setConfirmAction] = useState(false);
  const [modalError, setModalError] = useState('');
  const submit = useSubmit();

  const snapshot = insight.analytics_snapshot;
  const insightBatch = records(state, 'batches').find(item => item.id === snapshot?.dataset_id);
  const scopedPlanId = snapshot?.dataset === 'history' ? '' : insightBatch?.plan_id || snapshot?.filters?.plan_id || '';
  const scopedPlan = plans.find(item => item.id === scopedPlanId);
  const scopedCreative = allCreatives.find(item => item.id === scopedPlan?.creative_id);
  const creatives = scopedCreative
    ? allCreatives.filter(item => (item.family_id || item.id) === (scopedCreative.family_id || scopedCreative.id))
    : allCreatives;
  const currentCreative = creatives.find(item => item.id === creativeId) || creatives.at(-1);
  const availablePlans = plans.filter(item => ['running', 'paused'].includes(item.status) && (!scopedPlanId || item.id === scopedPlanId));
  const currentPlan = availablePlans.find(item => item.id === targetPlan)
    || availablePlans.find(item => item.id === props.planId) || availablePlans[0];

  useEffect(() => {
    if (!currentPlan) return;
    setBudget(String(currentPlan.budget));
    setStart(currentPlan.start_date);
    setEnd(currentPlan.end_date);
  }, [currentPlan?.id, currentPlan?.budget, currentPlan?.start_date, currentPlan?.end_date]);

  const resultAdjustment = adjustments.find(item => item.id === insight.result_adjustment_id || item.insight_id === insight.id);
  const resultCreative = allCreatives.find(item => item.id === insight.result_creative_id);
  const canAct = (!insight.status || insight.status === 'pending') && !resultAdjustment && !resultCreative;
  const actionUnavailable = action === 'creative' ? !currentCreative : !currentPlan;
  const createAction = async () => {
    if (!canAct || actionUnavailable) return;
    setModalError('');
    try {
      if (action === 'creative' && currentCreative) {
        await submit(`/insights/${insight.id}/accept`, { creative_id: currentCreative.id });
      }
      if (action === 'plan' && currentPlan) {
        await submit(`/plans/${currentPlan.id}/adjustments`, {
          insight_id: insight.id, budget: Number(budget), start_date: start, end_date: end, reason,
        });
      }
      setConfirmAction(false);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : '创建草稿失败，请重试。');
      throw error;
    }
  };

  return (
    <div className="feedback-insight">
      <p className="feedback-scope">
        {snapshot?.label || sourceText(insight.dataset)} · {snapshot?.window || '窗口未提供'} · {generationSource(insight)}
      </p>
      <details className="feedback-history">
        <summary>复盘依据：事实、假设与缺失信息</summary>
        <div className="feedback-insight-grid">
          <section>
            <h3><CheckCircle2 size={17} />已知事实</h3>
            <ul className="facts-list">{(insight.facts || []).map((fact, index) => <li key={index}>{fact}</li>)}</ul>
          </section>
          <section>
            <h3><SearchCheck size={17} />待验证原因</h3>
            <ul className="facts-list">{(insight.hypotheses || []).map((fact, index) => <li key={index}>{fact}</li>)}</ul>
            {!!insight.missing?.length && <p className="feedback-caution">缺失信息：{insight.missing.join('；')}</p>}
          </section>
        </div>
      </details>

      <section className="feedback-recommendation" aria-label="建议动作">
        <div className="feedback-title-line"><h3>建议动作</h3><Tag status={insight.status || 'pending'} /></div>
        <p className="feedback-recommendation-text">{insight.recommendation}</p>
        {canAct ? (
          <form onSubmit={event => { event.preventDefault(); setModalError(''); setConfirmAction(true); }}>
            <div className="tabs feedback-action-tabs" role="group" aria-label="采纳建议方式">
              <button type="button" className={`tab ${action === 'creative' ? 'active' : ''}`} aria-pressed={action === 'creative'} onClick={() => setAction('creative')}>生成下一版素材</button>
              <button type="button" className={`tab ${action === 'plan' ? 'active' : ''}`} aria-pressed={action === 'plan'} onClick={() => setAction('plan')}>调整计划</button>
            </div>
            {action === 'creative' ? (
              <Field label="选择要优化的素材">
                <select value={currentCreative?.id || ''} onChange={event => setCreativeId(event.target.value)}>
                  {!creatives.length && <option value="">请先创建素材</option>}
                  {creatives.map(item => <option key={item.id} value={item.id}>{item.title} · V{item.version}</option>)}
                </select>
              </Field>
            ) : (
              <div className="form-grid">
                <Field label="要调整的计划" full>
                  <select value={currentPlan?.id || ''} onChange={event => setTargetPlan(event.target.value)}>
                    {!availablePlans.length && <option value="">没有可调整的运行或暂停计划</option>}
                    {availablePlans.map(item => <option key={item.id} value={item.id}>{item.name} · {statusText[item.status]}</option>)}
                  </select>
                </Field>
                <Field label="调整后计划预算 / 元">
                  <input type="number" min="0.01" max="1000000" step="0.01" value={budget} required onChange={event => setBudget(event.target.value)} />
                </Field>
                <Field label="调整后开始日期"><input type="date" value={start} required onChange={event => setStart(event.target.value)} /></Field>
                <Field label="调整后结束日期"><input type="date" min={start} value={end} required onChange={event => setEnd(event.target.value)} /></Field>
                <Field label="调整理由" full><textarea value={reason} required maxLength={2000} rows={3} onChange={event => setReason(event.target.value)} /></Field>
              </div>
            )}
            <p className="feedback-caution">
              {scopedPlanId && '仅限此计划或其素材系列。'}每条建议可采纳一种动作，草稿需人工确认后执行。
            </p>
            <div className="feedback-actions">
              <Btn type="submit" primary disabled={busy || actionUnavailable}><Check size={15} />核对并创建草稿</Btn>
              <Btn onClick={() => { setModalError(''); setDismissOpen(true); }} disabled={busy}>暂不采纳</Btn>
            </div>
          </form>
        ) : (
          <div className="feedback-result">
            {resultCreative && <>
              <p><CheckCircle2 size={16} />已生成：{resultCreative.title} · V{resultCreative.version}</p>
              <Btn onClick={() => { sessionStorage.setItem('focus-creative', resultCreative.id); props.go('creative'); }}>查看并确认素材<ArrowRight size={15} /></Btn>
            </>}
            {resultAdjustment && <>
              <p><CheckCircle2 size={16} />计划调整 · {statusText[resultAdjustment.status]}</p>
              <details className="feedback-history"><summary>调整前后对比</summary><Evidence value={{ before: resultAdjustment.before, after: resultAdjustment.after }} /></details>
              <Btn onClick={() => {
                props.setPlanId(resultAdjustment.plan_id);
                sessionStorage.setItem('focus-adjustment', resultAdjustment.id);
                props.go('ads');
              }}>查看并确认计划调整<ArrowRight size={15} /></Btn>
            </>}
            {!resultCreative && !resultAdjustment && <p>{insight.dismiss_reason || insight.reason || '此复盘已处理。'}</p>}
          </div>
        )}
      </section>

      {dismissOpen && <Dialog title="暂不采纳" close={() => setDismissOpen(false)} busy={busy}>
        <form onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            setModalError('');
            try {
              await api(`/insights/${insight.id}/dismiss`, 'POST', { reason: dismissReason.trim() });
              setDismissOpen(false);
            } catch (error) {
              setModalError(error instanceof Error ? error.message : '保存失败，请重试。');
              throw error;
            }
          }, '已记录暂不采纳的原因');
        }}>
          <Field label="不采纳理由"><textarea value={dismissReason} required maxLength={2000} onChange={event => setDismissReason(event.target.value)} /></Field>
          {modalError && <p className="error-banner" role="alert">{modalError}</p>}
          <div className="modal-footer"><Btn onClick={() => setDismissOpen(false)} disabled={busy}>取消</Btn><Btn type="submit" primary disabled={busy || !dismissReason.trim()}>保存理由</Btn></div>
        </form>
      </Dialog>}

      {confirmAction && <Dialog title="确认创建优化草稿" close={() => setConfirmAction(false)} busy={busy}>
        <p>{action === 'creative'
          ? `基于「${currentCreative?.title}」V${currentCreative?.version} 创建下一版素材。`
          : `为「${currentPlan?.name}」创建调整草稿，执行前需在投放中心确认。`}</p>
        {action === 'plan' && <Evidence value={{
          before: { budget: currentPlan?.budget, start_date: currentPlan?.start_date, end_date: currentPlan?.end_date },
          after: { budget: Number(budget), start_date: start, end_date: end }, reason,
        }} />}
        <p className="feedback-caution">仅保存草稿，不产生真实花费或改善数据。</p>
        {modalError && <p className="error-banner" role="alert">{modalError}</p>}
        <div className="modal-footer">
          <Btn onClick={() => setConfirmAction(false)} disabled={busy}>返回修改</Btn>
          <Btn primary disabled={busy || !canAct || actionUnavailable} onClick={() => { void act(createAction, '优化草稿已创建，等待人工确认'); }}>确认创建草稿</Btn>
        </div>
      </Dialog>}
    </div>
  );
}
