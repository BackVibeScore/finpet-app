(() => {
  const STORAGE_KEY = 'finpet_mvp_state_v1';
  let welcomeDismissed = false;

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

  function mountWelcome() {
    if (!shouldShowWelcome() || document.querySelector('[data-welcome-gate]') || document.querySelector('.splash')) return;
    const gate = document.createElement('section');
    gate.className = 'welcome-gate premium-welcome';
    gate.dataset.welcomeGate = '1';
    gate.innerHTML = `
      <div class="welcome-shell">
        <div class="welcome-panel">
          <span class="welcome-kicker">Добро пожаловать в КопиХвост</span>
          <h1 class="welcome-title">Твой питомец.<br><strong>Твои деньги.</strong><br>Твои решения.</h1>
          <p class="welcome-description">Зарабатывай, трать, копи на цели и заботься о своём питомце.</p>
          <button class="welcome-start" type="button" data-welcome-start>Начать игру <span aria-hidden="true">›</span></button>
          <button class="welcome-skip" type="button" data-welcome-skip>Пропустить знакомство</button>
        </div>
      </div>`;
    document.body.appendChild(gate);

    const close = (skip = false) => {
      welcomeDismissed = true;
      gate.classList.add('is-leaving');
      window.setTimeout(() => gate.remove(), 330);
      if (skip) {
        const clickSkip = (tries = 0) => {
          const button = document.querySelector('[data-intro-skip]');
          if (button) button.click();
          else if (tries < 12) window.setTimeout(() => clickSkip(tries + 1), 100);
        };
        clickSkip();
      }
    };

    gate.querySelector('[data-welcome-start]')?.addEventListener('click', () => close(false));
    gate.querySelector('[data-welcome-skip]')?.addEventListener('click', () => close(true));
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

  function progressDots(step) {
    return introCopy.map((_, index) => `<i class="${index === step ? 'active' : ''}" aria-hidden="true"></i>`).join('');
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

    root.dataset.premiumReady = '1';
    root.dataset.introStep = String(step);
    root.classList.add('premium-intro');
    next.textContent = view.button;

    main.innerHTML = `
      <div class="premium-intro-hero" aria-hidden="true">
        <img src="${view.art}" alt="">
        <div class="premium-intro-shade"></div>
      </div>
      <div class="premium-intro-card">
        <div class="premium-intro-copy">
          <h1>${view.title}</h1>
          <p>${view.text}</p>
        </div>
        <div class="premium-intro-controls">
          <button class="premium-skip" type="button">Пропустить</button>
          <div class="premium-progress" aria-label="Экран ${step + 1} из ${introCopy.length}">
            <div class="premium-dots">${progressDots(step)}</div>
            <small>${step + 1} из ${introCopy.length}</small>
          </div>
          <div class="premium-next-slot"></div>
        </div>
      </div>`;

    main.querySelector('.premium-next-slot')?.appendChild(next);
    main.querySelector('.premium-skip')?.addEventListener('click', () => originalSkip?.click());
    addSwipe(root, next);
  }

  function tuneSplash() {
    const splash = document.querySelector('.splash');
    if (!splash || splash.dataset.premiumReady === '1') return;
    splash.dataset.premiumReady = '1';
    splash.classList.add('premium-splash');
    const p = splash.querySelector('p');
    if (p) p.textContent = 'Загружаем твой мир…';
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
