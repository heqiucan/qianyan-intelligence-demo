import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, BrainCircuit, Check, CheckCircle2, ChevronRight, Clock3, FileText, ListChecks, Printer, RefreshCw, SearchCheck, Sparkles, X } from 'lucide-react';
import { api, date, money, number, requestId, generationSource, type State } from './api';

type Entry = { id: string; campaign_id: string; created_at: string; source?: string; model_name?: string; edited_by?: string; [key: string]: any };
type ExtraState = { tasks?: Entry[]; batches?: Entry[]; adjustments?: Entry[]; observations?: Entry[]; reports?: Entry[] };
export type FeedbackProps = {
  page: 'tasks' | 'optimize' | 'reports'; state: State; campaignId: string;
  dataset: string; batchId: string; planId: string; dateFrom: string; dateTo: string;
  busy: boolean; act: (fn: () => Promise<unknown>, success?: string) => Promise<unknown>;
  go: (page: string) => void; setDataset: (s: string) => void;
  setBatchId: (s: string) => void; setPlanId: (s: string) => void;
};
const statusText: Record<string, string> = {
  pending: '待处理', processing: '处理中', review: '待复查', resolved: '已解决', ignored: '已忽略',
  accepted: '已采纳', dismissed: '暂不采纳', draft: '待确认', applied: '已执行',
  waiting_confirmation: '待确认并开始观察', observing: '观察中', reviewed: '已复盘',
  running: '模拟运行中', paused: '已暂停', approved: '已确认', ended: '已结束',
};
const keyLabels: Record<string, string> = {
  impressions: '模拟曝光', clicks: '点击', spend: '模拟消耗', orders: '支付订单', revenue: '模拟支付金额',
  buyers: '去重买家', new_customers: '识别新客', unknown_buyers: '历史未知买家', roi: '支付 ROI', ctr: '点击率',
  cpa: '订单广告成本', cac: '新客广告成本', budget: '计划预算', budget_ratio: '预算使用比例',
  spend_threshold: '消耗阈值', threshold: '规则阈值', sample_size: '样本量', window: '观察窗口',
  dataset: '数据来源', batch_id: '模拟批次', plan_id: '计划编号', plan_config_version: '计划配置版本',
  config_version: '配置版本', status: '状态', reason: '说明', message: '说明', note: '说明',
  before: '调整前', after: '调整后', baseline: '观察基线', current: '本轮数据', delta: '数值变化',
  baseline_orders: '基线订单', followup_orders: '后续订单', order_difference: '订单差值',
  created_at: '生成时间', start_at: '观察起点', end_at: '观察截止', rule: '检查规则',
  source: '来源', rule_version: '规则版本', minimum_clicks: '最低点击要求', clicks_threshold: '点击阈值',
  start_date: '开始日期', end_date: '结束日期', from: '原状态', to: '新状态', operator: '操作人',
  before_window: '基线窗口', after_window: '后续窗口', orders_delta: '订单差值',
  name: '名称', budget_ratio_threshold: '预算阈值比例', amount: '金额', id: '编号',
};
const readableTime = (value?: string) => !value ? '尚未开始' : Number.isNaN(Date.parse(value)) ? value : date(value);
const sourceText = (source?: string) => ({ history: '固定历史 D0', session: '现场互动记录', batch: '独立模拟批次' }[source || ''] || source || '未提供');
const records = (state: State, collection: keyof ExtraState): Entry[] => ((state as unknown as ExtraState)[collection] || []);
const list = (value: unknown): Entry[] => Array.isArray(value) ? value : [];
const textValue = (value: unknown) => value == null ? '未提供' : typeof value === 'string' ? (statusText[value] || value) : typeof value === 'boolean' ? (value ? '是' : '否') : String(value);

