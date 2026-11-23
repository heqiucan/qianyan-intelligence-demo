import type { Analytics, Metrics } from '../../api';

export type AnalyticsView = 'overview' | 'plans' | 'orders' | 'spend';
export type RankingMetric = 'revenue' | 'orders' | 'new_customers' | 'spend';
export type MetricFormat = 'number' | 'money' | 'percent';

export function resolveAnalyticsView(focus: string): AnalyticsView {
  return focus === 'plans' || focus === 'orders' || focus === 'spend' ? focus : 'overview';
}

export function metricValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatMetric(value: unknown, format: MetricFormat = 'number'): string {
  const valid = metricValue(value);
  if (valid === null) return format === 'percent' ? '不可计算' : '未提供';
  if (format === 'money') return `¥${valid.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === 'percent') return `${(valid * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
  return valid.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function averageOrderValue(metrics: Pick<Metrics, 'orders' | 'revenue'>): number | null {
  const orders = metricValue(metrics.orders);
  const revenue = metricValue(metrics.revenue);
  return orders !== null && orders > 0 && revenue !== null ? revenue / orders : null;
}

export function planRanking(rows: Analytics['rows'], metric: RankingMetric) {
  const ranked = rows.map((row, sourceIndex) => {
    const raw = metricValue(row[metric]);
    return { row, sourceIndex, value: raw !== null && raw >= 0 ? raw : null };
  }).sort((a, b) => {
    if (a.value === null) return b.value === null ? a.sourceIndex - b.sourceIndex : 1;
    if (b.value === null) return -1;
    return b.value - a.value || a.sourceIndex - b.sourceIndex;
  });
  const maximum = ranked[0]?.value ?? 0;
  let rank = 0;
  return ranked.map((entry, index) => {
    if (entry.value !== null && (index === 0 || entry.value !== ranked[index - 1].value)) rank = index + 1;
    return {
      ...entry,
      rank: entry.value === null ? null : rank,
      width: entry.value === null ? null : maximum > 0 ? entry.value / maximum * 100 : 0,
    };
  });
}

export function buyerComposition(metrics: Pick<Metrics, 'buyers' | 'new_customers' | 'unknown_buyers'>) {
  const total = metricValue(metrics.buyers);
  const fresh = metricValue(metrics.new_customers);
  const unknown = metricValue(metrics.unknown_buyers);
  const counts = [total, fresh, unknown];
  const missing = counts.some(value => value === null);
  const inconsistent = counts.some(value => value !== null && (!Number.isInteger(value) || value < 0))
    || (!missing && fresh! + unknown! > total!);
  const status = missing ? 'missing' : inconsistent ? 'inconsistent' : total === 0 ? 'empty' : 'ready';
  const valid = status === 'ready' || status === 'empty';
  const returning = valid ? total! - fresh! - unknown! : null;
  return {
    status, total,
    coverage: valid && total! > 0 ? (total! - unknown!) / total! : null,
    segments: [
      { key: 'new', label: '识别新客', value: fresh },
      { key: 'returning', label: '其余已识别买家', value: returning },
      { key: 'unknown', label: '历史未知', value: unknown },
    ].map(segment => ({ ...segment, share: valid && total! > 0 ? segment.value! / total! : null })),
  };
}

export function analyticsCsv(analytics: Analytics): string {
  const quote = (value: unknown) => `"${String(value == null || (typeof value === 'number' && !Number.isFinite(value)) ? '未提供' : value).replace(/"/g, '""')}"`;
  const rows: unknown[][] = [
    ['来源', analytics.label], ['窗口', analytics.window], ['说明', analytics.note], [],
    ['计划', '曝光', '点击', '消耗', '订单', '新客', '支付金额', '支付ROI'],
    ...analytics.rows.map(row => [row.name, row.impressions, row.clicks, row.spend, row.orders, row.new_customers, row.revenue, row.roi]),
  ];
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
}
