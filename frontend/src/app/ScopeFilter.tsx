import { SlidersHorizontal } from 'lucide-react';
import { date, type Analytics, type V2Record } from '../api';
import { Button, Field } from '../components/ui';

export interface ScopeProps {
  dataset: string; setDataset: (value: string) => void; batchId: string; setBatchId: (value: string) => void;
  planId: string; setPlanId: (value: string) => void; dateFrom: string; setDateFrom: (value: string) => void;
  dateTo: string; setDateTo: (value: string) => void; batches: V2Record[]; plans: { id: string; name: string }[];
  analytics: Analytics | null;
}
export default function ScopeFilter(props: ScopeProps) {
  const { dataset, setDataset, batchId, setBatchId, planId, setPlanId, dateFrom, setDateFrom, dateTo, setDateTo, batches, plans, analytics } = props;
  return <details className="workspace-scope" aria-label="统一数据范围">
    <summary><SlidersHorizontal size={15}/>{dataset === 'history' ? '历史样例' : dataset === 'batch' ? '模拟批次' : '互动记录'} · {planId ? plans.find(p => p.id === planId)?.name || '指定计划' : '全部计划'} · {dateFrom || dateTo ? `${dateFrom || '起始'} 至 ${dateTo || '现在'}` : '全部日期'}</summary>
    <div className="workspace-scope-fields">
      <Field label="数据来源"><select value={dataset} onChange={e => setDataset(e.target.value)}><option value="session">现场互动记录</option><option value="history">历史演示 D0</option><option value="batch">模拟场景批次</option></select></Field>
      {dataset === 'batch' && <Field label="模拟数据批次"><select value={batchId} onChange={e => setBatchId(e.target.value)}><option value="">选择批次</option>{batches.map(b => <option key={b.id} value={b.id}>{b.label} · {date(b.created_at)}</option>)}</select></Field>}
      <Field label="投放计划筛选"><select value={planId} onChange={e => setPlanId(e.target.value)}><option value="">全部计划</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="统计开始日期"><input type="date" disabled={dataset !== 'session'} value={dateFrom} onChange={e => setDateFrom(e.target.value)}/></Field>
      <Field label="统计结束日期"><input type="date" disabled={dataset !== 'session'} min={dateFrom} value={dateTo} onChange={e => setDateTo(e.target.value)}/></Field>
    </div>
    <p className="workspace-inline-note">{analytics?.window || '请选择数据范围'} · {dataset === 'session' ? '模拟业务记录' : '样例数据'}</p>
    <Button kind="ghost" onClick={() => { setPlanId(''); setDateFrom(''); setDateTo(''); }}>清除筛选</Button>
  </details>;
}
