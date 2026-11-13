import { useEffect, useState } from 'react';
import { BookOpen, ArrowRight } from 'lucide-react';
import { api, type Creative } from '../../api';
import { Button } from '../../components/ui';
import type { Evidence, DraftBlock } from '../knowledge/types';

export interface KnowledgeOrigin {
  draft_id: string; revision: number; title: string; space_id: string; space_name: string;
  agent_task_id: string | null; sources: Evidence[]; blocks: DraftBlock[]; missing: string[];
  source: string; model_name?: string; writing_mode?: string;
}

export default function CreativeOrigin({ creative, go }: { creative: Creative; go: (route: string) => void }) {
  const [warnings, setWarnings] = useState<string[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const origin = creative.knowledge_origin;
  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    setLoaded(false); setError('');
    api<{ warnings: string[] }>(`/creatives/${creative.id}/knowledge-origin`).then(r => { if (!cancelled) { setWarnings(r.warnings); setLoaded(true); } }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [creative.id, origin]);
  if (!origin) return null;
  return <section className="panel journey-origin" aria-label="创意知识来源">
    <div className="panel-header"><div><h3><BookOpen size={17}/>这份创意从哪里来</h3><p className="muted">{origin.space_name} → {origin.agent_task_id ? 'Agent 任务' : 'RAG 检索'} → 知识草稿 V{origin.revision} → 当前创意 V{creative.version}</p></div></div>
    <p>{origin.title} · {origin.sources.length} 条原文依据。转入时保留完整快照；后续编辑不会自动重新匹配每句话的引用。</p>
    {error ? <p className="kb-warning" role="alert">引用状态暂未读取：{error}。确认素材时服务端会重新检查。</p> : !loaded ? <p role="status">正在核对引用是否仍可用…</p> : warnings.length ? <div className="kb-warning" role="alert"><strong>引用已变化，需重新生成并转入</strong>{warnings.map(w => <p key={w}>{w}</p>)}</div> : <p className="muted">引用资料版本当前可用；这不代表已核实资料真实性或全部宣传表达。</p>}
    <details className="journey-evidence"><summary>查看保留的引用原文和待核实事项</summary>{origin.sources.map(s => <article key={s.id}><strong>{s.title} · V{s.version} · {s.locator}{s.is_demo ? ' · 虚构示例' : ''}</strong><p>{s.text}</p></article>)}{origin.missing.map((m, i) => <p key={i}>待核实：{m}</p>)}</details>
    <div className="row-actions"><Button kind="ghost" onClick={() => go(`creative?tab=knowledge&space=${encodeURIComponent(origin.space_id)}&draft=${encodeURIComponent(origin.draft_id)}`)}>查看原知识草稿<ArrowRight size={14}/></Button>{origin.agent_task_id && <Button kind="ghost" onClick={() => go(`overview?agent=${encodeURIComponent(origin.agent_task_id!)}`)}>查看 Agent 执行记录<ArrowRight size={14}/></Button>}</div>
  </section>;
}
