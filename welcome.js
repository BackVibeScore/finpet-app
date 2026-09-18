(() => {
  const STORAGE_KEY = 'finpet_mvp_state_v1';
  const SPLASH_ART = 'assets/kopihvost-splash.webp';
  let welcomeDismissed = false;
  const preloaded = new Set();

  const introCopy = [
    {
      title: 'Это твой новый друг',
      text: 'Заботься о питомце, играй и наблюдай, как он растёт вместе с тобой.',
      art: 'assets/onboarding-1.webp',
      button: 'Дальше'
    },
    {
      title: 'Монеты помогают заботиться',
      text: 'Зарабатывай монеты, трать их с умом и выбирай, что важно прямо сейчас.',
      art: 'assets/onboarding-2.webp',
      button: 'Дальше'
    },
    {
      title: 'Копи на большие цели',
      text: 'Не всё сразу: откладывай монеты, открывай новое и шаг за шагом приближайся к мечте.',
      art: 'assets/onboarding-3.webp',
      button: 'Дальше'
    },
    {
      title: 'Каждое решение меняет мир',
      text: 'Покупки, накопления и забота о питомце меняют комнату, настроение и открывают новые возможности.',
      art: 'assets/onboarding-4.webp',
      button: 'Выбрать режим'
    }
  ];

  function readState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function isInitialOnboarding() {
    const s = readState();
    return !!s && !s.onboardingDone;
  }

  function shouldShowWelcome() {
    const s = readState();
    return !welcomeDismissed && !!s && !s.onboardingDone && Number(s.onboardingStep || 0) === 0;
  }

  function preloadArt(src) {
    if (!src || preloaded.has(src)) return;
    preloaded.add(src);
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
  }

  function preloadIntro() {
    preloadArt(SPLASH_ART);
    introCopy.forEach(item => preloadArt(item.art));
  }

  function artMarkup(src, alt = '') {
    return `
      <div class="premium-art-backdrop" aria-hidden="true"><img src="${src}" alt=""></div>
      <div class="premium-art-safe">
        <div class="premium-art-frame">
          <img class="premium-art-image" src="${src}" alt="${alt}" loading="eager" decoding="async">
        </div>
      </div>`;
  }

  function mountWelcome() {
    if (!shouldShowWelcome() || document.querySelector('[data-welcome-gate]') || document.querySelector('.splash')) return;
    preloadIntro();
    const gate = document.createElement('section');
    gate.className = 'welcome-gate premium-welcome premium-art-screen';
    gate.dataset.welcomeGate = '1';
    gate.innerHTML = `${artMarkup(SPLASH_ART, 'КопиХвост. Нажмите для продолжения')}
      <button class="welcome-tap-surface" type="button" data-welcome-start aria-label="Нажмите для продолжения"></button>`;
    document.body.appendChild(gate);

    const close = () => {
      welcomeDismissed = true;
      gate.classList.add('is-leaving');
      window.setTimeout(() => gate.remove(), 280);
    };

    gate.querySelector('[data-welcome-start]')?.addEventListener('click', close);
  }

  function currentIntroStep(root) {
    const dots = [...root.querySelectorAll('.dots i')];
    const active = dots.findIndex(dot => dot.classList.contains('active'));
    return Math.max(0, active);
  }

  function addSwipe(root, nextButton) {
    if (root.dataset.swipeReady === '1') return;
    root.dataset.swipeReady = '1';
    let startX = null;
    root.addEventListener('touchstart', event => {
      startX = event.changedTouches?.[0]?.clientX ?? null;
    }, { passive: true });
    root.addEventListener('touchend', event => {
      if (startX == null) return;
      const endX = event.changedTouches?.[0]?.clientX ?? startX;
      if (startX - endX > 54) nextButton?.click();
      startX = null;
    }, { passive: true });
  }

  function enhanceIntro() {
    const root = document.querySelector('.intro-onboarding');
    if (!root || !isInitialOnboarding() || root.dataset.premiumReady === '1') return;

    const step = currentIntroStep(root);
    const view = introCopy[step] || introCopy[0];
    const main = root.querySelector('.onboard-main');
    const next = root.querySelector('[data-onboard-next]');
    const originalSkip = root.querySelector('[data-intro-skip]');
    if (!main || !next) return;

    preloadIntro();
    root.dataset.premiumReady = '1';
    root.dataset.introStep = String(step);
    root.classList.add('premium-intro', 'premium-art-screen');
    next.textContent = view.button;
    next.setAttribute('aria-label', view.button);

    main.innerHTML = `
      <div class="premium-art-backdrop" aria-hidden="true"><img src="${view.art}" alt=""></div>
      <div class="premium-art-safe">
        <div class="premium-art-frame premium-intro-frame">
          <img class="premium-art-image" src="${view.art}" alt="" loading="eager" decoding="async">
          <div class="premium-a11y-copy sr-only">
            <h1>${view.title}</h1>
            <p>${view.text}</p>
            <span>Экран ${step + 1} из ${introCopy.length}</span>
          </div>
          <button class="premium-hotspot premium-hotspot-skip" type="button" aria-label="Пропустить знакомство"></button>
          <div class="premium-next-slot"></div>
        </div>
      </div>`;

    main.querySelector('.premium-next-slot')?.appendChild(next);
    main.querySelector('.premium-hotspot-skip')?.addEventListener('click', () => originalSkip?.click());
    addSwipe(root, next);
  }

  function tuneSplash() {
    const splash = document.querySelector('.splash');
    if (!splash || splash.dataset.premiumReady === '1') return;
    preloadIntro();
    splash.dataset.premiumReady = '1';
    splash.classList.add('premium-splash', 'premium-art-screen');
    splash.innerHTML = artMarkup(SPLASH_ART, 'КопиХвост');
  }

  function refresh() {
    tuneSplash();
    enhanceIntro();
    if (!document.querySelector('.splash')) mountWelcome();
  }

  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refresh();
})();
