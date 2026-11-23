import { useRef, useSyncExternalStore } from 'react';
import { api, date, requestId } from '../../api';
import { records, type FeedbackProps } from './types';

export const statusText: Record<string, string> = {
  pending: '待处理', processing: '处理中', review: '待复查', resolved: '已解决', ignored: '已忽略',
  accepted: '已采纳', dismissed: '暂不采纳', draft: '待确认', applied: '已执行',
  waiting_confirmation: '待确认并开始观察', observing: '观察中', reviewed: '已复盘',
  running: '模拟运行中', paused: '已暂停', approved: '已确认', ended: '已结束',
};

export const keyLabels: Record<string, string> = {
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

export const readableTime = (value?: string | null) => !value
  ? '尚未开始'
  : Number.isNaN(Date.parse(value)) ? value : date(value);

export const sourceText = (source?: string) => {
  const labels: Record<string, string> = {
    history: '固定历史 D0', session: '现场互动记录', batch: '独立模拟批次',
  };
  return labels[source || ''] || source || '未提供';
};

export const textValue = (value: unknown) => {
  if (value == null) return '未提供';
  if (typeof value === 'string') return statusText[value] || value;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
};

// Retain a failed submission key so retrying a lost response cannot duplicate it.
export function useSubmit() {
  const keys = useRef(new Map<string, string>());
  return async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
    const fingerprint = path + JSON.stringify(body);
    const key = keys.current.get(fingerprint) || requestId();
    keys.current.set(fingerprint, key);
    const result = await api<T>(path, 'POST', { ...body, request_id: key });
    keys.current.delete(fingerprint);
    return result;
  };
}

export function scope(props: FeedbackProps) {
  return {
    campaign_id: props.campaignId,
    dataset: props.dataset,
    ...(props.dataset === 'batch' && props.batchId ? { batch_id: props.batchId } : {}),
    ...(props.planId ? { plan_id: props.planId } : {}),
    ...(props.dataset === 'session' && props.dateFrom ? { date_from: props.dateFrom } : {}),
    ...(props.dataset === 'session' && props.dateTo ? { date_to: props.dateTo } : {}),
  };
}

export function scopeLabel(props: FeedbackProps) {
  const batch = records(props.state, 'batches').find(item => item.id === props.batchId);
  const plan = props.state.plans.find(item => item.id === props.planId);
  const window = props.dataset === 'batch' ? batch?.label || '请先选择批次'
    : props.dataset === 'session' ? `${props.dateFrom || '全部起点'} 至 ${props.dateTo || '现在'}`
      : '固定样例窗口';
  return `${sourceText(props.dataset)} · ${window} · ${props.planId ? plan?.name || props.planId : '活动内全部计划'}`;
}

function subscribeRoute(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

export function useFeedbackParams() {
  const hash = useSyncExternalStore(subscribeRoute, () => window.location.hash, () => '');
  return new URLSearchParams(hash.split('?')[1] || '');
}

export function reportRoute(reportId?: string, copyFrom?: string) {
  const query = new URLSearchParams({ view: 'reports' });
  if (reportId) query.set('report', reportId);
  if (copyFrom) query.set('from', copyFrom);
  return `analytics?${query}`;
}
