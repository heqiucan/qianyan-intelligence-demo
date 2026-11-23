import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Bell, ChevronRight, CircleHelp, Menu, Settings2, X } from 'lucide-react';
import { detailLabel, pageFor, pages } from './pages';
import './workspace.css';
import ThemeControls from './ThemeControls';

export default function AppShell({ route, go, children, actions, pending, openDialog }: {
  route: string; go: (route: string) => void; children: ReactNode; actions?: ReactNode;
  pending: number; openDialog: (dialog: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const page = pageFor(route);
  const detail = detailLabel(route);
  const navigate = (target: string) => { go(target); setMenuOpen(false); };
  return <div className={'app-shell v2 workspace-frame' + (page.id === 'live' ? ' live-desk-app' : '')}>
    {menuOpen && <button className="workspace-scrim" aria-label="关闭主导航" onClick={() => setMenuOpen(false)}/>}
    <aside className={'workspace-sidebar' + (menuOpen ? ' is-open' : '')}>
      <button className="workspace-brand" onClick={() => navigate('overview')}><img src="/brand-mark.svg" alt=""/><strong>浙衍 AI</strong></button>
      <nav aria-label="主导航">{pages.map(item => <button key={item.id} className={'nav-item' + (page.id === item.id ? ' active' : '')} aria-label={item.label} aria-current={page.id === item.id ? 'page' : undefined} onClick={() => navigate(item.route)}><item.icon size={18}/><span>{item.label}</span>{item.id === 'tasks' && pending > 0 && <span className="workspace-count">{pending}</span>}</button>)}</nav>
      <div className="workspace-utilities">
        <button className="nav-item" onClick={() => openDialog('settings')}><Settings2 size={18}/>设置</button>
        <button className="nav-item" onClick={() => openDialog('guide')}><CircleHelp size={18}/>帮助</button>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <button className="button ghost workspace-menu-toggle" title="主导航" aria-label="打开主导航" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
        <nav className="breadcrumb" aria-label="当前位置"><button onClick={() => go(page.route)}>{page.label}</button>{detail && <><ChevronRight size={14}/><span>{detail}</span></>}</nav>
        <div className="workspace-appearance"><a className="button ghost workspace-website-link" href="/website.html" target="_blank" rel="noreferrer" aria-label="产品官网" title="产品官网"><span>产品官网</span><ArrowUpRight size={15}/></a><ThemeControls/><button className="button ghost workspace-log-button" title="执行记录" aria-label="查看执行记录" onClick={() => openDialog('logs')}><Bell size={18}/></button></div>
      </header>
      <main className={'page workspace-page ' + (page.id === 'live' ? 'live-workspace-page' : '')}>
        <div className="page-heading"><h1>{page.label}</h1><div className="heading-actions">{actions}</div></div>
        {children}
      </main>
    </div>
  </div>;
}
