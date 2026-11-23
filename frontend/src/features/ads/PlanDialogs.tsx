import { useRef, useState } from 'react';
import { Copy, FlaskConical, Settings2 } from 'lucide-react';
import { api, date, money, requestId, type Creative, type Plan, type V2Record } from '../../api';
import { Badge, Button, Details, Empty, Field, Modal, Submit } from '../../components/ui';
import { later, names, today, type Act } from '../../domain';

type DialogKind = 'create' | 'edit' | 'detail' | 'start' | 'end' | 'adjust' | 'apply' | 'bulk';
export interface PlanDialog {
  kind: DialogKind; requestId: string; planId?: string; adjustmentId?: string; planIds?: string[];
  pendingAdjustment?: V2Record;
}
interface Props {
  dialog: PlanDialog; change: (dialog: PlanDialog) => void; close: () => void;
  plans: Plan[]; approved: Creative[]; adjustments: V2Record[]; batches: V2Record[];
  selectedCreative: string; busy: boolean; error: string; act: Act;
  paused: () => void; scenarios: (plan: Plan) => void;
}
const titles: Record<DialogKind, string> = {
  create: '创建模拟投放计划', edit: '编辑计划草稿', detail: '投放计划详情',
  start: '核对并确认模拟启动', end: '结束模拟投放计划', adjust: '创建计划调整草稿',
  apply: '核对计划配置变更', bulk: '核对批量暂停',
};

