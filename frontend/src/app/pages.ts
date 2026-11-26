import { Bot, Globe2, LayoutDashboard, Megaphone, Package, Radio } from 'lucide-react';
import { workspaceLocation, workspaceModules } from './workspaceNavigation';

const icons = { overview: LayoutDashboard, geo: Globe2, live: Radio, marketing: Megaphone, product: Package, agent: Bot };
export const pages = workspaceModules.map(page => ({ ...page, icon: icons[page.id as keyof typeof icons] }));

export function pageFor(route: string) {
  if (route.split('?')[0] === 'codex') return { id: 'codex', label: 'Codex 工作台', icon: LayoutDashboard, route: 'codex' };
  return pages.find(page => page.id === workspaceLocation(route).module.id)!;
}

export function detailLabel(route: string): string {
  const location = workspaceLocation(route);
  return location.detail || location.section?.label || '';
}
