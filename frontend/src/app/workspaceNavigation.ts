export interface NavigationItem {
  id: string;
  label: string;
  route: string;
}

export const workspaceModules: NavigationItem[] = [
  { id: 'overview', label: '工作总览', route: 'overview' },
  { id: 'geo', label: 'GEO 工作台', route: 'geo' },
  { id: 'live', label: '直播工作台', route: 'live?pane=session' },
  { id: 'marketing', label: '营销工作台', route: 'creative?view=campaigns' },
  { id: 'product', label: '商品与知识', route: 'product?tab=catalog' },
  { id: 'agent', label: 'Agent 中心', route: 'agent' },
];

const sections: Record<string, NavigationItem[]> = {
  overview: [
    { id: 'today', label: '今日工作', route: 'overview' },
    { id: 'review', label: '待办与审核', route: 'tasks?view=creative' },
    { id: 'issues', label: '异常提醒', route: 'tasks' },
  ],
  marketing: [
    { id: 'campaigns', label: '活动管理', route: 'creative?view=campaigns' },
    { id: 'demand', label: '需求与选题', route: 'agent?tab=demand' },
    { id: 'content', label: '内容创意', route: 'creative' },
    { id: 'ads', label: '广告投放', route: 'ads' },
    { id: 'results', label: '效果与复盘', route: 'analytics' },
    { id: 'assistant', label: '咨询助手', route: 'overview?tab=assistant' },
  ],
  live: [
    { id: 'sessions', label: '场次管理', route: 'live?pane=session' },
    { id: 'control', label: '现场控制', route: 'live?pane=control' },
    { id: 'materials', label: '直播素材', route: 'live?module=scripts&feature=groups' },
    { id: 'results', label: '场次复盘', route: 'analytics?view=live' },
  ],
  product: [
    { id: 'catalog', label: '商品目录', route: 'product?tab=catalog' },
    { id: 'brand', label: '品牌资料', route: 'product?tab=brand' },
    { id: 'knowledge', label: '知识资料', route: 'product?tab=knowledge' },
  ],
  agent: [
    { id: 'list', label: '任务列表', route: 'agent' },
    { id: 'new', label: '新建任务', route: 'agent?agent=new' },
  ],
};

export function workspaceLocation(route: string) {
  const [page, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  const view = params.get('view') || '';
  const tab = params.get('tab') || '';
  let moduleId = 'overview';
  let sectionId = 'today';
  let detail = '';
  if (page === 'geo') {
    moduleId = 'geo'; sectionId = view || 'overview';
  } else if (page === 'agent' && tab !== 'demand') {
    moduleId = 'agent'; sectionId = params.get('agent') === 'new' ? 'new' : 'list';
    detail = params.get('agent') && params.get('agent') !== 'new' ? '任务详情' : '';
  } else if (page === 'product' || (page === 'creative' && tab === 'knowledge')) {
    moduleId = 'product';
    sectionId = tab === 'knowledge' ? 'knowledge' : tab === 'brand' ? 'brand' : 'catalog';
    detail = tab === 'knowledge' ? (params.has('draft') ? '知识草稿' : params.has('space') ? '资料空间' : '') : !tab || tab === 'profile' ? '商品资料' : '';
  } else if (page === 'live' || (page === 'analytics' && ['live', 'live-reports'].includes(view))) {
    moduleId = 'live';
    const feature = params.get('feature') || '';
    const materials = params.get('module') === 'scripts' || ['groups', 'variables', 'writing', 'slicing', 'conversion', 'subtitles', 'playlist', 'ambience'].includes(feature);
    sectionId = page === 'analytics' ? 'results' : params.get('pane') === 'session' || !query ? 'sessions' : materials ? 'materials' : 'control';
    detail = params.has('live') ? (sectionId === 'sessions' ? '场次准备' : sectionId === 'results' ? '本场结果' : '当前场次') : '';
    if (view === 'live-reports') detail = '场次报告';
  } else if (page === 'tasks') {
    sectionId = view === 'creative' ? 'review' : 'issues';
  } else if (page === 'overview' && tab === 'assistant') {
    moduleId = 'marketing'; sectionId = 'assistant';
  } else if (page === 'agent' && tab === 'demand') {
    moduleId = 'marketing'; sectionId = 'demand';
    detail = params.get('task') === 'new' ? '新建需求任务' : params.has('task') ? '需求任务详情' : '';
  } else if (['creative', 'ads', 'analytics'].includes(page)) {
    moduleId = 'marketing';
    sectionId = page === 'ads' ? 'ads' : page === 'analytics' ? 'results' : view === 'campaigns' ? 'campaigns' : 'content';
    detail = params.has('item') ? '创意详情' : view === 'reports' ? '活动报告' : view === 'optimize' ? '优化复盘' : params.has('campaign') && view === 'campaigns' ? '活动详情' : '';
  }
  const module = workspaceModules.find(item => item.id === moduleId)!;
  const items = (sections[moduleId] || []).map(item => {
    if (moduleId !== 'live' || !params.has('live')) return item;
    return { ...item, route: item.route + '&live=' + encodeURIComponent(params.get('live')!) };
  });
  return { module, items, section: items.find(item => item.id === sectionId), sectionId, detail };
}
