(() => {
  const STORAGE_KEY = 'finpet_mvp_state_v1';
  let welcomeDismissed = false;
  const introCopy = [
    {
      title: 'Это твой мир',
      text: 'Питомец, комната, монеты и первые решения — всё вокруг начнёт меняться из-за твоих действий.',
      art: 'assets/intro-world.svg',
      labelA: 'Твой питомец',
      labelB: 'Твой мир',
      button: 'Покажи дальше'
    },
    {
      title: 'Монет на всё не хватит',
      text: 'Сначала реши, что нужно питомцу. Потом — что хочется сейчас и на что копить.',
      art: 'assets/intro-choice.svg',
      labelA: 'Нужно',
      labelB: 'Хочу / Коплю',
      button: 'Хочу посмотреть'
    },
    {
      title: 'Покупки меняют пространство',
      text: 'Игрушки, мебель и большие цели появляются не только в списке — ты увидишь их рядом с питомцем.',
      art: 'assets/intro-room.svg',
      labelA: 'Было',
      labelB: 'Стало уютнее',
      button: 'Дальше'
    },
    {
      title: 'Каждая неделя открывает новое',
      text: 'Комната, парк, город, события и новые возможности. Посмотрим, каким станет твой мир дальше.',
      art: 'assets/intro-week.svg',
      labelA: 'Дом → парк',
      labelB: 'Новые события',
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
    if (!shouldShowWelcome() || document.querySelector('[data-welcome-gate]')) return;
    const gate = document.createElement('section');
    gate.className = 'welcome-gate';
    gate.dataset.welcomeGate = '1';
    gate.innerHTML = `
      <div class="welcome-shell">
        <div class="welcome-topline">
          <div class="welcome-brand">ФинПитомец</div>
          <button class="welcome-skip" type="button" data-welcome-skip>Пропустить знакомство</button>
        </div>
        <div class="welcome-copy">
          <span class="welcome-kicker">Игра про деньги, выбор и живой мир</span>
          <h1 class="welcome-title">Твой питомец.<br><strong>Твои решения.</strong></h1>
          <p>Копи на мечты, меняй пространство и смотри, как каждое решение отражается на мире вокруг.</p>
        </div>
        <div class="welcome-art-card" aria-hidden="true">
          <img src="assets/welcome-hero.svg" alt="">
          <span class="welcome-float coin">1000 монет</span>
          <span class="welcome-float goal">Большая цель</span>
          <span class="welcome-float world">Мир меняется</span>
          <i class="welcome-spark s1"></i><i class="welcome-spark s2"></i>
        </div>
        <div class="welcome-actions">
          <button class="welcome-start" type="button" data-welcome-start>Начать игру</button>
          <p class="welcome-note">Знакомство займёт меньше минуты — и его можно пропустить.</p>
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

  function enhanceIntro() {
    const root = document.querySelector('.intro-onboarding');
    if (!root || !isInitialOnboarding()) return;
    const step = currentIntroStep(root);
    const view = introCopy[step] || introCopy[0];
    const visual = root.querySelector('.onboard-visual');
    const title = root.querySelector('.onboard-main h1');
    const text = root.querySelector('.onboard-main p');
    const dots = root.querySelector('.dots');
    const next = root.querySelector('[data-onboard-next]');
    if (!visual || !title || !text || !dots || !next) return;

    if (root.dataset.introStep !== String(step)) {
      root.dataset.introStep = String(step);
      title.textContent = view.title;
      text.textContent = view.text;
      next.textContent = view.button;
      visual.innerHTML = `<div class="intro-art-frame"><img src="${view.art}" alt=""><span class="intro-art-label a">${view.labelA}</span><span class="intro-art-label b">${view.labelB}</span></div>`;
      let kicker = root.querySelector('.intro-kicker');
      if (!kicker) {
        dots.insertAdjacentHTML('afterend', `<span class="intro-kicker"></span>`);
        kicker = root.querySelector('.intro-kicker');
      }
      if (kicker) kicker.textContent = `Знакомство · ${step + 1}/${introCopy.length}`;
    }

    addSwipe(root, next);
  }

  function tuneSplash() {
    const splash = document.querySelector('.splash');
    if (!splash || splash.dataset.vivid === '1') return;
    splash.dataset.vivid = '1';
    const p = splash.querySelector('p');
    if (p) p.textContent = 'Игра. Выбор. Свой мир.';
  }

  function refresh() {
    tuneSplash();
    enhanceIntro();
    mountWelcome();
  }

  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refresh();
})();