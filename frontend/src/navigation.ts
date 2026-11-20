// Keep bookmarked pages and existing cross-page actions on the new navigation.
export function normalizeRoute(route: string): string {
  const separator = route.indexOf('?');
  const page = separator < 0 ? route : route.slice(0, separator);
  const params = new URLSearchParams(separator < 0 ? '' : route.slice(separator + 1));
  let target = page;
  if (page === 'overview' && params.get('tab') === 'live') {
    target = 'live';
    params.delete('tab');
  } else if (page === 'optimize' || page === 'reports') {
    target = 'review';
    params.set('view', page);
  }
  const query = params.toString();
  return target + (query ? '?' + query : '');
}

// A panel change may keep local drafts only within the same effective session.
export function sameLiveSession(from: string, to: string, sessionIds: string[]): boolean {
  const resolve = (route: string) => {
    const [page, query = ''] = normalizeRoute(route).split('?');
    if (page !== 'live') return null;
    const selected = new URLSearchParams(query).get('live');
    return selected && sessionIds.includes(selected) ? selected : sessionIds.at(-1) || '';
  };
  const previous = resolve(from);
  return previous !== null && previous === resolve(to);
}
