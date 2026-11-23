import { useEffect, useRef, useState } from 'react';
import { Check, FileSearch, RefreshCw } from 'lucide-react';
import { api, money, number, requestId, type Plan, type V2Record } from '../../api';
import { Badge, Button, Details, Empty, Field } from '../../components/ui';
import type { Act } from '../../domain';

interface Props {
  plans: Plan[]; initialPlanId: string; busy: boolean; act: Act;
  loadedBatch: (batch: V2Record) => void;
}

export default function ScenarioWorkspace({ plans, initialPlanId, busy, act, loadedBatch }: Props) {
  const runningPlans = plans.filter(plan => plan.status === 'running');
  const [planId, setPlanId] = useState(initialPlanId || runningPlans[0]?.id || '');
  const [scenario, setScenario] = useState('no_conversion');
  const [scenarios, setScenarios] = useState<V2Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<{ key: string; data: V2Record } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; batch: V2Record } | null>(null);
  const [working, setWorking] = useState(false);
  const sequence = useRef(0);
  const request = useRef(requestId());
  const lock = useRef(false);
  const mounted = useRef(true);
  const plan = runningPlans.find(item => item.id === planId);
  const selectionKey = JSON.stringify([plan?.id, plan?.config_version || 1, plan?.budget, plan?.start_date, plan?.end_date, scenario]);
  const currentKey = useRef(selectionKey);
  currentKey.current = selectionKey;
  const currentPreview = preview?.key === selectionKey ? preview.data : null;
  const currentBatch = loaded?.key === selectionKey ? loaded.batch : null;
  const available = Boolean(plan && scenarios.some(item => item.id === scenario));
  const disabled = busy || working;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    api<V2Record[]>('/scenarios', 'GET', undefined, { signal: controller.signal }).then(items => {
      if (!active) return;
      setScenarios(items);
      setScenario(current => items.some(item => item.id === current) ? current : items[0]?.id || '');
    }).catch(error => { if (active) setLoadError((error as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reload]);

  useEffect(() => {
    sequence.current++;
    setPreview(null); setLoaded(null); request.current = requestId();
  }, [selectionKey]);

  const invalidate = () => {
    sequence.current++;
    setPreview(null); setLoaded(null); request.current = requestId();
  };
  const previewScenario = async () => {
    if (disabled || lock.current || !available) return;
    lock.current = true; setWorking(true); setPreview(null);
    const revision = ++sequence.current;
    try {
      await act(async () => {
        const data = await api<V2Record>('/batches/preview', 'POST', { plan_id: planId, scenario });
        if (mounted.current && sequence.current === revision && currentKey.current === selectionKey) setPreview({ key: selectionKey, data });
      });
    } finally { lock.current = false; if (mounted.current) setWorking(false); }
  };
  const loadScenario = async () => {
    if (disabled || lock.current || !available || !currentPreview || currentBatch) return;
    lock.current = true; setWorking(true);
    try {
      await act(async () => {
        const batch = await api<V2Record>('/batches', 'POST', { plan_id: planId, scenario, request_id: request.current });
        if (mounted.current && currentKey.current === selectionKey) {
          setLoaded({ key: selectionKey, batch });
          loadedBatch(batch);
        }
      }, '模拟批次已保存，已切换到对应统计范围');
    } finally { lock.current = false; if (mounted.current) setWorking(false); }
  };

  return <section className="ads-scenarios" aria-label="模拟场景">
    <div className="ads-section-heading"><div><h2>模拟场景</h2><p className="muted">每次载入保存独立批次，与现场购买记录分开。</p></div><Badge tone="amber">固定演示数据</Badge></div>
    {loadError ? <div className="error-banner" role="alert"><span>场景读取失败：{loadError}</span><Button disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={14}/>重试</Button></div> : loading ? <p role="status">正在读取场景…</p> : !scenarios.length && <Empty text="暂无可用模拟场景。"/>}
    {!runningPlans.length ? <Empty text="暂无运行中的计划，请在计划列表确认启动后选择场景。"/> : <>
      <div className="ads-scenario-fields">
        <Field label="场景关联计划"><select disabled={disabled} value={planId} onChange={event => { invalidate(); setPlanId(event.target.value); }}>
          {!plan && <option value={planId}>请选择运行中的计划</option>}
          {runningPlans.map(item => <option key={item.id} value={item.id}>{item.name} · 配置 V{item.config_version || 1}</option>)}
        </select></Field>
        <Field label="预设投放场景"><select disabled={disabled || loading} value={scenario} onChange={event => { invalidate(); setScenario(event.target.value); }}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
      </div>
      <p className="ads-source-note">{scenarios.find(item => item.id === scenario)?.description}</p>
      <Button disabled={disabled || loading || !available || Boolean(currentBatch)} onClick={() => { void previewScenario(); }}><FileSearch size={15}/>预览场景数据</Button>
      {currentPreview && <section className="ads-scene-preview" aria-label="场景预览结果">
        <h3>预览结果</h3>
        <Details items={[
          ['批次标签', currentPreview.label], ['曝光 / 点击', `${number(currentPreview.metrics.impressions)} / ${number(currentPreview.metrics.clicks)}`],
          ['模拟消耗', money(currentPreview.metrics.spend)], ['模拟订单', currentPreview.metrics.orders],
          ['支付金额', money(currentPreview.metrics.revenue)], ['窗口', currentPreview.window],
        ]}/>
        <div className="notice">{currentPreview.note || '固定模拟情境，不是平台报表或效果预测。保存为独立批次，不与现场订单混算。'}</div>
        {currentBatch ? <p role="status">已载入：{currentBatch.label}</p> : <Button kind="primary" disabled={disabled || !available} onClick={() => { void loadScenario(); }}><Check size={15}/>确认载入独立批次</Button>}
      </section>}
    </>}
  </section>;
}
