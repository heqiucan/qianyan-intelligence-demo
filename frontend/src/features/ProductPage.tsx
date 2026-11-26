import { useEffect, useState } from 'react';
import { ArrowRight, Check, FileCheck2, Image, Package, Upload } from 'lucide-react';
import { api, requestId, type ClaimEvidence, type Product } from '../api';
import { Badge, Button, Field, Modal } from '../components/ui';
import type { Act } from '../domain';
import ProductEvidenceEditor, { evidenceError } from './product/ProductEvidenceEditor';
import './product/product.css';

interface Props {
  product: Product;
  busy: boolean;
  error: string;
  act: Act;
  dirtyChanged: (value: boolean) => void;
}

const labels: Record<string, string> = {
  name: '商品名称', brand: '品牌', price: '售价', capacity: '规格', color: '颜色',
  description: '商品描述', restrictions: '宣传限制', evidence: '资料来源',
  claim_evidence: '逐条主张依据', image_url: '商品图片', video_url: '已有视频',
};
const evidenceSummary = (items?: ClaimEvidence[]) => items?.map(item => `${item.claim}；${item.source}；${item.conditions || '未另填条件'}；${item.confirmed ? '已确认' : '待确认'}`).join('\n') || '未填写';
const displayValue = (product: Product, key: string) => key === 'claim_evidence'
  ? evidenceSummary(product.claim_evidence) : String(product[key as keyof Product] ?? '未填写');

