import { ArrowLeft, ArrowRight } from 'lucide-react';
import { date, type Campaign, type State } from '../api';
import { Button } from '../components/ui';

export default function CampaignDetail({ campaign, state, go }: { campaign: Campaign; state: State; go: (route: string) => void }) {
  const creatives = state.creatives.filter(item => item.campaign_id === campaign.id);
  const plans = state.plans.filter(item => item.campaign_id === campaign.id);
  return <section className="workspace-detail">
    <Button kind="ghost" onClick={() => go('creative?view=campaigns')}><ArrowLeft size={15}/>返回活动列表</Button>
    <div className="workspace-detail-heading"><h2>{campaign.name}</h2><span className="muted">{date(campaign.created_at)}</span></div>
    <dl className="workspace-facts">
      <dt>关联商品</dt><dd>{campaign.product_snapshot.name}</dd>
      <dt>资料版本</dt><dd>V{campaign.product_snapshot.version} · {campaign.product_snapshot.color} · {campaign.product_snapshot.capacity}</dd>
      <dt>内容与计划</dt><dd>{creatives.length} 份创意 · {plans.length} 个投放计划</dd>
    </dl>
    <div className="workspace-record-grid">
      <article className="workspace-record"><h3>准备内容</h3><p>基于本活动商品快照，编辑与审核创意素材。</p><Button onClick={() => go('creative')}>进入内容创意<ArrowRight size={15}/></Button></article>
      <article className="workspace-record"><h3>管理执行</h3><p>查看计划状态、投放配置及当前活动结果。</p><div className="row-actions"><Button onClick={() => go('ads')}>查看投放计划</Button><Button onClick={() => go('analytics')}>查看活动效果</Button></div></article>
    </div>
  </section>;
}
