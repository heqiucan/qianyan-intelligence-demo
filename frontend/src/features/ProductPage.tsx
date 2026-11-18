import { useEffect, useState } from 'react';
import { ArrowRight, Check, Plus, Upload, X } from 'lucide-react';
import { api, requestId, type ClaimEvidence, type Product } from '../api';
import { Badge, Button, Field, Modal } from '../components/ui';
import { type Act } from '../domain';

const normalized = (text: string) => text.normalize('NFKC').replace(/\s/g, '').replace(/^[。.;；!！?？]+|[。.;；!！?？]+$/g, '').toLowerCase();
const evidenceError = (item: ClaimEvidence) => {
  if (!item.claim.trim() || !item.source.trim()) return '请填写完整主张原文和具体来源。';
  if (item.conditions.trim() && !normalized(item.claim).includes(normalized(item.conditions))) return '完整主张原文必须保留填写的适用条件。';
  if (!item.confirmed) return '核对来源与条件后，请勾选人工确认；尚未核实的内容请删除本条，不作为依据保存。';
  return '';
};
const evidenceSummary = (items?: ClaimEvidence[]) => items?.map(item => `${item.category === 'shipping' ? '物流时效' : '性能时长'}：${item.claim}；来源：${item.source}；条件：${item.conditions || '未另填条件'}；${item.confirmed ? '已人工确认' : '待确认'}`).join('\n') || '未填写';

