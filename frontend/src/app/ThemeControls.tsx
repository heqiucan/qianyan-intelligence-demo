import { Monitor, Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from './theme';

export default function ThemeControls({ settings = false }: { settings?: boolean }) {
  const { preference, resolved } = useTheme();
  const options = settings
    ? [{ id: 'light', label: '浅色', icon: Sun }, { id: 'dark', label: '深色', icon: Moon }, { id: 'system', label: '跟随系统', icon: Monitor }] as const
    : [{ id: 'light', label: '浅色', icon: Sun }, { id: 'dark', label: '深色', icon: Moon }] as const;
  return <div className={'theme-controls' + (settings ? ' theme-settings' : '')} role="group" aria-label="外观主题">
    {options.map(option => <button type="button" key={option.id} aria-label={option.label + '主题'} title={option.label + (preference === 'system' && !settings ? '（当前跟随系统）' : '主题')} aria-pressed={(settings ? preference : resolved) === option.id} onClick={() => setTheme(option.id)}><option.icon size={17}/>{settings && <span>{option.label}</span>}</button>)}
  </div>;
}
