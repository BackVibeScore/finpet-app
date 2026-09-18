(() => {
  // Shared analytics seam. Web keeps Yandex.Metrika in index.html.
  // Android intentionally stays no-op until AppMetrica is integrated.
  if (!window.FINPET_ANALYTICS) window.FINPET_ANALYTICS = { event() {} };
})();
