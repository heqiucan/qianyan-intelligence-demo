import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Search, Plus, FileText, ArrowRight, Sparkles, CheckCircle2, RefreshCw, Library, Layers } from 'lucide-react';
import { api, requestId, date, type ModelInfo } from '../../api';
import { Badge, Button, Empty, Field, Modal, Submit } from '../../components/ui';
import DocumentEditor from './DocumentEditor';
import DraftEditor from './DraftEditor';
import { kindLabels, sceneLabels, type Channel, type Document, type Evidence, type KnowledgeDraft, type RetrievalMode, type Scene, type SearchResult, type Space } from './types';
import './knowledge.css';
import type { HandoffContext } from '../journey/CreativeHandoff';

export default function KnowledgeWorkspace({ model, dirtyChanged, initialTab = 'library', initialSpaceId, initialDraftId, initialScene, handoff }: {
  model: ModelInfo; dirtyChanged: (v: boolean) => void; initialTab?: 'library' | 'drafts';
  initialSpaceId?: string; initialDraftId?: string; initialScene?: Scene; handoff: HandoffContext;
}) {
  const [spaces, setSpaces] = useState<Space[]>([]), [spaceId, setSpaceId] = useState('');
  const [docs, setDocs] = useState<Document[]>([]), [drafts, setDrafts] = useState<KnowledgeDraft[]>([]);
  const [tab, setTab] = useState<'library' | 'search' | 'drafts'>(initialTab);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [channel, setChannel] = useState<Channel>('internal'), [task, setTask] = useState('answer');
  const [mode, setMode] = useState<RetrievalMode>('hybrid');
  const [result, setResult] = useState<SearchResult | null>(null), [draft, setDraft] = useState<KnowledgeDraft | null>(null);
  const [editing, setEditing] = useState<Document | null | undefined>(undefined), [detail, setDetail] = useState<Document | null>(null);
  const [source, setSource] = useState<Evidence | null>(null), [newSpace, setNewSpace] = useState(false);
  const [newName, setNewName] = useState(''), [newScene, setNewScene] = useState<Scene>('medical');
  const [reviewAck, setReviewAck] = useState(false), [loaded, setLoaded] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const lock = useRef(false), currentSpace = useRef(spaceId); currentSpace.current = spaceId;
  const space = spaces.find(s => s.id === spaceId);
  const markDraftDirty = useCallback((v: boolean) => setDraftDirty(v), []);
  useEffect(() => { dirtyChanged(draftDirty || !!busy || editing !== undefined); return () => dirtyChanged(false); }, [draftDirty, busy, editing, dirtyChanged]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(''); }
  };
  const load = async (id: string) => {
    const [documents, items] = await Promise.all([api<Document[]>('/knowledge/documents?space_id=' + encodeURIComponent(id)), api<KnowledgeDraft[]>('/knowledge/drafts?space_id=' + encodeURIComponent(id))]);
    if (currentSpace.current !== id) return;
    setDocs(documents); setDrafts(items); setLoaded(true);
    setDraft(previous => previous ? items.find(d => d.id === previous.id) || null : items.find(d => d.id === initialDraftId) || null);
  };
  const loadSpaces = async () => {
    const list = await api<Space[]>('/knowledge/spaces'); setSpaces(list);
    setSpaceId(previous => list.some(s => s.id === previous) ? previous : list.find(s => s.id === initialSpaceId)?.id || (initialScene ? list.find(s => s.scene === initialScene)?.id : list.find(s => s.id === localStorage.getItem('knowledge-space'))?.id) || list[0]?.id || '');
  };
  useEffect(() => { loadSpaces().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!spaceId) return;
    localStorage.setItem('knowledge-space', spaceId);
    setDocs([]); setDrafts([]); setResult(null); setDraft(null); setLoaded(false); setError('');
    load(spaceId).catch(e => { if (currentSpace.current === spaceId) setError(e.message); });
  }, [spaceId]);
  const canLeave = () => !draftDirty || confirm('草稿有未保存修改，确定放弃本次修改？');
  const chooseSpace = (id: string) => { if (!busy && canLeave()) { setDraftDirty(false); setSpaceId(id); setQuery(''); } };
  const switchTab = (next: typeof tab) => { if (!busy && canLeave()) { setDraftDirty(false); setDraft(null); setTab(next); } };
  const openDocument = (id: string) => run('读取资料', async () => { setDetail(await api<Document>('/knowledge/documents/' + id)); setReviewAck(false); });
  const review = (status: 'approved' | 'archived') => run('保存审核状态', async () => {
    if (!detail) return;
    await api('/knowledge/documents/' + detail.id + '/review', 'POST', { request_id: requestId(), expected_version: detail.version, status });
    setDetail(null); setResult(null); await load(spaceId); setNotice(status === 'approved' ? '资料已标记为可用。下一步：检索并核对命中原文。' : '资料已归档，不再进入检索；已有草稿保留引用快照。');
  });
  const search = (searchQuery = query) => run(mode === 'hybrid' ? '正在检索本机资料，首次语义检索可能需要稍等' : '正在分词并检索本机资料', async () => {
    setQuery(searchQuery);
    setResult(null);
    setResult(await api<SearchResult>('/knowledge/search', 'POST', { space_id: spaceId, query: searchQuery, channel, mode }));
  });
  const generate = () => run(model.mode === 'replay' ? '正在整理检索依据' : '已找到依据，正在等待模型生成', async () => {
    if (!result) return;
    const item = await api<KnowledgeDraft>('/knowledge/drafts', 'POST', { space_id: spaceId, query: result.query, channel: result.channel, mode: result.mode, task, signature: result.signature, request_id: requestId() });
    await load(spaceId); setDraft(item); setTab('drafts');
    setNotice('草稿已保存。下一步：逐段查看引用，核对后人工确认。');
  });
  const changedDraft = (item: KnowledgeDraft) => { setDraft(item); setDrafts(list => list.map(d => d.id === item.id ? item : d)); };
  const currentResult = result && result.query === query.trim() && result.channel === channel && result.mode === mode && result.space.id === spaceId;
  const available = docs.filter(d => d.availability === '可检索').length;
  const demandAvailable = docs.filter(d => d.kind === 'demand' && d.availability === '需求素材可用（非事实依据）').length;
  return <div className="kb-workspace">
    <section className="panel kb-intro">
      <div className="kb-intro-copy"><h2>{initialTab === 'drafts' ? '知识草稿' : '知识资料'}</h2></div>
      <div className="kb-intro-icon" aria-hidden="true"><BookOpen size={34}/><span>RAG</span></div>
    </section>
    <div className="kb-scope panel">
      <Field label="业务场景"><select disabled={!!busy} value={space?.scene || 'medical'} onChange={e => { const found = spaces.find(s => s.scene === e.target.value); if (found) chooseSpace(found.id); }}><option value="medical">医美获客</option><option value="live">直播电商</option></select></Field>
      <Field label="机构 / 品牌资料空间"><select value={spaceId} disabled={!!busy} onChange={e => chooseSpace(e.target.value)}>{spaces.filter(s => s.scene === space?.scene).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Button disabled={!!busy} onClick={() => setNewSpace(true)}><Plus size={15}/>新建资料空间</Button>
      <Badge tone="neutral">仅当前空间 · 本机保存</Badge>
    </div>
    <div className="kb-stepper" aria-label="知识草稿流程"><span className={tab === 'library' ? 'active' : ''}>01 导入与审核</span><ArrowRight size={14}/><span className={tab === 'search' ? 'active' : ''}>02 检索与引用</span><ArrowRight size={14}/><span className={tab === 'drafts' ? 'active' : ''}>03 生成与确认</span></div>
    <nav className="kb-tabs" aria-label="知识库功能"><button aria-pressed={tab === 'library'} onClick={() => switchTab('library')}><Library size={16}/>资料库 <span>{docs.length}</span></button><button aria-pressed={tab === 'search'} onClick={() => switchTab('search')}><Search size={16}/>检索与生成</button><button aria-pressed={tab === 'drafts'} onClick={() => switchTab('drafts')}><FileText size={16}/>已保存草稿 <span>{drafts.length}</span></button></nav>
    {error && <div className="error-banner" role="alert"><span>{error}</span><Button disabled={!!busy} onClick={() => run('重新读取', async () => { await loadSpaces(); if (spaceId) await load(spaceId); })}>重新读取</Button></div>}
    {notice && <div className="kb-success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {busy && <div className="kb-progress" role="status"><RefreshCw size={16}/>{busy}…{busy.includes('模型生成') && <span>模型响应可能需要等待，失败后可手动重试。</span>}</div>}
    {!loaded && !error && <p className="muted" role="status">正在读取资料空间…</p>}
    {loaded && tab === 'library' && <>
      <div className="kb-library-head"><div><h3>{space?.name}</h3><p className="muted">{available} 份事实/规则/脚本可检索 · {demandAvailable} 份需求素材可用 · {docs.length - available - demandAvailable} 份待审核或已失效</p></div><div className="row-actions">{space?.is_demo && <Button disabled={!!busy} onClick={() => run('载入虚构示例', async () => { await api('/knowledge/spaces/' + spaceId + '/samples', 'POST'); await load(spaceId); setNotice('虚构演示资料已载入，请逐份查看并标记为可用。重复载入不会覆盖已有资料。'); })}>载入本场景示例</Button>}<Button kind="primary" disabled={!!busy} onClick={() => setEditing(null)}><Plus size={15}/>导入资料</Button></div></div>
      {!docs.length ? <div className="panel kb-empty"><BookOpen size={36}/><h3>把你的第一份资料放进来</h3><p>支持文本型 PDF、TXT、Markdown 和直接粘贴。可以先载入虚构示例，体验完整流程。</p></div> : <div className="kb-doc-grid">{docs.map(doc => <article className="panel kb-doc-card" key={doc.id}>
        <div className="kb-doc-top"><span className="kb-file-icon"><FileText size={21}/></span><Badge tone={doc.availability === '可检索' ? 'green' : 'neutral'}>{doc.availability}</Badge></div>
        <h3>{doc.title}</h3><div className="kb-tags"><span>{kindLabels[doc.kind]}</span><span>V{doc.version} · {doc.chunk_count} 个片段</span>{doc.is_demo && <span>虚构演示</span>}</div>
        <p className="muted">{doc.channel === 'internal' ? '内部参考' : '抖音渠道参考'} · {doc.valid_until ? `有效至 ${doc.valid_until}（UTC）` : '未设失效日期'}</p>
        <Button disabled={!!busy} onClick={() => openDocument(doc.id)}>查看资料与审核<ArrowRight size={14}/></Button>
      </article>)}</div>}
      {available > 0 && <div className="kb-next"><span>资料准备好了，试着问一个具体问题。</span><Button kind="primary" onClick={() => { setTab('search'); setQuery(space?.scene === 'medical' ? '咨询预约流程和审核要求' : '保温杯规格和直播讲解要求'); }}>开始检索<ArrowRight size={15}/></Button></div>}
    </>}
    {loaded && tab === 'search' && <>
      <section className="panel kb-search-panel"><form onSubmit={e => { e.preventDefault(); search(); }}>
        <Field label="输入关键词或任务"><textarea rows={3} maxLength={500} required disabled={!!busy} value={query} placeholder={space?.scene === 'medical' ? '例如：咨询预约流程和审核要求' : '例如：保温杯规格和直播讲解要求'} onChange={e => setQuery(e.target.value)}/></Field>
        <div className="kb-search-controls">
          <Field label="检索方式"><select disabled={!!busy} value={mode} onChange={e => setMode(e.target.value as RetrievalMode)}><option value="hybrid">混合检索（关键词 + 语义）</option><option value="keyword">关键词检索（含同义词扩展）</option></select></Field>
          <Field label="检索范围"><select disabled={!!busy} value={channel} onChange={e => setChannel(e.target.value as Channel)}><option value="internal">内部参考</option><option value="douyin">抖音渠道参考</option></select></Field>
          <Field label="生成用途"><select disabled={!!busy} value={task} onChange={e => setTask(e.target.value)}><option value="answer">内部资料问答</option><option value="script">内部脚本草稿</option></select></Field>
          <Submit busy={!!busy}><Search size={15}/>检索资料</Submit>
        </div>
      </form><p className="muted">关键词检索可补充当前业务场景的同义词；混合检索还会按表达含义寻找原文。检索在本机完成，不消耗在线模型额度，仅限当前空间、适用范围内已审核且有效的资料。</p></section>
      {result && <section className="kb-results" aria-label="资料检索结果">
        <div className="kb-library-head"><div><h3>找到 {result.hits.length} 个相关片段</h3><p className="muted">检索词：{result.terms.join(' · ') || '无有效关键词'}。排序不代表事实置信度。</p></div><Badge tone="neutral">{result.retrieval.used_mode === 'hybrid' ? '关键词 + 语义' : '关键词检索'}</Badge></div>
        {!currentResult && <div className="kb-warning">任务、范围或检索方式已修改，请重新检索。</div>}
        <div className={result.retrieval.semantic_status === 'unavailable' ? 'kb-warning' : 'kb-retrieval-note'} role="status">
          <p>{result.retrieval.message}</p>
          <p>{result.note}</p>
        </div>
        {result.expanded_terms.length > 0 && <div className="kb-query-expansion"><strong>本次扩展词</strong><div className="kb-tags">{result.expanded_terms.map(term => <span key={term}>{term}</span>)}</div><p>按当前业务场景补充相关表达，原始问题保持不变。</p></div>}
        {result.corrections.length > 0 && <div className="kb-corrections"><strong>你是否想查这些词？</strong><p>以下仅是拼写建议。点击后会使用建议重新检索。</p><div className="row-actions">{result.corrections.map(correction => <Button key={correction.query} disabled={!!busy || !currentResult} title={correction.query} onClick={() => search(correction.query)}>{correction.original} → {correction.suggestion} · 重新检索</Button>)}</div></div>}
        {!result.hits.length ? <div className="panel kb-empty"><Search size={30}/><h3>暂无可用依据</h3><p>可以换用项目名、商品名或更具体的问题；也请检查资料是否审核、过期或属于其他范围。没有依据时不会调用生成模型。</p></div> : <div className="kb-hit-list">{result.hits.map((hit, i) => <article className="panel kb-hit" key={hit.id}>
          <div className="kb-hit-index">{String(i + 1).padStart(2, '0')}</div>
          <div><div className="kb-hit-title"><h3>{hit.title}</h3><Badge tone="neutral">{kindLabels[hit.kind]}</Badge>{result.evidence_ids.includes(hit.id) && <Badge>用于生成</Badge>}</div>
            <p className="muted">V{hit.version} · {hit.locator} · {hit.filename}</p>
            <div className="kb-hit-methods">{hit.retrieval_methods?.includes('keyword') && <span>关键词匹配</span>}{hit.retrieval_methods?.includes('semantic') && <span>语义相关</span>}</div>
            <p className="kb-excerpt">{hit.text}</p>
            {hit.matched_terms.length > 0 && <div className="kb-tags" aria-label="该片段及标题的命中词"><small>命中词</small>{hit.matched_terms.map(t => <span key={t}>{t}</span>)}</div>}
            <Button disabled={!!busy} onClick={() => setSource(hit)}>查看引用原文</Button>
          </div>
        </article>)}</div>}
        {result.hits.length > 0 && <div className="panel kb-generate"><div><h3>用选取的依据生成草稿</h3><p>本次展示 {result.hits.length} 个候选片段，选取其中 {result.evidence_ids.length} 个用于生成（最多 6 个）；已在上方标记。</p><p>{model.mode === 'replay' ? '当前为演示回放：整理选取的原文，不调用生成模型。' : `当前使用 ${model.label}。任务与选取的依据片段将发送至当前配置的模型接口；不会上传整份文件。`}</p><p className="muted">历史脚本仅供结构参考。生成结果保留引用，等待逐段人工核对。</p></div><Button kind="primary" disabled={!!busy || !currentResult || !result.can_generate} onClick={generate}><Sparkles size={16}/>{model.mode === 'replay' ? '整理依据草稿（回放）' : '基于依据生成草稿'}</Button>{!result.can_generate && <p className="kb-warning">缺少可用于事实核对的资料；历史脚本不能单独作为事实依据。</p>}</div>}
      </section>}
    </>}
    {loaded && tab === 'drafts' && <div className={'kb-drafts-layout' + (draft ? ' has-editor' : '')}><section className="panel kb-draft-list"><div className="panel-header"><h3>已保存的知识草稿</h3><Layers size={18}/></div>{!drafts.length ? <><Empty text="还没有草稿，先检索一份可用依据。"/><Button onClick={() => setTab('search')}>去检索资料</Button></> : drafts.map(d => <button key={d.id} className={'kb-draft-item' + (draft?.id === d.id ? ' active' : '')} onClick={() => { if (canLeave()) { setDraftDirty(false); setDraft(d); } }}><strong>{d.title}</strong><span>{d.status === 'confirmed' ? '人工已确认' : '待核对'} · V{d.revision} · {date(d.created_at)}</span><small>{d.source === 'replay' ? '本地摘录回放' : '模型生成'}{d.source_warnings.length > 0 ? ' · 引用已变化' : ''}</small></button>)}</section>{draft && <DraftEditor key={draft.id} draft={draft} changed={changedDraft} dirtyChanged={markDraftDirty} openSource={setSource} handoff={handoff}/>}</div>}
    <details className="kb-boundary"><summary>资料适用范围</summary><p>{space?.scene === 'medical' ? '当前资料用于内部核对，公开发布前需核对适用资质和渠道要求。' : '资料内容不代表平台实时价格、库存与优惠。'}</p></details>
    {editing !== undefined && <DocumentEditor spaceId={spaceId} document={editing} close={() => setEditing(undefined)} saved={async () => { setResult(null); await load(spaceId); setNotice('资料已保存为待审核版本，请查看原文并确认可用范围。'); }}/> }
    {detail && <Modal title={detail.title} wide busy={!!busy} error={error} onClose={() => setDetail(null)}><div className="kb-tags"><Badge>{detail.availability}</Badge><span>{kindLabels[detail.kind]} · V{detail.version}</span><span>{detail.channel === 'internal' ? '内部参考' : '抖音渠道参考'}</span></div><div className="kb-source-pages">{detail.chunks.map(c => <article key={c.id}><small>{c.locator}</small><p>{c.text}</p></article>)}</div><div className="notice">标记可用表示已核对资料及适用范围，不等同于广告审查通过。有效期按 UTC 日期判断。</div><label className="kb-ack"><input type="checkbox" checked={reviewAck} onChange={e => setReviewAck(e.target.checked)}/><span>我已核对这份资料的内容、类型、范围与有效期。</span></label><div className="row-actions"><Button disabled={!!busy} onClick={() => { setEditing(detail); setDetail(null); }}>编辑为新版本</Button><Button disabled={!!busy || detail.status === 'archived'} onClick={() => review('archived')}>归档停用</Button><Button kind="primary" disabled={!!busy || !reviewAck || detail.status === 'approved'} onClick={() => review('approved')}>确认资料可用</Button></div></Modal>}
    {source && <Modal title="引用原文快照" wide onClose={() => setSource(null)}><div className="kb-source-preview"><Badge tone="neutral">{kindLabels[source.kind]} · {source.is_demo ? '虚构演示' : '用户导入'}</Badge><h3>{source.title}</h3><p className="muted">版本 V{source.version} · {source.locator} · {source.filename}</p><blockquote>{source.text}</blockquote><p className="notice">这是检索或生成时保存的原文，不会随文件更新而替换。请核对它是否支持草稿中的具体表述。</p></div></Modal>}
    {newSpace && <Modal title="新建机构 / 品牌资料空间" onClose={() => setNewSpace(false)} busy={!!busy} error={error}><form onSubmit={e => { e.preventDefault(); run('创建资料空间', async () => { const item = await api<Space>('/knowledge/spaces', 'POST', { name: newName, scene: newScene, request_id: requestId() }); setSpaces(list => [...list, item]); setSpaceId(item.id); setNewSpace(false); setNewName(''); }); }}><Field label="业务场景"><select value={newScene} onChange={e => setNewScene(e.target.value as Scene)}>{Object.entries(sceneLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field><Field label="机构或品牌名称"><input required maxLength={60} value={newName} onChange={e => setNewName(e.target.value)}/></Field><p className="notice">新空间从空资料库开始，不会混入其他空间的资料。</p><Submit busy={!!busy}>创建空间</Submit></form></Modal>}
  </div>;
}
