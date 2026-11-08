/** Тема: применяется до отрисовки (внешний файл — совместимо с CSP). Переключатель — кнопки [data-theme-toggle]. */
(function () {
  const root = document.documentElement;
  let saved: string | null = null;
  try { saved = localStorage.getItem('pp:theme'); } catch { /* ignore */ }
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-theme-toggle]'); if (!btn) return;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark'; root.dataset.theme = next;
    try { localStorage.setItem('pp:theme', next); } catch { /* ignore */ }
    window.dispatchEvent(new Event('pp-theme'));
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => window.dispatchEvent(new Event('pp-theme')));
})();
