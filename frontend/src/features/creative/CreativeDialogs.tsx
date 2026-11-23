import { useState } from 'react';
import { money, type Creative } from '../../api';
import { Badge, Button, Details, Field, Modal } from '../../components/ui';
import Poster from '../../Poster';
import { creativeFamilies } from './CreativeLibrary';

export interface CreativeDialog { kind: 'preview' | 'approve' | 'compare'; creative: Creative }

interface Props {
  dialog: CreativeDialog; creatives: Creative[]; busy: boolean; error: string;
  close: () => void; edit: (creative: Creative) => void; approve: (creative: Creative) => void;
}

export default function CreativeDialogs({ dialog: { kind, creative }, creatives, busy, error, close, edit, approve }: Props) {
  const [compareId, setCompareId] = useState('');
  const siblings = (creativeFamilies(creatives).find(items => items.some(item => item.id === creative.id)) || [creative]).slice().sort((a, b) => a.version - b.version);
  const previous = siblings.find(item => item.id === compareId) || siblings.filter(item => item.version < creative.version).at(-1) || creative;
  const title = { preview: '素材预览与导出', approve: '核对并确认素材', compare: '创意版本对比' }[kind];

  return <Modal title={title} wide={kind !== 'preview'} error={error} busy={busy} onClose={close}>
    {kind === 'preview' && <div className="poster-modal"><Poster creative={creative} download/><p className="muted">导出已保存版本，不包含未保存的修改。</p></div>}
    {kind === 'approve' && <>
      <Details items={[
        ['素材', `${creative.title} · V${creative.version}`],
        ['商品依据', `${creative.product_snapshot.name} · ${money(creative.product_snapshot.price)} · ${creative.product_snapshot.capacity}`],
        ['资料来源', creative.product_snapshot.evidence || '虚构商品演示设定，未提供独立来源'],
        ['宣传限制', creative.product_snapshot.restrictions],
      ]}/>
      <div className="notice">确认时服务端重新核对已保存文案，支持范围内的冲突或缺依据会阻止确认。人工确认不等于完整广告审核。</div>
      <div className="modal-footer"><Button disabled={busy} onClick={() => edit(creative)}>返回编辑</Button><Button kind="primary" disabled={busy} onClick={() => approve(creative)}>确认通过素材</Button></div>
    </>}
    {kind === 'compare' && <>
      <Field label="对照版本"><select value={previous.id} onChange={event => setCompareId(event.target.value)}>{siblings.map(item => <option key={item.id} value={item.id}>V{item.version} · {item.title}</option>)}</select></Field>
      <div className="v2-compare">{[{ label: '对照', item: previous }, { label: '当前', item: creative }].map(({ label, item }) => <section key={label}>
        <Badge tone={label === '当前' ? 'purple' : 'neutral'}>{label} V{item.version}</Badge>
        <h3>{item.title}</h3><p>{item.body}</p><p>{item.cta}</p><pre>{item.script}</pre><p>资料 V{item.product_snapshot.version}</p>
      </section>)}</div>
      <p className="muted">同组 {siblings.length} 个版本。旧投放计划保留原素材快照。</p>
    </>}
  </Modal>;
}
