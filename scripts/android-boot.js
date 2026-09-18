(() => {
  const STORAGE_KEY = 'finpet_mvp_state_v1';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.body.appendChild(s);
    });
  }
  (async () => {
    try { await window.FINPET_STORAGE?.ready?.(STORAGE_KEY); }
    catch (err) { console.warn('[KopiHvost boot] native hydration failed, local fallback will be used', err); }
    await loadScript('app.js?v=20260918h');
    await loadScript('welcome.js?v=20260918c');
  })().catch(err => {
    console.error('[KopiHvost boot]', err);
    const app = document.getElementById('app');
    if (app) app.innerHTML = '<main class="screen"><h1>КопиХвост</h1><p>Не удалось запустить приложение. Перезапустите его.</p></main>';
  });
})();
