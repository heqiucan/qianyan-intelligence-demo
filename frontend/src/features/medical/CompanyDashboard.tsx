import { CheckCircle2, TriangleAlert, Headset, Ban } from 'lucide-react';
import { Badge } from '../../components/ui';
import { FUNNEL, GAPS, HANDLING, KPI, SERVICE_TERMS, TOP_TERMS, TOTAL_TERMS } from '../../shared/demoData';
import './dashboard.css';

const icons = { auto: CheckCircle2, review: TriangleAlert, handoff: Headset, exclude: Ban } as const;

function RankedBars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(...rows.map(r => r.value));
  return <div className="dm-bars" role="img" aria-label={rows.map(r => `${r.label} ${r.value}${unit}`).join('，')}>
    {rows.map(r => <div className="dm-bar-row" key={r.label} title={`${r.label}：${r.value.toLocaleString()} ${unit}`}>
      <span className="dm-bar-label">{r.label}</span>
      <span className="dm-bar-track"><span className="dm-bar" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
      <strong className="dm-bar-value">{r.value.toLocaleString()}</strong>
    </div>)}
  </div>;
}

export default function CompanyDashboard() {
  return <div className="section-stack dm-root">
    <div className="notice"><span>示例数据说明：标注“示例”的数字是演示用的占位数据，接入后端后会换成真实搜索记录。标注“真实”的数字来自你整理的 795 个词条。</span></div>

    <div className="stats-grid">
      {KPI.map(k => <div className="stat-card" key={k.label}>
        <div className="stat-label">{k.label}</div>
        <div className="stat-value">{k.value}</div>
        <div className="stat-foot">{k.foot}</div>
      </div>)}
    </div>

    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-header"><div><h2>从搜索到预约</h2><p>顾客搜索后，每一步还剩多少</p></div><Badge tone="amber">示例</Badge></div>
        <RankedBars rows={FUNNEL} unit="次" />
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>热门搜索词</h2><p>每个服务最常被搜索的价格类词</p></div><Badge tone="amber">示例</Badge></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>搜索词</th><th>服务</th><th>次数</th></tr></thead>
            <tbody>{TOP_TERMS.map(t => <tr key={t.term}><td><strong>{t.term}</strong></td><td>{t.service}</td><td>{t.volume}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>

    <section className="panel">
      <div className="panel-header"><div><h2>词表覆盖：{TOTAL_TERMS} 个词条怎么处理</h2><p>系统对每个词条的默认处理方式</p></div><Badge tone="green">真实</Badge></div>
      <div className="dm-seg" role="img" aria-label={HANDLING.map(h => `${h.label} ${h.count} 个`).join('，')}>
        {HANDLING.map(h => {
          const pct = (h.count / TOTAL_TERMS) * 100;
          return <span key={h.key} className={`dm-seg-part dm-${h.key}`} style={{ flex: h.count }} title={`${h.label}：${h.count} 个（${pct.toFixed(1)}%）`}>{pct >= 12 ? `${Math.round(pct)}%` : ''}</span>;
        })}
      </div>
      <ul className="dm-legend">
        {HANDLING.map(h => { const Icon = icons[h.key]; return <li key={h.key}><span className={`dm-swatch dm-${h.key}`}><Icon size={12} /></span>{h.label}<strong>{h.count}</strong></li>; })}
      </ul>
      <div className="panel-header dm-sub"><div><h3>各服务的词条数</h3></div></div>
      <RankedBars rows={SERVICE_TERMS.map(s => ({ label: s.label, value: s.count }))} unit="个" />
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>待补充资料</h2><p>系统要答得准，还需要客户提供这些已审核的资料</p></div><Badge tone="green">真实</Badge></div>
      <ul className="dm-gaps">{GAPS.map(g => <li key={g.title}><div><strong>{g.title}</strong><p>{g.detail}</p></div><span className="dm-gap-count">{g.count}</span></li>)}</ul>
    </section>
  </div>;
}
