import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, TriangleAlert, Headset, Ban } from 'lucide-react';
import { Badge } from '../../components/ui';
import { api } from '../../api';
import { FUNNEL, GAPS, HANDLING, KPI, SERVICE_TERMS, TOP_TERMS, TOTAL_TERMS } from '../../shared/demoData';
import './dashboard.css';

interface Stats {
  kpi: { searches: number; recommended: number; handoff: number; review: number; clicks: number; click_rate: number };
  funnel: { label: string; value: number }[];
  top_terms: { term: string; service: string | null; count: number }[];
  gaps: { text: string; count: number }[];
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '0%');

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
  const [stats, setStats] = useState<Stats | null>(null);
  const load = useCallback(() => { api<Stats>('/recommend/stats').then(setStats).catch(() => setStats(null)); }, []);
  useEffect(load, [load]);

  const live = !!stats && stats.kpi.searches > 0;
  const kpi = live ? [
    { label: '搜索次数', value: stats.kpi.searches.toLocaleString(), foot: '真实记录' },
    { label: '给出机构推荐', value: stats.kpi.recommended.toLocaleString(), foot: `占搜索 ${pct(stats.kpi.recommended, stats.kpi.searches)}` },
    { label: '转人工顾问', value: stats.kpi.handoff.toLocaleString(), foot: `占搜索 ${pct(stats.kpi.handoff, stats.kpi.searches)}` },
    { label: '点击预约面诊', value: stats.kpi.clicks.toLocaleString(), foot: `占推荐 ${pct(stats.kpi.clicks, stats.kpi.recommended)}` },
  ] : KPI;
  const funnel = live ? stats.funnel : FUNNEL;
  const top = live ? stats.top_terms.map(t => ({ term: t.term, service: t.service ?? '未匹配', volume: t.count })) : TOP_TERMS;
  const tone = live ? 'green' : 'amber';
  const tag = live ? '真实' : '示例';

  return <div className="section-stack dm-root">
    <div className="notice"><span>{live
      ? '搜索次数、推荐、预约和热门词来自后端的真实搜索记录（你在“测试助手”或网站演示里搜索过的内容）。词表覆盖来自 795 个词条。'
      : '还没有真实搜索记录，下面标注“示例”的数字是占位数据。到“测试助手”搜几个词，再回来刷新，就会变成真实记录。'}</span>
      <button type="button" className="button" onClick={load}>刷新</button></div>

    <div className="stats-grid">
      {kpi.map(k => <div className="stat-card" key={k.label}>
        <div className="stat-label">{k.label}</div>
        <div className="stat-value">{k.value}</div>
        <div className="stat-foot">{k.foot}</div>
      </div>)}
    </div>

    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-header"><div><h2>从搜索到预约</h2><p>顾客搜索后，每一步还剩多少</p></div><Badge tone={tone}>{tag}</Badge></div>
        <RankedBars rows={funnel} unit="次" />
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>热门搜索词</h2><p>{live ? '被搜索最多的词' : '每个服务最常被搜索的价格类词'}</p></div><Badge tone={tone}>{tag}</Badge></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>搜索词</th><th>服务</th><th>次数</th></tr></thead>
            <tbody>{top.map(t => <tr key={t.term}><td><strong>{t.term}</strong></td><td>{t.service}</td><td>{t.volume}</td></tr>)}</tbody>
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

    {live && stats.gaps.length > 0 && <section className="panel">
      <div className="panel-header"><div><h2>搜索中暴露的资料缺口</h2><p>真实搜索时，系统发现答不准、需要补充的地方</p></div><Badge tone="green">真实</Badge></div>
      <ul className="dm-gaps">{stats.gaps.map(g => <li key={g.text}><div><strong>{g.text}</strong></div><span className="dm-gap-count">{g.count}</span></li>)}</ul>
    </section>}

    <section className="panel">
      <div className="panel-header"><div><h2>待补充资料</h2><p>系统要答得准，还需要客户提供这些已审核的资料</p></div><Badge tone="green">真实</Badge></div>
      <ul className="dm-gaps">{GAPS.map(g => <li key={g.title}><div><strong>{g.title}</strong><p>{g.detail}</p></div><span className="dm-gap-count">{g.count}</span></li>)}</ul>
    </section>
  </div>;
}
