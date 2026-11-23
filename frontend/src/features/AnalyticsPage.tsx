import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, Download, ListFilter, ShoppingBag, Wallet, X } from 'lucide-react';
import { date, type Analytics, type Order } from '../api';
import { Badge, Button, Empty, Table } from '../components/ui';
import { buyers } from '../domain';
import TrendChart from './live/TrendChart';
import AnalyticsCharts from './analytics/AnalyticsCharts';
import { analyticsCsv, formatMetric, resolveAnalyticsView, type AnalyticsView } from './analytics/data';
import { ANALYTICS_VIEW_EVENT } from './analytics/viewNavigation';
import './analytics/analytics.css';

const views = [
  { id: 'overview', label: '概览图表', icon: ChartNoAxesCombined },
  { id: 'plans', label: '计划明细', icon: ListFilter },
  { id: 'orders', label: '订单', icon: ShoppingBag },
  { id: 'spend', label: '消耗', icon: Wallet },
] as const;

export default function AnalyticsPage({ analytics, focus, trace, selectPlan, onSelectView }: {
  analytics: Analytics | null;
  focus: string;
  trace: (order: Order) => void;
  selectPlan: (id: string) => void;
  onSelectView?: (view: AnalyticsView) => void;
}) {
  const [view, setView] = useState<AnalyticsView>(() => resolveAnalyticsView(focus));
  const tabsId = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { setView(resolveAnalyticsView(focus)); }, [focus]);
  useEffect(() => {
    // Summary actions can request the same focus again after a local tab change.
    const navigate = (event: Event) => setView(resolveAnalyticsView((event as CustomEvent<string>).detail));
    window.addEventListener(ANALYTICS_VIEW_EVENT, navigate);
    return () => window.removeEventListener(ANALYTICS_VIEW_EVENT, navigate);
  }, []);

  if (!analytics) return null;
  const m = analytics.metrics;
  const selectedPlan = analytics.filters?.plan_id;
  const orders = analytics.orders ?? [];
  const spendEntries = analytics.spend_entries ?? [];
  const hasTrend = Boolean(analytics.trend?.points.length);
  const selectView = (next: AnalyticsView) => {
    setView(next);
    onSelectView?.(next);
  };

  const exportCsv = () => {
    const blob = new Blob([analyticsCsv(analytics)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${analytics.dataset}-活动明细.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const navigateTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault();
    selectView(views[next].id);
    tabs.current[next]?.focus();
  };

  return <div className="analytics-workspace">
    <div className="analytics-toolbar">
      <div className="analytics-tabs" role="tablist" aria-label="活动效果视图">
        {views.map((item, index) => <button
          key={item.id} type="button" role="tab" id={`${tabsId}-${item.id}-tab`}
          aria-controls={`analytics-${item.id}`} aria-selected={view === item.id}
          tabIndex={view === item.id ? 0 : -1}
          ref={node => { tabs.current[index] = node; }}
          onClick={() => selectView(item.id)} onKeyDown={event => navigateTab(event, index)}
        ><item.icon size={16} aria-hidden="true"/><span>{item.label}</span></button>)}
      </div>
      <Button onClick={exportCsv}><Download size={15} aria-hidden="true"/>导出当前范围 CSV</Button>
    </div>
    {selectedPlan && <div className="analytics-selected-plan">
      <span>当前计划：<strong>{analytics.rows.find(row => row.plan_id === selectedPlan)?.name ?? selectedPlan}</strong></span>
      <Button kind="ghost" onClick={() => selectPlan('')}><X size={14} aria-hidden="true"/>清除计划筛选</Button>
    </div>}
    {views.map(item => <div
      key={item.id} id={`analytics-${item.id}`} className="analytics-view" role="tabpanel"
      aria-labelledby={`${tabsId}-${item.id}-tab`} tabIndex={0} hidden={view !== item.id}
    >
      {view === item.id && item.id === 'overview' && <>
        <AnalyticsCharts analytics={analytics} selectPlan={selectPlan}/>
        {hasTrend ? <TrendChart analytics={analytics}/> : <div className="analytics-trend-note">
          <ChartNoAxesCombined size={18} aria-hidden="true"/>
          <div><strong>时间趋势暂无数据</strong><p>{analytics.trend?.note || (analytics.dataset === 'session'
            ? '当前范围没有带日期的模拟成交记录。'
            : '当前来源未提供逐日明细，仅展示当前窗口的计划对比。')}</p></div>
        </div>}
        <section className="analytics-section" aria-label="触达与成交记录">
          <div className="analytics-section-heading"><h3>触达与成交记录</h3><span className="muted">各指标独立统计</span></div>
          <dl className="analytics-records">{[
            ['广告曝光', m.impressions, '次'], ['广告点击', m.clicks, '次'],
            ['商品页浏览', analytics.views, '次'], ['支付订单', m.orders, '笔'], ['去重买家', m.buyers, '人'],
          ].map(([label, value, unit]) => <div key={String(label)}><dt>{label}</dt><dd>{formatMetric(value)}<small>{unit}</small></dd></div>)}</dl>
          <p className="analytics-note">曝光、访问、订单与买家口径不同，不计算跨单位漏斗转化率。</p>
        </section>
        <details className="analytics-disclosure">
          <summary>效率指标与统计口径</summary>
          <dl className="analytics-records analytics-efficiency">
            <div><dt>点击率</dt><dd>{formatMetric(m.ctr, 'percent')}</dd></div>
            <div><dt>订单广告成本</dt><dd>{m.cpa == null ? '不可计算' : formatMetric(m.cpa, 'money')}</dd></div>
            <div><dt>新客广告成本</dt><dd>{m.cac == null ? '不可计算' : formatMetric(m.cac, 'money')}</dd></div>
          </dl>
          <p>{analytics.note}</p>
          <p>广告成本仅含当前范围广告消耗；缺少消耗、分母为零或新客历史不完整时，相应比率不可计算。支付 ROI 不等于利润。</p>
        </details>
      </>}
      {view === item.id && item.id === 'plans' && <section className="analytics-section">
        <div className="analytics-section-heading"><h3>计划表现明细</h3><Badge tone="neutral">{analytics.rows.length} 个计划</Badge></div>
        <p className="analytics-note">{analytics.label} · {analytics.window}</p>
        {analytics.rows.length ? <Table headers={['计划', '曝光 / 点击', '广告消耗', '支付订单', '识别新客', '支付金额', '支付 ROI']}>
          {analytics.rows.map((row, index) => <tr key={`${row.plan_id ?? row.name}-${index}`}>
            <td>{row.plan_id ? <button type="button" className="analytics-plan-link" onClick={() => selectPlan(row.plan_id!)} aria-label={`筛选计划：${row.name}`}>{row.name}<ArrowUpRight size={14} aria-hidden="true"/></button> : row.name}</td>
            <td>{formatMetric(row.impressions)} / {formatMetric(row.clicks)}</td>
            <td>{formatMetric(row.spend, 'money')}</td><td>{formatMetric(row.orders)}</td>
            <td>{formatMetric(row.new_customers)}</td><td>{formatMetric(row.revenue, 'money')}</td><td>{row.roi == null ? '不可计算' : formatMetric(row.roi)}</td>
          </tr>)}
        </Table> : <Empty text="当前范围没有计划数据。"/>}
      </section>}
      {view === item.id && item.id === 'orders' && <section className="analytics-section">
        <div className="analytics-section-heading"><h3>订单明细 · 来源追溯</h3><Badge tone="neutral">{orders.length} 笔明细</Badge></div>
        <p className="analytics-note">{analytics.label} · {analytics.window} · 汇总支付订单 {formatMetric(m.orders)} 笔</p>
        {orders.length ? <Table headers={['订单编号', '测试买家', '客群识别', '数量', '模拟支付金额', '时间', '来源']}>
          {orders.map(order => <tr key={order.id}>
            <td><span className="analytics-record-id" title={order.id}>{order.id}</span></td>
            <td>{order.buyer_id}</td><td><Badge tone={order.buyer_type === 'new' ? 'green' : order.buyer_type === 'unknown' ? 'amber' : 'neutral'}>{buyers[order.buyer_type] ?? '历史未知'}</Badge></td>
            <td>{formatMetric(order.quantity)}</td><td>{formatMetric(order.amount, 'money')}</td><td>{date(order.created_at)}</td>
            <td><Button kind="ghost" onClick={() => trace(order)}>查看链路<ArrowUpRight size={13} aria-hidden="true"/></Button></td>
          </tr>)}
        </Table> : <Empty text={m.orders === 0 ? '当前范围没有订单。现场互动与模拟场景分别统计。' : '当前来源未提供逐笔订单明细。'}/>}
      </section>}
      {view === item.id && item.id === 'spend' && <section className="analytics-section">
        <div className="analytics-section-heading"><h3>消耗依据</h3><Badge tone="neutral">预算配置不作为消耗</Badge></div>
        <p className="analytics-note">{analytics.label} · {analytics.window} · 广告消耗 {formatMetric(m.spend, 'money')}</p>
        {spendEntries.length ? <Table headers={['记录', '对应计划', '金额', '来源 / 窗口']}>
          {spendEntries.map(entry => <tr key={entry.id}>
            <td><span className="analytics-record-id">{entry.id}</span></td>
            <td>{analytics.rows.find(row => row.plan_id === entry.plan_id)?.name ?? entry.plan_id ?? '未提供'}</td>
            <td>{formatMetric(entry.amount, 'money')}</td><td>{entry.source ?? '未提供'}<small>{date(entry.created_at)}</small></td>
          </tr>)}
        </Table> : <Empty text={m.spend == null
          ? '当前来源未提供广告消耗，ROI 与广告获客成本不可计算。'
          : m.spend === 0 ? '当前范围广告消耗为 0，未提供逐笔消耗记录。' : '当前来源仅提供汇总消耗，未提供逐笔消耗记录。'}/>}
      </section>}
    </div>)}
  </div>;
}
