import { useState, type FormEvent } from 'react';
import { Badge, Field, Submit } from '../../components/ui';
import AnswerCard from '../../shared/AnswerCard';
import { getRecommendation, type Recommendation } from '../../shared/recommend';
import CompanyDashboard from './CompanyDashboard';

function TestAssistant() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true); setError('');
    try { setResult(await getRecommendation(query.trim())); } catch (e) { setResult(null); setError(e instanceof Error ? e.message : '请求失败，请重试。'); } finally { setLoading(false); }
  }

  return <section className="panel" aria-label="测试助手">
    <h2>测试助手 <Badge tone="green">真实后端</Badge></h2>
    <p>输入顾客搜索的词，查看系统会如何回答、是否推荐机构，以及还缺哪些资料。回复来自后端：先在词表中匹配，再只引用已审核的机构资料作答；每次测试都会记入公司看板。</p>
    <form onSubmit={submit}>
      <Field label="顾客搜索词"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：割双眼皮多少钱" /></Field>
      <Submit busy={loading}>测试</Submit>
    </form>
    {error && <div className="notice" role="alert"><span>{error}</span></div>}
    {result && !loading && <AnswerCard key={result.search_id ?? result.matched.term} data={result} showGaps />}
  </section>;
}

export default function MedicalAssistantPanel() {
  const [view, setView] = useState<'dashboard' | 'test'>('dashboard');
  return <div className="section-stack" aria-label="医美咨询助手">
    <div className="tabs" role="tablist" aria-label="医美咨询助手视图">
      <button type="button" role="tab" aria-selected={view === 'dashboard'} className={`tab ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>公司看板</button>
      <button type="button" role="tab" aria-selected={view === 'test'} className={`tab ${view === 'test' ? 'active' : ''}`} onClick={() => setView('test')}>测试助手</button>
    </div>
    {view === 'dashboard' ? <CompanyDashboard /> : <TestAssistant />}
  </div>;
}
