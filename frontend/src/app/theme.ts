import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const key = 'workspace-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(key);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch { /* Keep switching functional even without persistent storage. */ }
  return 'light';
}
let preference = readPreference();
let snapshot = { preference, resolved: resolve(preference) };
function resolve(value: ThemePreference): 'light' | 'dark' {
  return value === 'system' ? (media.matches ? 'dark' : 'light') : value;
}
function apply() {
  const resolved = resolve(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'light' ? '#f7f8fc' : '#111015';
  snapshot = { preference, resolved };
  listeners.forEach(listener => listener());
}
export function setTheme(value: ThemePreference) {
  preference = value;
  try { localStorage.setItem(key, value); } catch { /* Session-only fallback. */ }
  apply();
}
media.addEventListener('change', () => { if (preference === 'system') apply(); });
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) { preference = readPreference(); apply(); }
});
apply();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useTheme() { return useSyncExternalStore(subscribe, () => snapshot); }
