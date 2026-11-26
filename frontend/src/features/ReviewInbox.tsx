import { ArrowRight, Bot, FileCheck } from 'lucide-react';
import type { Creative } from '../api';
import { Button } from '../components/ui';

export default function ReviewInbox({ creatives, go }: { creatives: Creative[]; go: (route: string) => void }) {
  return <section className="workspace-detail">
    <div className="workspace-detail-heading"><h2>待办与审核</h2><Button kind="ghost" onClick={() => go('agent?status=attention')}><Bot size={15}/>Agent 待处理</Button></div>
    {creatives.filter(item => item.status === 'draft').map(item => <button key={item.id} className="workspace-action-row" onClick={() => go('creative?item=' + encodeURIComponent(item.id) + '&returnTo=' + encodeURIComponent('tasks?view=creative'))}>
      <FileCheck size={18}/><span><strong>{item.title}</strong><small>{item.product_snapshot.name} · V{item.version}</small></span><ArrowRight size={16}/>
    </button>)}
    {!creatives.some(item => item.status === 'draft') && <p className="muted">当前活动暂无待审核创意。</p>}
    <div className="row-actions"><Button onClick={() => go('agent?tab=demand&view=attention')}>需求任务待处理</Button><Button onClick={() => go('geo')}>查看 GEO 项目审核</Button></div>
  </section>;
}
