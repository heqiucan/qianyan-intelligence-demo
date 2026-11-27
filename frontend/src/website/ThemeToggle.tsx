import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '../app/theme';

/** Light / dark switch for the homepage. Shares its storage key with the workbench, so the choice follows the visitor into the demo. */
export default function ThemeToggle() {
  const { resolved } = useTheme();
  const options = [{ id: 'light', label: '浅色', icon: Sun }, { id: 'dark', label: '深色', icon: Moon }] as const;
  return <div className="qy-theme-toggle" role="group" aria-label="外观主题">
    {options.map(option => <button type="button" key={option.id} aria-label={`${option.label}主题`} title={`${option.label}主题`} aria-pressed={resolved === option.id} onClick={() => setTheme(option.id)}><option.icon size={15} strokeWidth={1.6} /></button>)}
  </div>;
}
