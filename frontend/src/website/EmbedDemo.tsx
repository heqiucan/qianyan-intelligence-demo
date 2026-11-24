import { useState, type FormEvent } from 'react';
import { Search, Sparkles } from 'lucide-react';
import AnswerCard from '../shared/AnswerCard';
import { getRecommendation, type Recommendation } from '../shared/recommend';
import './embedDemo.css';

const TRY = ['割双眼皮多少钱', '艺星祛斑多少钱', '吸脂安全吗', '私密整形'];

export default function EmbedDemo() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [error, setError] = useState('');

  async function run(text: string) {
    const term = text.trim();
    if (!term || loading) return;
    setQuery(term); setLoading(true); setError('');
    try { setResult(await getRecommendation(term)); } catch (e) { setResult(null); setError(e instanceof Error ? e.message : '请求失败，请重试。'); } finally { setLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void run(query); }

  return <section id="live-demo" className="ed" aria-labelledby="ed-title">
    <div className="ed-head">
      <span className="ed-kicker">LIVE DEMO</span>
      <h2 id="ed-title">在客户网站上的样子</h2>
      <p>买家在公司网站自己的搜索框里提问，AI 只根据机构已审核的资料作答，并推荐合适的机构。公司在后台看到每一次搜索。</p>
    </div>

    <div className="ed-frame">
      <div className="ed-bar"><i /><i /><i /><span className="ed-url">www.beauty-demo.example</span></div>
      <div className="ed-site">
        <header className="ed-site-head"><strong>美颜汇 · 在线医美平台（演示）</strong><nav>首页　项目　医生　预约</nav></header>
        <form className="ed-search" onSubmit={submit} role="search">
          <Search size={18} aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目或问题，例如：割双眼皮多少钱" aria-label="站内搜索" />
          <button type="submit" disabled={loading}>搜索</button>
        </form>
        <div className="ed-try">试试：{TRY.map(t => <button type="button" key={t} onClick={() => void run(t)}>{t}</button>)}</div>
        {error && <p className="ed-loading" role="alert">{error}</p>}
        {loading && <p className="ed-loading" role="status">AI 正在整理答案…</p>}
        {result && !loading
          ? <div className="ed-ai">
              <div className="ed-ai-head"><Sparkles size={16} aria-hidden="true" /><strong>AI 智能解答</strong><small>由 Qianyan Intelligence 提供 · 仅基于机构已审核资料</small></div>
              <AnswerCard key={result.search_id ?? result.matched.term} data={result} />
            </div>
          : !loading && <div className="ed-skeleton" aria-hidden="true">
              <span>热门项目</span>
              <div><i /><i /><i /></div>
            </div>}
      </div>
    </div>

    <div className="ed-benefits">
      <div><h3>对买家</h3><ul><li>搜索时直接得到清楚的答案，不用到处比较</li><li>每句话都有资料出处，可以点开查看</li><li>涉及隐私和风险的话题，转给人工顾问</li></ul></div>
      <div><h3>对商家</h3><ul><li>把高意向的搜索变成预约线索</li><li>看到顾客真正在问什么</li><li>知道还缺哪些资料，答案才会更准</li></ul></div>
    </div>
  </section>;
}
