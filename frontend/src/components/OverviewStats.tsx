import { ArrowUpRight, ShoppingBag, Target, Users, Wallet } from 'lucide-react';
import { money, number, type Analytics } from '../api';

export default function OverviewStats({ analytics, onSelect }: { analytics: Analytics | null; onSelect: (section: string) => void }) {
  const metrics = analytics?.metrics;
  const items = [
    { label: '广告消耗', value: metrics?.spend == null ? '暂无消耗数据' : money(metrics.spend), note: '当前统计范围', key: 'spend', icon: Wallet },
    { label: '支付金额', value: money(metrics?.revenue), note: `${number(metrics?.orders)} 笔模拟订单`, key: 'orders', icon: ShoppingBag },
    { label: '支付 ROI', value: metrics?.roi == null ? '暂不可计算' : number(metrics.roi), note: '支付金额 / 广告消耗', key: 'spend', icon: Target },
    { label: '识别新客', value: number(metrics?.new_customers), note: metrics ? `${metrics.unknown_buyers} 位买家历史未知` : '正在读取', key: 'orders', icon: Users },
  ];
  return <div className="stats-grid">{items.map(item => <button key={item.label} className="stat-card v2-stat-button" onClick={() => onSelect(item.key)}>
    <span className="stat-label">{item.label}<item.icon size={17}/></span>
    <span className={'stat-value' + (['暂无消耗数据', '暂不可计算'].includes(item.value) ? ' v3-metric-unavailable' : '')}>{item.value}</span>
    <span className="stat-foot">{item.note}<ArrowUpRight size={13}/></span>
  </button>)}</div>;
}
