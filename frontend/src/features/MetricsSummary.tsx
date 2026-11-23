import { ArrowUpRight, ShoppingBag, Users, Wallet, Target } from 'lucide-react';
import type { Analytics } from '../api';
import { averageOrderValue, formatMetric, type AnalyticsView } from './analytics/data';
import { requestAnalyticsView } from './analytics/viewNavigation';
import './analytics/analytics.css';

export default function MetricsSummary({ analytics, onSelect }: { analytics: Analytics | null; onSelect: (section: string) => void }) {
  if (!analytics) return null;
  const m = analytics.metrics;
  const average = averageOrderValue(m);
  const select = (view: AnalyticsView) => { onSelect(view); requestAnalyticsView(view); };
  const business = [
    { label: '支付金额', value: formatMetric(m.revenue, 'money'), icon: Wallet },
    { label: '支付订单', value: formatMetric(m.orders), icon: ShoppingBag },
    { label: '识别新客', value: formatMetric(m.new_customers), icon: Users },
    { label: '客单价', value: average === null ? '不可计算' : formatMetric(average, 'money'), icon: Target },
  ];
  return <section className="analytics-summary" aria-label="效果指标摘要">
    <div className="analytics-summary-heading"><h2>效果摘要</h2><span>{analytics.label} · {analytics.window}</span></div>
    <div className="analytics-summary-grid">{business.map(item => <button type="button" key={item.label} className="analytics-stat" onClick={() => select('orders')} aria-label={`${item.label} ${item.value}，查看订单明细`}>
      <span className="analytics-stat-label">{item.label}<item.icon size={16} aria-hidden="true"/></span>
      <span className="analytics-stat-value">{item.value}</span><ArrowUpRight size={14} className="analytics-stat-link" aria-hidden="true"/>
    </button>)}</div>
    <div className="analytics-summary-costs">
      <button type="button" onClick={() => select('spend')} aria-label={`广告消耗 ${formatMetric(m.spend, 'money')}，查看消耗依据`}><span>广告消耗</span><strong>{formatMetric(m.spend, 'money')}</strong><ArrowUpRight size={14} aria-hidden="true"/></button>
      <button type="button" onClick={() => select('spend')} aria-label={`支付 ROI ${m.roi == null ? '不可计算' : formatMetric(m.roi)}，查看消耗依据`}><span>支付 ROI</span><strong>{m.roi == null ? '不可计算' : formatMetric(m.roi)}</strong><ArrowUpRight size={14} aria-hidden="true"/></button>
    </div>
    <details className="analytics-disclosure">
      <summary>数据来源与指标口径</summary>
      <p>{analytics.label} · {analytics.window}</p><p>{analytics.note}</p>
      <dl className="analytics-definitions">
        <div><dt>成交</dt><dd>支付金额为当前范围模拟支付合计；客单价 = 支付金额 / 支付订单数。订单数为 0 或金额缺失时不可计算。</dd></div>
        <div><dt>获客</dt><dd>新客按买家去重；当前 {formatMetric(m.unknown_buyers)} 位买家历史未知，不能当作新客。</dd></div>
        <div><dt>投入</dt><dd>广告消耗取自同范围消耗记录，不使用预算替代。支付 ROI = 支付金额 / 广告消耗；消耗为 0 或缺失时不可计算，不含商品与履约成本，不等于利润。</dd></div>
        <div><dt>范围</dt><dd>来源、活动、计划和日期筛选统一作用于摘要、图表与明细；有效的 0 与未提供分开显示。</dd></div>
      </dl>
    </details>
  </section>;
}
