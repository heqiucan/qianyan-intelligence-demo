import { useState } from 'react';
import { api, money, type Campaign, type Product } from '../api';
import { Badge, Button, Field, Modal, Submit } from './ui';
import { today, later } from '../domain';
import './product-basis.css';

interface Props {
  campaign?: Campaign; prefill?: Campaign; product: Product; latestProduct?: boolean;
  busy: boolean; error: string; close: () => void;
  save: (body: Record<string, unknown>) => Promise<boolean>;
}

export default function CampaignModal({campaign, prefill, product, latestProduct = false, busy, error, close, save}: Props) {
  // Keep the reviewed version stable while open; the server rejects a stale version.
  const [basis, setBasis] = useState(() => campaign?.product_snapshot || product);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const [reloaded, setReloaded] = useState(false);
  const initial = campaign || prefill;
  return <Modal title={campaign ? '编辑活动策略' : latestProduct ? '使用最新商品创建活动' : '新建营销活动'} onClose={close} error={error} wide busy={busy}>
    <section className="notice product-basis-notice" aria-label="本活动使用的商品">
      <Badge tone="neutral">商品资料 V{basis.version}</Badge>
      <p><strong>{basis.name}</strong> · {money(basis.price)} · {basis.capacity} · {basis.color}</p>
      <p>{campaign ? '本活动继续使用创建时的商品资料。' : '创建后将切换到此商品的新活动，下一步生成创意。'}</p>
      {latestProduct && <p>原活动、素材和计划保留。下面的受众与卖点沿用原活动，请按此商品核对或修改。</p>}
      {!campaign && error.includes('商品资料已更新') && <Button disabled={busy || reloading} onClick={async () => {
        setReloading(true); setReloadError('');
        try { const current = await api<{product: Product}>('/state'); setBasis(current.product); setReloaded(true); }
        catch (reason) { setReloadError((reason as Error).message); }
        finally { setReloading(false); }
      }}>{reloading ? '正在读取最新商品…' : '重新读取最新商品，保留表单输入'}</Button>}
      {reloaded && <p role="status">已读取商品资料 V{basis.version}。活动名称、受众与卖点输入已保留，请按上方商品核对后重新提交。</p>}
      {reloadError && <p role="alert">{reloadError}</p>}
    </section>
    <form onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void save({...Object.fromEntries(form), budget_limit: form.get('budget_limit') ? Number(form.get('budget_limit')) : null,
        ...(!campaign ? {expected_product_version: basis.version} : {})});
    }}>
      <div className="form-grid">
        <Field label="活动名称" full><input name="name" defaultValue={campaign?.name || `${basis.name} · 推广活动`.slice(0, 120)} required maxLength={120}/></Field>
        <Field label="内部观察目标" full><input name="goal" defaultValue={initial?.goal} placeholder="填写这次推广要观察的目标" maxLength={600}/></Field>
        <Field label="受众假设"><input name="audience" defaultValue={initial?.audience} maxLength={600} placeholder="填写待验证的目标人群"/></Field>
        <Field label="主推卖点"><input name="selling_point" defaultValue={initial?.selling_point} maxLength={600} placeholder="必须依据商品已知资料"/></Field>
        <Field label="预算上限"><input name="budget_limit" type="number" min="1" max="1000000" step="0.01" defaultValue={initial?.budget_limit ?? ''}/></Field>
        <Field label="平台推广目标"><input value="商品成交 · 模拟" readOnly/></Field>
        <Field label="活动开始日期"><input name="start_date" type="date" defaultValue={campaign?.start_date || today()} required/></Field>
        <Field label="活动结束日期"><input name="end_date" type="date" defaultValue={campaign?.end_date || later()} required/></Field>
      </div>
      <div className="notice">商品：{basis.name} · 资料 V{basis.version}。编辑策略保留版本；受众与目标均为内部待验证假设。</div>
      <div className="modal-footer"><Button onClick={close} disabled={busy || reloading}>取消</Button><Submit busy={busy || reloading}>{campaign ? '保存策略新版本' : latestProduct ? '创建活动并使用此商品' : '创建并开始策划'}</Submit></div>
    </form>
  </Modal>;
}
