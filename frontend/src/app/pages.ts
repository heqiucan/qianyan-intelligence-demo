import { Bot, ChartNoAxesCombined, LayoutDashboard, ListChecks, Megaphone, Package, Radio, Sparkles } from 'lucide-react';

export const pages = [
  { id: 'overview', label: '工作总览', icon: LayoutDashboard, route: 'overview' },
  { id: 'agent', label: 'Agent 任务', icon: Bot, route: 'agent' },
  { id: 'product', label: '商品与知识', icon: Package, route: 'product?tab=catalog' },
  { id: 'creative', label: '营销与创意', icon: Sparkles, route: 'creative' },
  { id: 'live', label: '直播工作台', icon: Radio, route: 'live' },
  { id: 'ads', label: '广告投放', icon: Megaphone, route: 'ads' },
  { id: 'analytics', label: '效果与复盘', icon: ChartNoAxesCombined, route: 'analytics' },
  { id: 'tasks', label: '待办与审核', icon: ListChecks, route: 'tasks' },
];

export function pageFor(route: string) {
  const id = route.split('?')[0];
  return id === 'codex' ? { id, label: 'Codex 工作台', icon: LayoutDashboard, route: id }
    : pages.find(page => page.id === id) || pages[0];
}

export function detailLabel(route: string): string {
  const [page, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  if (page === 'agent') {
    if (params.get('tab') === 'demand') return params.get('task') ? '需求任务详情' : '需求分析';
    return params.get('agent') === 'new' ? '新建内容任务' : params.has('agent') ? '内容任务详情' : '内容任务';
  }
  if (page === 'product') return ({ catalog: '商品目录', knowledge: '知识库' } as Record<string, string>)[params.get('tab') || ''] || '品牌与商品资料';
  if (page === 'creative') return params.has('item') ? '创意详情' : params.get('tab') === 'knowledge' ? '知识草稿' : params.get('view') === 'campaigns' ? '活动管理' : '创意素材';
  if (page === 'analytics') return ({ optimize: '优化复盘', reports: '活动报告', live: '场次复盘', 'live-reports': '场次报告' } as Record<string, string>)[params.get('view') || ''] || '效果分析';
  if (page === 'live') return params.get('pane') === 'session' ? '场次与货盘' : params.has('feature') && params.get('feature') !== 'console' ? '场次设置' : '现场控制';
  return '';
}
