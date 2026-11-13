import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import type { Campaign, Creative, Plan, State } from '../api';

export function activityProgress(state: State, campaign?: Campaign) {
  const creatives = state.creatives.filter(c => c.campaign_id === campaign?.id);
  const plans = state.plans.filter(p => p.campaign_id === campaign?.id);
  const approved = creatives.some(c => c.status === 'approved');
  const running = plans.find(p => p.status === 'running');
  const hadRun = plans.some(p => ['running', 'paused', 'ended'].includes(p.status));
  const hasOrders = state.orders.some(o => o.campaign_id === campaign?.id) || state.batches.some(b => b.campaign_id === campaign?.id && b.metrics?.orders > 0);
  const reviewed = state.insights.some(i => i.campaign_id === campaign?.id);
  const steps = [
    { id: 'product', label: '商品依据', done: !!campaign?.product_snapshot.name },
    { id: 'creative', label: '创意核对', done: approved },
    { id: 'ads', label: '模拟投放', done: hadRun },
    { id: 'analytics', label: '成交记录', done: hasOrders },
    { id: 'optimize', label: '效果复盘', done: reviewed },
  ];
  const next = !approved
    ? { route: 'creative', title: creatives.length ? '核对并确认一份创意' : '生成第一份创意', detail: '根据活动商品资料检查文案，确认后再用于投放。', label: '进入创意工作室' }
    : !hadRun
    ? { route: 'ads', title: '让已确认的素材进入投放', detail: '核对素材、预算和周期，启动一个模拟计划。', label: '核对投放计划' }
    : !hasOrders && running
    ? { route: 'shop/' + running.id, title: '体验一次完整的模拟成交', detail: `通过「${running.name}」进入商品页，订单会保留素材与计划的对应记录。`, label: '体验模拟购买' }
    : !hasOrders
    ? { route: 'ads', title: '选择一个计划继续演示', detail: '当前没有运行计划。可恢复有效周期内的计划，或新建计划。', label: '查看投放计划' }
    : { route: 'analytics', title: '查看成交，并决定下一步', detail: '选择现场记录或独立模拟批次，查看依据，再形成优化草稿。', label: '查看效果与复盘' };
  return { steps, next, creatives, plans };
}

export default function Workflow({state, campaign, route, go}: {state: State; campaign?: Campaign; route: string; go: (route: string) => void}) {
  if (!campaign) return null;
  const {steps, next} = activityProgress(state, campaign);
  const active = ({reports:'optimize',tasks:'analytics',overview:''} as Record<string,string>)[route] ?? route;
  return <section className="v3-workflow feedback-no-print" aria-label="当前活动路径">
    <div className="v3-workflow-context"><span>当前活动</span><strong>{campaign.name}</strong><small>资料 V{campaign.product_snapshot.version}</small></div>
    <ol>{steps.map((step, index) => <li key={step.id}>
      <button type="button" aria-current={active === step.id ? 'step' : undefined} className={`${step.done ? 'done' : ''} ${active === step.id ? 'current' : ''}`} onClick={() => go(step.id)}>
        <span>{step.done ? <Check size={13}/> : index + 1}</span>{step.label}
      </button>{index < steps.length - 1 && <ChevronRight size={13} aria-hidden="true"/>}
    </li>)}</ol>
    <button type="button" className="v3-workflow-next" onClick={() => go(next.route)}>下一步：{next.label}<ArrowRight size={14}/></button>
  </section>;
}
