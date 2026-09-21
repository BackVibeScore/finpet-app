(() => {
  const STORAGE_KEY = 'finpet_mvp_state_v1';
  const ART_VERSION = '20260918c';
  const art = name => `assets/${name}.webp?v=${ART_VERSION}`;
  const SPLASH_ART = art('kopihvost-splash');
  const ART_RATIO = 941 / 1672;
  let welcomeDismissed = false;
  const preloaded = new Set();

  const introCopy = [
    { title:'Это твой новый друг', text:'Заботься о питомце, играй и наблюдай, как он растёт вместе с тобой.', art:art('onboarding-1'), button:'Дальше' },
    { title:'Монеты помогают заботиться', text:'Получай монеты и решай, что купить сейчас, а что оставить на потом.', art:art('onboarding-2'), button:'Дальше' },
    { title:'Копи на большие цели', text:'Клади монеты в копилку. Так большая покупка становится всё ближе.', art:art('onboarding-3'), button:'Дальше' },
    { title:'Каждое решение меняет мир', text:'Покупки, копилка и забота о питомце меняют комнату, настроение и открывают новое.', art:art('onboarding-4'), button:'Выбрать режим' }
  ];

  function readState(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){return null} }
  function isInitialOnboarding(){ const s=readState(); return !!s && !s.onboardingDone; }
  function shouldShowWelcome(){ const s=readState(); return !welcomeDismissed && !!s && !s.onboardingDone && Number(s.onboardingStep||0)===0; }

  function preloadArt(src){
    if(!src || preloaded.has(src)) return;
    preloaded.add(src);
    const image=new Image();
    image.decoding='async';
    image.src=src;
  }
  function preloadIntro(){ preloadArt(SPLASH_ART); introCopy.forEach(x=>preloadArt(x.art)); }

  function fitArtFrame(frame){
    if(!frame) return;
    const vv=window.visualViewport;
    const vw=Math.max(1,Math.floor(vv?.width||window.innerWidth||document.documentElement.clientWidth||360));
    const vh=Math.max(1,Math.floor(vv?.height||window.innerHeight||document.documentElement.clientHeight||640));
    let w=vw, h=w/ART_RATIO;
    if(h>vh){ h=vh; w=h*ART_RATIO; }
    frame.style.width=`${Math.floor(w)}px`;
    frame.style.height=`${Math.floor(h)}px`;
  }
  function fitAllArtFrames(){ document.querySelectorAll('.premium-art-frame').forEach(fitArtFrame); }

  function artMarkup(src,alt=''){
    return `
      <div class="premium-art-backdrop" aria-hidden="true"><img src="${src}" alt=""></div>
      <div class="premium-art-safe">
        <div class="premium-art-frame">
          <img class="premium-art-image" src="${src}" alt="${alt}" loading="eager" decoding="async">
        </div>
      </div>`;
  }

  function mountWelcome(){
    if(!shouldShowWelcome() || document.querySelector('[data-welcome-gate]') || document.querySelector('.splash')) return;
    preloadIntro();
    const gate=document.createElement('section');
    gate.className='welcome-gate premium-welcome premium-art-screen';
    gate.dataset.welcomeGate='1';
    gate.innerHTML=`${artMarkup(SPLASH_ART,'КопиХвост. Нажмите для продолжения')}
      <button class="welcome-tap-surface" type="button" data-welcome-start aria-label="Нажмите для продолжения"></button>`;
    document.body.appendChild(gate);
    fitAllArtFrames();
    const close=()=>{ welcomeDismissed=true; gate.classList.add('is-leaving'); window.setTimeout(()=>gate.remove(),280); };
    gate.querySelector('[data-welcome-start]')?.addEventListener('click',close);
  }

  function currentIntroStep(root){
    const dots=[...root.querySelectorAll('.dots i')];
    return Math.max(0,dots.findIndex(dot=>dot.classList.contains('active')));
  }

  function addSwipe(root,nextButton){
    if(root.dataset.swipeReady==='1') return;
    root.dataset.swipeReady='1';
    let startX=null;
    root.addEventListener('touchstart',e=>{startX=e.changedTouches?.[0]?.clientX??null},{passive:true});
    root.addEventListener('touchend',e=>{
      if(startX==null) return;
      const endX=e.changedTouches?.[0]?.clientX??startX;
      if(startX-endX>54) nextButton?.click();
      startX=null;
    },{passive:true});
  }

  function enhanceIntro(){
    const root=document.querySelector('.intro-onboarding');
    if(!root || !isInitialOnboarding() || root.dataset.premiumReady==='1') return;
    const step=currentIntroStep(root);
    const view=introCopy[step]||introCopy[0];
    const main=root.querySelector('.onboard-main');
    const next=root.querySelector('[data-onboard-next]');
    const originalSkip=root.querySelector('[data-intro-skip]');
    if(!main || !next) return;

    preloadIntro();
    root.dataset.premiumReady='1';
    root.dataset.introStep=String(step);
    root.classList.add('premium-intro','premium-art-screen');
    next.textContent=view.button;
    next.setAttribute('aria-label',view.button);

    main.innerHTML=`
      <div class="premium-art-backdrop" aria-hidden="true"><img src="${view.art}" alt=""></div>
      <div class="premium-art-safe">
        <div class="premium-art-frame premium-intro-frame">
          <img class="premium-art-image" src="${view.art}" alt="" loading="eager" decoding="async">
          <div class="premium-a11y-copy sr-only"><h1>${view.title}</h1><p>${view.text}</p><span>Экран ${step+1} из ${introCopy.length}</span></div>
          <button class="premium-hotspot premium-hotspot-skip" type="button" aria-label="Пропустить знакомство"></button>
          <div class="premium-next-slot"></div>
        </div>
      </div>`;

    main.querySelector('.premium-next-slot')?.appendChild(next);
    main.querySelector('.premium-hotspot-skip')?.addEventListener('click',()=>originalSkip?.click());
    addSwipe(root,next);
    fitAllArtFrames();
  }

  function tuneSplash(){
    const splash=document.querySelector('.splash');
    if(!splash || splash.dataset.premiumReady==='1') return;
    preloadIntro();
    splash.dataset.premiumReady='1';
    splash.classList.add('premium-splash','premium-art-screen');
    splash.innerHTML=artMarkup(SPLASH_ART,'КопиХвост');
    fitAllArtFrames();
  }

  function refresh(){
    tuneSplash();
    enhanceIntro();
    if(!document.querySelector('.splash')) mountWelcome();
    fitAllArtFrames();
  }

  const observer=new MutationObserver(refresh);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('resize',fitAllArtFrames,{passive:true});
  window.visualViewport?.addEventListener('resize',fitAllArtFrames,{passive:true});
  refresh();
})();