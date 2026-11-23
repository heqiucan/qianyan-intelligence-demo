import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, FlaskConical, List, Pause, Play, Plus, ShieldCheck } from 'lucide-react';
import { api, money, requestId, type Plan, type State, type V2Record } from '../api';
import { Badge, Button, Empty, Table } from '../components/ui';
import { names, type Act } from '../domain';
import PlanDialogs, { type PlanDialog } from './ads/PlanDialogs';
import ScenarioWorkspace from './ads/ScenarioWorkspace';
import './ads/ads.css';

interface Props {
  initialScenarios?: boolean; state: State; campaignId: string; busy: boolean; error: string;
  act: Act; go: (route: string) => void; initialCreative: string;
  clearCreative: () => void; loadedBatch: (batch: V2Record) => void;
}

export default function AdsPage({ state, campaignId, busy, error, act, go, initialCreative, clearCreative, loadedBatch, initialScenarios = false }: Props) {
  const plans = state.plans.filter(plan => plan.campaign_id === campaignId);
  const approved = state.creatives.filter(creative => creative.campaign_id === campaignId && creative.status === 'approved');
  const adjustments = state.adjustments.filter(adjustment => adjustment.campaign_id === campaignId);
  const [selectedCreative, setSelectedCreative] = useState(initialCreative);
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [scenarioPlanId, setScenarioPlanId] = useState('');
  const consumedCreative = useRef('');
  const selectedRunning = selection.filter(id => plans.some(plan => plan.id === id && plan.status === 'running'));
  const open = (kind: 'detail' | 'edit' | 'start', plan: Plan) => setDialog({ kind, planId: plan.id, requestId: requestId() });

  useEffect(() => {
    if (!initialCreative) { consumedCreative.current = ''; return; }
    if (consumedCreative.current === initialCreative) return;
    consumedCreative.current = initialCreative;
    setSelectedCreative(initialCreative);
    setDialog({ kind: 'create', requestId: requestId() });
    clearCreative();
  }, [initialCreative, clearCreative]);

  useEffect(() => {
    if (initialCreative) return;
    const adjustmentId = sessionStorage.getItem('focus-adjustment');
    const adjustment = adjustments.find(item => item.id === adjustmentId);
    if (adjustment) {
      setDialog({ kind: 'apply', planId: adjustment.plan_id, adjustmentId: adjustment.id, requestId: requestId() });
      sessionStorage.removeItem('focus-adjustment');
      sessionStorage.removeItem('focus-plan');
      return;
    }
    const planId = sessionStorage.getItem('focus-plan');
    if (planId && plans.some(plan => plan.id === planId)) {
      setDialog({ kind: 'detail', planId, requestId: requestId() });
      sessionStorage.removeItem('focus-plan');
    }
  }, [initialCreative, state.plans, state.adjustments, campaignId]);

  const showScenarios = (plan: Plan) => {
    setScenarioPlanId(plan.id);
    setDialog(null);
    go('ads?scenarios=1');
  };

  return <div className="ads-page">
    <div className="ads-mode-note"><ShieldCheck size={17}/><span>模拟投放与支付，不产生真实花费。</span></div>
    <nav className="ads-tabs" aria-label="投放视图">
      <button type="button" aria-current={!initialScenarios ? 'page' : undefined} disabled={busy} onClick={() => go('ads')}><List size={15}/>计划列表</button>
      <button type="button" aria-current={initialScenarios ? 'page' : undefined} disabled={busy} onClick={() => go('ads?scenarios=1')}><FlaskConical size={15}/>模拟场景</button>
    </nav>
    {initialScenarios ? <ScenarioWorkspace
      plans={plans} initialPlanId={scenarioPlanId} busy={busy} act={act} loadedBatch={loadedBatch}
    /> : <>
      <div className="ads-section-heading">
        <div><h2>投放计划</h2><p className="muted">{plans.length} 个计划 · {plans.filter(plan => plan.status === 'running').length} 个运行中</p></div>
        <div className="row-actions">
          <Button disabled={busy || !selectedRunning.length} onClick={() => setDialog({ kind: 'bulk', planIds: selectedRunning, requestId: requestId() })}><Pause size={14}/>批量暂停（{selectedRunning.length}）</Button>
          <Button kind="primary" disabled={busy || !approved.length} title={!approved.length ? '请先确认一份素材' : undefined} onClick={() => setDialog({ kind: 'create', requestId: requestId() })}><Plus size={16}/>创建投放计划</Button>
        </div>
      </div>
      {!approved.length && <div className="notice">创建计划需要已确认素材。<Button kind="ghost" onClick={() => go('creative')}>去确认素材<ArrowRight size={14}/></Button></div>}
      <section className="ads-plan-list" aria-label="投放计划列表">
        <Table headers={['选择', '计划名称 / 素材', '状态', '预算配置', '计划周期', '操作']}>
          {plans.map(plan => <tr key={plan.id}>
            <td><input aria-label={`选择计划 ${plan.name}`} type="checkbox" checked={selectedRunning.includes(plan.id)} disabled={busy || plan.status !== 'running'} onChange={event => setSelection(ids => event.target.checked ? [...new Set([...ids, plan.id])] : ids.filter(id => id !== plan.id))}/></td>
            <td><button className="v2-text-button" disabled={busy} onClick={() => open('detail', plan)}>{plan.name}</button><small>{plan.creative_snapshot.title} · 素材 V{plan.creative_snapshot.version}</small></td>
            <td><Badge tone={plan.status === 'running' ? 'green' : plan.status === 'paused' ? 'amber' : 'neutral'}>{names[plan.status]}</Badge></td>
            <td>{money(plan.budget)}<small>总预算 · 配置 V{plan.config_version || 1}</small></td>
            <td>{plan.start_date}<small>至 {plan.end_date}</small></td>
            <td><div className="row-actions">
              <Button kind="ghost" disabled={busy} onClick={() => open('detail', plan)}>详情</Button>
              {plan.status === 'draft' && <Button disabled={busy} onClick={() => open('edit', plan)}>编辑草稿</Button>}
              {(plan.status === 'draft' || plan.status === 'paused') && <Button disabled={busy} onClick={() => open('start', plan)}><Play size={13}/>{plan.status === 'draft' ? '确认启动' : '恢复'}</Button>}
              {plan.status === 'running' && <>
                <Button disabled={busy} onClick={() => { void act(() => api(`/plans/${plan.id}/status`, 'POST', { status: 'paused' }), '计划已暂停'); }}><Pause size={13}/>暂停</Button>
                <Button kind="primary" disabled={busy} onClick={() => go(`shop/${plan.id}`)}>体验购买<ExternalLink size={13}/></Button>
              </>}
            </div></td>
          </tr>)}
        </Table>
        {!plans.length && <Empty text="暂无计划，使用已确认素材创建计划草稿。"/>}
      </section>
      <details className="ads-rules"><summary>计划规则与数据口径</summary>
        <p>草稿经人工确认后模拟运行，可暂停、恢复或结束。已结束计划不能恢复，可复制为新草稿。</p>
        <p>预算为配置值，周期按 UTC 日期核对，不触发自动调度。更换素材需新建计划；原计划保留素材快照。</p>
        <p>预算与周期调整先保存草稿，再确认应用。调整记录在对应计划详情中查看。</p>
      </details>
    </>}
    {dialog && <PlanDialogs
      key={dialog.requestId} dialog={dialog} change={setDialog} close={() => setDialog(null)}
      plans={plans} approved={approved} adjustments={adjustments} batches={state.batches}
      selectedCreative={selectedCreative} busy={busy} error={error} act={act}
      paused={() => setSelection([])} scenarios={showScenarios}
    />}
  </div>;
}