export default function PlanDialogs({ dialog, change, close, plans, approved, adjustments, batches, selectedCreative, busy, error, act, paused, scenarios }: Props) {
  const { kind, planId, adjustmentId } = dialog;
  const target = plans.find(plan => plan.id === planId);
  const adjustment = adjustments.find(item => item.id === adjustmentId) || dialog.pendingAdjustment;
  const planAdjustments = adjustments.filter(item => item.plan_id === planId).slice().reverse();
  const [bulkResult, setBulkResult] = useState<{ plan_id: string; ok: boolean; error?: string }[] | null>(null);
  const mutationLock = useRef(false);
  const submit = async (work: () => Promise<unknown>, message: string) => {
    if (busy || mutationLock.current) return;
    mutationLock.current = true;
    try { await act(work, message); } finally { mutationLock.current = false; }
  };
  const switchDialog = (next: DialogKind) => change({ ...dialog, kind: next });
  const missing = kind === 'apply' ? !adjustment : !['create', 'bulk'].includes(kind) && !target;

  return <Modal title={titles[kind]} wide error={error} busy={busy} onClose={close}>
    <div className="ads-dialog">
      {missing && <Empty text="记录已不在当前活动中，请关闭后重新选择。"/>}
      {(kind === 'create' || (kind === 'edit' && target)) && <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const fields = { name: String(form.get('name')), budget: Number(form.get('budget')), start_date: String(form.get('start_date')), end_date: String(form.get('end_date')) };
        void submit(async () => {
          await api(kind === 'edit' ? `/plans/${planId}` : '/plans', kind === 'edit' ? 'PUT' : 'POST', {
            ...fields, ...(kind === 'create' ? { creative_id: form.get('creative_id'), request_id: dialog.requestId } : {}),
          });
          close();
        }, '计划草稿已保存');
      }}>
        <fieldset disabled={busy} className="form-grid ads-form-fields">
          <Field label="计划名称" full><input name="name" defaultValue={target?.name} required maxLength={120} placeholder="新品推广"/></Field>
          {kind === 'create' && <Field label="已确认素材" full><select name="creative_id" defaultValue={approved.some(creative => creative.id === selectedCreative) ? selectedCreative : approved[0]?.id} required>{approved.map(creative => <option key={creative.id} value={creative.id}>{creative.title} · V{creative.version}</option>)}</select></Field>}
          <Field label="计划总预算"><input name="budget" type="number" min="1" max="1000000" step="0.01" defaultValue={target?.budget || 300} required/></Field>
          <Field label="推广目标"><input value="商品成交 · 模拟" readOnly/></Field>
          <Field label="开始日期"><input name="start_date" type="date" defaultValue={target?.start_date || today()} required/></Field>
          <Field label="结束日期"><input name="end_date" type="date" defaultValue={target?.end_date || later()} required/></Field>
        </fieldset>
        <div className="notice">保存为草稿，核对后手动启动。日期需覆盖 UTC 模拟启动当天。</div>
        <div className="modal-footer"><Button disabled={busy} onClick={close}>取消</Button><Submit busy={busy || (kind === 'create' && !approved.length)}>保存计划草稿</Submit></div>
      </form>}
      {kind === 'detail' && target && <>
        <Details items={[
          ['计划', target.name], ['状态', names[target.status]], ['预算配置', `${money(target.budget)} · V${target.config_version || 1}`],
          ['周期', `${target.start_date} 至 ${target.end_date}`], ['素材快照', `${target.creative_snapshot.title} · V${target.creative_snapshot.version}`],
          ['商品快照', `${target.creative_snapshot.product_snapshot.name} · ${money(target.creative_snapshot.product_snapshot.price)}`],
        ]}/>
        <div className="row-actions ads-detail-actions">
          <Button disabled={busy} onClick={() => { void submit(async () => { await api(`/plans/${target.id}/copy`, 'POST', { request_id: dialog.requestId }); close(); }, '已复制为独立草稿，未复制转化数据'); }}><Copy size={14}/>复制为新计划</Button>
          {target.status === 'draft' ? <Button disabled={busy} onClick={() => switchDialog('edit')}>编辑草稿</Button> : target.status !== 'ended' && <Button kind="primary" disabled={busy} onClick={() => switchDialog('adjust')}><Settings2 size={14}/>调整预算与周期</Button>}
          {target.status === 'running' && <Button disabled={busy} onClick={() => scenarios(target)}><FlaskConical size={14}/>模拟场景</Button>}
          {target.status !== 'ended' && <Button kind="danger" disabled={busy} onClick={() => switchDialog('end')}>结束计划</Button>}
        </div>
        <section className="ads-adjustments" aria-label="当前计划调整记录">
          <h3>调整记录 <span className="subtle">{planAdjustments.length} 条</span></h3>
          {planAdjustments.length ? planAdjustments.map(item => <article key={item.id}>
            <div><strong>{money(item.before?.budget)} → {money(item.after?.budget)}</strong><p>{item.reason}</p><small>{date(item.created_at)}</small></div>
            <Badge tone={item.status === 'applied' ? 'green' : 'amber'}>{names[item.status] || item.status}</Badge>
            <Button disabled={busy} onClick={() => change({ kind: 'apply', planId: target.id, adjustmentId: item.id, requestId: requestId() })}>查看变更</Button>
          </article>) : <p className="muted">暂无调整记录。</p>}
        </section>
        <details className="ads-rules"><summary>配置历史（{target.config_history?.length || 0}）</summary>{target.config_history?.map((history, index) => <p key={index}>V{history.config_version || index + 1} · {money(history.budget)} · {history.start_date} 至 {history.end_date}</p>)}</details>
        <p className="ads-source-note">已载入 {batches.filter(batch => batch.plan_id === target.id).length} 个独立场景批次，不能相加作为真实累计消耗。</p>
      </>}
      {kind === 'start' && target && <>
        <Details items={[
          ['计划', target.name], ['使用素材', `${target.creative_snapshot.title} · V${target.creative_snapshot.version}`],
          ['预算', money(target.budget)], ['周期', `${target.start_date} 至 ${target.end_date}`],
        ]}/>
        <div className="notice">确认后模拟运行，不产生真实花费。超出周期时需先编辑草稿或调整周期。</div>
        <div className="modal-footer"><Button disabled={busy} onClick={close}>取消</Button><Button kind="primary" disabled={busy} onClick={() => { void submit(async () => { await api(`/plans/${target.id}/status`, 'POST', { status: 'running' }); close(); }, '计划已模拟启动'); }}>确认模拟启动</Button></div>
      </>}
      {kind === 'end' && target && <>
        <p>结束「{target.name}」后无法恢复，也不再接受新模拟订单。原记录保留，可复制为新计划。</p>
        <div className="modal-footer"><Button disabled={busy} onClick={() => switchDialog('detail')}>返回详情</Button><Button kind="danger" disabled={busy} onClick={() => { void submit(async () => { await api(`/plans/${target.id}/status`, 'POST', { status: 'ended' }); close(); }, '计划已结束'); }}>确认结束</Button></div>
      </>}
      {kind === 'adjust' && target && <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit(async () => {
          const saved = await api<V2Record>(`/plans/${target.id}/adjustments`, 'POST', {
            budget: Number(form.get('budget')), start_date: form.get('start_date'), end_date: form.get('end_date'), reason: form.get('reason'), request_id: dialog.requestId,
          });
          change({ kind: 'apply', planId: target.id, adjustmentId: saved.id, pendingAdjustment: saved, requestId: requestId() });
        }, '调整草稿已保存，尚未应用');
      }}>
        <Details items={[["当前预算", money(target.budget)], ["当前配置", `V${target.config_version || 1}`]]}/>
        <fieldset disabled={busy} className="form-grid ads-form-fields">
          <Field label="调整后预算"><input name="budget" type="number" min="1" max="1000000" step="0.01" defaultValue={target.budget} required/></Field>
          <Field label="调整原因"><input name="reason" required maxLength={1000} placeholder="调整依据或测试假设"/></Field>
          <Field label="调整后开始日期"><input name="start_date" type="date" defaultValue={target.start_date} required/></Field>
          <Field label="调整后结束日期"><input name="end_date" type="date" defaultValue={target.end_date} required/></Field>
        </fieldset>
        <div className="modal-footer"><Button disabled={busy} onClick={() => switchDialog('detail')}>返回详情</Button><Submit busy={busy}>保存调整草稿</Submit></div>
      </form>}
      {kind === 'apply' && adjustment && <>
        <div className="v2-compare"><section><Badge tone="neutral">修改前 · V{adjustment.before.config_version}</Badge><h3>{money(adjustment.before.budget)}</h3><p>{adjustment.before.start_date} 至 {adjustment.before.end_date}</p></section><section><Badge>修改后</Badge><h3>{money(adjustment.after.budget)}</h3><p>{adjustment.after.start_date} 至 {adjustment.after.end_date}</p></section></div>
        <p>调整原因：{adjustment.reason}</p>
        <div className="notice">确认后保存新配置并建立观察记录，不改变已有数据，也不自动启动已暂停计划。</div>
        <div className="modal-footer">
          <Badge tone={adjustment.status === 'applied' ? 'green' : 'amber'}>{names[adjustment.status]}</Badge>
          {target && <Button disabled={busy} onClick={() => switchDialog('detail')}>返回计划详情</Button>}
          {adjustment.status === 'draft' && <Button kind="primary" disabled={busy} onClick={() => { void submit(async () => { await api(`/adjustments/${adjustment.id}/apply`, 'POST', { request_id: dialog.requestId }); close(); }, '新配置已应用，后续效果待观察'); }}>确认应用调整</Button>}
        </div>
      </>}
      {kind === 'bulk' && <>
        <p>暂停以下 {dialog.planIds?.length || 0} 个模拟计划后，不再接受新模拟订单。</p>
        <ul>{dialog.planIds?.map(id => <li key={id}>{plans.find(plan => plan.id === id)?.name || id}</li>)}</ul>
        {bulkResult && <div role="status">{bulkResult.map(result => <p key={result.plan_id}>{plans.find(plan => plan.id === result.plan_id)?.name || result.plan_id}：{result.ok ? '已暂停' : result.error}</p>)}</div>}
        <div className="modal-footer"><Button disabled={busy} onClick={close}>返回列表</Button><Button kind="primary" disabled={busy || !dialog.planIds?.length || bulkResult !== null} onClick={() => { void submit(async () => {
          const result = await api<{ results: { plan_id: string; ok: boolean; error?: string }[] }>('/plans/batch-status', 'POST', { plan_ids: dialog.planIds, status: 'paused', request_id: dialog.requestId });
          setBulkResult(result.results); paused();
        }, '批量操作已完成'); }}>确认批量暂停</Button></div>
      </>}
    </div>
  </Modal>;
}
