import { ArrowUpRight, ShoppingBag, Users, Wallet, Target } from 'lucide-react';
import { money, number, type Analytics } from '../api';

export default function MetricsSummary({analytics, onSelect}: {analytics: Analytics | null; onSelect: (section: string) => void}) {
  if (!analytics) return null;
  const m = analytics.metrics;
  const business = [
    {label:'支付金额', value:money(m.revenue), note:'当前范围模拟支付合计', key:'orders', icon:Wallet},
    {label:'支付订单', value:number(m.orders), note:'数量为 0 表示当前范围内没有订单', key:'orders', icon:ShoppingBag},
    {label:'识别新客', value:number(m.new_customers), note:`去重买家 · ${m.unknown_buyers} 位历史未知`, key:'orders', icon:Users},
    {label:'客单价', value:m.orders ? money(m.revenue / m.orders) : '暂无支付订单', note:'支付金额 / 支付订单数', key:'orders', icon:Target},
  ];
  return <>
    <div className="v3-stats-heading"><h2>这次推广带来了什么</h2><span className="muted">{analytics.label} · {analytics.window}</span></div>
    <div className="stats-grid">{business.map(item => <button type="button" key={item.label} className="stat-card v2-stat-button" onClick={() => onSelect(item.key)}>
      <span className="stat-label">{item.label}<item.icon size={17}/></span><span className={`stat-value ${!m.orders && item.label === '客单价' ? 'v3-metric-unavailable' : ''}`}>{item.value}</span><span className="stat-foot">{item.note}<ArrowUpRight size={13}/></span>
    </button>)}</div>
    <div className="metrics-strip">
      <button type="button" className="v2-text-button" onClick={() => onSelect('spend')}><span>广告消耗</span><strong>{m.spend == null ? '当前来源未提供' : money(m.spend)}</strong><small>查看消耗依据 →</small></button>
      <button type="button" className="v2-text-button" onClick={() => onSelect('spend')}><span>支付 ROI</span><strong>{m.roi == null ? '暂不可计算' : number(m.roi)}</strong><small>{m.spend == null ? '缺少同范围广告消耗' : m.spend === 0 ? '广告消耗为 0，不能作为分母' : '支付金额 / 广告消耗'}</small></button>
    </div>
    <p className="v3-stat-explainer">支付金额不等于利润，支付 ROI 不含商品和履约成本。来源、计划、日期筛选同时作用于这些指标和下方明细；没有数据与有效的 0 分开显示。</p>
  </>;
}
