import { ArrowRight, Plus } from 'lucide-react';
import { date, type State } from '../api';
import { Button } from '../components/ui';

export default function CampaignList({ state, select, create }: { state: State; select: (id: string) => void; create: () => void }) {
  return <section className="workspace-section">
    <div className="workspace-section-heading"><h2>营销活动</h2><Button kind="primary" onClick={create}><Plus size={16}/>新建营销活动</Button></div>
    <div className="workspace-campaign-list">{state.campaigns.slice().reverse().map(campaign => <button key={campaign.id} className="workspace-action-row" onClick={() => select(campaign.id)}>
      <img width="42" height="42" style={{ objectFit: 'cover', borderRadius: 6 }} src={campaign.product_snapshot.image_url} alt=""/>
      <span><strong>{campaign.name}</strong><small>{campaign.product_snapshot.name} · {date(campaign.created_at)}</small></span>
      <span>{state.creatives.filter(c => c.campaign_id === campaign.id).length} 份素材</span><ArrowRight size={16}/>
    </button>)}</div>
  </section>;
}
