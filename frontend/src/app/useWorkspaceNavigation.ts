import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { normalizeRoute, sameLiveSession } from '../navigation';
import { requestId } from '../api';

const readRoute = () => normalizeRoute(location.hash.replace(/^#\/?/, '') || 'overview');
const leaveMessage = '当前有未保存内容或正在播报，确定离开、停止播报并放弃修改？';
interface Entry { key: string; index: number; top: number }
const newEntry = (index: number, top = 0): Entry => ({ key: requestId(), index, top });

export function useWorkspaceNavigation() {
  const [route, setRoute] = useState(readRoute);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [, setDirtyState] = useState(false);
  const routeRef = useRef(route), dirty = useRef(false), retainLive = useRef(false);
  const liveSessionIds = useRef<string[]>([]);
  const entry = useRef<Entry>(history.state?.workspaceEntry || newEntry(history.length - 1));
  const positions = useRef(new Map<string, number>());
  const routePositions = useRef(new Map<string, number>());
  const restore = useRef<number | null>(entry.current.top);
  const reverting = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirty.current = value; setDirtyState(value); }, []);
  const markLiveDirty = useCallback((value: boolean, retain = true) => { retainLive.current = retain; markDirty(value); }, [markDirty]);
  const canLeave = useCallback(() => !dirty.current || window.confirm(leaveMessage), []);
  const retain = (next: string) => retainLive.current && sameLiveSession(routeRef.current, next, liveSessionIds.current);
  const remember = () => {
    entry.current.top = window.scrollY;
    positions.current.set(entry.current.key, window.scrollY);
    routePositions.current.set(routeRef.current, window.scrollY);
  };
  const discard = (checked: boolean) => {
    if (dirty.current && !checked) setEditorEpoch(value => value + 1);
    markDirty(false);
  };
  const apply = useCallback((target: string, replace = false, checked = false) => {
    const next = normalizeRoute(target);
    if (next === routeRef.current) return true;
    const preserve = retain(next);
    if (!checked && !preserve && !canLeave()) return false;
    remember();
    history.replaceState({ ...history.state, workspaceEntry: entry.current }, '', '#/' + routeRef.current);
    if (!preserve) discard(checked);
    const top = preserve ? window.scrollY : routePositions.current.get(next) || 0;
    const nextEntry = replace ? { ...entry.current, top } : newEntry(entry.current.index + 1, top);
    restore.current = preserve ? null : top;
    if (replace) history.replaceState({ workspaceEntry: nextEntry }, '', '#/' + next);
    else history.pushState({ workspaceEntry: nextEntry }, '', '#/' + next);
    entry.current = nextEntry; routeRef.current = next; setRoute(next);
    return true;
  }, [canLeave, markDirty]);
  const go = useCallback((next: string) => { apply(next); }, [apply]);
  const replace = useCallback((next: string) => { apply(next, true, true); }, [apply]);
  const navigateChecked = useCallback((next: string) => { apply(next, false, true); }, [apply]);

  useLayoutEffect(() => {
    history.replaceState({ ...history.state, workspaceEntry: entry.current }, '', '#/' + route);
    if (restore.current === null) return;
    const top = restore.current;
    let stopped = false;
    const stop = () => { stopped = true; observer.disconnect(); };
    const update = () => {
      if (stopped) return;
      window.scrollTo({ top, behavior: 'instant' });
      if (Math.abs(window.scrollY - top) < 2) stop();
    };
    // Lists may finish loading after the route has rendered.
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    const frame = requestAnimationFrame(update), timer = setTimeout(stop, 20000);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    return () => { stop(); cancelAnimationFrame(frame); clearTimeout(timer); window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); };
  }, [route, editorEpoch, historyRevision]);

  useLayoutEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const change = () => {
      const next = readRoute();
      if (reverting.current) {
        if (history.state?.workspaceEntry?.key !== entry.current.key) return;
        reverting.current = false;
        history.replaceState({ ...history.state, workspaceEntry: entry.current }, '', '#/' + routeRef.current);
        window.scrollTo({ top: entry.current.top, behavior: 'instant' });
        return;
      }
      let incoming: Entry = history.state?.workspaceEntry;
      if (next === routeRef.current) {
        if (incoming && incoming.key !== entry.current.key) {
          remember(); restore.current = positions.current.get(incoming.key) ?? incoming.top;
          entry.current = incoming; setHistoryRevision(value => value + 1);
        }
        return;
      }
      // A new hash entry copies the current state; an untracked earlier entry has no key.
      if (!incoming) incoming = newEntry(entry.current.index - 1);
      else if (incoming.key === entry.current.key) incoming = newEntry(entry.current.index + 1);
      remember();
      const preserve = retain(next);
      if (!preserve && !canLeave()) {
        const delta = entry.current.index - incoming.index;
        if (delta) { reverting.current = true; history.go(delta); }
        else history.replaceState({ workspaceEntry: entry.current }, '', '#/' + routeRef.current);
        return;
      }
      if (!preserve) discard(false);
      restore.current = preserve ? null : positions.current.get(incoming.key) ?? incoming.top;
      entry.current = incoming; routeRef.current = next; setRoute(next);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = ''; }
    };
    const savePosition = () => { if (!reverting.current) remember(); };
    window.addEventListener('popstate', change);
    window.addEventListener('hashchange', change);
    window.addEventListener('scroll', savePosition, { passive: true });
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      history.scrollRestoration = previousRestoration;
      window.removeEventListener('popstate', change); window.removeEventListener('hashchange', change);
      window.removeEventListener('scroll', savePosition); window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [canLeave, markDirty]);
  return { route, go, replace, navigateChecked, editorEpoch, dirty, markDirty, markLiveDirty, liveSessionIds, canLeave };
}
