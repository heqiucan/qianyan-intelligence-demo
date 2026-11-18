import { useEffect, useState } from 'react';
import { CheckCircle2, Download, FileText } from 'lucide-react';
import { api, requestId } from '../../api';
import { Badge, Button, Field } from '../../components/ui';
import { type Evidence, type KnowledgeDraft } from './types';
import CreativeHandoff, { type HandoffContext } from '../journey/CreativeHandoff';

export default function DraftEditor({ draft, changed, dirtyChanged, openSource, handoff }: {
  draft: KnowledgeDraft; changed: (d: KnowledgeDraft) => void; dirtyChanged: (v: boolean) => void;
  openSource: (s: Evidence) => void;
  handoff?: HandoffContext;
}) {
  const [title, setTitle] = useState(draft.title), [blocks, setBlocks] = useState(draft.blocks);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [ack, setAck] = useState(false);
  const dirty = title !== draft.title || JSON.stringify(blocks) !== JSON.stringify(draft.blocks);
  const sourceLabel = (draft.source === 'replay' ? '本地摘录回放 · 未调用模型' : `${draft.writing_mode === 'evidence_composed' ? '智谱选取依据 · 原文组合' : '智谱生成'} · ${draft.model_name}`) + (draft.edited_by ? ' · 含人工修订' : '');
  useEffect(() => { dirtyChanged(dirty || busy); return () => dirtyChanged(false); }, [dirty, busy, dirtyChanged]);
  useEffect(() => { setTitle(draft.title); setBlocks(draft.blocks); setAck(false); }, [draft.id, draft.revision]);
  const run = async (confirmDraft: boolean) => {
    setBusy(true); setError('');
    try {
      const result = await api<KnowledgeDraft>('/knowledge/drafts/' + draft.id + (confirmDraft ? '/confirm' : ''), confirmDraft ? 'POST' : 'PUT', {
        request_id: requestId(), expected_revision: draft.revision,
        ...(confirmDraft ? { acknowledged: true } : { title, blocks }),
      });
      changed(result); setAck(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const download = () => {
    const text = [`# ${draft.title}`, `状态：${draft.status === 'confirmed' ? '人工已确认（未发布）' : '待核对草稿'}`, `来源：${sourceLabel}`, '',
      ...draft.blocks.flatMap(b => [b.text, '引用：' + b.citation_ids.map(id => { const s = draft.sources.find(s => s.id === id); return s ? `${s.title} V${s.version} / ${s.locator}` : id; }).join('；'), '']),
      '## 待核实事项', ...draft.missing.map(x => '- ' + x), ...draft.source_warnings.map(x => '- 来源变化：' + x), '',
      ...(draft.demand_origin ? ['## 需求来源与任务链', `原始问题：${draft.demand_origin.original}`, `内容任务：${draft.demand_origin.task_id}；结果：${draft.demand_origin.result_id}；确认版本：V${draft.demand_origin.result_revision}`, `上游任务：${draft.demand_origin.parent_task_id || '无'}`, ...draft.demand_origin.upstream.map(item => `- V${item.revision} · ${item.original}（${item.id}）`), '### 完整需求来源快照', '```json', JSON.stringify(draft.demand_origin, null, 2), '```', '需求记录提供问题方向，正文事实依据见下方独立审核的引用快照。', ''] : []),
      '## 引用快照', ...draft.sources.flatMap(s => [`### ${s.title} V${s.version} · ${s.locator}`, s.text, '']),
      '引用存在不等于结论已获验证；人工确认不代表广告审查通过。',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `知识草稿-${draft.id}-V${draft.revision}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="panel kb-draft-editor" aria-label="知识草稿编辑器">
    <div className="panel-header"><div><h3>核对草稿与引用</h3><p className="muted">{sourceLabel} · 版本 {draft.revision}</p></div><Badge tone={draft.status === 'confirmed' ? 'green' : 'purple'}>{draft.status === 'confirmed' ? '人工已确认 · 未发布' : '待人工核对'}</Badge></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {draft.demand_origin && <div className="notice"><strong>需求来源与任务链</strong><p>原始问题：{draft.demand_origin.original}</p><p>结果版本 V{draft.demand_origin.result_revision} · {draft.demand_origin.upstream.length} 条上游确认记录。需求只提供问题方向，以下正文引用独立审核的事实资料。</p><a href={`#/creative?tab=demand&space=${encodeURIComponent(draft.space_id)}&task=${encodeURIComponent(draft.demand_origin.task_id)}`}>回到来源内容任务</a></div>}
    {draft.source_warnings.length > 0 && <div className="kb-warning" role="alert"><strong>引用资料已变化，请重新检索生成</strong>{draft.source_warnings.map(x => <p key={x}>{x}</p>)}<p>以下保留生成时的引用快照。</p></div>}
    <Field label="草稿标题"><input value={title} maxLength={160} onChange={e => setTitle(e.target.value)}/></Field>
    {blocks.map((b, i) => <div className="kb-draft-block" key={i}>
      <Field label={`第 ${i + 1} 段内容`}><textarea rows={5} maxLength={2400} value={b.text} onChange={e => setBlocks(v => v.map((x, n) => n === i ? { ...x, text: e.target.value } : x))}/></Field>
      <div className="kb-citations">{b.citation_ids.map(id => { const s = draft.sources.find(s => s.id === id); return s && <button key={id} className="button ghost" onClick={() => openSource(s)}><FileText size={13}/>{s.title} · V{s.version} · {s.locator}</button>; })}</div>
    </div>)}
    <div className="notice"><strong>待核实事项</strong>{draft.missing.length ? <ul>{draft.missing.map((m, i) => <li key={i}>{m}</li>)}</ul> : <p>仍需逐项核对事实、引用与适用范围。</p>}修改正文不会自动验证新表述；引用匹配通过，也不能证明每句话都被资料支持。</div>
    {draft.status !== 'confirmed' && <label className="kb-ack"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/><span>我已逐段核对正文与引用。此次确认保存供内部使用，不代表广告审查通过或执行发布。</span></label>}
    <div className="row-actions">
      <Button disabled={!dirty || busy || !title.trim() || blocks.some(b => !b.text.trim())} onClick={() => run(false)}>保存修订版本</Button>
      <Button kind="primary" disabled={dirty || busy || !ack || !draft.can_confirm} onClick={() => run(true)}><CheckCircle2 size={15}/>人工确认并保存</Button>
      <Button disabled={dirty || busy} onClick={download}><Download size={15}/>导出草稿与引用</Button>
    </div>
    <p className="muted">{dirty ? '有未保存修改，请先保存修订版本。' : '草稿和引用已保存在本机；可在“营销与创意 → 行业知识草稿”继续查看。'}</p>
    {handoff && <CreativeHandoff draft={draft} context={handoff} disabled={dirty || busy}/>}
  </section>;
}
