import type { ReactNode } from 'react';
import { ArrowRight, BrainCircuit, Check, ChevronRight, ListTodo, Megaphone, Play, Sparkles } from 'lucide-react';
import { date, money, type Analytics, type Campaign, type State } from '../api';
import { Badge, Button, Details } from '../components/ui';
import { OrbitVisual } from '../visuals';
import OverviewStats from '../components/OverviewStats';

interface Props {
  start?: ReactNode; state: State; campaign?: Campaign; campaignId: string; analytics: Analytics | null;
  go: (page: string) => void; inspect: (section: string) => void; setDialog: (dialog: string) => void;
}

// Preserve the original home presentation; creative checks remain an enhancement in its page.
export default function Overview({state, campaign, campaignId, analytics, go, inspect, setDialog, start}: Props) {
  const cs = state.creatives.filter(c => c.campaign_id === campaignId);
  const ps = state.plans.filter(p => p.campaign_id === campaignId);
  const batches = state.batches.filter(b => b.campaign_id === campaignId);
  return <><section className="hero"><div className="hero-copy"><Badge><Sparkles size={13}/>营销行动工作台</Badge><h2>让好创意，<br/>走向下一次增长。</h2><p>明确目标，执行投放，追踪成交。<br/>每次调整都有依据，也有下一步。</p><div className="hero-actions"><Button kind="primary" onClick={()=>go('creative')}>开始创作<ArrowRight size={16}/></Button><Button kind="ghost" onClick={()=>setDialog('guide')}><Play size={14}/>演示路线</Button></div><div className="hero-caption">CREATE. ACT. LEARN.</div></div><div className="hero-art"><OrbitVisual/></div></section>{start}<OverviewStats analytics={analytics} onSelect={inspect}/><div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><h3>当前活动策略</h3><span className="muted">{campaign?.name} · 策略 V{campaign?.strategy_version||1}</span></div><Button kind="ghost" onClick={()=>setDialog('campaign-edit')}>编辑策略</Button></div><Details items={[["内部观察目标",campaign?.goal],["受众假设",campaign?.audience],["主推卖点",campaign?.selling_point],["活动预算上限",money(campaign?.budget_limit)],["计划周期",campaign?.start_date?`${campaign.start_date} → ${campaign.end_date}`:'待补充'],["商品依据",`${campaign?.product_snapshot.name} · 资料 V${campaign?.product_snapshot.version}`]]}/>{(campaign?.strategy_history?.length||0)>0&&<details><summary>查看策略历史（{campaign?.strategy_history?.length}）</summary>{campaign?.strategy_history?.map((h,i)=><p key={i} className="muted">V{h.strategy_version||i+1} · {h.goal||h.name} · {date(h.updated_at||h.created_at)}</p>)}</details>}</section><section className="panel"><div className="panel-header"><h3>下一步，继续推进</h3><Badge>{cs.filter(c=>c.status==='draft').length+ps.filter(p=>p.status==='draft').length} 项待确认</Badge></div><div className="next-actions">{[{p:'creative',icon:Sparkles,t:'确认活动素材',s:`${cs.filter(c=>c.status==='draft').length} 份创意草稿`},{p:'ads',icon:Megaphone,t:'核对投放计划',s:`${ps.filter(p=>p.status==='draft').length} 份草稿 · ${ps.filter(p=>p.status==='running').length} 个模拟运行计划`},{p:'tasks',icon:ListTodo,t:'检查异常与待办',s:`${state.tasks.filter(t=>t.campaign_id===campaignId&&!['resolved','ignored'].includes(t.status)).length} 项待处理`},{p:'optimize',icon:BrainCircuit,t:'继续优化观察',s:`${state.observations.filter(o=>o.campaign_id===campaignId&&o.status!=='reviewed').length} 项待观察`}].map(a=><button key={a.p} onClick={()=>go(a.p)}><span className="action-icon"><a.icon size={19}/></span><span><strong>{a.t}</strong><small>{a.s}</small></span><ChevronRight size={16}/></button>)}</div></section></div></>;
}
