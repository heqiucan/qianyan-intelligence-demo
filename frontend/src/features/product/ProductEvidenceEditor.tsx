import { Plus, X } from 'lucide-react';
import type { ClaimEvidence } from '../../api';
import { Button, Field } from '../../components/ui';

const normalized = (text: string) => text.normalize('NFKC').replace(/\s/g, '').replace(/^[。.;；!！?？]+|[。.;；!！?？]+$/g, '').toLowerCase();

export function evidenceError(item: ClaimEvidence) {
  if (!item.claim.trim() || !item.source.trim()) return '请填写完整主张原文和具体来源。';
  if (item.conditions.trim() && !normalized(item.claim).includes(normalized(item.conditions))) return '完整主张原文必须保留填写的适用条件。';
  if (!item.confirmed) return '请核对来源与条件，并勾选人工确认。';
  return '';
}

interface Props {
  items: ClaimEvidence[];
  busy: boolean;
  add: () => void;
  remove: (index: number) => void;
  update: (index: number, change: Partial<ClaimEvidence>) => void;
}

export default function ProductEvidenceEditor({ items, busy, add, remove, update }: Props) {
  return <section className="product-evidence" aria-label="逐条主张依据">
    <div className="product-section-heading"><h3>逐条主张依据 <small>{items.length}/20</small></h3><Button disabled={busy || items.length >= 20} onClick={add}><Plus size={15}/>添加依据</Button></div>
    <p className="muted">仅支持已核对的完整原文与适用条件；系统不认证报告真伪。</p>
    {items.map((item, index) => <fieldset key={item.id}>
      <legend>依据 {index + 1}</legend>
      <div className="form-grid">
        <Field label={`依据 ${index + 1} 类型`} full><select value={item.category} onChange={e => update(index, { category: e.target.value as ClaimEvidence['category'] })}><option value="shipping">物流时效</option><option value="performance">性能时长</option></select></Field>
        <Field label={`依据 ${index + 1} 完整主张原文`} full><textarea rows={3} required maxLength={400} value={item.claim} onChange={e => update(index, { claim: e.target.value })}/></Field>
        <Field label={`依据 ${index + 1} 来源`} full><textarea rows={2} required maxLength={300} value={item.source} onChange={e => update(index, { source: e.target.value })}/></Field>
        <Field label={`依据 ${index + 1} 适用条件（可留空）`} full><textarea rows={2} maxLength={300} value={item.conditions} onChange={e => update(index, { conditions: e.target.value })}/></Field>
      </div>
      <label className="product-evidence-confirm"><input type="checkbox" checked={item.confirmed} onChange={e => update(index, { confirmed: e.target.checked })}/>我已核对原文、来源和适用条件</label>
      {evidenceError(item) && <p className="muted" role="status">{evidenceError(item)}</p>}
      <Button disabled={busy} onClick={() => remove(index)}><X size={15}/>删除依据 {index + 1}</Button>
    </fieldset>)}
  </section>;
}
