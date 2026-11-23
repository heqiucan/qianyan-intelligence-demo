// Run before the app and its styles load to avoid flashing the wrong theme.
(() => {
  let preference = 'light';
  try {
    const saved = localStorage.getItem('workspace-theme');
    if (['light', 'dark', 'system'].includes(saved)) preference = saved;
  } catch { /* Storage can be unavailable in private or restricted contexts. */ }
  const theme = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f7f8fc' : '#111015';
})();
