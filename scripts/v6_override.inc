  // ===== V6 DIFFICULTY, MOTION, CHILD UX AND PARENT GATE OVERRIDES =====
  let parentPuzzleState = null;
  let parentGateMessage = '';

  function difficultyLabel(mode=state.difficultyMode){ return mode==='medium'?'Средний':'Лёгкий'; }
  function modeAges(s=state){ return s.difficultyMode==='medium'?['12-14','15-17']:['7-11']; }
  function syncModeCompatibility(s=state){ s.ageGroup=s.difficultyMode==='medium'?'12-14':s.difficultyMode==='easy'?'7-11':null; return s.ageGroup; }
  function modeIncludes(list,s=state){ const arr=Array.isArray(list)?list:[]; return !arr.length || modeAges(s).some(a=>arr.includes(a)); }
  function setDifficulty(mode,{initial=false}={}){
    if(!['easy','medium'].includes(mode)) return false;
    const previous=state.difficultyMode||null;
    state.difficultyMode=mode; syncModeCompatibility(state); state.ageMigrationPending=false;
    state.currentChainId=null; state.currentEventId=selectEventId(state,true);
    track(previous&&previous!==mode?'difficulty_changed':'difficulty_selected',{difficultyMode:mode,previousDifficulty:previous,initial:!!initial});
    save(); return true;
  }

  function track(name,props={}){
    state.analytics.push({id:uid(),name,timestamp:Date.now(),week:state.wallet.week,day:state.wallet.day,difficultyMode:state.difficultyMode||null,...props});
    state.analytics=state.analytics.slice(-500);
    if(name==='income_received'&&props.amount) showMotionFeedback('+'+fmt(props.amount),'income');
    else if(name==='expense_completed'&&props.amount) showMotionFeedback('−'+fmt(props.amount),'expense');
    else if(name==='savings_deposit'&&props.amount) showMotionFeedback('+'+fmt(props.amount)+' в копилку','saving');
    else if(name==='goal_completed') showMotionFeedback('Цель достигнута','goal');
  }

  function motionEnabled(){
    const systemReduce=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return state.settings?.motion!==false&&!systemReduce;
  }
  function syncMotionPreference(){
    const root=document?.documentElement; if(!root) return;
    root.dataset.motion=motionEnabled()?'on':'off';
    if(motionEnabled()&&document.querySelectorAll){
      document.querySelectorAll('.pet-svg').forEach((svg,i)=>svg.style?.setProperty?.('--blink-delay',((i*1.3+3+Math.random()*4).toFixed(1))+'s'));
    }
  }
  function showMotionFeedback(text,kind='neutral'){
    if(!motionEnabled()||!document?.createElement||!document?.body?.appendChild) return;
    const el=document.createElement('div'); el.className='motion-feedback '+kind; el.textContent=text; document.body.appendChild(el);
    setTimeout(()=>el.remove?.(),900);
  }

  function ageTaskList(){ return C.tasks.filter(t=>modeIncludes(t.age)); }
  function eventPoolFor(s=state){ return C.events.filter(e=>modeIncludes(e.age,s)); }
  function ageModeClass(){ return `mode-${state.difficultyMode||'easy'}`; }
  function petStage(){
    const lvl=petLevel();
    if(state.difficultyMode==='easy') return ['Малыш','Подрос','Любопытный','Уверенный','Особый облик'][lvl-1];
    return ['Новичок','Освоился','Исследователь','Уверенный','Особый этап'][lvl-1];
  }
  function goalView(g=activeGoal()){
    if(!g) return null;
    const preferred=state.difficultyMode==='easy'?'7-11':'12-14';
    const fallback=state.difficultyMode==='easy'?'7-11':'15-17';
    const v=C.goalPresentation?.[preferred]?.[g.id]||C.goalPresentation?.[fallback]?.[g.id]||{};
    return {...g,...v};
  }
  function petThought(){
    const ages=modeAges(),list=ages.flatMap(a=>C.petThoughts?.[a]||[]);
    if(!list.length||(state.wallet.week+state.wallet.day)%3!==0) return '';
    return list[(state.wallet.week*2+state.wallet.day)%list.length];
  }
  function ensureStoryChainsFor(s=state,shouldTrack=false){
    s.storyChains||={}; const stage=s===state?desiredWorldStage(s):(s.worldProgress?.stage||1),ages=modeAges(s);
    for(const chain of C.eventChains||[]){
      if(!chain.ageGroup.some(a=>ages.includes(a))||stage<chain.unlockStage) continue;
      if(!s.storyChains[chain.id]){s.storyChains[chain.id]={startedWeek:s.wallet.week,stageIndex:0,completed:false,lastShownWeek:null};if(shouldTrack&&s===state)track('story_chain_started',{chainId:chain.id});}
    }
  }
  function applyGoalUnlock(goalId){
    const ageKeys=state.difficultyMode==='easy'?['7-11']:['12-14','15-17'];
    let u=null; for(const key of ageKeys){u=C.goalUnlocksByAge?.[key]?.[goalId]||u;} u=u||C.goalUnlocks?.[goalId]; if(!u)return[];
    const changes=[]; state.worldProgress=state.worldProgress||{stage:1,areas:['home'],unlocks:[],decor:[]};state.worldProgress.areas||=['home'];state.worldProgress.unlocks||=[];state.worldProgress.decor||=[];
    if(u.area&&!state.worldProgress.areas.includes(u.area)){state.worldProgress.areas.push(u.area);changes.push(u.message||`Открыто: ${u.area}`);track('world_area_unlocked',{areaId:u.area,reason:'goal',goalId});}
    if(u.worldDecor&&!state.worldProgress.decor.includes(u.worldDecor)){state.worldProgress.decor.push(u.worldDecor);changes.push(u.message||'Мир изменился.');track('world_item_unlocked',{decorId:u.worldDecor,reason:'goal',goalId});}
    if(!state.worldProgress.unlocks.includes(`goal:${goalId}`))state.worldProgress.unlocks.push(`goal:${goalId}`);return[...new Set(changes)];
  }
  function availableWorkActivities(){
    if(state.difficultyMode!=='medium') return [];
    const stage=state.worldProgress?.stage||1,ages=modeAges();
    return (C.workActivities||[]).filter(a=>a.ageGroup.some(age=>ages.includes(age))&&stage>=Number(a.unlockCondition?.worldStage||1));
  }

  function render(){
    syncMotionPreference();
    if(showingSplash){app.innerHTML=`<section class="splash"><div><div class="splash-mark">${petSVG('mumo','#7C8CF8','badge')}</div><h1>ФинПитомец</h1><p>Игра. Выбор. Свой мир.</p></div></section>`;syncMotionPreference();return;}
    if(introReplay){renderIntroReplay();syncMotionPreference();return;}
    if(!state.onboardingDone){renderOnboarding();syncMotionPreference();return;}
    if(state.ageMigrationPending){renderAgeMigration();syncMotionPreference();return;}
    recalculateWorldProgress();ensureStoryChainsFor(state,true);
    app.innerHTML=`<main class="app-shell ${ageModeClass()}">${renderScreen()}${renderNav()}</main>${modal?renderModal():''}`;
    bindCommon();syncMotionPreference();
  }

  function renderOnboarding(){
    const slides=C.introSlides||[],step=Math.max(0,Number(state.onboardingStep||0));
    if(step<slides.length){
      if(!state.analytics.some(x=>x.name==='intro_started'&&!x.replay)){track('intro_started',{replay:false});save();}
      const slide=slides[step];
      app.innerHTML=`<section class="onboarding intro-onboarding"><header class="onboard-header"><div class="brand">ФинПитомец</div><button class="skip-link" data-intro-skip>Пропустить</button></header><div class="onboard-main"><div class="onboard-visual">${learningArtwork(slide.art)}</div><div class="dots" aria-label="Экран ${step+1} из ${slides.length}">${slides.map((_,i)=>`<i class="${i===step?'active':''}"></i>`).join('')}</div><h1>${esc(slide.title)}</h1><p>${esc(slide.text)}</p></div><button class="btn primary block" data-onboard-next>${step===slides.length-1?'Выбрать режим':'Дальше'}</button></section>`;
      app.querySelector('[data-intro-skip]').onclick=skipInitialIntro;app.querySelector('[data-onboard-next]').onclick=advanceInitialIntro;return;
    }
    if(step===slides.length){
      const modes=[['easy','Лёгкий','Меньше текста, проще ситуации и больше подсказок.'],['medium','Средний','Больше самостоятельных решений и сложнее финансовые ситуации.']];
      app.innerHTML=`<section class="onboarding difficulty-onboarding"><header class="onboard-header"><div class="brand">ФинПитомец</div></header><div class="onboard-main age-select-main"><div><div class="eyebrow">Шаг 1 из 2</div><h1>Как будем играть?</h1><p>Режим можно изменить позже в настройках.</p></div><div class="age-grid difficulty-grid">${modes.map(m=>`<button class="select-card ${state.difficultyMode===m[0]?'active':''}" data-difficulty="${m[0]}"><h3>${m[1]}</h3><p>${m[2]}</p></button>`).join('')}</div></div><button class="btn primary block" data-difficulty-next ${!state.difficultyMode?'disabled':''}>Создать питомца</button></section>`;
      app.querySelectorAll('[data-difficulty]').forEach(b=>b.onclick=()=>{setDifficulty(b.dataset.difficulty,{initial:true});render();});
      app.querySelector('[data-difficulty-next]').onclick=()=>{state.onboardingStep=slides.length+1;save();render();};return;
    }
    app.innerHTML=`<section class="onboarding pet-create"><header class="onboard-header"><div class="brand">ФинПитомец</div></header><div class="onboard-main pet-create-main"><div><div class="eyebrow">Шаг 2 из 2</div><h1>Создай друга</h1><p>Выбери питомца, цвет и аксессуар.</p></div><div class="pet-grid">${C.pets.map(p=>`<button class="select-card pet-pick ${state.pet.type===p.id?'active':''}" data-pet="${p.id}">${petSVG(p.id,state.pet.color,state.pet.accessory)}<div><h3>${p.name}</h3><p>${p.desc}</p></div></button>`).join('')}</div><div class="field"><label for="petName">Имя питомца</label><input id="petName" maxlength="14" value="${esc(state.pet.name)}"></div><div class="field"><label>Основной цвет</label><div class="color-row">${C.petColors.map(c=>`<button class="color-dot ${state.pet.color===c?'active':''}" style="background:${c}" data-color="${c}" aria-label="Выбрать цвет ${c}"></button>`).join('')}</div></div><div class="field accessory-field"><label for="accessory">Аксессуар</label><select id="accessory">${C.accessories.map(a=>`<option value="${a.id}" ${state.pet.accessory===a.id?'selected':''}>${a.name}</option>`).join('')}</select></div></div><div class="onboard-actions"><button class="btn primary block" data-start>Получить 1000 монет</button></div></section>`;
    const rememberName=()=>{const input=app.querySelector('#petName');if(input)state.pet.name=(input.value||'Финни').slice(0,14);};
    app.querySelectorAll('[data-pet]').forEach(b=>b.onclick=()=>{rememberName();state.pet.type=b.dataset.pet;save();render();});app.querySelectorAll('[data-color]').forEach(b=>b.onclick=e=>{e.preventDefault();rememberName();state.pet.color=b.dataset.color;save();render();});
    app.querySelector('#accessory').onchange=e=>{rememberName();state.pet.accessory=e.target.value;track('accessory_selected',{accessory:e.target.value,petType:state.pet.type});save();render();};app.querySelector('#petName').oninput=e=>{state.pet.name=e.target.value;save();};
    app.querySelector('[data-start]').onclick=()=>{rememberName();state.pet.name=(state.pet.name||'Финни').trim().slice(0,14)||'Финни';if(!state.difficultyMode)setDifficulty('easy',{initial:true});state.onboardingDone=true;state.onboardingIntroCompleted=true;state.onboardingStep=slides.length+2;tx('income',1000,'Доход','Стартовый недельный бюджет','onboarding');state.currentEventId=selectEventId(state,true);state.weekNeedsPlanning=true;track('pet_created',{type:state.pet.type,difficultyMode:state.difficultyMode,accessory:state.pet.accessory});track('week_started',{week:1,income:1000});save();route='weekStart';render();};
  }

  function renderAgeMigration(){
    app.innerHTML=`<section class="onboarding migration-screen"><header class="onboard-header"><div class="brand">ФинПитомец</div></header><div class="onboard-main"><div class="onboard-visual compact-art">${learningArtwork('help')}</div><div><div class="eyebrow">Режим игры</div><h1>Выбери сложность</h1><p>Монеты, покупки, цели и весь прогресс сохранятся.</p></div><div class="age-grid difficulty-grid"><button class="select-card" data-migrated-difficulty="easy"><h3>Лёгкий</h3><p>Проще ситуации и больше подсказок.</p></button><button class="select-card" data-migrated-difficulty="medium"><h3>Средний</h3><p>Больше самостоятельных решений.</p></button></div></div></section>`;
    app.querySelectorAll('[data-migrated-difficulty]').forEach(b=>b.onclick=()=>{setDifficulty(b.dataset.migratedDifficulty);state.ageMigrationPending=false;state.currentEventId=selectEventId(state,true);save();render();});
  }

  function homeScreen(){
    const g=goalView(),baseGoal=activeGoal(),event=currentEvent(),h=healthText(),task=activeTaskForAge(),easy=state.difficultyMode==='easy',medium=state.difficultyMode==='medium';
    return `<section class="screen home-screen">${topbar('Дом')}${worldSceneHtml()}<div class="pet-status-line"><b>${petStage()}</b><span>${petWellbeing()>=70?'в хорошем состоянии':petWellbeing()>=50?'в норме':'нужно немного внимания'}</span></div><div class="stat-row">${miniStat(easy?'Сыт':'Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,'☻')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat(easy?'Чисто':'Уход',state.pet.care,'✦')}</div>
      <div class="money-strip home-money"><div><span>${easy?'Монеты':'Баланс'}</span><b>${fmt(state.wallet.balance)} ●</b></div><button data-savings><span>В копилке</span><b>${fmt(state.wallet.savings)} ●</b></button><div><span>До дохода</span><b>${state.wallet.nextIncomeIn} дн.</b></div><div><span>${easy?'Хватит?':'Состояние'}</span><b>${h[0]}</b></div></div>
      ${g?`<div class="section-title compact-title"><h2>${easy?'Коплю на':'Текущая цель'}</h2><button data-route="goals">Открыть</button></div><div class="card goal-card compact-card"><div class="goal-icon">${illustration(g.icon,g.name||g.label||g.id)}</div><div><h3>${esc(g.name)}</h3><p>${fmt(goalSaved())} из ${fmt(goalTarget(baseGoal))} · ≈ ${weeksToGoal()} нед.</p><div class="bar green"><i style="width:${progressPct()}%"></i></div></div><div class="goal-progress">${progressPct()}%</div></div>`:`<div class="section-title compact-title"><h2>${easy?'На что будем копить?':'Текущая цель'}</h2></div><button class="btn secondary block" data-route="goals">Выбрать цель</button>`}
      <div class="section-title compact-title"><h2>Активное задание</h2><button data-route="tasks">Все</button></div>${task?`<div class="active-task-card"><div class="active-task-art">${learningArtwork(task.cyberSafety?'help':'needs')}</div><div><span>${taskTypeLabel(task.mechanicType)}</span><h3>${esc(task.title)}</h3><p>Награда +${fmt(task.reward)} ●</p></div><button class="btn secondary" data-open-task="${task.id}">Начать</button></div>`:`<div class="empty-state small-empty">${learningArtwork('savings')}<div><b>Все доступные задания выполнены</b><button class="linkbtn" data-route="tasks">Открыть список</button></div></div>`}
      <div class="section-title compact-title"><h2>${easy?'Что случилось':'Текущая ситуация'}</h2><span class="soft-label">${event?.categoryLabel||'событие'}</span></div>${eventTeaser()}
      <div class="section-title"><h2>Что сделать?</h2></div><div class="quick-actions"><button class="action" data-action="feed"><span class="ico">${illustration('🥣')}</span><b>Покормить</b><small>40 ●</small></button><button class="action" data-action="play"><span class="ico">${illustration('⚽')}</span><b>Поиграть</b><small>80 ●</small></button><button class="action" data-action="care"><span class="ico">${illustration('🫧')}</span><b>Уход</b><small>60 ●</small></button><button class="action" data-route="shop"><span class="ico">${illustration('','shop')}</span><b>Магазин</b><small>выбрать</small></button></div>${medium?`<button class="work-entry" data-route="sidejob"><span class="work-entry-icon">${illustration('◇')}</span><span><b>${state.workSession?'Продолжить смену':'Подработка'}</b><small>${workShiftStatusShort()} · дополнительный доход</small></span><span aria-hidden="true">›</span></button>`:''}${wishHtml()}${worldProgressCard()}<button class="btn primary block end-day" data-new-day>Завершить день ${state.wallet.day}</button></section>`;
  }

  function petScreen(){
    return `<section class="screen">${topbar(state.pet.name,true)}${worldSceneHtml()}<div class="section-title"><h2>Как себя чувствует</h2></div><div class="stat-row">${miniStat('Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,'☻')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat('Уход',state.pet.care,'✦')}</div><div class="section-title"><h2>Забота</h2></div><div class="grid2"><button class="btn secondary" data-action="feed">Покормить · 40</button><button class="btn secondary" data-action="care">Уход · 60</button><button class="btn secondary" data-action="play">Поиграть · 80</button><button class="btn secondary" data-route="shop">Магазин</button></div><div class="section-title"><h2>Что появилось в мире</h2></div><div class="inventory-strip">${state.inventory.length?state.inventory.slice().reverse().map(x=>C.items.find(i=>i.id===x.id)).filter(Boolean).slice(0,16).map(i=>`<div class="inventory-chip">${illustration(i.icon,i.name||i.label||i.id)}<span>${i.name}</span></div>`).join(''):`<div class="need-note">Первые покупки будут видны прямо в пространстве.</div>`}</div></section>`;
  }

  function budgetScreen(){
    state.stats.budgetViews++;recalculateHealth();checkAchievements();save();const reserve=needsReserve(),free=freeMoney(),h=healthText(),plan=planForWeek(),actual=actualsForWeek();
    if(state.difficultyMode==='easy') return `<section class="screen">${topbar('Мои монеты')}<div class="junior-budget"><div class="junior-money-card"><span>Сейчас</span><b>${fmt(state.wallet.balance)} ●</b></div><div class="junior-money-card"><span>Коплю</span><b>${fmt(state.wallet.savings)} ●</b></div><div class="junior-money-card"><span>Нужно оставить</span><b>≈ ${fmt(reserve)} ●</b></div><div class="junior-money-card"><span>До следующей недели</span><b>${state.wallet.nextIncomeIn} дн.</b></div></div><div class="card junior-health"><b>${h[0]}</b><p>${h[1]}</p></div><div class="section-title"><h2>Как разложили</h2><button data-edit-plan>Поменять</button></div>${plan?`<div class="card simple-buckets"><span>Нужно <b>${fmt(plan.necessary)}</b></span><span>Хочу <b>${fmt(plan.wants)}</b></span><span>Коплю <b>${fmt(plan.savings)}</b></span><span>Оставлю <b>${fmt(plan.reserve)}</b></span></div>`:'<div class="need-note">Сначала разложи монеты в начале недели.</div>'}<div class="section-title"><h2>Что происходило</h2></div><div class="card history">${historyHtml()}</div></section>`;
    const obligations=(state.futureObligations||[]).filter(o=>o.dueWeek<=state.wallet.week+2).sort((a,b)=>a.dueWeek-b.dueWeek||a.dueDay-b.dueDay);
    return `<section class="screen">${topbar('Мой бюджет')}<div class="metric-grid"><div class="metric"><div class="label">Баланс</div><div class="value">${fmt(state.wallet.balance)}</div></div><div class="metric"><div class="label">До дохода</div><div class="value">${state.wallet.nextIncomeIn} дн.</div></div><div class="metric"><div class="label">Нужно предусмотреть</div><div class="value money-orange">${fmt(reserve)}</div></div><div class="metric"><div class="label">Свободно сейчас</div><div class="value money-green">${fmt(free)}</div></div></div><div class="section-title"><h2>Состояние бюджета</h2></div><div class="card health-card"><div class="health-dot ${state.financialHealth>=62?'stable':state.financialHealth>=45?'caution':'risk'}"></div><div><h3>${h[0]}</h3><p>${h[1]}</p></div></div>${obligations.length?`<div class="section-title"><h2>Будущие списания</h2></div><div class="card obligation-list">${obligations.slice(0,5).map(o=>`<div><span>${esc(o.description)}</span><b>−${fmt(o.amount)} · нед. ${o.dueWeek}</b></div>`).join('')}</div>`:''}<div class="section-title"><h2>План → факт</h2><button data-edit-plan>Изменить</button></div>${plan?planFactHtml(plan,actual):'<div class="need-note">У этой недели ещё нет плана.</div>'}<div class="section-title"><h2>Копилка</h2><button data-savings>Открыть</button></div><div class="card"><div class="goal-card"><div class="goal-icon">${illustration('🪙')}</div><div><h3>${fmt(state.wallet.savings)} монет</h3><p>${goalView()?`Для цели «${esc(goalView().name)}» · ≈ ${weeksToGoal()} нед.`:'Можно выбрать цель позже'}</p></div></div></div><div class="section-title"><h2>История</h2></div><div class="card history">${historyHtml()}</div></section>`;
  }

  function profileScreen(){
    const ws=worldStageData();return `<section class="screen">${topbar('Профиль')}<div class="card profile-row"><div class="avatar">${petSVG()}</div><div><h3>${esc(state.pet.name)}</h3><p class="subtle">${difficultyLabel()} режим · ${petStage()}</p></div></div><div class="card macro-card"><div class="eyebrow">Мир</div><h3>Этап ${ws.id} · ${ws.title}</h3><p>${ws.note}</p><div class="world-badges">${state.worldProgress.areas.map(a=>`<span>${C.world.areas.find(x=>x.id===a)?.name||a}</span>`).join('')}</div></div><div class="menu"><button data-route="progress">Прогресс мира <span>›</span></button><button data-route="achievements">Достижения <span>${state.achievements.length}/${C.achievements.length} ›</span></button><button data-help>Как всё работает <span>›</span></button><button data-route="adultGate">Для взрослых <span>›</span></button><button data-route="settings">Настройки <span>›</span></button></div></section>`;
  }

  function helpScreen(){
    const topics=(C.helpTopics||[]).filter(t=>modeIncludes(t.ages));const selected=topics.find(t=>t.id===state.helpLastTopic);
    if(selected)return `<section class="screen help-screen">${topbar('Помощь',true)}<div class="help-article-art">${learningArtwork(selected.id==='virus'||selected.id==='links'?'help':'savings')}</div><article class="help-article"><div class="eyebrow">Как всё работает</div><h2>${esc(selected.title)}</h2><p>${esc(selected.text)}</p><div class="help-example"><b>Пример</b><span>${esc(selected.example)}</span></div></article><button class="btn secondary block" data-help-list>К списку тем</button></section>`;
    return `<section class="screen help-screen">${topbar('Как всё работает',true)}<div class="help-hero">${learningArtwork('help')}<div><h2>Короткие подсказки</h2><p>Каждая тема — на один небольшой экран.</p></div></div><div class="help-list">${topics.map(t=>`<button data-help-topic="${t.id}"><span>${esc(t.title)}</span><b>›</b></button>`).join('')}</div><button class="btn secondary block replay-intro" data-replay-intro>Повторить знакомство</button></section>`;
  }

  function settingsScreen(){
    return `<section class="screen settings-screen"><header class="settings-header"><button class="linkbtn" data-back>← Назад</button><h1>Настройки</h1></header><div class="settings-group"><div class="section-title"><h2>Режим игры</h2></div><div class="difficulty-settings"><button class="select-card ${state.difficultyMode==='easy'?'active':''}" data-difficulty-change="easy"><h3>Лёгкий</h3><p>Проще ситуации и больше подсказок.</p></button><button class="select-card ${state.difficultyMode==='medium'?'active':''}" data-difficulty-change="medium"><h3>Средний</h3><p>Больше самостоятельных решений.</p></button></div></div><div class="menu settings-list"><button data-toggle="sound" role="switch" aria-checked="${state.settings.sound}" aria-label="Звуки"><span>Звуки</span><span class="setting-control"><small>${state.settings.sound?'Вкл.':'Выкл.'}</small><span class="switch-track" aria-hidden="true"></span></span></button><button data-toggle="motion" role="switch" aria-checked="${state.settings.motion}" aria-label="Анимация"><span>Анимация</span><span class="setting-control"><small>${state.settings.motion?'Вкл.':'Выкл.'}</small><span class="switch-track" aria-hidden="true"></span></span></button></div><div class="settings-reset"><button class="linkbtn danger" data-reset>Начать заново</button><p class="subtle">Удалить сохранённый прогресс и начать новую игру.</p></div><p class="settings-note">Прогресс сохраняется на этом устройстве.</p>${pageArtwork('settings')}</section>`;
  }

  function createParentPuzzle(){
    const sizes=[56,70,84,100],shapes=['●','■','▲','◆'];
    const items=sizes.map((size,i)=>({id:'shape_'+i,size,shape:shapes[i]}));
    for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
    parentPuzzleState={items,correct:[...items].sort((a,b)=>b.size-a.size).map(x=>x.id),progress:0,attempted:false};return parentPuzzleState;
  }
  function parentPuzzle(){return parentPuzzleState||createParentPuzzle();}
  function chooseParentPuzzle(id){
    const p=parentPuzzle();if(!p.attempted){p.attempted=true;track('parent_gate_attempted',{difficultyMode:state.difficultyMode});}
    if(id!==p.correct[p.progress]){track('parent_gate_failed',{step:p.progress});parentGateMessage='Попробуйте ещё раз.';createParentPuzzle();render();return false;}
    p.progress++;parentGateMessage='';
    if(p.progress>=p.correct.length){adultUnlocked=true;track('parent_gate_completed',{steps:p.correct.length});track('adult_section_opened',{difficultyMode:state.difficultyMode});save();route='adult';parentPuzzleState=null;render();return true;}
    render();return true;
  }
  function lockAdultGate(){adultUnlocked=false;parentPuzzleState=null;parentGateMessage='';}
  function completeAdultHold(){return false;}
  function adultGateScreen(){
    const p=parentPuzzle();return `<section class="screen adult-screen parent-puzzle-screen">${topbar('Для взрослых',true)}<div class="adult-illustration">${learningArtwork('adult')}</div><h2>Проверка для взрослого</h2><p>Нажмите фигуры от самой большой к самой маленькой.</p><div class="parent-puzzle" aria-label="Головоломка для взрослого">${p.items.map(x=>`<button data-parent-puzzle="${x.id}" aria-label="Фигура размер ${x.size}"><span style="font-size:${x.size}px">${x.shape}</span></button>`).join('')}</div><div class="parent-puzzle-progress">${p.correct.map((_,i)=>`<i class="${i<p.progress?'done':''}"></i>`).join('')}</div>${parentGateMessage?`<p class="parent-gate-message" role="status">${parentGateMessage}</p>`:''}<p class="subtle">Это защита от случайного входа, а не пароль.</p></section>`;
  }
  function adultScreen(){
    const g=goalView(),topics=completedLearningTopics(),world=worldStageData();return `<section class="screen adult-screen">${topbar('Для взрослых',true)}<div class="adult-summary"><div>${learningArtwork('adult')}</div><div><div class="eyebrow">Цель приложения</div><h2>Учиться принимать финансовые решения без оценки ребёнка</h2><p>Питомец, недели и цели показывают последствия выбора в безопасной игровой среде.</p></div></div><div class="adult-metrics"><div><span>Режим игры</span><b>${difficultyLabel()}</b></div><div><span>Завершено недель</span><b>${state.weekHistory.length}</b></div><div><span>Выполнено заданий</span><b>${state.completedTasks.length}</b></div><div><span>Мир</span><b>Этап ${world.id}</b></div></div><div class="section-title"><h2>Текущая цель</h2></div><div class="adult-goal"><b>${g?esc(g.name):'Пока не выбрана'}</b><span>${g?`${fmt(state.wallet.savings)} из ${fmt(goalTarget())} монет`:'Ребёнок сможет выбрать её в разделе целей.'}</span></div><div class="section-title"><h2>Пройденные темы</h2></div>${topics.length?`<div class="topic-chips">${topics.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'<div class="empty-state small-empty"><div><b>Темы ещё не завершены</b><span>Они появятся после выполнения игровых заданий.</span></div></div>'}<div class="section-title"><h2>Чему учат механики</h2></div><div class="adult-mechanics">${(C.adultMechanics||[]).map(([n,d])=>`<details><summary>${esc(n)}</summary><p>${esc(d)}</p></details>`).join('')}</div><div class="adult-reset"><button class="linkbtn danger" data-reset>Удалить локальный профиль</button><p>Будут удалены данные только на этом устройстве. Потребуется отдельное подтверждение.</p></div></section>`;
  }

  if(document?.addEventListener&&!window.__finpetV6Events){
    window.__finpetV6Events=true;
    document.addEventListener('click',e=>{
      const puzzle=e.target?.closest?.('[data-parent-puzzle]');if(puzzle){e.preventDefault();chooseParentPuzzle(puzzle.dataset.parentPuzzle);return;}
      const mode=e.target?.closest?.('[data-difficulty-change]');if(mode){e.preventDefault();if(mode.dataset.difficultyChange!==state.difficultyMode){setDifficulty(mode.dataset.difficultyChange);toast(`Режим: ${difficultyLabel()}`);render();}return;}
      const gate=e.target?.closest?.('[data-route="adultGate"]');if(gate){track('parent_gate_opened',{source:'profile'});save();}
    },true);
    document.addEventListener('click',e=>{if(route==='adult'&&e.target?.closest?.('[data-back]'))lockAdultGate();},true);
  }
  // ===== END V6 OVERRIDES =====
