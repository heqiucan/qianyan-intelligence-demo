import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, FileCheck2, FileSearch, GitCompareArrows, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { api, money, type Creative, type Product } from '../../api';
import { Badge, Button, Details, Field, Modal } from '../../components/ui';
import { names } from '../../domain';
import Poster from '../../Poster';

type CopyField = 'title' | 'body' | 'cta' | 'script';
type Copy = Record<CopyField, string>;
type FindingKind = 'consistent' | 'conflict' | 'missing_evidence' | 'manual_review';
interface Finding {
  id: string; field: CopyField; start: number; end: number; text: string; kind: FindingKind;
  expected: string; explanation: string; replacement: string | null;
  source: { field: string; label: string; value: unknown; version: number; evidence: string };
}
interface CheckResult {
  mode: 'rules'; creative_id: string; product_snapshot: Product; fields: Copy;
  findings: Finding[]; suggested_fields: Copy; summary: Record<FindingKind, number>;
  can_approve: boolean; scope_note: string; incomplete_fields?: CopyField[];
}

const copyLabels: Record<CopyField, string> = { title: '标题', body: '广告正文', cta: '行动文案', script: '视频脚本' };
const kindLabels: Record<FindingKind, string> = {
  consistent: '与资料一致', conflict: '与资料冲突', missing_evidence: '缺少依据', manual_review: '需人工核查',
};
const copyFields: CopyField[] = ['title', 'body', 'cta', 'script'];
const copyOf = (creative: Creative): Copy => Object.fromEntries(copyFields.map(key => [key, creative[key] || ''])) as Copy;
const editPayload = (creative: Creative) => ({ ...copyOf(creative), direction: creative.direction, template: creative.template || 'classic' });

// Checks never mutate a draft. Each request belongs to one exact input revision.
function useClaimCheck(creativeId: string) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, [creativeId]);
  const invalidate = () => { sequence.current++; setResult(null); setChecking(false); setCheckError(''); };
  const check = async (draft: Creative) => {
    const revision = ++sequence.current;
    setChecking(true); setCheckError(''); setResult(null);
    try {
      const response = await api<CheckResult>(`/creatives/${creativeId}/check`, 'POST', copyOf(draft));
      if (sequence.current === revision) setResult(response);
    } catch (error) {
      if (sequence.current === revision) setCheckError((error as Error).message);
    } finally {
      if (sequence.current === revision) setChecking(false);
    }
  };
  return { result, checking, checkError, check, invalidate };
}

function HighlightedCopy({ text, findings }: { text: string; findings: Finding[] }) {
  let cursor = 0;
  const segments = [];
  for (const finding of [...findings].sort((a, b) => a.start - b.start)) {
    if (finding.start < cursor || finding.start < 0 || finding.end > text.length) continue;
    segments.push(<span key={`text-${finding.id}`}>{text.slice(cursor, finding.start)}</span>);
    segments.push(<mark key={finding.id} className={`claim-mark ${finding.kind}`} title={`${kindLabels[finding.kind]}：${finding.explanation}`}>{text.slice(finding.start, finding.end)}</mark>);
    cursor = finding.end;
  }
  segments.push(<span key="remaining">{text.slice(cursor)}</span>);
  return <p className="studio-highlighted-copy">{segments}</p>;
}

