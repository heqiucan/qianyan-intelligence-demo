import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Bell, ChevronRight, CircleHelp, ListChecks, Menu, Settings2, X } from 'lucide-react';
import { pageFor, pages } from './pages';
import './workspace.css';
import ThemeControls from './ThemeControls';
import WorkspaceTabs from './WorkspaceTabs';
import { workspaceLocation } from './workspaceNavigation';
import './hierarchy.css';

const navigationGroups = [
  { id: 'work', label: '工作', entries: ['overview'] },
  { id: 'business', label: '业务运营', entries: ['geo', 'live', 'marketing'] },
  { id: 'assets', label: '资产与执行', entries: ['product', 'agent'] },
];

interface AppShellProps {
  route: string;
  go: (route: string) => void;
  children: ReactNode;
  actions?: ReactNode;
  pending: number;
  openDialog: (dialog: string) => void;
}

export default function AppShell({ route, go, children, actions, pending, openDialog }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const page = pageFor(route);
  const location = workspaceLocation(route);
  const overviewItems = workspaceLocation('overview').items;

  useLayoutEffect(() => {
    const element = frame.current;
    const header = element?.querySelector('.topbar');
    const tabs = element?.querySelector('.module-navigation');
    if (!element || !header) return;
    const measure = () => {
      element.style.setProperty('--shell-header-height', `${header.getBoundingClientRect().height}px`);
      element.style.setProperty('--shell-tabs-height', `${tabs?.getBoundingClientRect().height || 0}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header, { box: 'border-box' });
    if (tabs) observer.observe(tabs, { box: 'border-box' });
    measure();
    return () => observer.disconnect();
  }, [page.id]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const panel = sidebar.current;
    const toggle = menuToggle.current;
    if (!panel) return;
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button, a[href]'))
      .filter(element => element.getClientRects().length > 0);
    panel.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    if (!panel.contains(document.activeElement)) controls()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key === 'Tab') {
        const items = controls();
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    panel.addEventListener('keydown', handleKey);
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      document.body.style.overflow = previousOverflow;
      panel.removeEventListener('keydown', handleKey);
      desktop.removeEventListener('change', closeOnDesktop);
      if (!desktop.matches && (panel.contains(document.activeElement) || document.activeElement === document.body)) {
        toggle?.focus();
      }
    };
  }, [menuOpen]);

  const navigate = (target: string) => {
    go(target);
    setMenuOpen(false);
  };
  const showDialog = (dialog: string) => {
    setMenuOpen(false);
    openDialog(dialog);
  };

  return (
    <div ref={frame} className={'app-shell v2 workspace-frame' + (page.id === 'live' ? ' live-desk-app' : '')}>
      {menuOpen && (
        <button className="workspace-scrim" aria-label="关闭主导航遮罩" tabIndex={-1} onClick={() => setMenuOpen(false)}/>
      )}
      <aside
        ref={sidebar}
        id="workspace-primary-navigation"
        className={'workspace-sidebar' + (menuOpen ? ' is-open' : '')}
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label="工作区导航"
      >
        <div className="workspace-brand-row">
          <button className="workspace-brand" onClick={() => navigate('overview')}>
            <img src="/brand-mark.svg" alt=""/>
            <strong>浙衍 AI</strong>
          </button>
          <button className="button ghost workspace-menu-close" aria-label="关闭主导航" title="关闭主导航" onClick={() => setMenuOpen(false)}>
            <X size={20}/>
          </button>
        </div>
        <nav className="workspace-primary-nav" aria-label="主导航">
          {navigationGroups.map(group => (
            <div className="workspace-nav-group" key={group.id} role="group" aria-labelledby={'workspace-group-' + group.id}>
              <p className="workspace-nav-caption" id={'workspace-group-' + group.id}>{group.label}</p>
              {pages.filter(item => group.entries.includes(item.id)).map(item => (
                <Fragment key={item.id}>
                <button
                  className={'nav-item' + (page.id === item.id ? ' active' : '')}
                  aria-label={item.label}
                  aria-current={page.id === item.id ? item.id === 'overview' ? 'location' : 'page' : undefined}
                  onClick={() => navigate(item.route)}
                >
                  <item.icon size={18} aria-hidden="true"/>
                  <span>{item.label}</span>
                </button>
                {item.id === 'overview' && (
                  <div className="workspace-overview-subnav" role="group" aria-label="工作总览子菜单">
                    {overviewItems.map(child => (
                      <button
                        key={child.id}
                        type="button"
                        aria-current={page.id === 'overview' && location.sectionId === child.id ? 'page' : undefined}
                        onClick={() => navigate(child.route)}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
                </Fragment>
              ))}
            </div>
          ))}
        </nav>
        <div className="workspace-utilities">
          <button className="nav-item" onClick={() => showDialog('settings')}>
            <Settings2 size={18} aria-hidden="true"/><span>设置</span>
          </button>
          <button className="nav-item" onClick={() => showDialog('guide')}>
            <CircleHelp size={18} aria-hidden="true"/><span>帮助</span>
          </button>
        </div>
      </aside>
      <div className="main-shell" inert={menuOpen}>
        <header className="topbar">
          <button
            ref={menuToggle}
            className="button ghost workspace-menu-toggle"
            title="主导航"
            aria-label="打开主导航"
            aria-controls="workspace-primary-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20}/>
          </button>
          <nav className="breadcrumb" aria-label="当前位置">
            <button onClick={() => go(page.route)} aria-current={!location.section && !location.detail ? 'page' : undefined}>
              {page.label}
            </button>
            {location.section && (
              <span className="breadcrumb-segment">
                <ChevronRight size={14} aria-hidden="true"/>
                <button onClick={() => go(location.section!.route)} aria-current={!location.detail ? 'page' : undefined}>
                  {location.section.label}
                </button>
              </span>
            )}
            {location.detail && (
              <span className="breadcrumb-segment">
                <ChevronRight size={14} aria-hidden="true"/>
                <span aria-current="page">{location.detail}</span>
              </span>
            )}
          </nav>
          <div className="workspace-appearance">
            <a className="button ghost workspace-website-link" href="/website.html" target="_blank" rel="noreferrer" aria-label="产品官网" title="产品官网">
              <span>产品官网</span><ArrowUpRight size={15}/>
            </a>
            <ThemeControls/>
            <button className="button ghost workspace-review-shortcut" title="待办与审核" aria-label="待办与审核" onClick={() => go('tasks?view=creative')}>
              <ListChecks size={18}/>
              {pending > 0 && <span className="workspace-count">{pending}</span>}
            </button>
            <button className="button ghost workspace-log-button" title="执行记录" aria-label="查看执行记录" onClick={() => openDialog('logs')}>
              <Bell size={18}/>
            </button>
          </div>
        </header>
        <main className={'page workspace-page ' + (page.id === 'live' ? 'live-workspace-page' : '')}>
          <div className="page-heading">
            <h1>{page.label}</h1>
            <div className="heading-actions">{actions}</div>
          </div>
          {page.id !== 'overview' && location.items.length > 0 && (
            <div className="module-navigation">
              <WorkspaceTabs label={page.label + '功能'} selected={location.sectionId} items={location.items} go={go}/>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
