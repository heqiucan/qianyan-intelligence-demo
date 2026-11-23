// Preserve saved links while assigning each workflow one navigation owner.
export function normalizeRoute(route: string): string {
  const separator = route.indexOf('?');
  const page = separator < 0 ? route : route.slice(0, separator);
  const params = new URLSearchParams(separator < 0 ? '' : route.slice(separator + 1));
  let target = page;
  if (['review', 'optimize', 'reports'].includes(page)) {
    target = 'analytics';
    if (page !== 'review' || !params.has('view')) params.set('view', page === 'reports' ? 'reports' : 'optimize');
  }
  if (params.get('tab') === 'demand' && ['overview', 'product', 'creative', 'analytics', 'tasks'].includes(target)) {
    const views: Record<string, string> = { overview: 'tasks', product: 'library', creative: 'content', analytics: 'results', tasks: 'attention' };
    params.set('view', views[target]);
    target = 'agent';
  } else if (page === 'overview' && params.has('agent')) {
    target = 'agent';
  } else if (['overview', 'creative'].includes(page) && params.get('tab') === 'live') {
    target = 'live';
    params.delete('tab');
    if (page === 'creative' && !params.has('pane')) params.set('pane', 'session');
  } else if (target === 'analytics' && params.get('tab') === 'live') {
    params.delete('tab');
    params.set('view', 'live');
  }
  const query = params.toString();
  return target + (query ? '?' + query : '');
}

export function routeWith(route: string, values: Record<string, string | undefined>): string {
  const [page, query = ''] = normalizeRoute(route).split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  return normalizeRoute(page + (params.size ? '?' + params : ''));
}

// A panel change may keep local drafts only within the same effective session.
export function sameLiveSession(from: string, to: string, sessionIds: string[]): boolean {
  if (!sessionIds.length) return false;
  const resolve = (route: string) => {
    const [page, query = ''] = normalizeRoute(route).split('?');
    if (page !== 'live') return null;
    const selected = new URLSearchParams(query).get('live');
    return selected && sessionIds.includes(selected) ? selected : sessionIds.at(-1) || '';
  };
  const previous = resolve(from);
  return previous !== null && previous === resolve(to);
}
