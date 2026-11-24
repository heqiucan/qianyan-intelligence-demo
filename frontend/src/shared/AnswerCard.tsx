import { useState } from 'react';
import { trackBooking, type Handling, type Recommendation } from './recommend';
import './answerCard.css';

const handlingLabel: Record<Handling, string> = { auto: '可自动推荐', review: '需人工复核', handoff: '转人工顾问' };

export default function AnswerCard({ data, showGaps = false }: { data: Recommendation; showGaps?: boolean }) {
  const [booked, setBooked] = useState(false);
  const rec = data.recommendation;
  return <div className="ac-card" role="status">
    <div className="ac-chips">
      {data.matched.service && <span className="ac-chip">{data.matched.service}</span>}
      {data.matched.intent && <span className="ac-chip">{data.matched.intent}</span>}
      {showGaps && <span className={`ac-chip ac-${data.handling}`}>{handlingLabel[data.handling]}</span>}
    </div>
    <p className="ac-answer">{data.answer}</p>
    {data.citations.length > 0 && <p className="ac-refs">依据：{data.citations.map((_, i) => <span key={i} className="ac-ref">[{i + 1}]</span>)}</p>}
    {rec && <section className="ac-rec" aria-label="机构推荐">
      <header><strong>{rec.clinic}</strong><span className="ac-ad">{rec.ad_label}</span></header>
      <ul>{rec.benefits.map(b => <li key={b.text}>{b.text} <sup>[{b.citation + 1}]</sup></li>)}</ul>
      <button type="button" className="ac-cta" onClick={() => { setBooked(true); if (data.search_id) void trackBooking(data.search_id); }}>{rec.cta}</button>
      {booked && <small>演示：这里将打开预约表单。</small>}
    </section>}
    {data.handling === 'handoff' && <p className="ac-handoff">已转人工顾问跟进（演示）</p>}
    {data.citations.length > 0 && <details className="ac-sources">
      <summary>查看依据（{data.citations.length}）</summary>
      <ol>{data.citations.map((c, i) => <li key={i}><small>{c.document} · {c.location}</small><br />{c.text}</li>)}</ol>
    </details>}
    {showGaps && data.gaps.length > 0 && <div className="ac-gaps"><strong>待补充资料</strong><ul>{data.gaps.map(g => <li key={g}>{g}</li>)}</ul></div>}
    <p className="ac-note">以上内容仅供参考，不构成诊疗建议；具体方案请经执业医师面诊评估。</p>
  </div>;
}