function Tag({ status }: { status: string }) {
  const tone = ['resolved', 'reviewed', 'applied', 'accepted'].includes(status) ? 'green' : ['pending', 'review', 'waiting_confirmation'].includes(status) ? 'amber' : 'neutral';
  return <span className={`badge ${tone}`}>{statusText[status] || status}</span>;
}
function Btn({ children, onClick, disabled, primary = false, type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} className={`button ${primary ? 'primary' : 'secondary'}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-labelledby': `${id}-label` }) : children;
  return <label htmlFor={id} className={`field ${full ? 'full' : ''}`}><span id={`${id}-label`}>{label}</span>{control}</label>;
}
function Dialog({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className="modal wide feedback-dialog" onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => { if (event.target === ref.current && !busy) close(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="button ghost" aria-label="关闭反馈详情" onClick={close} disabled={busy}><X size={19} /></button></div><div className="modal-body">{children}</div>
  </dialog>;
}
function Empty({ children }: { children: ReactNode }) { return <div className="feedback-empty"><ListChecks size={28} /><p>{children}</p></div>; }
function Evidence({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return <span className="muted">未提供</span>;
  if (typeof value !== 'object') return <span>{textValue(value)}</span>;
  if (depth > 3) return <span>{JSON.stringify(value)}</span>;
  if (Array.isArray(value)) return <ul className="feedback-evidence-list">{value.map((item, i) => <li key={i}><Evidence value={item} depth={depth + 1} /></li>)}</ul>;
  return <dl className="feedback-evidence">{Object.entries(value).map(([key, val]) => <div key={key}><dt>{keyLabels[key] || key}</dt><dd>{val != null && typeof val === 'number' && ['budget', 'spend', 'revenue', 'spend_threshold'].includes(key) ? money(val) : <Evidence value={val} depth={depth + 1} />}</dd></div>)}</dl>;
}
// Retain a failed submission key so retrying after a lost response cannot duplicate it.
function useSubmit() {
  const keys = useRef(new Map<string, string>());
  return async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
    const fingerprint = path + JSON.stringify(body);
    const key = keys.current.get(fingerprint) || requestId(); keys.current.set(fingerprint, key);
    const result = await api<T>(path, 'POST', { ...body, request_id: key });
    keys.current.delete(fingerprint); return result;
  };
}
function scope(props: FeedbackProps) {
  return { campaign_id: props.campaignId, dataset: props.dataset,
    ...(props.dataset === 'batch' && props.batchId ? { batch_id: props.batchId } : {}),
    ...(props.planId ? { plan_id: props.planId } : {}),
    ...(props.dataset === 'session' && props.dateFrom ? { date_from: props.dateFrom } : {}),
    ...(props.dataset === 'session' && props.dateTo ? { date_to: props.dateTo } : {}) };
}
function scopeLabel(props: FeedbackProps) {
  const batch = records(props.state, 'batches').find(b => b.id === props.batchId);
  const plan = props.state.plans.find(p => p.id === props.planId);
  return `${sourceText(props.dataset)}${props.dataset === 'batch' ? ` · ${batch?.label || '请先选择批次'}` : props.dataset === 'session' ? ` · ${props.dateFrom || '全部起点'} 至 ${props.dateTo || '现在'}` : ' · 固定样例窗口'} · ${props.planId ? plan?.name || props.planId : '活动内全部计划'}`;
}

function TasksPage(props: FeedbackProps) {
  const { state, campaignId, busy, act } = props;
  const tasks = records(state, 'tasks').filter(t => t.campaign_id === campaignId);
  const batches = records(state, 'batches').filter(t => t.campaign_id === campaignId);
  const [scanBatch, setScanBatch] = useState(props.dataset === 'batch' ? props.batchId : '');
  const [threshold, setThreshold] = useState('100'), [filter, setFilter] = useState('active');
  const [taskId, setTaskId] = useState(''), [nextStatus, setNextStatus] = useState('processing'), [note, setNote] = useState('');
  const [localError, setLocalError] = useState(''); const submit = useSubmit();
  useEffect(() => { setTaskId(''); setScanBatch(props.dataset === 'batch' ? props.batchId : ''); }, [campaignId]);
  useEffect(() => { if (props.dataset === 'batch') setScanBatch(props.batchId); }, [props.batchId, props.dataset]);
  const task = tasks.find(t => t.id === taskId);
  const visible = tasks.filter(t => filter === 'all' || (filter === 'active' ? !['resolved', 'ignored'].includes(t.status) : ['resolved', 'ignored'].includes(t.status))).slice().reverse();
  const openTask = (t: Entry) => { setTaskId(t.id); setNextStatus(t.status); setNote(t.note || ''); setLocalError(''); };
  const toObject = (t: Entry, diagnostic = false) => {
    if (t.batch_id) { props.setDataset('batch'); props.setBatchId(t.batch_id); }
    props.setPlanId(t.plan_id || (['plan', 'plans'].includes(t.object_type) ? t.object_id : ''));
    if (!diagnostic) sessionStorage.setItem(['creative', 'creatives'].includes(t.object_type) ? 'focus-creative' : 'focus-plan', t.object_id);
    setTaskId(''); props.go(diagnostic ? 'optimize' : ['creative', 'creatives'].includes(t.object_type) ? 'creative' : 'ads');
  };
  return <div className="feedback-page">
    <section className="panel feedback-lead"><div className="action-icon"><ListChecks size={24} /></div><div><span className="eyebrow">ACTION CENTER</span><h2>每一个问题，都有下一步。</h2><p className="muted">按活动检查待办和模拟数据，保存处理理由，再复查结果。</p></div><span className="badge amber">{tasks.filter(t => !['resolved', 'ignored'].includes(t.status)).length} 项待推进</span></section>
    <form className="panel feedback-scan" onSubmit={e => { e.preventDefault(); void act(async () => { await submit('/tasks/scan', { campaign_id: campaignId, ...(scanBatch ? { batch_id: scanBatch } : {}), spend_threshold: Number(threshold) }); }, '检查完成，重复问题已去重'); }}>
      <Field label="检查数据批次"><select value={scanBatch} onChange={e => setScanBatch(e.target.value)}><option value="">只检查业务待办</option>{batches.map(b => <option key={b.id} value={b.id}>{b.label} · {readableTime(b.created_at)}</option>)}</select></Field>
      <Field label="无成交消耗阈值 / 元"><input type="number" min="1" max="1000000" step="1" required value={threshold} onChange={e => setThreshold(e.target.value)} /></Field>
      <Btn type="submit" primary disabled={busy || !campaignId}><SearchCheck size={16} />检查当前活动</Btn>
      <p className="muted feedback-scan-note">阈值由运营设定。现场互动没有广告消耗；需要判断消耗时，请先在投放中心载入明确的模拟批次。</p>
    </form>
    <div className="section-heading"><h2>活动待办 <span className="subtle">{visible.length} 项</span></h2><div className="tabs" role="group" aria-label="待办状态筛选">{[['active', '待推进'], ['closed', '已处理'], ['all', '全部']].map(([id, label]) => <button type="button" className={`tab ${filter === id ? 'active' : ''}`} key={id} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
    <div className="feedback-task-list">{visible.map(t => <article className="panel feedback-task" key={t.id}><div className="feedback-task-icon"><AlertCircle size={20} /></div><div className="feedback-task-copy"><div className="feedback-title-line"><h3>{t.title}</h3><Tag status={t.status} /></div><p>{t.detail}</p><div className="feedback-meta"><span>{t.batch_id ? '模拟批次检查' : '业务待办'}</span><span>{readableTime(t.created_at)}</span><span>{t.rule}</span></div>{t.note && <p className="feedback-note">处理备注：{t.note}</p>}</div><Btn onClick={() => openTask(t)}>查看与处理<ChevronRight size={15} /></Btn></article>)}</div>
    {!visible.length && <section className="panel"><Empty>{filter === 'active' ? '当前没有待推进事项。点击“检查当前活动”核对素材、计划或选定批次。' : '此筛选下暂无事项，处理记录会保留在这里。'}</Empty></section>}
    {task && <Dialog title="异常与待办详情" close={() => setTaskId('')} busy={busy}>
      <div className="feedback-title-line"><h3>{task.title}</h3><Tag status={task.status} /></div><p className="muted">{task.detail}</p>
      <section className="feedback-inset"><h3>判断依据</h3><Evidence value={task.evidence} /><p className="muted">规则：{task.rule} · 事项编号：{task.id}</p></section>
      <div className="feedback-actions"><Btn onClick={() => toObject(task)}>打开相关{['creative', 'creatives'].includes(task.object_type) ? '素材' : '计划'}<ArrowRight size={14} /></Btn>{task.plan_id && <Btn onClick={() => toObject(task, true)}><BrainCircuit size={15} />带着依据去复盘</Btn>}</div>
      <form onSubmit={e => { e.preventDefault(); setLocalError(''); if (['resolved', 'ignored'].includes(nextStatus) && !note.trim()) { setLocalError('解决或忽略事项前，请填写处理理由。'); return; } void act(async () => { try { await api(`/tasks/${task.id}/status`, 'POST', { status: nextStatus, note: note.trim() }); setTaskId(''); } catch (error) { setLocalError(error instanceof Error ? error.message : '保存失败，请重试。'); throw error; } }, '事项状态与处理记录已保存'); }}>
        <div className="form-grid"><Field label="处理状态"><select value={nextStatus} onChange={e => setNextStatus(e.target.value)}>{['pending', 'processing', 'review', 'resolved', 'ignored'].map(s => <option value={s} key={s}>{statusText[s]}</option>)}</select></Field><Field label="处理备注 / 复查理由" full><textarea rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="记录采取了什么动作，以及为什么解决或暂不处理。" /></Field></div>
        {localError && <p className="error-banner" role="alert">{localError}</p>}<div className="notice">创建优化草稿不会自动解决异常。确认结果后填写依据，再保存复查状态。</div><div className="modal-footer"><Btn onClick={() => setTaskId('')} disabled={busy}>取消</Btn><Btn type="submit" primary disabled={busy}><Check size={15} />保存处理记录</Btn></div>
      </form>
      {!!task.history?.length && <details className="feedback-history"><summary>查看处理历史（{task.history.length}）</summary><Evidence value={task.history} /></details>}
    </Dialog>}
  </div>;
}

function OptimizePage(props: FeedbackProps) {
  const { state, campaignId, busy, act } = props;
  const insights = (state.insights || []).filter(i => (i as unknown as Entry).campaign_id === campaignId) as unknown as Entry[];
  const allCreatives = state.creatives.filter(c => c.campaign_id === campaignId);
  const plans = state.plans.filter(p => p.campaign_id === campaignId);
  const observations = records(state, 'observations').filter(o => o.campaign_id === campaignId);
  const adjustments = records(state, 'adjustments').filter(a => a.campaign_id === campaignId);
  const [selectedId, setSelectedId] = useState(''), [action, setAction] = useState('creative');
  const [creativeId, setCreativeId] = useState(''), [targetPlan, setTargetPlan] = useState('');
  const [budget, setBudget] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [reason, setReason] = useState('');
  const [dismissOpen, setDismissOpen] = useState(false), [dismissReason, setDismissReason] = useState('');
  const [confirmAction, setConfirmAction] = useState(false), [modalError, setModalError] = useState(''); const submit = useSubmit();
  useEffect(() => { setSelectedId(localStorage.getItem(`insight-${campaignId}`) || ''); setCreativeId(''); setTargetPlan(''); setConfirmAction(false); }, [campaignId]);
  const insight = insights.find(i => i.id === selectedId) || insights.at(-1);
  const snapshot = insight?.analytics_snapshot;
  const insightBatch = records(state, 'batches').find(b => b.id === snapshot?.dataset_id);
  const scopedPlanId = snapshot?.dataset === 'history' ? '' : insightBatch?.plan_id || snapshot?.filters?.plan_id || '';
  const scopedPlan = plans.find(p => p.id === scopedPlanId);
  const scopedCreative = allCreatives.find(c => c.id === scopedPlan?.creative_id);
  const creatives = scopedCreative ? allCreatives.filter(c => (c.family_id || c.id) === (scopedCreative.family_id || scopedCreative.id)) : allCreatives;
  const currentCreative = creatives.find(c => c.id === creativeId) || creatives.at(-1);
  const availablePlans = plans.filter(p => ['running', 'paused'].includes(p.status) && (!scopedPlanId || p.id === scopedPlanId));
  const currentPlan = availablePlans.find(p => p.id === targetPlan) || availablePlans.find(p => p.id === props.planId) || availablePlans[0];
  useEffect(() => { if (!currentPlan) return; setBudget(String(currentPlan.budget)); setStart(currentPlan.start_date); setEnd(currentPlan.end_date); }, [currentPlan?.id, currentPlan?.budget, currentPlan?.start_date, currentPlan?.end_date]);
  useEffect(() => { setReason(insight?.recommendation || ''); setDismissOpen(false); setDismissReason(''); setConfirmAction(false); setModalError(''); }, [insight?.id]);
  const chooseInsight = (id: string) => { setSelectedId(id); localStorage.setItem(`insight-${campaignId}`, id); };
  const resultAdjustment = adjustments.find(a => a.id === insight?.result_adjustment_id || a.insight_id === insight?.id);
  const resultCreative = allCreatives.find(c => c.id === insight?.result_creative_id);
  const canAct = insight && (!insight.status || insight.status === 'pending') && !resultAdjustment && !resultCreative;
  const createAction = async () => {
    if (!insight) return;
    setModalError('');
    try {
      if (action === 'creative' && currentCreative) await submit(`/insights/${insight.id}/accept`, { creative_id: currentCreative.id });
      if (action === 'plan' && currentPlan) await submit(`/plans/${currentPlan.id}/adjustments`, { insight_id: insight.id, budget: Number(budget), start_date: start, end_date: end, reason });
      setConfirmAction(false);
    } catch (error) { setModalError(error instanceof Error ? error.message : '创建草稿失败，请重试。'); throw error; }
  };
  return <div className="feedback-page">
    <section className="panel feedback-lead"><div className="action-icon"><BrainCircuit size={26} /></div><div><span className="eyebrow">EVIDENCE → ACTION → OBSERVATION</span><h2>让建议落在具体的工作上。</h2><p className="muted">{state.model.label} · 数字由系统计算，原因是待验证假设，执行需要人工确认。</p></div><Btn primary disabled={busy || !campaignId || (props.dataset === 'batch' && !props.batchId)} onClick={() => { void act(async () => { const result = await submit<Entry>('/insights', scope(props)); chooseInsight(result.id); }, '复盘已保存，可从历史记录继续处理'); }}><Sparkles size={16} />生成本轮复盘</Btn></section>
    <p className="feedback-scope">本次生成使用：{scopeLabel(props)}</p>
    {!!insights.length && <div className="feedback-review-picker"><Field label="历史复盘记录"><select value={insight?.id || ''} onChange={e => chooseInsight(e.target.value)}>{insights.slice().reverse().map(i => <option key={i.id} value={i.id}>{readableTime(i.created_at)} · {sourceText(i.dataset)} · {statusText[i.status] || '待处理'} · {i.id.slice(-5)}</option>)}</select></Field>{insight && <Tag status={insight.status || 'pending'} />}</div>}
    {insight ? <>
      <div className="notice">当前查看已保存的复盘：{snapshot?.label || sourceText(insight.dataset)} · {snapshot?.window || '窗口未提供'} · {generationSource(insight)}。上方切换筛选不会改写这份复盘。</div>
      <div className="feedback-insight-grid"><section className="panel"><h3><CheckCircle2 size={17} />已知事实</h3><ul className="facts-list">{(insight.facts || []).map((fact: string, i: number) => <li key={i}>{fact}</li>)}</ul></section><section className="panel"><h3><SearchCheck size={17} />待验证原因</h3><ul className="facts-list">{(insight.hypotheses || []).map((fact: string, i: number) => <li key={i}>{fact}</li>)}</ul><div className="notice">{(insight.missing || []).join('；')}</div></section></div>
      <section className="panel feedback-recommendation"><div className="feedback-title-line"><span className="badge purple"><Sparkles size={13} />建议动作</span><Tag status={insight.status || 'pending'} /></div><h3>{insight.recommendation}</h3>
        {canAct ? <form onSubmit={e => { e.preventDefault(); setModalError(''); setConfirmAction(true); }}>
          <div className="tabs feedback-action-tabs" role="group" aria-label="采纳建议方式"><button type="button" className={`tab ${action === 'creative' ? 'active' : ''}`} onClick={() => setAction('creative')}>生成下一版素材</button><button type="button" className={`tab ${action === 'plan' ? 'active' : ''}`} onClick={() => setAction('plan')}>创建计划调整草稿</button></div>
          {action === 'creative' ? <Field label="选择要优化的素材"><select value={currentCreative?.id || ''} onChange={e => setCreativeId(e.target.value)}>{!creatives.length && <option value="">请先创建素材</option>}{creatives.map(c => <option key={c.id} value={c.id}>{c.title} · V{c.version}</option>)}</select></Field> : <div className="form-grid"><Field label="要调整的计划" full><select value={currentPlan?.id || ''} onChange={e => setTargetPlan(e.target.value)}>{!availablePlans.length && <option value="">没有可调整的运行或暂停计划</option>}{availablePlans.map(p => <option key={p.id} value={p.id}>{p.name} · {statusText[p.status]}</option>)}</select></Field><Field label="调整后计划预算 / 元"><input type="number" min="0.01" max="1000000" step="0.01" value={budget} required onChange={e => setBudget(e.target.value)} /></Field><Field label="调整后开始日期"><input type="date" value={start} required onChange={e => setStart(e.target.value)} /></Field><Field label="调整后结束日期"><input type="date" min={start} value={end} required onChange={e => setEnd(e.target.value)} /></Field><Field label="调整理由" full><textarea value={reason} required maxLength={2000} rows={3} onChange={e => setReason(e.target.value)} /></Field></div>}
          <div className="notice">{scopedPlanId && '此复盘限定具体计划，仅允许调整该计划或它的素材系列。'}一条建议只采纳一种动作。生成草稿后仍需确认；不会立即投放，也不会自动产生改善数据。</div><div className="feedback-actions"><Btn type="submit" primary disabled={busy || (action === 'creative' ? !currentCreative : !currentPlan)}><Check size={15} />核对并创建草稿</Btn><Btn onClick={() => { setModalError(''); setDismissOpen(true); }} disabled={busy}>暂不采纳</Btn></div>
        </form> : <div className="feedback-result">
          {resultCreative && <><p><CheckCircle2 size={16} />已生成：{resultCreative.title} · V{resultCreative.version}</p><Btn onClick={() => { sessionStorage.setItem('focus-creative', resultCreative.id); props.go('creative'); }}>查看并确认素材<ArrowRight size={15} /></Btn></>}
          {resultAdjustment && <><p><CheckCircle2 size={16} />计划调整已保存 · {statusText[resultAdjustment.status]}</p><Evidence value={{ before: resultAdjustment.before, after: resultAdjustment.after }} /><Btn onClick={() => { props.setPlanId(resultAdjustment.plan_id); sessionStorage.setItem('focus-adjustment', resultAdjustment.id); props.go('ads'); }}>查看并确认计划调整<ArrowRight size={15} /></Btn></>}
          {!resultCreative && !resultAdjustment && <p>{insight.dismiss_reason || insight.reason || '此复盘已处理，处理状态已保存。'}</p>}
        </div>}
      </section>
    </> : <section className="panel"><Empty>选择数据范围后生成第一份复盘。复盘历史和后续动作会保存在当前活动中。</Empty></section>}
    <section className="panel"><div className="panel-header"><div><h3>观察任务</h3><p>记录调整起点，等待可比较的新数据。</p></div><span className="badge neutral">{observations.length} 项</span></div>
      <div className="feedback-observation-list">{observations.slice().reverse().map(o => <ObservationCard key={o.id} observation={o} props={props} />)}</div>
      {!observations.length && <Empty>采纳素材建议或确认计划调整后，这里会出现观察任务。没有后续数据时保持待观察。</Empty>}
    </section>
    {dismissOpen && insight && <Dialog title="记录暂不采纳的原因" close={() => setDismissOpen(false)} busy={busy}><form onSubmit={e => { e.preventDefault(); void act(async () => { setModalError(''); try { await api(`/insights/${insight.id}/dismiss`, 'POST', { reason: dismissReason.trim() }); setDismissOpen(false); } catch (error) { setModalError(error instanceof Error ? error.message : '保存失败，请重试。'); throw error; } }, '已记录暂不采纳的原因'); }}><Field label="不采纳理由"><textarea value={dismissReason} required maxLength={2000} onChange={e => setDismissReason(e.target.value)} placeholder="例如：当前样本不足，先补充同一口径的数据。" /></Field>{modalError && <p className="error-banner" role="alert">{modalError}</p>}<div className="modal-footer"><Btn onClick={() => setDismissOpen(false)} disabled={busy}>取消</Btn><Btn type="submit" primary disabled={busy || !dismissReason.trim()}>保存理由</Btn></div></form></Dialog>}
    {confirmAction && insight && <Dialog title="确认创建优化草稿" close={() => setConfirmAction(false)} busy={busy}><p>{action === 'creative' ? `基于「${currentCreative?.title}」V${currentCreative?.version} 创建下一版本，原版本及已绑定计划保持不变。` : `为「${currentPlan?.name}」建立调整草稿，实际执行前仍需到投放中心确认。`}</p>{action === 'plan' && <Evidence value={{ before: { budget: currentPlan?.budget, start_date: currentPlan?.start_date, end_date: currentPlan?.end_date }, after: { budget: Number(budget), start_date: start, end_date: end }, reason }} />}<div className="notice">本次操作会保存草稿和关联记录，不产生真实广告花费。</div>{modalError && <p className="error-banner" role="alert">{modalError}</p>}<div className="modal-footer"><Btn onClick={() => setConfirmAction(false)} disabled={busy}>返回修改</Btn><Btn primary disabled={busy} onClick={() => { void act(createAction, '优化草稿已创建，等待人工确认'); }}>确认创建草稿</Btn></div></Dialog>}
  </div>;
}

function ObservationCard({ observation: o, props }: { observation: Entry; props: FeedbackProps }) {
  const adjustment = records(props.state, 'adjustments').find(a => a.id === o.adjustment_id);
  const plans = props.state.plans.filter(p => p.campaign_id === props.campaignId && p.status === 'running' && (!o.creative_id || p.creative_id === o.creative_id) && (!o.adjustment_id || (p.id === o.plan_id && adjustment?.status === 'applied' && (p.config_version || 1) === adjustment.applied_config_version)));
  const [plan, setPlan] = useState(o.plan_id || ''), [batch, setBatch] = useState(''), [note, setNote] = useState('');
  const [operationError, setOperationError] = useState('');
  const operate = async (path: string, payload: Record<string, unknown>) => { setOperationError(''); try { return await api(path, 'POST', payload); } catch (error) { setOperationError(error instanceof Error ? error.message : '操作失败，请重试。'); throw error; } };
  const selectedPlan = plans.find(p => p.id === plan) || plans[0];
  const batches = records(props.state, 'batches').filter(b => b.campaign_id === props.campaignId && b.plan_id === o.plan_id && b.id !== o.baseline_batch_id && (!o.start_at || b.created_at >= o.start_at));
  return <article className="feedback-observation"><div className="feedback-title-line"><div><h3><Clock3 size={15} />{o.metric || '支付订单'} · {o.id.slice(-6)}</h3><p className="muted">基线：{sourceText(o.baseline_dataset)} · 起点：{readableTime(o.start_at)}</p></div><Tag status={o.status} /></div>
    <p className="feedback-note">{o.note || '先确认调整，再开始收集同源、同计划版本的后续数据。'}</p>
    {o.status === 'waiting_confirmation' && <div className="feedback-observe-form"><Field label={`观察计划 ${o.id.slice(-6)}`}><select value={selectedPlan?.id || ''} onChange={e => setPlan(e.target.value)}>{!plans.length && <option value="">{o.adjustment_id ? '请先应用调整并运行对应配置的计划' : '请先确认素材并启动对应计划'}</option>}{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Btn disabled={props.busy || !selectedPlan} onClick={() => { void props.act(async () => { await operate(`/observations/${o.id}/start`, { plan_id: selectedPlan?.id }); }, '观察起点已保存'); }}>开始观察</Btn></div>}
    {o.status === 'observing' && <form onSubmit={e => { e.preventDefault(); void props.act(async () => { await operate(`/observations/${o.id}/review`, { ...(batch ? { batch_id: batch } : {}), note }); }, '已检查后续数据，请查看观察状态和说明'); }}>
      <div className="form-grid">{o.baseline_dataset === 'batch' && <Field label={`后续模拟批次 ${o.id.slice(-6)}`}><select value={batch} onChange={e => setBatch(e.target.value)}><option value="">检查数据是否齐备</option>{batches.map(b => <option key={b.id} value={b.id}>{b.label} · {readableTime(b.created_at)}</option>)}</select></Field>}<Field label={`观察备注 ${o.id.slice(-6)}`}><input value={note} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder="可记录此次调整后的观察情况" /></Field></div><div className="feedback-actions"><Btn type="submit" disabled={props.busy}><RefreshCw size={14} />检查后续数据</Btn>{o.plan_id && <Btn onClick={() => { props.setPlanId(o.plan_id); props.go('ads'); }}>打开观察计划</Btn>}</div>
      <p className="muted feedback-small">不同来源不能混比。批次需属于同一计划的有效配置，并在观察开始后明确载入；无数据时继续观察。</p>
    </form>}
    {operationError && <p className="error-banner" role="alert">{operationError}</p>}
    {o.comparison && <details className="feedback-history" open={o.status === 'reviewed'}><summary>查看观察结果与口径</summary><Evidence value={o.comparison} /></details>}
  </article>;
}

function ReportPaper({ report }: { report: Entry }) {
  const snapshot = report.snapshot || {}, analytics = snapshot.analytics || {}, metrics = analytics.metrics || {};
  const rows = list(analytics.rows), tasks = list(snapshot.tasks), adjustments = list(snapshot.adjustments), observations = list(snapshot.observations);
  return <article className="feedback-report-paper" aria-label="活动报告预览">
    <header className="feedback-report-heading"><div className="eyebrow">ZHEY AN / CAMPAIGN REVIEW</div><h2>{report.title}</h2><p>{snapshot.campaign?.name || '营销活动'} · 生成于 {readableTime(report.created_at)}</p><div className="feedback-report-badges"><span>模拟投放与支付</span><span>{snapshot.model_label || '演示回放'}</span><span>已保存的报告快照</span></div></header>
    <section><h3>01 / 目标与统计范围</h3><dl className="feedback-report-info"><div><dt>活动目标</dt><dd>{snapshot.campaign?.goal || '商品成交；未单独填写内部目标'}</dd></div><div><dt>受众假设</dt><dd>{snapshot.campaign?.audience || '未填写'}</dd></div><div><dt>主推卖点</dt><dd>{snapshot.campaign?.selling_point || '未填写'}</dd></div><div><dt>数据来源</dt><dd>{analytics.label || sourceText(analytics.dataset)}</dd></div><div><dt>统计窗口</dt><dd>{analytics.window || '未提供'}</dd></div><div><dt>报告编号</dt><dd>{report.id}</dd></div></dl><p className="feedback-report-note">{analytics.note}</p></section>
    <section><h3>02 / 系统计算的结果</h3><div className="feedback-report-stats">{[['模拟广告消耗', money(metrics.spend)], ['模拟支付金额', money(metrics.revenue)], ['支付订单', number(metrics.orders)], ['识别新客', number(metrics.new_customers)], ['支付 ROI', number(metrics.roi)], ['去重买家', number(metrics.buyers)]].map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div><p className="feedback-report-note">“—”表示无法计算或未提供。支付 ROI 不代表利润；新客识别不证明广告增量。</p>
      {!!rows.length && <div className="table-wrap"><table className="data-table"><thead><tr>{['计划 / 素材', '点击', '消耗', '订单', '支付金额', '支付 ROI'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.plan_id || i}><td>{r.name}</td><td>{number(r.clicks)}</td><td>{money(r.spend)}</td><td>{number(r.orders)}</td><td>{money(r.revenue)}</td><td>{number(r.roi)}</td></tr>)}</tbody></table></div>}
      <details className="feedback-report-detail"><summary>查看快照中的订单与消耗依据</summary><div className="feedback-report-evidence"><h4>对应订单（{list(analytics.orders).length} 笔）</h4>{list(analytics.orders).length ? <ul>{list(analytics.orders).map((o, i) => <li key={o.id || i}>{o.id} · {o.buyer_id} · {money(o.amount)} · {o.plan_id}</li>)}</ul> : <p>当前范围没有订单记录。</p>}<h4>消耗明细</h4>{list(analytics.spend_entries).length ? <Evidence value={analytics.spend_entries} /> : <p>当前范围未提供消耗明细。</p>}</div></details>
    </section>
    <section><h3>03 / 本轮工作与后续观察</h3><p>所选活动/计划范围保存素材 {list(snapshot.creatives).length} 个版本、计划 {list(snapshot.plans).length} 个；调整 {adjustments.length} 项、待办 {tasks.length} 项、观察任务 {observations.length} 项。以下为生成报告时对应范围的工作记录。</p><div className="feedback-report-work">{tasks.map(t => <p key={t.id}><strong>{t.title}</strong> · {statusText[t.status] || t.status}{t.note ? ` · ${t.note}` : ''}</p>)}{adjustments.map(a => <p key={a.id}><strong>计划调整</strong> · {a.plan_id} · {money(a.before?.budget)} → {money(a.after?.budget)} · {statusText[a.status] || a.status}</p>)}{observations.map(o => <p key={o.id}><strong>观察任务</strong> · {statusText[o.status] || o.status} · {o.note || '待补充同口径数据'}</p>)}{!tasks.length && !adjustments.length && !observations.length && <p>尚无异常处理或观察记录。</p>}</div></section>
    <section className="feedback-report-human"><h3>04 / 运营结论 · 人工填写</h3><p>{report.conclusion || '尚未填写人工结论。'}</p><h4>下一步行动</h4><p>{report.next_action || '尚未填写下一步行动。'}</p></section>
    <footer>本报告来自演示系统，广告与支付均为模拟。事实、假设和人工判断应分别理解；不代表真实经营效果。保存后内容固定，后续变化需另存新报告。</footer>
  </article>;
}

function ReportsPage(props: FeedbackProps) {
  const reports = records(props.state, 'reports').filter(r => r.campaign_id === props.campaignId);
  const campaign = props.state.campaigns.find(c => c.id === props.campaignId);
  const [title, setTitle] = useState(''), [conclusion, setConclusion] = useState(''), [nextAction, setNextAction] = useState('');
  const [selectedId, setSelectedId] = useState(''); const submit = useSubmit();
  useEffect(() => { setTitle(`${campaign?.name || '营销活动'} · 活动复盘`); setConclusion(''); setNextAction(''); setSelectedId(localStorage.getItem(`report-${props.campaignId}`) || ''); }, [props.campaignId]);
  useEffect(() => { const done = () => { delete document.body.dataset.printReport; }; window.addEventListener('afterprint', done); return () => { done(); window.removeEventListener('afterprint', done); }; }, []);
  const selected = reports.find(r => r.id === selectedId) || reports.at(-1);
  const choose = (id: string) => { setSelectedId(id); localStorage.setItem(`report-${props.campaignId}`, id); };
  const print = () => { document.body.dataset.printReport = 'true'; window.requestAnimationFrame(() => window.print()); };
  return <div className="feedback-page feedback-report-page">
    <section className="panel feedback-lead feedback-no-print"><div className="action-icon"><FileText size={24} /></div><div><span className="eyebrow">CAMPAIGN REVIEW</span><h2>把本轮工作，讲清楚。</h2><p className="muted">系统事实与人工判断分开保存，报告保留生成时的数据和版本。</p></div><span className="badge neutral">{reports.length} 份快照</span></section>
    <form className="panel feedback-report-form feedback-no-print" onSubmit={e => { e.preventDefault(); void props.act(async () => { const report = await submit<Entry>('/reports', { ...scope(props), title: title.trim(), conclusion, next_action: nextAction }); choose(report.id); }, '报告快照已保存，后续数据不会修改旧报告'); }}>
      <div className="panel-header"><h3>生成一份活动报告</h3><span className="muted feedback-small">{scopeLabel(props)}</span></div>
      <div className="form-grid"><Field label="报告标题" full><input value={title} required maxLength={120} onChange={e => setTitle(e.target.value)} /></Field><Field label="运营结论（人工判断）"><textarea value={conclusion} maxLength={5000} rows={4} onChange={e => setConclusion(e.target.value)} placeholder="说明本轮发现了什么，以及哪些结论仍待验证。" /></Field><Field label="下一步行动"><textarea value={nextAction} maxLength={5000} rows={4} onChange={e => setNextAction(e.target.value)} placeholder="记录准备调整的素材、计划及需要补充的数据。" /></Field></div>
      <div className="feedback-actions"><Btn type="submit" primary disabled={props.busy || !props.campaignId || !title.trim() || (props.dataset === 'batch' && !props.batchId)}><FileText size={16} />保存新的报告快照</Btn><span className="muted feedback-small">修改结论后再次保存，会创建新报告。</span></div>
    </form>
    {selected ? <><div className="feedback-report-toolbar feedback-no-print"><Field label="已保存的活动报告"><select value={selected.id} onChange={e => choose(e.target.value)}>{reports.slice().reverse().map(r => <option key={r.id} value={r.id}>{r.title} · {readableTime(r.created_at)} · {r.id.slice(-5)}</option>)}</select></Field><Btn onClick={() => { setTitle(`${selected.title} · 新版`); setConclusion(selected.conclusion || ''); setNextAction(selected.next_action || ''); window.scrollTo({ top: 0, behavior: 'auto' }); }}>沿用文字生成新版</Btn><Btn onClick={print}><Printer size={16} />打印 / 另存 PDF</Btn></div><ReportPaper report={selected} /></> : <section className="panel"><Empty>选择活动与数据范围，填写运营结论后保存第一份报告。</Empty></section>}
  </div>;
}

export default function FeedbackPages(props: FeedbackProps) {
  if (props.page === 'tasks') return <TasksPage key={`tasks-${props.campaignId}`} {...props} />;
  if (props.page === 'reports') return <ReportsPage key={`reports-${props.campaignId}`} {...props} />;
  return <OptimizePage key={`optimize-${props.campaignId}`} {...props} />;
}
