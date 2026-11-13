import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import type { Campaign, State } from '../../api';
import { today } from '../../domain';

export function activityJourney(state: State, campaign: Campaign) {
  const creatives = state.creatives.filter(c => c.campaign_id === campaign.id);
  const plans = state.plans.filter(p => p.campaign_id === campaign.id);
  const approved = creatives.some(c => c.status === 'approved');
  const day = today();
  const running = plans.find(p => p.status === 'running' && p.start_date <= day && day <= p.end_date);
  const hadRun = plans.some(p => ['running', 'paused', 'ended'].includes(p.status));
  const pendingPlan = plans.some(p => p.status === 'draft');
  const hasData = state.orders.some(o => o.campaign_id === campaign.id) || state.batches.some(b => b.campaign_id === campaign.id);
  const reviewed = state.insights.some(i => i.campaign_id === campaign.id);
  const reported = state.reports.some(i => i.campaign_id === campaign.id);
  const steps = [
    { id: 'product', label: '商品依据', done: !!campaign.product_snapshot.name },
    { id: 'creative', label: '确认素材', done: approved },
    { id: 'ads', label: '模拟投放', done: hadRun },
    { id: 'analytics', label: '成交与数据', done: hasData },
    { id: 'optimize', label: '效果复盘', done: reviewed },
    { id: 'reports', label: '保存报告', done: reported },
  ];
  const next = !approved
    ? { route: 'creative', title: creatives.length ? '核对并确认一份素材' : '生成第一份活动创意', detail: '生成或从知识草稿转入后，先核对商品事实，再确认素材；草稿不能直接用于投放。', label: '去核对活动创意' }
    : !hadRun
    ? { route: 'ads', title: pendingPlan ? '计划草稿已保存，下一步确认启动' : '创建并启动模拟计划', detail: pendingPlan ? '在计划行点击“确认启动”，核对素材、预算和周期，再确认模拟启动。' : '已有确认素材。选择素材、预算和覆盖今天的周期，保存后再确认模拟启动。', label: pendingPlan ? '核对投放计划' : '去创建投放计划' }
    : !hasData && running
    ? { route: 'shop/' + running.id, title: '亲自体验一次模拟成交', detail: `「${running.name}」正在模拟运行。从广告进入商品页，确认订单并模拟付款。`, label: '体验模拟购买' }
    : !hasData
    ? { route: 'ads', title: '先准备一个可体验的计划', detail: '当前没有有效周期内的运行计划。请检查状态与周期，恢复或新建计划。', label: '检查计划与周期' }
    : !reviewed
    ? { route: 'analytics', title: '查看数据，再形成复盘', detail: '已有测试订单或独立模拟批次。选对来源，查看订单与消耗依据，再生成复盘。', label: '查看结果与来源' }
    : !reported
    ? { route: 'reports', title: '保存本轮结论与下一步', detail: '复盘已经保存。确认报告的数据范围，填写人工结论，保存报告快照。', label: '去保存活动报告' }
    : { route: 'reports', title: '本轮已有报告，可以继续下一次迭代', detail: '报告保留生成时的快照。后续修改素材或计划会另存版本，不会改写历史结果。', label: '查看已保存报告' };
  return { steps, next, hasData, reviewed };
}

export default function ActivityJourney({ state, campaign, route, go }: { state: State; campaign?: Campaign; route: string; go: (route: string) => void }) {
  if (!campaign) return null;
  const progress = activityJourney(state, campaign);
  const { steps } = progress;
  const next = route === 'analytics' && progress.hasData && !progress.reviewed
    ? { route: 'optimize', title: '看过结果后，生成一次复盘', detail: '沿用当前数据来源、计划和日期，生成事实、待验证原因与建议。', label: '基于当前范围复盘' }
    : progress.next;
  const active = route === 'tasks' ? 'analytics' : route;
  return <section className="panel journey-progress feedback-no-print" aria-label="当前活动路径">
    <div className="journey-progress-context"><strong>当前商品活动 · {campaign.name}</strong><span>按已保存记录标记 · 资料 V{campaign.product_snapshot.version}</span></div>
    <ol>{steps.map((step, i) => <li key={step.id}><button type="button" aria-current={active === step.id ? 'step' : undefined} className={`${step.done ? 'done' : ''} ${active === step.id ? 'current' : ''}`} onClick={() => go(step.id)}><span>{step.done ? <Check size={13}/> : i + 1}</span>{step.label}</button>{i < steps.length - 1 && <ChevronRight size={13} aria-hidden="true"/>}</li>)}</ol>
    <div className="journey-next"><div><strong>{next.title}</strong><p>{next.detail}</p></div><button className="button secondary" type="button" onClick={() => go(next.route)}>{next.label}<ArrowRight size={14}/></button></div>
  </section>;
}
