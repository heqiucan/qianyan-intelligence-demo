import type { AnalyticsView } from './data';

export const ANALYTICS_VIEW_EVENT = 'analytics:select-view';

export function requestAnalyticsView(view: AnalyticsView) {
  window.dispatchEvent(new CustomEvent(ANALYTICS_VIEW_EVENT, { detail: view }));
}