export default function ProductPage({product, busy, error, act, dirtyChanged}: {product: Product; busy: boolean; error: string; act: Act; dirtyChanged: (v: boolean) => void}) {
  const [draft, setDraft] = useState(product);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(product);
  const evidence = draft.claim_evidence || [];
  const invalidEvidence = evidence.some(item => !!evidenceError(item));
  useEffect(() => { setDraft(product); }, [product]);
  useEffect(() => { dirtyChanged(dirty); return () => dirtyChanged(false); }, [dirty]);
  const set = (key: keyof Product, value: string | number) => setDraft(previous => ({...previous, [key]: value}));
  const updateEvidence = (index: number, change: Partial<ClaimEvidence>) => setDraft(previous => ({
    ...previous,
    claim_evidence: (previous.claim_evidence || []).map((item, i) => i === index ? {...item, confirmed: false, ...change} : item),
  }));
  const addEvidence = () => setDraft(previous => ({...previous, claim_evidence: [...(previous.claim_evidence || []), {
    id: requestId(), category: 'shipping', claim: '', source: '', conditions: '', confirmed: false,
  }]}));
  const removeEvidence = (index: number) => setDraft(previous => ({...previous, claim_evidence: (previous.claim_evidence || []).filter((_, i) => i !== index)}));
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true); setUploadError('');
    try {
      const data = new FormData(); data.set('file', file);
      const result = await api<{url: string}>('/uploads', 'POST', data);
      set(file.type.startsWith('video/') ? 'video_url' : 'image_url', result.url);
    } catch (e) { setUploadError((e as Error).message); }
    finally { setUploading(false); }
  };
  const labels: Record<string, string> = {name: '商品名称', brand: '品牌', price: '售价', capacity: '规格', color: '颜色', description: '商品描述', restrictions: '宣传限制', evidence: '资料来源', claim_evidence: '逐条主张依据', image_url: '商品图片', video_url: '已有视频'};
  const displayValue = (item: Product, key: string) => key === 'claim_evidence' ? evidenceSummary(item.claim_evidence) : String(item[key as keyof Product] || '未填写');

  return <>
    <div className="split-layout">
      <section className="panel product-stage">
        <div className="panel-header"><Badge tone="neutral">商品主视觉</Badge><Badge>资料 V{product.version}</Badge></div>
        <img className="product-image" src={draft.image_url} alt={draft.name}/>
        <div className="product-stage-caption"><span>{draft.brand}</span><h2>{draft.name}</h2><p>{draft.capacity} / {draft.color}</p></div>
        <label className="button secondary upload-button"><Upload size={16}/>{uploading ? '上传中…' : '上传商品图片 / 已有视频'}<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" disabled={uploading} onChange={e => upload(e.target.files?.[0])}/></label>
        <p className="muted">PNG / JPG / WebP、MP4 / WebM · 最大 20 MB</p>
        {draft.video_url && <video src={draft.video_url} controls preload="metadata" poster={draft.image_url} className="product-video"/>}
        {uploadError && <p role="alert">{uploadError}，请重新选择文件重试。</p>}
        <div className="notice">资料完整性：{[draft.name, draft.brand, draft.capacity, draft.color, draft.description, draft.evidence].filter(Boolean).length}/6 项。完整性只统计填写情况，不表示内容已被外部核实。</div>
      </section>
      <section className="panel product-detail">
        <div className="panel-header"><div><h3>商品与品牌资料</h3><span className="muted">生成内容的事实依据 · 虚构测试商品</span></div><Badge tone={dirty ? 'amber' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Badge></div>
        <form onSubmit={e => { e.preventDefault(); if (!invalidEvidence) setConfirmSave(true); }}>
          <div className="form-grid">
            <Field label="商品名称" full><input value={draft.name} onChange={e => set('name', e.target.value)} required maxLength={100}/></Field>
            <Field label="品牌"><input value={draft.brand} onChange={e => set('brand', e.target.value)} required maxLength={100}/></Field>
            <Field label="售价 / 元"><input type="number" min="0.01" max="1000000" step="0.01" value={draft.price} onChange={e => set('price', Number(e.target.value))} required/></Field>
            <Field label="容量 / 规格"><input value={draft.capacity} onChange={e => set('capacity', e.target.value)} required maxLength={40}/></Field>
            <Field label="颜色"><input value={draft.color} onChange={e => set('color', e.target.value)} required maxLength={40}/></Field>
            <Field label="已知商品描述" full><textarea rows={4} value={draft.description} onChange={e => set('description', e.target.value)} required maxLength={6000}/></Field>
            <Field label="卖点依据 / 资料来源" full><textarea rows={3} value={draft.evidence || ''} onChange={e => set('evidence', e.target.value)} maxLength={4000} placeholder="填写资料出处或明确标注为演示设定，不编造检测报告"/></Field>
            <Field label="宣传限制 / 尚无依据的内容" full><textarea rows={3} value={draft.restrictions} onChange={e => set('restrictions', e.target.value)} maxLength={4000}/></Field>
          </div>
          <section aria-label="逐条主张依据" style={{marginTop: 24}}>
            <div className="panel-header" style={{flexWrap: 'wrap', gap: 12}}><div><h3>逐条主张依据</h3><span className="muted">可选 · {evidence.length}/20 条 · 物流时效 / 性能时长</span></div><Button onClick={addEvidence} disabled={busy || evidence.length >= 20}><Plus size={16}/>添加依据</Button></div>
            <div className="notice">上方自由文本资料用于说明出处，不自动支持物流或性能主张。在这里逐条填写经你核对的完整原文、来源及适用条件，再人工确认。文案须使用相同完整表述；条件应写在同一子句内，可用括号保留。系统仅比对资料快照，不验证报告真伪。促销价、免费和保证性效果仍需另行核查，不能通过本表自动放行。</div>
            {evidence.map((item, index) => <fieldset key={item.id} style={{minWidth: 0, margin: '16px 0', padding: 16, border: '1px solid var(--border)', borderRadius: 12}}>
              <legend>依据 {index + 1}</legend>
              <div className="form-grid">
                <Field label={`依据 ${index + 1} 类型`} full><select value={item.category} onChange={e => updateEvidence(index, {category: e.target.value as ClaimEvidence['category']})}><option value="shipping">物流时效</option><option value="performance">性能时长</option></select></Field>
                <Field label={`依据 ${index + 1} 完整主张原文`} full><textarea rows={3} required maxLength={400} value={item.claim} onChange={e => updateEvidence(index, {claim: e.target.value})} placeholder="例：24小时内发货（仅限工作日下单）；请按实际资料填写，不将示例视为事实"/></Field>
                <Field label={`依据 ${index + 1} 来源`} full><textarea rows={2} required maxLength={300} value={item.source} onChange={e => updateEvidence(index, {source: e.target.value})} placeholder="文件名称、版本、页码或可追溯的确认记录；演示设定请明确写明"/></Field>
                <Field label={`依据 ${index + 1} 适用条件（可留空）`} full><textarea rows={2} maxLength={300} value={item.conditions} onChange={e => updateEvidence(index, {conditions: e.target.value})} placeholder="如：仅限工作日下单。填写的条件必须原样保留在完整主张中"/></Field>
              </div>
              <label style={{display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, fontSize: 13, lineHeight: 1.7}}><input type="checkbox" style={{width: 'auto', flexShrink: 0, marginTop: 5}} checked={item.confirmed} onChange={e => updateEvidence(index, {confirmed: e.target.checked})}/>我已人工核对这条原文、来源和适用条件；我理解系统不会据此认证真实效果。</label>
              {evidenceError(item) && <p className="muted" role="status">{evidenceError(item)}</p>}
              <div className="form-actions"><Button disabled={busy} onClick={() => removeEvidence(index)}><X size={15}/>删除依据 {index + 1}</Button></div>
            </fieldset>)}
          </section>
          <div className="notice">保存只更新商品资料。已有活动、素材与计划仍使用原快照；要让新依据参与核对，请保存后用新版本创建活动并生成素材。</div>
          <div className="form-actions"><Button disabled={!dirty || busy} onClick={() => { if (confirm('放弃本次未保存的商品修改？')) setDraft(product); }}>放弃修改</Button><button className="button primary" disabled={busy || uploading || !dirty || invalidEvidence}><Check size={16}/>核对并保存商品资料</button></div>
        </form>
      </section>
    </div>
    {confirmSave && <Modal title="核对商品资料变更" wide error={error} busy={busy} onClose={() => setConfirmSave(false)}>
      <div className="v2-diff-list">{Object.keys(labels).filter(key => displayValue(draft, key) !== displayValue(product, key)).map(key => <div key={key}><strong>{labels[key]}</strong><span style={{whiteSpace: 'pre-wrap'}}>{displayValue(product, key)}</span><ArrowRight size={15}/><span style={{whiteSpace: 'pre-wrap'}}>{displayValue(draft, key)}</span></div>)}</div>
      <div className="notice">将保存为资料 V{product.version + 1}，原活动的价格、规格和依据不变。逐条依据是人工确认记录，不是系统对真实效果的认证。</div>
      <div className="modal-footer"><Button onClick={() => setConfirmSave(false)} disabled={busy}>返回编辑</Button><Button kind="primary" disabled={busy || invalidEvidence} onClick={() => act(async () => { await api('/product', 'PUT', draft); setConfirmSave(false); dirtyChanged(false); }, '商品新版本已保存')}>确认保存商品资料</Button></div>
    </Modal>}
  </>;
}