export default function ProductPage({ product, busy, error, act, dirtyChanged }: Props) {
  const [draft, setDraft] = useState(product);
  const [view, setView] = useState('basic');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(product);
  const evidence = draft.claim_evidence || [];
  const invalidEvidence = evidence.some(item => Boolean(evidenceError(item)));
  const changedKeys = Object.keys(labels).filter(key => displayValue(draft, key) !== displayValue(product, key));

  useEffect(() => setDraft(product), [product]);
  useEffect(() => { dirtyChanged(dirty || uploading); return () => dirtyChanged(false); }, [dirty, uploading, dirtyChanged]);
  const set = (key: keyof Product, value: string | number) => setDraft(previous => ({ ...previous, [key]: value }));
  const updateEvidence = (index: number, change: Partial<ClaimEvidence>) => setDraft(previous => ({
    ...previous,
    claim_evidence: (previous.claim_evidence || []).map((item, i) => i === index ? { ...item, confirmed: false, ...change } : item),
  }));
  const addEvidence = () => setDraft(previous => ({ ...previous, claim_evidence: [...(previous.claim_evidence || []), {
    id: requestId(), category: 'shipping', claim: '', source: '', conditions: '', confirmed: false,
  }] }));
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true); setUploadError('');
    try {
      const data = new FormData(); data.set('file', file);
      const result = await api<{ url: string }>('/uploads', 'POST', data);
      set(file.type.startsWith('video/') ? 'video_url' : 'image_url', result.url);
    } catch (failure) { setUploadError((failure as Error).message); }
    finally { setUploading(false); }
  };

  return <div className="product-editor">
    <header className="product-detail-header">
      <div><h2>{product.name}</h2><p>{product.brand} · 资料 V{product.version}</p></div>
      <Badge tone={dirty ? 'amber' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Badge>
    </header>
    <nav className="product-detail-tabs" aria-label="商品资料视图">
      {[['basic', '基本资料', Package], ['media', '图片与视频', Image], ['evidence', '事实依据', FileCheck2]].map(([key, label, Icon]) => {
        const TabIcon = Icon as typeof Package;
        return <button type="button" key={String(key)} aria-current={view === key ? 'page' : undefined} onClick={() => setView(String(key))}><TabIcon size={16}/>{String(label)}</button>;
      })}
    </nav>
    <div className="product-detail-layout">
      <aside className="product-media-preview">
        <img src={draft.image_url} alt={draft.name}/>
        <dl><div><dt>规格</dt><dd>{draft.capacity}</dd></div><div><dt>颜色</dt><dd>{draft.color}</dd></div><div><dt>售价</dt><dd>¥{draft.price.toFixed(2)}</dd></div></dl>
        <span className="muted">{draft.image_url.startsWith('/uploads/') ? '已上传商品图片' : '初始样例图片'}</span>
      </aside>
      <form className="product-detail-fields" onInvalidCapture={event => {
        const section = (event.target as HTMLElement).closest('section')?.getAttribute('aria-label');
        setView(section === '逐条主张依据' || section === '商品事实依据' ? 'evidence' : 'basic');
      }} onSubmit={event => { event.preventDefault(); if (!invalidEvidence) setConfirmSave(true); }}>
        <section hidden={view !== 'basic'} aria-label="商品基本资料">
          <h3>基本资料</h3>
          <div className="form-grid">
            <Field label="商品名称" full><input value={draft.name} onChange={e => set('name', e.target.value)} required maxLength={100}/></Field>
            <Field label="品牌"><input value={draft.brand} onChange={e => set('brand', e.target.value)} required maxLength={100}/></Field>
            <Field label="售价 / 元"><input type="number" min="0.01" max="1000000" step="0.01" value={draft.price} onChange={e => set('price', Number(e.target.value))} required/></Field>
            <Field label="容量 / 规格"><input value={draft.capacity} onChange={e => set('capacity', e.target.value)} required maxLength={40}/></Field>
            <Field label="颜色"><input value={draft.color} onChange={e => set('color', e.target.value)} required maxLength={40}/></Field>
            <Field label="已知商品描述" full><textarea rows={6} value={draft.description} onChange={e => set('description', e.target.value)} required maxLength={6000}/></Field>
          </div>
        </section>
        <section hidden={view !== 'media'} aria-label="商品媒体资料">
          <h3>图片与视频</h3>
          <label className="button secondary product-upload"><Upload size={16}/>{uploading ? '上传中…' : '上传商品图片 / 已有视频'}<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" disabled={uploading || busy} onChange={e => upload(e.target.files?.[0])}/></label>
          <p className="muted">PNG / JPG / WebP、MP4 / WebM · 最大 20 MB</p>
          {draft.video_url ? <video src={draft.video_url} controls preload="metadata" poster={draft.image_url}/> : <p className="product-empty-media">尚未上传商品视频</p>}
          {uploadError && <p role="alert">{uploadError}</p>}
        </section>
        <section hidden={view !== 'evidence'} aria-label="商品事实依据">
          <h3>事实依据与宣传边界</h3>
          <Field label="卖点依据 / 资料来源"><textarea rows={7} value={draft.evidence || ''} onChange={e => set('evidence', e.target.value)} maxLength={4000}/></Field>
          <Field label="宣传限制 / 尚无依据的内容"><textarea rows={4} value={draft.restrictions} onChange={e => set('restrictions', e.target.value)} maxLength={4000}/></Field>
          <ProductEvidenceEditor items={evidence} busy={busy} add={addEvidence} update={updateEvidence} remove={index => setDraft(previous => ({ ...previous, claim_evidence: (previous.claim_evidence || []).filter((_, i) => i !== index) }))}/>
        </section>
        <footer className="product-save-bar">
          <p className="muted">保存更新商品资料，已有活动和素材保留原版本。</p>
          {invalidEvidence && <Button kind="ghost" onClick={() => setView('evidence')}>检查未完成的事实依据</Button>}
          <div className="row-actions"><Button disabled={!dirty || busy || uploading} onClick={() => { if (confirm('放弃本次未保存的商品修改？')) setDraft(product); }}>放弃修改</Button><button className="button primary" disabled={busy || uploading || !dirty || invalidEvidence}><Check size={16}/>核对并保存商品资料</button></div>
        </footer>
      </form>
    </div>
    {confirmSave && <Modal title="核对商品资料变更" wide error={error} busy={busy} onClose={() => setConfirmSave(false)}>
      <div className="v2-diff-list">{changedKeys.map(key => <div key={key}><strong>{labels[key]}</strong><span className="product-diff-text">{displayValue(product, key)}</span><ArrowRight size={15}/><span className="product-diff-text">{displayValue(draft, key)}</span></div>)}</div>
      <p className="muted">将保存为资料 V{product.version + 1}；原活动的价格、规格和依据不变。</p>
      <div className="modal-footer"><Button onClick={() => setConfirmSave(false)} disabled={busy}>返回编辑</Button><Button kind="primary" disabled={busy || invalidEvidence} onClick={() => act(async () => { await api('/product', 'PUT', draft); setConfirmSave(false); dirtyChanged(false); }, '商品新版本已保存')}>确认保存商品资料</Button></div>
    </Modal>}
  </div>;
}
