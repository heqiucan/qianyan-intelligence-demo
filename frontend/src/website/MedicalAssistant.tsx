import { useState, type FormEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import AnswerCard from '../shared/AnswerCard';
import EmbedDemo from './EmbedDemo';
import { getRecommendation, type Recommendation } from '../shared/recommend';

export default function MedicalAssistant() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    try { setResult(await getRecommendation(query.trim())); } finally { setLoading(false); }
  }

  return <>
    <EmbedDemo />
    <button type="button" className="qy-assistant-fab" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <X size={18} /> : <MessageCircle size={18} />}{open ? '收起' : '医美咨询'}
    </button>
    {open && <section className="qy-assistant-panel" role="dialog" aria-label="医美咨询助手" style={{ width: 'min(420px, calc(100vw - 32px))', maxHeight: '70vh', overflowY: 'auto' }}>
      <form onSubmit={submit}>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：割双眼皮多少钱" aria-label="输入想了解的项目" />
        <button type="submit" disabled={loading} aria-label="发送"><Send size={16} /></button>
      </form>
      {loading && <p role="status">正在查找…</p>}
      {result && !loading && <AnswerCard key={result.matched.term} data={result} />}
    </section>}
  </>;
}