export default function FactWorkspace({ creative, busy, openProduct, dirtyChanged, save, approve, useCreative }: {
  creative: Creative; busy: boolean; openProduct: () => void; dirtyChanged: (dirty: boolean) => void;
  save: (body: Record<string, unknown>) => Promise<boolean>; approve: () => void; useCreative: () => void;
}) {
  const [draft, setDraft] = useState(creative);
  const [preview, setPreview] = useState(false);
  const [evidence, setEvidence] = useState<Finding | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const { result, checking, checkError, check, invalidate } = useClaimCheck(creative.id);
  const dirty = JSON.stringify(editPayload(draft)) !== JSON.stringify(editPayload(creative));
  const product = creative.product_snapshot;
  useEffect(() => { dirtyChanged(dirty); return () => dirtyChanged(false); }, [dirty, dirtyChanged]);
  const update = (key: keyof Creative, value: string) => {
    invalidate(); setNotice('文案已修改，请重新核对当前内容。'); setSaveError('');
    setDraft(current => ({ ...current, [key]: value }));
  };
  const changes = result ? copyFields.filter(key => result.fields[key] !== result.suggested_fields[key]) : [];
  const supported = result?.summary.consistent || 0;
  const issues = result ? result.summary.conflict + result.summary.missing_evidence + result.summary.manual_review : 0;
  const loadExample = () => {
    if (dirty && !window.confirm('载入示例会替换未保存的文案，是否继续？')) return;
    invalidate(); setSaveError(''); setPreview(false);
    setDraft({ ...creative, title: `${product.name}，随行新选择`, body: '超大 1L 容量，保温 24 小时，现在只要 79 元。', cta: '查看商品详情', script: '', direction: '事实核对演示' });
    setNotice('已载入故意包含问题的测试文案，仅在编辑区展示；请点击“核对当前文案”。尚未保存。');
  };
  return <section className="studio-workspace" data-testid="creative-workspace" aria-label="创意事实核对工作区">
    <div className="studio-workspace-heading"><div><span className="studio-eyebrow">素材详情 · V{creative.version}</span><h2>{creative.direction}</h2></div><Badge tone={dirty ? 'amber' : creative.status === 'approved' ? 'green' : 'neutral'}>{dirty ? '有未保存修改' : names[creative.status]}</Badge></div>
    <div className="studio-steps" aria-label="创意处理进度">
      <span className="done"><CheckCircle2 size={14} />资料 V{product.version} 已读取</span><ArrowRight size={13}/>
      <span className={result ? 'done' : ''}><FileSearch size={14}/>{checking ? '正在执行规则检查' : result ? `检查完成 · ${issues} 项待处理` : '等待核对当前文案'}</span><ArrowRight size={13}/>
      <span className={!dirty && creative.status === 'approved' ? 'done' : ''}><ShieldCheck size={14}/>{!dirty && creative.status === 'approved' ? '素材已人工确认' : '等待人工确认素材'}</span>
    </div>
    <div className="studio-columns">
      <aside className="studio-evidence-panel">
        <div className="studio-panel-title"><FileCheck2 size={17}/><h3>商品依据</h3><Badge tone="neutral">V{product.version}</Badge></div>
        <img className="studio-product-image" src={product.image_url} alt={product.name}/>
        <h4>{product.name}</h4>
        <dl className="studio-facts"><div><dt>当前售价</dt><dd>{money(product.price)}</dd></div><div><dt>容量 / 规格</dt><dd>{product.capacity}</dd></div><div><dt>颜色</dt><dd>{product.color}</dd></div><div><dt>品牌</dt><dd>{product.brand}</dd></div></dl>
        <details className="studio-fact-details"><summary>资料来源与宣传限制</summary><p>{product.evidence || '未填写独立资料来源；当前为虚构商品演示设定。'}</p><p>{product.restrictions}</p><p>这里只核对已提供资料，未独立验证资料真实性。旧活动继续使用原资料快照。</p></details>
        <Button kind="ghost" onClick={openProduct}>查看商品资料<ArrowUpRight size={13}/></Button>
      </aside>
      <section className="studio-editor-panel">
        <div className="studio-panel-title"><h3>创作与修订</h3><div className="studio-view-switch" role="group" aria-label="创意展示方式"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>文案</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>海报</button></div></div>
        <div className="studio-example-action"><Button disabled={busy} onClick={loadExample}><Sparkles size={14}/>载入核对示例</Button><small>测试文本 · 不会自动保存</small></div>
        {notice && <p className="studio-inline-note" role="status">{notice}</p>}
        {preview && <div className="studio-main-poster"><Poster creative={draft}/><p>海报价格、规格来自资料快照；正文和脚本仍需核对。</p></div>}
        <form className="studio-edit-form" onSubmit={async event => {
          event.preventDefault(); setSaveError('');
          if (await save(editPayload(draft))) { invalidate(); setNotice('新版本已保存。核对并确认后，可用于投放。'); }
          else setSaveError('新版本未保存成功，输入已保留。请检查页面错误后重试。');
        }}>
          <Field label="标题" full><input value={draft.title} disabled={busy} onChange={event => update('title', event.target.value)} required maxLength={200}/></Field>
          <Field label="广告正文" full><textarea rows={4} value={draft.body} disabled={busy} onChange={event => update('body', event.target.value)} required maxLength={6000}/></Field>
          {result && result.findings.some(finding => finding.field === 'body') && <div className="studio-checked-text" aria-label="正文核对高亮"><small>核对标记</small><HighlightedCopy text={draft.body} findings={result.findings.filter(finding => finding.field === 'body')}/></div>}
          <div className="studio-form-pair"><Field label="行动文案"><input value={draft.cta} disabled={busy} onChange={event => update('cta', event.target.value)} required maxLength={100}/></Field><Field label="创意方向"><input value={draft.direction} disabled={busy} onChange={event => update('direction', event.target.value)} required maxLength={100}/></Field></div>
          <Field label="海报模板"><select value={draft.template || 'classic'} disabled={busy} onChange={event => update('template', event.target.value)}><option value="classic">经典暖色</option><option value="minimal">极简留白</option></select></Field>
          <Field label="视频脚本" full><textarea rows={4} value={draft.script} disabled={busy} onChange={event => update('script', event.target.value)} maxLength={6000}/></Field>
          {saveError && <p className="studio-error" role="alert">{saveError}</p>}
          <div className="studio-save-actions"><Button disabled={!dirty || busy} onClick={() => {
            if (window.confirm('放弃未保存修改，恢复到当前素材版本？')) { setDraft(creative); invalidate(); setNotice('已恢复当前已保存版本。'); setSaveError(''); }
          }}>放弃修改</Button><button type="submit" className="button primary" disabled={busy || !dirty}>{busy ? <LoaderCircle size={15}/> : <Check size={15}/>}保存为新版本</button></div>
          <p className="studio-help">保存为新草稿，保留旧版本。检查结果不会自动批准素材。</p>
        </form>
      </section>
      <section className="studio-check-panel" data-testid="claim-results" aria-label="文案核对结果">
        <div className="studio-panel-title"><ShieldCheck size={17}/><h3>事实核对</h3><Badge tone="neutral">规则检查</Badge></div>
        <p className="studio-help">检查价格、容量与部分宣传表达。未覆盖的语义仍需人工判断。</p>
        <Button kind="primary" disabled={checking || busy} onClick={() => { setNotice(''); void check(draft); }}>{checking ? <LoaderCircle size={15}/> : <FileSearch size={15}/>} {checking ? '正在核对当前文案…' : '核对当前文案'}</Button>
        {checkError && <div className="studio-error" role="alert"><p>{checkError}</p><p>输入已保留，请重新核对。</p></div>}
        {!result && !checking && <div className="studio-check-empty"><FileSearch size={28}/><strong>{dirty ? '当前修改尚未核对' : '当前文案尚未核对'}</strong><p>核对结果包含冲突位置、资料依据与修订建议。</p></div>}
        {checking && <p className="studio-inline-note" role="status">正在向服务端核对当前文案与资料 V{product.version}，尚未返回结果。</p>}
        {result && <>
          <div className={`studio-check-summary ${result.can_approve ? 'checked' : 'needs-review'}`} role="status"><strong>{issues ? `${issues} 项需要处理` : result.incomplete_fields?.length ? '请补齐必填文案' : '支持范围内未发现阻断项'}</strong><p>{supported} 处与资料一致 · {result.summary.conflict} 处冲突 · {result.summary.missing_evidence} 处缺依据 · {result.summary.manual_review} 处待核查</p>{Boolean(result.incomplete_fields?.length) && <p>尚未填写：{result.incomplete_fields?.map(field => copyLabels[field]).join('、')}</p>}</div>
          <div className="studio-findings">{result.findings.map(finding => <article key={finding.id} className={`studio-finding ${finding.kind}`}>
            <div><span className="studio-finding-kind">{kindLabels[finding.kind]}</span><small>{copyLabels[finding.field]}</small></div>
            <strong>“{finding.text}”</strong><p>{finding.explanation}</p>
            <button className="studio-evidence-link" type="button" aria-label={`查看依据：${finding.text}`} onClick={() => setEvidence(finding)}>查看依据 · {finding.source.label} V{finding.source.version}<ArrowUpRight size={12}/></button>
          </article>)}</div>
          {changes.length > 0 && <Button onClick={() => setSuggestionsOpen(true)}><GitCompareArrows size={15}/>查看修订建议</Button>}
          <p className="studio-scope-note">{result.scope_note}</p>
        </>}
        <div className="studio-next-action">
          <span className="studio-eyebrow">下一步</span>
          {dirty ? <><strong>保存修订，形成新版本</strong><p>当前修改尚未保存。可以先保存草稿，再核对并人工确认。</p></> : creative.status === 'approved' ? <><strong>素材已确认，可以创建计划</strong><Button kind="primary" disabled={busy} onClick={useCreative}>用当前素材创建投放<ArrowRight size={14}/></Button></> : <><strong>人工确认后再用于投放</strong><Button disabled={busy || Boolean(result && !result.can_approve)} onClick={approve}>确认当前素材<Check size={14}/></Button>{result && !result.can_approve && <p>请先修改冲突或缺依据的表述，保存新版本后再确认。</p>}</>}
        </div>
      </section>
    </div>
    {evidence && <Modal title="查看商品依据" onClose={() => setEvidence(null)}><Badge tone={evidence.kind === 'consistent' ? 'green' : 'amber'}>{kindLabels[evidence.kind]}</Badge><Details items={[
      ['待核对表述', evidence.text], ['所在字段', copyLabels[evidence.field]], ['对应资料', evidence.source.label], ['资料记录', String(evidence.source.value ?? '未提供')], ['资料版本', `V${evidence.source.version}`], ['资料来源', evidence.source.evidence || '当前为虚构商品演示设定，未提供独立证明'], ['核对说明', evidence.explanation],
    ]}/><div className="notice">该来源由商品资料提供，不代表已通过独立检测或平台审核。</div></Modal>}
    {suggestionsOpen && result && <Modal title="核对修订建议" wide onClose={() => setSuggestionsOpen(false)}>
      <p className="muted">规则建议只修订能明确处理的部分。采用后仍可编辑，尚未保存或批准。</p>
      <div className="studio-revision-diff">{changes.map(key => <section key={key}><h3>{copyLabels[key]}</h3><div><div><small>修改前</small><p>{result.fields[key] || '空'}</p></div><ArrowRight size={16}/><div><small>建议内容</small><p>{result.suggested_fields[key] || '删除该表述'}</p></div></div></section>)}</div>
      {result.summary.manual_review > 0 && <div className="notice">需人工核查的表达没有自动修改，请结合活动条件核实后编辑。</div>}
      <div className="modal-footer"><Button onClick={() => setSuggestionsOpen(false)}>继续手动编辑</Button><Button kind="primary" disabled={busy} onClick={() => {
        setDraft(current => ({ ...current, ...result.suggested_fields })); invalidate(); setSuggestionsOpen(false); setPreview(false);
        setNotice('建议已带入编辑区。请重新核对，再保存为新版本；旧素材未改变。');
      }}>采用建议到编辑区</Button></div>
    </Modal>}
  </section>;
}
