import type { LiveSession } from '../live/types';
import { useRef, useState } from 'react';
import { ArrowRight, FileCheck2, LoaderCircle } from 'lucide-react';
import { api, money, requestId, type Campaign, type Creative } from '../../api';
import { Badge, Button, Field, Modal } from '../../components/ui';
import type { KnowledgeDraft } from '../knowledge/types';

export interface HandoffContext {
  sessions?:LiveSession[]; campaigns: Campaign[]; campaignId: string;
  transferred: (creative: Creative) => Promise<void>;
}

export default function CreativeHandoff({ draft, context, disabled }: {
  draft: KnowledgeDraft; context: HandoffContext; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (draft.scene !== 'live') return <div className="journey-handoff-note"><FileCheck2 size={17}/><p>下一步：确认后可导出内部 FAQ。医美内容不进入商品成交计划。</p></div>;
  return <div className="journey-handoff">
    <div><strong>把内容接到下一步营销工作</strong><p>{draft.transfer_note || '先确认知识草稿，再转为活动创意。'}</p>
      {!!draft.transfers?.length && <small>此版本已转入 {draft.transfers.length} 个活动。再次转入同一活动会打开原素材，不会重复创建。</small>}
    </div>
    <Button disabled={disabled || !draft.can_transfer} kind="primary" onClick={() => setOpen(true)}>转为活动创意<ArrowRight size={14}/></Button>
    {open && <TransferForm draft={draft} context={context} close={() => setOpen(false)}/>}
  </div>;
}

function TransferForm({ draft, context, close }: { draft: KnowledgeDraft; context: HandoffContext; close: () => void }) {
  const [campaignId, setCampaignId] = useState(draft.linked_campaign_id || context.campaignId || context.campaigns[0]?.id || '');
  const [title, setTitle] = useState(draft.title), [body, setBody] = useState(draft.blocks[0]?.text || '');
  const [script, setScript] = useState(draft.blocks.map(b => b.text).join('\n\n')), [cta, setCta] = useState('查看商品详情');
  const [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sessionId,setSessionId]=useState(draft.linked_live_context?.session_id||''),[itemId,setItemId]=useState(draft.linked_live_context?.item_id||'');
  const lock = useRef(false);
  const campaign = context.campaigns.find(c => c.id === campaignId),session=context.sessions?.find(s=>s.id===sessionId),item=session?.items.find(i=>i.id===itemId),product=draft.linked_live_context?.product_snapshot||item?.product_snapshot||campaign?.product_snapshot;
  const existing = draft.transfers?.find(t => t.campaign_id === campaignId && (t.live_context?.session_id||'')===sessionId && (t.live_context?.item_id||'')===itemId && (!sessionId||t.live_context?.session_version===(draft.linked_live_context?.session_version||session?.version)));
  const tooLong = script.length > 6000 || body.length > 6000;
  const submit = async () => {
    if (lock.current || !product) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await api<{ creative: Creative; reused: boolean }>(`/knowledge/drafts/${draft.id}/creative`, 'POST', {
        request_id: requestId(), campaign_id: campaignId, expected_revision: draft.revision,
        // Existing transfers only reopen their saved creative; original long scripts need not be resubmitted.
        ...(sessionId?{live_session_id:sessionId,live_item_id:itemId}:{}),
        expected_product_version: product.version, acknowledged: ack, title, body, script: existing ? '' : script, cta,
      });
      await context.transferred(result.creative);
      close();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="核对并转为活动创意" wide busy={busy} error={error} onClose={close}>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <div className="journey-transfer-context"><Badge>知识草稿 V{draft.revision}</Badge><span>{draft.sources.length} 条引用随草稿保存 · {draft.agent_task_id ? '来自 Agent 任务' : '来自知识库'}</span></div>
      <Field label="转入目标活动"><select required disabled={busy || !!draft.linked_campaign_id} value={campaignId} onChange={e => { setCampaignId(e.target.value);setSessionId('');setItemId(''); setAck(false); }}><option value="">请选择商品营销活动</option>{context.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {draft.linked_campaign_id && <p className="muted">沿用 Agent 创建时关联的活动。切换工作台活动不会改变任务归属。</p>}
      {draft.linked_live_context?<p className="notice">场次：{draft.linked_live_context.session_title} · 货盘 V{draft.linked_live_context.session_version} · {draft.linked_live_context.sku_label}</p>:<><Field label="关联直播场次（可选）"><select value={sessionId} onChange={e=>{setSessionId(e.target.value);setItemId('');setAck(false)}}><option value="">独立活动创意</option>{context.sessions?.filter(s=>s.campaign_id===campaignId&&s.status==='ready').map(s=><option key={s.id} value={s.id}>{s.title} · V{s.version}</option>)}</select></Field>{sessionId&&<Field label="目标货盘商品"><select required value={itemId} onChange={e=>{setItemId(e.target.value);setAck(false)}}><option value="">请选择本场商品</option>{session?.items.map(i=><option value={i.id} key={i.id}>{i.product_snapshot.name} · {i.sku_label}</option>)}</select></Field>}</>}
      {product && <div className="journey-target-product"><strong>请核对目标商品：{product.name}</strong><p>{product.brand} · {product.capacity} · {product.color} · {money(product.price)} · 活动资料 V{product.version}</p><small>系统不会把其他商品资料自动当作本商品事实。请逐项比较正文与此商品。</small></div>}
      {existing ? <div className="notice">这个版本已转入本活动，将打开原素材。后续修改请在创意编辑器保存新版本。</div> : <>
        <p className="muted">标题与第一段预填为广告文案，全文预填为脚本。你可以整理表达，原草稿与引用快照完整保留。</p>
        <Field label="转入创意标题"><input required maxLength={200} disabled={busy} value={title} onChange={e => { setTitle(e.target.value); setAck(false); }}/></Field>
        <Field label="转入广告正文"><textarea required rows={4} maxLength={6000} disabled={busy} value={body} onChange={e => { setBody(e.target.value); setAck(false); }}/></Field>
        <Field label="转入行动文案"><input required maxLength={100} disabled={busy} value={cta} onChange={e => { setCta(e.target.value); setAck(false); }}/></Field>
        <Field label="转入视频脚本"><textarea rows={6} maxLength={6000} disabled={busy} value={script} onChange={e => { setScript(e.target.value); setAck(false); }}/></Field>
        <p className={tooLong ? 'kb-warning' : 'muted'}>脚本 {script.length} / 6000 字。{tooLong ? '内容超长，请先整理；不会静默截断原文。' : '转入后仍需核对与确认素材。'}</p>
      </>}
      <details className="journey-evidence"><summary>查看随草稿保存的原文依据与待核实事项</summary>{draft.sources.map(s => <article key={s.id}><strong>{s.title} · V{s.version} · {s.locator}</strong><p>{s.text}</p></article>)}{draft.missing.map((m, i) => <p key={i}>待核实：{m}</p>)}</details>
      <label className="kb-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)}/><span>我已核对内容属于目标活动商品，了解此次仅转为待确认创意，不会发布或启动投放。</span></label>
      <div className="modal-footer"><Button disabled={busy} onClick={close}>取消</Button><button type="submit" className="button primary" disabled={busy || !ack || !campaign || (!!sessionId&&!itemId) || (!existing && tooLong)}>{busy ? <LoaderCircle size={15}/> : <ArrowRight size={15}/>} {busy ? '正在转入…' : existing ? '打开已转入素材' : '确认转入创意草稿'}</button></div>
    </form>
  </Modal>;
}
