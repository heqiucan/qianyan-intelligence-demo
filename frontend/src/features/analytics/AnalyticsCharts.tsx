import { useId, useState } from 'react';
import { ArrowUpRight, Users } from 'lucide-react';
import type { Analytics } from '../../api';
import { Empty, Table } from '../../components/ui';
import { buyerComposition, formatMetric, planRanking, type RankingMetric, type MetricFormat } from './data';

const rankingMetrics: { key: RankingMetric; label: string; unit: string; format: MetricFormat }[] = [
  { key: 'revenue', label: '支付金额', unit: '元', format: 'money' },
  { key: 'orders', label: '支付订单', unit: '笔', format: 'number' },
  { key: 'new_customers', label: '识别新客', unit: '人', format: 'number' },
  { key: 'spend', label: '广告消耗', unit: '元', format: 'money' },
];

export default function AnalyticsCharts({ analytics, selectPlan }: { analytics: Analytics; selectPlan: (id: string) => void }) {
  const [metric, setMetric] = useState<RankingMetric>('revenue');
  const rankingId = useId();
  const buyersId = useId();
  const selected = rankingMetrics.find(item => item.key === metric)!;
  const ranked = planRanking(analytics.rows, metric);
  const composition = buyerComposition(analytics.metrics);
  return <div className="analytics-chart-grid">
    <section className="analytics-section analytics-ranking" aria-labelledby={rankingId}>
      <div className="analytics-section-heading">
        <h3 id={rankingId}>计划排名</h3>
        <label className="analytics-ranking-select"><span className="analytics-sr-only">排名指标</span>
          <select value={metric} onChange={event => setMetric(event.target.value as RankingMetric)}>
            {rankingMetrics.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <p className="analytics-note">{selected.label} · {selected.unit} · 当前统计范围降序排列</p>
      {ranked.length ? <>
        <ol className="analytics-ranking-list" aria-label={`计划${selected.label}排名`}>
          {ranked.map(entry => {
            const content = <>
              <span className="analytics-rank" aria-hidden="true">{entry.rank ?? '—'}</span>
              <span className="analytics-rank-main"><span className="analytics-rank-name">{entry.row.name}</span>
                <span className={`analytics-bar-track ${entry.value === null ? 'is-missing' : ''}`} aria-hidden="true">
                  {entry.width !== null && <span className={`analytics-bar-fill ${metric === 'spend' ? 'is-spend' : ''}`} style={{ width: `${entry.width}%` }}/>}
                </span>
              </span>
              <strong className="analytics-rank-value">{formatMetric(entry.value, selected.format)}</strong>
              {entry.row.plan_id && <ArrowUpRight size={14} aria-hidden="true"/>}
            </>;
            return <li key={`${entry.row.plan_id ?? entry.row.name}-${entry.sourceIndex}`}>
              {entry.row.plan_id ? <button type="button" className="analytics-rank-row" onClick={() => selectPlan(entry.row.plan_id!)}
                aria-label={`${entry.rank === null ? '未排名' : `第 ${entry.rank} 名`}，${entry.row.name}，${selected.label} ${formatMetric(entry.value, selected.format)}；筛选此计划`}
              >{content}</button> : <div className="analytics-rank-row">{content}</div>}
            </li>;
          })}
        </ol>
        <details className="analytics-disclosure">
          <summary>排名数据表</summary>
          <Table headers={['排名', '计划', `${selected.label}（${selected.unit}）`]}>
            {ranked.map(entry => <tr key={entry.sourceIndex}><td>{entry.rank ?? '未排名'}</td><td>{entry.row.name}</td><td>{formatMetric(entry.value, selected.format)}</td></tr>)}
          </Table>
        </details>
      </> : <Empty text="当前范围没有计划数据。"/>}
    </section>
    <section className="analytics-section analytics-buyers" aria-labelledby={buyersId}>
      <div className="analytics-section-heading"><h3 id={buyersId}>买家构成</h3><Users size={18} aria-hidden="true"/></div>
      <p className="analytics-buyer-total"><strong>{formatMetric(composition.total)}</strong><span>位去重买家</span></p>
      {composition.status === 'ready' ? <div className="analytics-composition-track" role="img"
        aria-label={composition.segments.map(segment => `${segment.label} ${formatMetric(segment.value)} 人，占 ${formatMetric(segment.share, 'percent')}`).join('；')}>
        {composition.segments.map(segment => <span key={segment.key} className={`analytics-segment is-${segment.key}`} style={{ width: `${(segment.share ?? 0) * 100}%` }} aria-hidden="true"/>)}
      </div> : <p className="analytics-chart-state" role="status">{composition.status === 'empty' ? '当前范围买家数为 0，暂无构成占比。'
        : composition.status === 'missing' ? '买家分类数据不完整，暂不计算构成。' : '分类人数与去重总数不一致，暂不计算构成。'}</p>}
      <table className="analytics-buyer-table">
        <caption className="analytics-sr-only">当前统计范围买家构成，按人数去重</caption>
        <thead><tr><th scope="col">客群</th><th scope="col">人数</th><th scope="col">占比</th></tr></thead>
        <tbody>{composition.segments.map(segment => <tr key={segment.key}>
          <th scope="row"><span className={`analytics-legend is-${segment.key}`} aria-hidden="true"/>{segment.label}</th>
          <td>{formatMetric(segment.value)}</td><td>{formatMetric(segment.share, 'percent')}</td>
        </tr>)}</tbody>
      </table>
      <div className="analytics-coverage"><span>新老客识别覆盖</span><strong>{formatMetric(composition.coverage, 'percent')}</strong></div>
      <p className="analytics-note">使用当前范围去重买家汇总；其余已识别买家 = 总买家 − 识别新客 − 历史未知。同一买家复购不重复计为新客。</p>
    </section>
  </div>;
}
