export default function WorkspaceTabs({ label, selected, items, go }: {
  label: string; selected: string; items: { id: string; label: string; route: string }[]; go: (route: string) => void;
}) {
  return <nav className="workspace-tabs" aria-label={label}>{items.map(item => <button type="button" key={item.id} aria-current={item.id === selected ? 'page' : undefined} aria-pressed={item.id === selected} onClick={() => go(item.route)}>{item.label}</button>)}</nav>;
}
