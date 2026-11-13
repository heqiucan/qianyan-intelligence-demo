import { ArrowRight, Info } from 'lucide-react';
import type { Analytics } from '../../api';
import { Button } from '../../components/ui';

export default function SourceGuide({ dataset, analytics, batchId, session, scenarios, compact = false }: {
  dataset: string; analytics: Analytics | null; batchId: string; session: () => void; scenarios: () => void;
  compact?: boolean;
}) {
  const text = dataset === 'session'
    ? '刚刚体验购买？订单在这里。现场记录保存在本机，没有广告平台曝光和消耗，因此消耗与 ROI 暂不能计算。'
    : dataset === 'history'
    ? '这里是固定的虚构历史样例 D0，不包含你刚刚的购买。新建活动没有 D0 数据属于正常情况。'
    : batchId ? '这里只展示所选批次的固定演示数据，不累计其他批次，也不包含现场购买。' : '还没有选定批次。先在广告投放中预览场景，再确认载入一份独立样例。';
  const content = <div className="journey-source" aria-label="数据来源使用说明"><Info size={17}/><div><strong>{dataset === 'session' ? '看自己的操作，选现场互动记录' : dataset === 'history' ? '历史样例与本次操作分开' : '每个模拟批次单独查看'}</strong><p>{text}</p>
    {analytics && !analytics.metrics.orders && <small>当前筛选范围没有订单；可检查活动、计划和日期，或体验一次模拟购买。</small>}
    <div className="row-actions"><Button kind="ghost" onClick={session}>看我刚才的购买<ArrowRight size={13}/></Button><Button kind="ghost" onClick={scenarios}>去载入投放样例<ArrowRight size={13}/></Button></div>
  </div></div>;
  return compact ? <details className="journey-source-disclosure"><summary>这些数据来自哪里？看不到订单怎么办？</summary>{content}</details> : content;
}
