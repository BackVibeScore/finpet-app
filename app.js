(() => {
  const C = window.FINPET_CONTENT;
  const STORAGE_KEY = 'finpet_mvp_state_v1'; // keep key for backward-compatible migration
  const app = document.getElementById('app');
  let state = migrateState(loadRawState());
  let route = !state.onboardingDone ? 'onboarding' : (state.weekSummary ? 'weekSummary' : (state.weekNeedsPlanning ? 'weekStart' : 'home'));
  let modal = null;
  let taskResult = null;
  let toastTimer = null;
  let petBubble = '';
  let showingSplash = true;
  let editingPlan = false;
  let introReplay = false;
  let introReplayStep = 0;
  let petRenderSeq = 0;
  let adultUnlocked = false;
  let adultHoldTimer = null;
  let adultHoldStartedAt = 0;
  let helpReturnRoute = 'profile';
  setTimeout(() => { showingSplash = false; render(); }, 650);

  function freshState() {
    return {
      version: 2,
      onboardingDone: false,
      onboardingStep: 0,
      ageGroup: null,
      pet: { type: 'cat', name: 'Финни', color: C.petColors[0], accessory: 'none', satiety: 72, mood: 74, energy: 78, care: 76, development: 8 },
      wallet: { balance: 1000, savings: 0, weeklyIncome: 1000, week: 1, day: 1, nextIncomeIn: 7, needsSpent: 0 },
      activeGoal: null,
      goalContributions: 0,
      goalAdjustments: {},
      completedGoals: [],
      inventory: [],
      completedTasks: [],
      achievements: [],
      transactions: [],
      financialHealth: 68,
      xp: 0,
      streak: 1,
      stats: { needsFirst: 0, positiveDecisions: 0, budgetViews: 0, tasksDone: 0, impulsePurchases: 0, reserveUsed: 0, petNeedsIgnored: 0, weeksBalanced: 0 },
      currentEventId: null,
      eventResolved: false,
      recentEventIds: [],
      weekNeedsPlanning: true,
      weekPlan: null,
      weekSnapshot: null,
      weekSummary: null,
      weekHistory: [],
      dayActions: { count: 0, necessary: 0, optional: 0, income: 0, sideJob: false },
      petWish: null,
      wishDismissedDay: null,
      analytics: [],
      nextWeekObligations: [],
      settings: { sound: true, motion: true },
      createdAt: Date.now()
    };
  }

  function loadRawState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { return null; }
  }

  function migrateState(raw) {
    const base = freshState();
    if (!raw) return base;
    const migrated = {
      ...base,
      ...raw,
      version: 2,
      pet: { ...base.pet, ...(raw.pet || {}) },
      wallet: { ...base.wallet, ...(raw.wallet || {}) },
      stats: { ...base.stats, ...(raw.stats || {}) },
      settings: { ...base.settings, ...(raw.settings || {}) },
      dayActions: { ...base.dayActions, ...(raw.dayActions || {}) },
      goalAdjustments: raw.goalAdjustments || {},
      recentEventIds: raw.recentEventIds || [],
      weekHistory: raw.weekHistory || [],
      analytics: raw.analytics || [],
      nextWeekObligations: raw.nextWeekObligations || []
    };
    if ((raw.version || 1) < 2 && raw.onboardingDone) {
      migrated.weekNeedsPlanning = true;
      migrated.weekPlan = null;
      migrated.weekSnapshot = null;
      migrated.weekSummary = null;
      migrated.eventResolved = false;
      migrated.currentEventId = selectEventId(migrated, true);
    }
    if (!migrated.currentEventId) { const pool = eventPoolFor(migrated); migrated.currentEventId = pool.length ? pool[(migrated.wallet.week * 17 + migrated.wallet.day * 7) % pool.length].id : (C.events[0]?.id || null); }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, Number(n) || 0)); }
  function esc(s = '') { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function fmt(n) { return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)); }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`); }

  function track(name, props = {}) {
    state.analytics.push({ id: uid(), name, timestamp: Date.now(), week: state.wallet.week, day: state.wallet.day, ...props });
    state.analytics = state.analytics.slice(-500);
  }

  function tx(type, amount, category, description, source, meta = {}) {
    state.transactions.unshift({
      id: uid(), type, amount, category, timestamp: Date.now(), description, source,
      week: state.wallet.week, day: state.wallet.day, balanceAfter: state.wallet.balance, meta
    });
    state.transactions = state.transactions.slice(0, 180);
  }

  function earn(amount, description, source = 'reward', meta = {}) {
    state.wallet.balance += amount;
    const workIncome = ['side_job','work_shift'].includes(source);
    tx(source === 'weekly_income' || workIncome ? 'income' : 'reward', amount, workIncome ? 'Подработка' : 'Доход', description, source, meta);
    state.dayActions.count++;
    state.dayActions.income += amount;
    track('income_received', { amount, source });
    recalculateHealth();
    checkAchievements();
    save();
  }

  function spend(amount, category, description, source = 'shop', meta = {}) {
    amount = Number(amount) || 0;
    if (state.wallet.balance < amount) { toast('Монет пока не хватает'); return false; }
    const beforeFree = freeMoney();
    state.wallet.balance -= amount;
    tx('expense', -amount, category, description, source, meta);
    state.dayActions.count++;
    if (category === 'Необходимые расходы') state.dayActions.necessary += amount;
    else state.dayActions.optional += amount;
    if (beforeFree > 0 && freeMoney() <= 0) { state.stats.reserveUsed++; track('reserve_used', { amount, source }); }
    track('expense_completed', { amount, category, source });
    track(category === 'Необходимые расходы' ? 'necessary_expense_completed' : 'optional_expense_completed', { amount, source });
    recalculateHealth();
    save();
    return true;
  }

  function adjustPet(effect = {}) {
    for (const k of ['satiety', 'mood', 'energy', 'care', 'development']) {
      if (effect[k] != null) state.pet[k] = clamp(state.pet[k] + effect[k]);
    }
    checkAchievements();
    save();
  }

  function toast(text) {
    document.querySelector('.toast')?.remove();
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = text; document.body.appendChild(d);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => d.remove(), 2400);
  }

  function iconForTx(t) {
    if (t.type === 'income' || t.type === 'reward') return '＋';
    if (t.type === 'saving') return '🐷';
    if (t.type === 'saving_withdrawal') return '↩';
    return '−';
  }

  function planForWeek() { return state.weekPlan && state.weekPlan.week === state.wallet.week ? state.weekPlan : null; }
  function planningBudget() {
    const snap = state.weekSnapshot && state.weekSnapshot.week === state.wallet.week ? state.weekSnapshot : null;
    return snap ? Math.max(state.wallet.balance, snap.startingBalance + actualsForWeek().extraIncome) : state.wallet.balance;
  }
  function actualsForWeek(week = state.wallet.week) {
    const items = state.transactions.filter(t => t.week === week);
    let necessary = 0, wants = 0, savings = 0, extraIncome = 0, sideJobIncome = 0;
    items.forEach(t => {
      if (t.type === 'expense') {
        if (t.category === 'Необходимые расходы') necessary += -t.amount;
        else wants += -t.amount;
      } else if (t.type === 'saving') savings += -t.amount;
      else if (t.type === 'saving_withdrawal') savings -= t.amount;
      else if ((t.type === 'income' || t.type === 'reward') && !['weekly_income', 'onboarding'].includes(t.source)) { extraIncome += t.amount; if (['side_job','work_shift'].includes(t.source)) sideJobIncome += t.amount; }
    });
    return { necessary, wants, savings: Math.max(0, savings), extraIncome, sideJobIncome };
  }

  function expectedNeedsTotal() {
    const base = C.economy?.weeklyNeeds || 400;
    return state.ageGroup === '15-17' ? Math.round(base * 1.05) : base;
  }

  function needsReserve() {
    const base = expectedNeedsTotal();
    const actual = actualsForWeek().necessary;
    return Math.max(0, base - actual);
  }

  function freeMoney(balance = state.wallet.balance) { return Math.max(0, balance - needsReserve()); }
  function petWellbeing() { return Math.round((state.pet.satiety + state.pet.mood + state.pet.energy + state.pet.care) / 4); }
  function petLevel() { return Math.min(5, Math.max(1, Math.floor(state.pet.development / 20) + 1)); }
  function petStage() { return ['Малыш', 'Подросший', 'Взрослый', 'Уверенный', 'Финальный облик'][petLevel() - 1]; }
  function ageTaskList() { return C.tasks.filter(t => !state.ageGroup || (t.age || []).includes(state.ageGroup)); }
  function activeGoal() { return C.goals.find(g => g.id === state.activeGoal); }
  function goalTarget(g = activeGoal()) { return g ? Math.max(1, g.target + (state.goalAdjustments[g.id] || 0)) : 0; }
  function goalSaved() { return state.wallet.savings; }
  function progressPct() { const g = activeGoal(); return g ? Math.min(100, Math.round(goalSaved() / goalTarget(g) * 100)) : 0; }
  function savingsTempo() {
    const plan = planForWeek();
    if (plan?.savings > 0) return plan.savings;
    const hist = state.weekHistory.slice(-3).map(x => x.actual?.savings || 0).filter(Boolean);
    return hist.length ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length) : 200;
  }
  function weeksToGoal(additionalGap = 0) {
    const g = activeGoal(); if (!g) return null;
    const remain = Math.max(0, goalTarget(g) - state.wallet.savings + additionalGap);
    if (!remain) return 0;
    return Math.max(1, Math.ceil(remain / Math.max(50, savingsTempo())));
  }

  function purchaseGoalDelay(price) {
    if (!activeGoal()) return 0;
    const plan = planForWeek(); if (!plan || plan.savings <= 0) return 0;
    const actual = actualsForWeek();
    const remainingPlannedSaving = Math.max(0, plan.savings - actual.savings);
    if (!remainingPlannedSaving) return 0;
    const after = state.wallet.balance - price;
    const canStillSave = Math.max(0, after - needsReserve() - Math.max(0, plan.reserve || 0));
    const shortfall = Math.max(0, remainingPlannedSaving - canStillSave);
    return shortfall > 0 ? Math.max(1, Math.ceil(shortfall / Math.max(50, savingsTempo()))) : 0;
  }

  function recalculateHealth() {
    const plan = planForWeek();
    const actual = actualsForWeek();
    let score = 55;
    if (plan) score += 7;
    const reserveTarget = Math.max(100, plan?.reserve || 150);
    if (state.wallet.balance >= needsReserve() + reserveTarget) score += 14;
    else if (state.wallet.balance < needsReserve()) score -= 18;
    else score += 3;
    if (state.wallet.savings >= 100) score += 8;
    if (plan?.savings > 0 && actual.savings >= plan.savings * 0.75) score += 8;
    if (plan?.wants >= 0 && actual.wants > plan.wants * 1.35 + 50) score -= 8;
    score -= Math.min(10, state.stats.impulsePurchases * 2);
    score -= Math.min(6, state.stats.reserveUsed * 2);
    state.financialHealth = clamp(score);
    return state.financialHealth;
  }

  function healthText() {
    const s = recalculateHealth();
    if (s >= 80) return ['Хороший запас', 'Есть резерв и пространство для решений.'];
    if (s >= 62) return ['Стабильно', 'Бюджет пока выдерживает текущий темп.'];
    if (s >= 45) return ['Мало свободных средств', 'Следующие траты лучше сверять с планом.'];
    return ['Есть риск', 'Запаса мало: неожиданная трата может изменить планы.'];
  }

  function eventPoolFor(s = state) {
    const age = s.ageGroup || '7-11';
    return C.events.filter(e => !e.age || e.age.includes(age));
  }
  function selectEventId(s = state, ignoreRecent = false) {
    const pool = eventPoolFor(s);
    if (!pool.length) return C.events[0]?.id || null;
    const recent = ignoreRecent ? [] : (s.recentEventIds || []).slice(-4);
    const eligible = pool.filter(e => !recent.includes(e.id));
    const list = eligible.length ? eligible : pool;
    const seed = (s.wallet.week * 17 + s.wallet.day * 7 + (s.ageGroup || '').length) % list.length;
    return list[seed].id;
  }

  function unlock(id, silent = false) {
    if (!state.achievements.includes(id)) {
      state.achievements.push(id);
      save();
      const a = C.achievements.find(x => x.id === id);
      if (a && !silent) toast(`Достижение: ${a.name}`);
    }
  }

  function checkAchievements() {
    const plan = planForWeek(), actual = actualsForWeek();
    if (state.wallet.savings >= 100) unlock('first_saving');
    if (state.goalContributions >= 3) unlock('patience');
    if (state.stats.positiveDecisions >= 3) unlock('planner');
    if (state.completedGoals.length >= 1) unlock('strategist');
    if (state.stats.needsFirst >= 3) unlock('needs');
    if (state.stats.budgetViews >= 1 && state.wallet.balance >= needsReserve()) unlock('budget_master');
    if (state.stats.tasksDone >= 1) unlock('first_task');
    if (['satiety', 'mood', 'energy', 'care'].every(k => state.pet[k] >= 55)) unlock('care_balance');
    if (state.wallet.week >= 2 || state.weekHistory.length >= 1) unlock('week');
    if (plan && actual.wants <= plan.wants * 1.2 + 20 && actual.savings >= plan.savings * 0.8 && petWellbeing() >= 55) unlock('planner', true);
  }


  // Presentation assets only. IDs and amounts remain in the existing content/state.
  function illustration(symbol, label='') {
    const names={'shop':3,'food_basic':0,'food_snack':25,'food_treat':36,'care_wash':2,'care_brush':2,'care_spa':2,'game_ball':1,'game_puzzle':37,'game_skate':38,'wear_hoodie':39,'wear_cap':20,'wear_sneakers':19,'interior_lamp':12,'interior_plant':13,'interior_poster':14,'interior_sofa':15,'special_ticket':11,'special_camera':17,'special_bike':16,'special_console':18,'Наушники':8,'Смартфон':9,'Компьютер':10,'Собственный проект':4,'Худи':39,'Лампа':12,'Кеды':19,'Растение':13,'Кабель':40,'Чехол для телефона':41,'Плед':28};
    const symbols={'🥣':0,'🍎':25,'🧁':36,'🫧':2,'🧴':2,'🛁':2,'⚽':1,'🧩':37,'🛹':38,'🧥':39,'🧢':20,'👟':19,'💡':12,'🪴':13,'🖼️':14,'🛋️':15,'🎟️':11,'📷':17,'🚲':16,'🎮':18,'🏠':5,'🗺️':43,'🪟':14,'🎧':8,'♪':11,'▣':9,'▤':10,'◇':4,'🌳':30,'🏙️':31,'🎁':29,'📚':22,'📖':22,'🏆':42,'💰':7,'🪙':6,'⚡':44,'☻':32,'◡':32,'✦':2,'profile':35};
    const n=names[label]??symbols[symbol]??33, grid=n>=36?3:6, cell=n>=36?n-36:n;
    return `<span class="art ${n>=36?'art-extra':''}" style="--ax:${(cell%grid)*100/(grid-1)}%;--ay:${Math.floor(cell/grid)*100/(grid-1)}%" aria-hidden="true"></span>`;
  }
  function petSVG(type = state.pet.type, color = state.pet.color, accessory = state.pet.accessory) {
    const face = type === 'dog' ? `
      <path d="M48 75 C32 52 31 31 48 28 C58 27 66 39 70 51" fill="#71564b"/><path d="M152 75 C168 52 169 31 152 28 C142 27 134 39 130 51" fill="#71564b"/>`
      : type === 'cat' ? `<path d="M49 62 L53 25 L78 52 Z" fill="${color}"/><path d="M151 62 L147 25 L122 52 Z" fill="${color}"/>`
      : `<path d="M58 54 C42 35 47 22 59 31 L76 52 Z" fill="${color}"/><path d="M142 54 C158 35 153 22 141 31 L124 52 Z" fill="${color}"/>`;
    const extra = type === 'mumo' ? `<circle cx="100" cy="52" r="10" fill="#fff" opacity=".85"/><circle cx="100" cy="52" r="4" fill="#26314c"/>` : '';
    const acc = accessory === 'cap' ? `<path d="M62 50 Q100 28 138 50 L130 61 H67 Z" fill="#26314c"/><path d="M127 56 Q153 56 158 66 Q139 67 124 64Z" fill="#26314c"/>`
      : accessory === 'scarf' ? `<path d="M57 137 Q100 151 143 137 L139 153 Q101 165 61 151Z" fill="#f0a45e"/><path d="M119 149 L136 181 L119 184 L108 154Z" fill="#f0a45e"/>`
      : accessory === 'badge' ? `<circle cx="135" cy="139" r="10" fill="#ffd96f"/><path d="M135 133 l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z" fill="#8a6200"/>` : '';
    return `<svg class="pet-svg" viewBox="0 0 200 200" aria-label="Питомец ${esc(state.pet.name)}" role="img">
      <ellipse cx="100" cy="177" rx="61" ry="13" fill="#7c88aa" opacity=".16"/>${face}
      <path d="M45 102 C45 65 67 48 100 48 C133 48 155 65 155 102 L151 135 C147 163 129 176 100 176 C71 176 53 163 49 135 Z" fill="${color}"/>${extra}
      <ellipse cx="77" cy="98" rx="8" ry="10" fill="#26314c"/><ellipse cx="123" cy="98" rx="8" ry="10" fill="#26314c"/>
      <circle cx="74" cy="94" r="2.5" fill="#fff"/><circle cx="120" cy="94" r="2.5" fill="#fff"/>
      <path d="M91 116 Q100 124 109 116" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/>
      <ellipse cx="61" cy="116" rx="10" ry="5" fill="#fff" opacity=".14"/><ellipse cx="139" cy="116" rx="10" ry="5" fill="#fff" opacity=".14"/>${acc}
    </svg>`;
  }

  function render() {
    if (showingSplash) {
      app.innerHTML = `<section class="splash"><div><div class="splash-mark">${petSVG('mumo', '#7C8CF8', 'badge')}</div><h1>КопиХвост</h1><p>Твои деньги. Твои решения.</p></div></section>`;
      return;
    }
    if (!state.onboardingDone) { renderOnboarding(); return; }
    app.innerHTML = `<main class="app-shell">${renderScreen()}${renderNav()}</main>${modal ? renderModal() : ''}`;
    bindCommon();
  }

  function renderNav() {
    if (['weekStart', 'weekSummary'].includes(route)) return '';
    const nav = [['home', '⌂', 'Дом'], ['tasks', '◫', 'Задания'], ['budget', '◒', 'Бюджет'], ['goals', '◎', 'Цели'], ['profile', '○', 'Профиль']];
    return `<nav class="nav" aria-label="Основная навигация">${nav.map(([r, i, l]) => `<button data-route="${r}" class="${route === r ? 'active' : ''}" ${route === r ? 'aria-current="page"' : ''}>${illustration(({home:'🏠',tasks:'📖',budget:'💰',goals:'🪙',profile:'profile'})[r])}${l}</button>`).join('')}</nav>`;
  }

  function renderScreen() {
    if (route === 'weekStart') return weekStartScreen();
    if (route === 'weekSummary') return weekSummaryScreen();
    if (route === 'home') return homeScreen();
    if (route === 'tasks') return tasksScreen();
    if (route === 'budget') return budgetScreen();
    if (route === 'goals') return goalsScreen();
    if (route === 'profile') return profileScreen();
    if (route === 'shop') return shopScreen();
    if (route === 'pet') return petScreen();
    if (route === 'savings') return savingsScreen();
    if (route === 'task') return taskScreen();
    if (route === 'sidejob') return sideJobScreen();
    if (route === 'progress') return progressScreen();
    if (route === 'achievements') return achievementsScreen();
    if (route === 'settings') return settingsScreen();
    return homeScreen();
  }

  function topbar(title, back = false) {
    return `<div class="topbar"><div>${back ? `<button class="linkbtn" data-back>← Назад</button>` : ''}<div class="eyebrow">Неделя ${state.wallet.week} · день ${state.wallet.day}</div><h1>${title}</h1></div><div class="balance-pill"><span class="coin">●</span>${fmt(state.wallet.balance)}</div></div>`;
  }

  function weekStartScreen() {
    const existing = planForWeek();
    const availableNow = state.wallet.balance;
    const available = planningBudget();
    const needs = existing?.necessary ?? expectedNeedsTotal();
    const wants = existing?.wants ?? Math.min(200, Math.max(0, available - needs));
    const savings = existing?.savings ?? Math.min(200, Math.max(0, available - needs - wants));
    const reserve = existing?.reserve ?? Math.max(0, available - needs - wants - savings);
    const g = activeGoal();
    return `<section class="screen week-screen">
      <div class="week-kicker">${editingPlan ? 'План недели' : 'Новая неделя'}</div>
      <h1>${editingPlan ? 'Можно изменить план' : `Неделя ${state.wallet.week}`}</h1>
      <p class="week-lead">План — не обещание. Он нужен, чтобы потом увидеть, почему реальность получилась другой.</p>
      <div class="card income-card"><span>Недельный доход</span><b>+${fmt(state.wallet.weeklyIncome)} ●</b><small>Доступно сейчас: ${fmt(availableNow)} ● · в плане распределяется до ${fmt(available)} ●</small></div>
      <div class="week-context">
        <div><span>Примерно необходимое</span><b>≈ ${fmt(expectedNeedsTotal())}</b></div>
        <div><span>Финансовая цель</span><b>${g ? `${illustration(g.icon,g.name||g.label||g.id)} ${esc(g.name)} · осталось ${fmt(Math.max(0, goalTarget(g) - goalSaved()))}` : 'Пока не выбрана'}</b></div>
      </div>
      <div class="section-title"><h2>Как распределить деньги?</h2></div>
      <div class="plan-form">
        ${planInput('Необходимое', 'planNecessary', needs, 'Еда, уход и базовые расходы')}
        ${planInput('Желания', 'planWants', wants, 'Игры, вещи и развлечения')}
        ${planInput('Копилка', 'planSavings', savings, 'На текущую или будущую цель')}
        ${planInput('Резерв', 'planReserve', reserve, 'Оставить свободными')}
      </div>
      <div class="plan-total" id="planTotal" data-budget="${available}">План: ${fmt(needs + wants + savings + reserve)} из ${fmt(available)}</div>
      <button class="btn primary block" data-save-plan>${editingPlan ? 'Сохранить изменения' : 'Спланировать неделю'}</button>
      ${!g ? `<button class="btn secondary block" style="margin-top:10px" data-route="goals">Сначала выбрать цель</button>` : ''}
    </section>`;
  }

  function planInput(label, id, value, hint) {
    return `<label class="plan-row"><div><b>${label}</b><span>${hint}</span></div><div class="plan-amount"><input id="${id}" type="number" min="0" step="10" value="${Math.max(0, Math.round(value))}" inputmode="numeric"><span>●</span></div></label>`;
  }

  function homeScreen() {
    const g = activeGoal();
    const event = currentEvent();
    const h = healthText();
    return `<section class="screen">
      ${topbar('Дом')}
      <div class="card hero">
        <button class="pet-stage pet-stage-button" aria-label="Открыть состояние питомца" data-route="pet">${petBubble ? `<div class="pet-bubble">${petBubble}</div>` : ''}${petSVG()}${roomItemsHtml()}</button>
        <div class="pet-name">${esc(state.pet.name)}</div>
        <div class="pet-sub">${petStage()} · ${petWellbeing() >= 70 ? 'чувствует себя отлично' : petWellbeing() >= 50 ? 'в норме' : 'нуждается во внимании'}</div>
        <div class="stat-row">${miniStat('Сытость', state.pet.satiety, '🥣')}${miniStat('Настроение', state.pet.mood, '☻')}${miniStat('Энергия', state.pet.energy, '⚡')}${miniStat('Уход', state.pet.care, '✦')}</div>
      </div>
      <div class="money-strip">
        <div><span>Баланс</span><b>${fmt(state.wallet.balance)} ●</b></div>
        <div><span>До дохода</span><b>${state.wallet.nextIncomeIn} дн.</b></div>
        <div><span>Состояние</span><b>${h[0]}</b></div>
      </div>
      ${g ? `<div class="section-title"><h2>Цель</h2><button data-route="goals">Открыть</button></div>
        <div class="card goal-card"><div class="goal-icon">${illustration(g.icon,g.name||g.label||g.id)}</div><div><h3>${g.name}</h3><p>${fmt(goalSaved())} из ${fmt(goalTarget(g))} · ≈ ${weeksToGoal()} нед.</p><div class="bar green"><i style="width:${progressPct()}%"></i></div></div><div class="goal-progress">${progressPct()}%</div></div>` :
        `<div class="section-title"><h2>Финансовая цель</h2></div><button class="btn secondary block" data-route="goals">Выбрать, на что копить</button>`}
      <div class="section-title"><h2>Ситуация дня</h2><span class="soft-label">${event?.categoryLabel || 'решение'}</span></div>
      ${eventTeaser()}
      ${wishHtml()}
      <div class="section-title"><h2>Быстрые действия</h2></div>
      <div class="quick-actions">
        <button class="action" data-action="feed"><span class="ico">🥣</span><b>Покормить</b><small>40 ●</small></button>
        <button class="action" data-action="play"><span class="ico">⚽</span><b>Играть</b><small>80 ●</small></button>
        <button class="action" data-action="care"><span class="ico">🫧</span><b>Уход</b><small>60 ●</small></button>
        <button class="action" data-route="shop"><span class="ico">◫</span><b>Магазин</b><small>выбрать</small></button>
        ${state.ageGroup === '15-17' ? `<button class="action" data-action="sidejob"><span class="ico">🧰</span><b>Подработка</b><small>+150 · −20⚡</small></button>` : ''}
      </div>
      <button class="btn secondary block end-day" data-new-day>Завершить день ${state.wallet.day}</button>
      <p class="subtle center">Игровые дни идут подряд — ждать реальные сутки не нужно.</p>
    </section>`;
  }

  function roomItemsHtml() {
    const seen = new Set();
    const recent = state.inventory.slice().reverse().map(x => C.items.find(i => i.id === x.id)).filter(i => i && (i.cosmetic || ['Интерьер', 'Игры', 'Особое'].includes(i.category))).filter(i => !seen.has(i.id) && seen.add(i.id)).slice(0, 5).reverse();
    if (!recent.length) return '';
    return `<div class="room-items room-items-v2">${recent.map((i, idx) => `<div class="room-item slot-${idx}" title="${esc(i.name)}">${illustration(i.icon,i.name||i.label||i.id)}</div>`).join('')}</div>`;
  }

  function miniStat(label, val, ico) { return `<div class="mini-stat"><b>${Math.round(val)}</b><span>${label}</span><div class="bar"><i style="width:${val}%"></i></div></div>`; }
  function currentEvent() { return C.events.find(x => x.id === state.currentEventId) || eventPoolFor()[0] || C.events[0]; }

  function eventTeaser() {
    if (state.eventResolved) return `<div class="card"><div class="task-teaser"><div class="round-icon">✓</div><div><h3>Решение принято</h3><p>Можно заняться питомцем или завершить игровой день.</p></div></div></div>`;
    const e = currentEvent();
    return `<button class="card task-teaser event-card" data-event="${e.id}"><div class="round-icon">${illustration(e.icon)}</div><div><h3>${e.title}</h3><p>${e.situation || e.text}</p></div><span class="chevron">›</span></button>`;
  }

  function normalizeWorkState() {
    state.workState = state.workState || {week:state.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};
    if (state.workState.week !== state.wallet.week) state.workState = {week:state.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};
    state.workState.shiftsLimit = 3;
    state.workState.activityUsage ||= {};
    state.activityLimits = {week:state.wallet.week, sideJobs:state.workState.shiftsUsed};
    return state.workState;
  }
  function availableWorkActivities() {
    if (state.difficultyMode !== 'medium') return [];
    const stage = state.worldProgress?.stage || 1;
    return (C.workActivities || []).filter(a => a.ageGroup.includes(state.ageGroup) && stage >= Number(a.unlockCondition?.worldStage || 1));
  }
  function workShiftStatusShort() {
    const w=normalizeWorkState();
    return `${w.shiftsUsed}/${w.shiftsLimit} смен · ${Math.round(state.pet.energy)}⚡`;
  }
  function workActivityById(id) { return (C.workActivities || []).find(a=>a.id===id); }
  function sideJobScreen() {
    if (state.difficultyMode !== 'medium') { route='home'; return homeScreen(); }
    const w=normalizeWorkState(), activities=availableWorkActivities();
    if (state.workSession) return workShiftScreen(state.workSession);
    const left=Math.max(0,w.shiftsLimit-w.shiftsUsed);
    return `<section class="screen sidejob-screen">${topbar('Подработка',true)}<div class="work-hero"><div><div class="eyebrow">Дополнительный доход</div><h2>Короткая смена — свой доход</h2><p>Выбери работу. Доход и расход энергии указаны до начала смены.</p></div><div class="work-energy"><span>Энергия</span><b>${Math.round(state.pet.energy)}⚡</b></div></div><div class="work-limit"><span>Смены этой недели</span><b>${w.shiftsUsed} / ${w.shiftsLimit}</b><div class="work-dots">${Array.from({length:w.shiftsLimit},(_,i)=>`<i class="${i<w.shiftsUsed?'used':''}"></i>`).join('')}</div><small>${left?`Можно выполнить ещё ${left}`:'Лимит недели исчерпан'}. Не более одной смены за игровой день.</small></div><div class="section-title"><h2>Доступная работа</h2></div><div class="work-list">${activities.map(a=>workActivityCard(a)).join('')}</div><div class="need-note">Заработанные монеты можно потратить или отложить на цель.</div></section>`;
  }
  function workActivityCard(a) {
    const w=normalizeWorkState(), blockedLimit=w.shiftsUsed>=w.shiftsLimit, blockedDay=!!state.dayActions.sideJob, blockedEnergy=state.pet.energy<a.energyCost;
    const disabled=blockedLimit||blockedDay||blockedEnergy;
    const reason=blockedLimit?'Лимит недели исчерпан':blockedDay?'Сегодня смена уже была':blockedEnergy?'Недостаточно энергии':'30–60 секунд';
    return `<div class="card work-card"><div class="work-card-main"><div class="work-icon">${illustration('◇')}</div><div><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p></div></div><div class="work-economy"><span><b>+${a.reward}</b> монет</span><span><b>−${a.energyCost}</b> энергии</span><span><b>30–60 сек.</b> ориентировочно</span></div><button class="btn ${disabled?'secondary':'primary'} block" data-work-start="${a.id}" ${disabled?'disabled':''}>${disabled?reason:'Начать смену'}</button></div>`;
  }
  function workShiftScreen(session) {
    const a=workActivityById(session.activityId); if(!a){state.workSession=null;save();return sideJobScreen();}
    const step=a.steps[session.index]; const pct=Math.round((session.index/a.steps.length)*100);
    if(!step) return `<section class="screen sidejob-screen">${topbar('Подработка',true)}<div class="need-note">Смена уже завершена.</div></section>`;
    return `<section class="screen work-shift">${topbar(a.title,true)}<div class="shift-head"><div><div class="eyebrow">Смена</div><h2>${session.index+1} из ${a.steps.length}</h2></div><div class="shift-pay">+${a.reward} ●<small>после завершения</small></div></div><div class="bar work-progress"><i style="width:${pct}%"></i></div><div class="work-task-card"><span class="work-item-icon">${illustration(step.icon,step.name||step.label||step.id)}</span><div><small>Куда отправить?</small><h2>${esc(step.label)}</h2></div></div>${session.message?`<div role="status" aria-live="polite" class="work-message ${session.messageType||''}">${esc(session.message)}</div>`:''}<div class="work-bins">${a.bins.map(b=>`<button data-work-bin="${b.id}">${esc(b.label)}</button>`).join('')}</div><button class="linkbtn work-cancel" data-work-cancel>Отменить смену</button><p class="subtle center">Распредели все предметы, чтобы завершить смену и получить оплату.</p></section>`;
  }
  function startWorkActivity(id) {
    if(state.difficultyMode!=='medium') return;
    normalizeWorkState(); const a=workActivityById(id); if(!a||!availableWorkActivities().some(x=>x.id===id))return;
    if(state.workState.shiftsUsed>=state.workState.shiftsLimit){track('side_job_limit_reached',{activityId:id,used:state.workState.shiftsUsed});toast('На этой неделе лимит смен уже использован');return;}
    if(state.dayActions.sideJob){track('side_job_limit_reached',{activityId:id,reason:'day_limit'});toast('Сегодня смена уже была. Можно перейти к следующему игровому дню.');return;}
    if(state.pet.energy<a.energyCost){track('side_job_energy_blocked',{activityId:id,energy:state.pet.energy,required:a.energyCost});toast('Сейчас энергии мало. Можно восстановиться и вернуться к подработке позже.');return;}
    state.workSession={activityId:id,index:0,startedAt:Date.now(),attempts:0,message:'',messageType:''};
    track('side_job_started',{activityId:id,reward:a.reward,energyCost:a.energyCost});save();render();
  }
  function resolveWorkBin(binId) {
    const session=state.workSession; if(!session)return; const a=workActivityById(session.activityId),step=a?.steps?.[session.index]; if(!a||!step)return;
    session.attempts=(session.attempts||0)+1;
    if(binId!==step.bin){session.message='Не сюда — проверь описание ещё раз.';session.messageType='miss';save();render();return;}
    session.index++;session.message='Готово. Следующий заказ.';session.messageType='ok';
    if(session.index>=a.steps.length){completeWorkActivity(a);return;} save();render();
  }
  function completeWorkActivity(a) {
    normalizeWorkState();
    if(state.pet.energy<a.energyCost){state.workSession=null;track('side_job_energy_blocked',{activityId:a.id,energy:state.pet.energy,required:a.energyCost,stage:'completion'});save();toast('Энергии уже недостаточно для завершения смены');render();return;}
    const attempts=state.workSession?.attempts||0;
    state.workSession=null; // clear before the shared earn() persists state: a reload cannot duplicate a completed shift
    adjustPet({energy:-a.energyCost});
    state.workState.shiftsUsed++; state.workState.activityUsage[a.id]=(state.workState.activityUsage[a.id]||0)+1;
    state.activityLimits={week:state.wallet.week,sideJobs:state.workState.shiftsUsed}; state.dayActions.sideJob=true;
    earn(a.reward,`Смена: ${a.title}`,'work_shift',{activityId:a.id,shiftNumber:state.workState.shiftsUsed});
    track('side_job_completed',{activityId:a.id,reward:a.reward,energyCost:a.energyCost,attempts});
    track('side_job_income_received',{activityId:a.id,amount:a.reward,source:'work_shift'});
    petBubble='Смена закончена'; save(); modal={type:'workComplete',activityId:a.id,reward:a.reward,energyCost:a.energyCost,balance:state.wallet.balance,energy:state.pet.energy}; route='sidejob'; render();
  }
  function cancelWorkActivity() {
    if(!state.workSession)return; const id=state.workSession.activityId; state.workSession=null;track('side_job_cancelled',{activityId:id});save();render();
  }

  function wishHtml() {
    if (!state.petWish) return '';
    const w = C.petWishes?.find(x => x.id === state.petWish.id); if (!w) return '';
    return `<div class="card wish-card"><div class="round-icon">${illustration('☻')}</div><div><h3>${esc(state.pet.name)} хочет</h3><p>${w.text}</p></div><div class="wish-actions">${w.itemId ? `<button class="linkbtn" data-wish-buy="${w.itemId}">Посмотреть</button>` : `<button class="linkbtn" data-action="play">Поиграть</button>`}<button class="linkbtn muted-link" data-dismiss-wish>Не сейчас</button></div></div>`;
  }

  function petScreen() {
    return `<section class="screen">${topbar(state.pet.name, true)}
      <div class="pet-detail-stage">${petBubble ? `<div class="pet-bubble">${petBubble}</div>` : ''}${petSVG()}${roomItemsHtml()}</div>
      <div class="section-title"><h2>Как себя чувствует</h2></div>
      <div class="stat-row">${miniStat('Сытость', state.pet.satiety, '🥣')}${miniStat('Настроение', state.pet.mood, '☻')}${miniStat('Энергия', state.pet.energy, '⚡')}${miniStat('Уход', state.pet.care, '✦')}</div>
      <div class="section-title"><h2>Забота</h2></div>
      <div class="grid2"><button class="btn secondary" data-action="feed">🥣 Покормить · 40</button><button class="btn secondary" data-action="care">🫧 Уход · 60</button><button class="btn secondary" data-action="play">⚽ Играть · 80</button><button class="btn secondary" data-route="shop">◫ Магазин</button></div>
      <div class="section-title"><h2>Твои вещи</h2></div>
      <div class="inventory-strip">${state.inventory.length ? state.inventory.slice().reverse().map(x => C.items.find(i => i.id === x.id)).filter(Boolean).slice(0, 16).map(i => `<div class="inventory-chip">${illustration(i.icon,i.name||i.label||i.id)}<span>${i.name}</span></div>`).join('') : `<div class="need-note">Пока здесь пусто. Предметы из магазина будут менять пространство питомца.</div>`}</div>
    </section>`;
  }

  function savingsScreen() {
    const g = activeGoal();
    return `<section class="screen">${topbar('Копилка', true)}
      <div class="card savings-hero"><div class="pig">🐷</div><div class="big-money">${fmt(state.wallet.savings)}</div><div class="muted">монет отложено${g ? ` на «${g.name}»` : ''}</div>${g ? `<div class="bar green" style="height:10px;margin-top:16px"><i style="width:${progressPct()}%"></i></div><p class="subtle">${fmt(state.wallet.savings)} из ${fmt(goalTarget(g))} · ${progressPct()}% · ≈ ${weeksToGoal()} нед.</p>` : '<p class="subtle">Можно копить и без выбранной цели, а выбрать её позже.</p>'}</div>
      <div class="section-title"><h2>Отложить сначала?</h2></div>
      <div class="save-controls">${[50, 100, 200].map(n => `<button data-save="${n}">+${n}</button>`).join('')}</div>
      <div class="save-custom"><input type="number" min="1" inputmode="numeric" placeholder="Другая сумма" id="saveAmount"><button class="btn primary" data-save-custom>Отложить</button></div>
      ${state.wallet.savings > 0 ? `<button class="btn secondary block" style="margin-top:10px" data-withdraw="100">Вернуть 100 на баланс</button>` : ''}
      <p class="subtle">Снять деньги можно в любой момент. Вместо штрафа приложение покажет, как изменится срок цели.</p>
    </section>`;
  }

  function purchaseContext(item) {
    const afterBalance = Math.max(0, state.wallet.balance - item.price);
    const reserve = Math.max(0, afterBalance - needsReserve());
    const delay = item.need ? 0 : purchaseGoalDelay(item.price);
    if (item.need) return `После покупки останется ${fmt(afterBalance)} монет.`;
    if (delay > 0) return `Свободный резерв ≈ ${fmt(reserve)}. Цель может сдвинуться примерно на ${delay} нед.`;
    return `После покупки свободный резерв ≈ ${fmt(reserve)} монет.`;
  }

  function shopScreen() {
    const cat = shopScreen.cat || 'Еда'; const cats = ['Еда', 'Уход', 'Игры', 'Одежда', 'Интерьер', 'Особое'];
    const items = C.items.filter(i => i.category === cat);
    return `<section class="screen">${topbar('Магазин', true)}
      <div class="tabs">${cats.map(c => `<button class="chip ${c === cat ? 'active' : ''}" data-shop-cat="${c}">${c}</button>`).join('')}</div>
      <div class="shop-list">${items.map(item => {
        const owned = item.cosmetic && state.inventory.some(x => x.id === item.id);
        return `<div class="card shop-item shop-item-v2"><div class="shop-ico">${illustration(item.icon,item.name||item.label||item.id)}</div><div><h3>${item.name}</h3><p>${item.need ? 'Базовая потребность' : 'Желание / улучшение мира'}</p><span class="tag ${item.need ? 'need' : 'want'}">${item.need ? 'Нужно' : 'Желание'}</span><div class="item-context">${purchaseContext(item)}</div></div><div class="center"><div class="price">${fmt(item.price)} ●</div><button class="linkbtn" data-buy="${item.id}" ${owned ? 'disabled' : ''}>${owned ? 'Уже есть' : 'Купить'}</button></div></div>`;
      }).join('')}</div>
    </section>`;
  }

  function tasksScreen() {
    const list = ageTaskList();
    return `<section class="screen">${topbar('Задания')}
      <div class="soft-note"><b>Дополнительные миссии</b><span>Основная финансовая жизнь проходит в неделе, событиях и покупках. Здесь можно попробовать отдельные механики и получить небольшой дополнительный доход.</span></div>
      <div class="task-list">${list.map(t => {
        const done = state.completedTasks.includes(t.id);
        return `<button class="card task-card ${done ? 'done' : ''}" data-open-task="${t.id}"><div class="task-head"><h3>${done ? '✓ ' : ''}${t.title}</h3><span class="reward">+${t.reward} ●</span></div><p>${t.setup}</p><span class="tag">${taskTypeLabel(t.mechanicType)}</span></button>`;
      }).join('')}</div>
    </section>`;
  }

  function taskTypeLabel(type) {
    return ({ allocation: 'Распредели бюджет', subscriptions: 'Найди лишнее', goal_slider: 'Что изменится?', compare: 'Сравни предложения', role: 'Смена роли' }[type] || 'Финансовая ситуация');
  }

  function taskScreen() {
    const t = C.tasks.find(x => x.id === taskScreen.id); if (!t) { route = 'tasks'; return tasksScreen(); }
    const result = taskResult && taskResult.taskId === t.id ? taskResult : null;
    let body = '';
    if (result) {
      body = `<div class="result-box"><h3>Что получилось</h3><p>${result.choice.result}</p>${result.choice.impact ? `<div class="impact">${result.choice.impact.health ? `<span>Устойчивость: ${result.choice.impact.health > 0 ? '+' : ''}${result.choice.impact.health}</span>` : ''}${result.choice.impact.mood ? `<span>Настроение: ${result.choice.impact.mood > 0 ? '+' : ''}${result.choice.impact.mood}</span>` : ''}</div>` : ''}</div><div style="height:12px"></div><button class="btn primary block" data-finish-task>Завершить миссию</button>`;
    } else if (t.mechanicType === 'allocation') {
      const amount = t.amount || 1000;
      const defaults = [Math.round(amount*.4/10)*10, Math.round(amount*.2/10)*10, Math.round(amount*.25/10)*10]; defaults.push(Math.max(0, amount-defaults.reduce((a,b)=>a+b,0)));
      body = `<div class="mini-allocation"><div class="allocation-total">Распредели ${fmt(amount)} монет</div>${['necessary', 'wants', 'savings', 'reserve'].map((k, i) => `<label><span>${['Необходимое', 'Желания', 'Копилка', 'Резерв'][i]}</span><input type="number" id="task_${k}" min="0" step="10" value="${defaults[i]}"></label>`).join('')}<button class="btn primary block" data-task-allocate>Посмотреть последствия</button></div>`;
    } else if (t.mechanicType === 'subscriptions') {
      const subs = t.subscriptions || [{name:'Музыка',price:60,used:true},{name:'Игровой сервис',price:90,used:false},{name:'Облако',price:50,used:true}];
      body = `<div class="subscription-task"><p class="subtle">Отметь подписки, которые ты бы оставил. Подсказка: посмотри, чем действительно пользуешься.</p>${subs.map((x,i)=>`<label><input type="checkbox" id="sub_${i}" ${x.used?'checked':''}><span><b>${x.name}</b><small>${x.price} ● / нед.</small></span></label>`).join('')}<button class="btn primary block" data-task-subscriptions>Посмотреть итог</button></div>`;
    } else if (t.mechanicType === 'goal_slider') {
      body = `<div class="goal-simulator"><label>Откладывать в неделю <b id="sliderValue">200</b> ●</label><input id="goalSlider" type="range" min="50" max="500" step="50" value="200"><div class="sim-result">Цель 1200: примерно <b id="sliderWeeks">6 недель</b></div><button class="btn primary block" data-task-slider>Зафиксировать наблюдение</button></div>`;
    } else {
      body = `<div class="stack">${t.choices.map((c, i) => `<button class="choice" data-task-choice="${i}">${c.text}</button>`).join('')}</div>`;
    }
    return `<section class="screen">${topbar('Миссия', true)}<div class="card"><div class="eyebrow">${taskTypeLabel(t.mechanicType)}</div><div class="question">${t.setup}</div>${body}</div></section>`;
  }

  function budgetScreen() {
    state.stats.budgetViews++;
    recalculateHealth(); checkAchievements(); save();
    const reserve = needsReserve(), free = freeMoney(), h = healthText();
    const plan = planForWeek(), actual = actualsForWeek();
    return `<section class="screen">${topbar('Мой бюджет')}
      <div class="metric-grid">
        <div class="metric"><div class="label">Баланс</div><div class="value">${fmt(state.wallet.balance)}</div><div class="hint">в основном кошельке</div></div>
        <div class="metric"><div class="label">До дохода</div><div class="value">${state.wallet.nextIncomeIn} дн.</div><div class="hint">+${fmt(state.wallet.weeklyIncome)} монет</div></div>
        <div class="metric"><div class="label">Нужно предусмотреть</div><div class="value money-orange">${fmt(reserve)}</div><div class="hint">оценка до конца недели</div></div>
        <div class="metric"><div class="label">Свободно сейчас</div><div class="value money-green">${fmt(free)}</div><div class="hint">после базовых потребностей</div></div>
      </div>
      <div class="section-title"><h2>Финансовое здоровье</h2></div>
      <div class="card health-card"><div class="health-dot ${state.financialHealth >= 62 ? 'stable' : state.financialHealth >= 45 ? 'caution' : 'risk'}"></div><div><h3>${h[0]}</h3><p>${h[1]}</p></div></div>
      <div class="section-title"><h2>План → факт</h2><button data-edit-plan>Изменить план</button></div>
      ${plan ? planFactHtml(plan, actual) : `<div class="need-note">У этой недели ещё нет плана.</div>`}
      <div class="section-title"><h2>Копилка</h2><button data-savings>Управлять</button></div>
      <div class="card"><div class="goal-card"><div class="goal-icon">${illustration('🪙')}</div><div><h3>${fmt(state.wallet.savings)} монет</h3><p>${activeGoal() ? `Для цели «${activeGoal().name}» · ≈ ${weeksToGoal()} нед.` : 'Можно выбрать цель позже'}</p></div></div></div>
      <div class="section-title"><h2>История</h2></div><div class="card history">${historyHtml()}</div>
    </section>`;
  }

  function planFactHtml(plan, actual) {
    const rows = [
      ['Необходимое', plan.necessary, actual.necessary],
      ['Желания', plan.wants, actual.wants],
      ['Копилка', plan.savings, actual.savings],
      ['Резерв', plan.reserve, Math.max(0, state.wallet.balance)]
    ];
    return `<div class="card plan-fact"><div class="pf-head"><span></span><b>План</b><b>Факт</b></div>${rows.map(([n, p, f]) => `<div class="pf-row"><span>${n}</span><b>${fmt(p)}</b><b class="${f > p * 1.2 && n === 'Желания' ? 'over' : ''}">${fmt(f)}</b></div>`).join('')}${planInsight(plan, actual) ? `<div class="pf-insight">${planInsight(plan, actual)}</div>` : ''}</div>`;
  }

  function planInsight(plan, actual) {
    if (actual.wants > plan.wants + 80) return `На желания уже ушло на ${fmt(actual.wants - plan.wants)} больше плана.`;
    if (actual.savings + 50 < plan.savings) return `До планового взноса в копилку пока не хватает ${fmt(plan.savings - actual.savings)}.`;
    if (actual.necessary > plan.necessary + 60) return `Необходимые расходы оказались выше плана на ${fmt(actual.necessary - plan.necessary)}.`;
    return 'Пока план и фактические решения близки. Он может измениться после новых событий.';
  }

  function historyHtml() {
    if (!state.transactions.length) return `<div class="empty">Пока нет операций.</div>`;
    return state.transactions.slice(0, 16).map(t => `<div class="tx"><div class="tx-icon">${iconForTx(t)}</div><div><b>${esc(t.description)}</b><p>${esc(t.category)} · нед. ${t.week || state.wallet.week}, день ${t.day || 1}</p></div><div class="tx-amount ${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount > 0 ? '+' : ''}${fmt(t.amount)}</div></div>`).join('');
  }

  function goalsScreen() {
    return `<section class="screen">${topbar('Цели')}
      <p class="subtle">Цель — не запрет на другие покупки. Она показывает цену выбора и срок, который меняется вместе с решениями.</p>
      <div class="goal-list">${C.goals.map(g => {
        const target = goalTarget(g), active = state.activeGoal === g.id, pct = active ? progressPct() : 0;
        return `<div class="card goal-select ${active ? 'active' : ''}"><div class="goal-icon">${illustration(g.icon,g.name||g.label||g.id)}</div><div><h3>${g.name}</h3><p>${fmt(target)} монет · ${g.note}</p>${active ? `<div class="bar green"><i style="width:${pct}%"></i></div><p class="goal-detail">${fmt(state.wallet.savings)} / ${fmt(target)} · осталось ${fmt(Math.max(0, target - state.wallet.savings))} · ≈ ${weeksToGoal()} нед.</p>` : ''}</div><button class="linkbtn" data-goal="${g.id}">${active ? 'Выбрано' : 'Выбрать'}</button></div>`;
      }).join('')}</div>
      <button class="btn secondary block" data-savings>Открыть копилку</button>
    </section>`;
  }

  function profileScreen() {
    return `<section class="screen">${topbar('Профиль')}
      <div class="card profile-row"><div class="avatar">${state.pet.type === 'cat' ? '🐱' : state.pet.type === 'dog' ? '🐶' : '✨'}</div><div><h3>${esc(state.pet.name)}</h3><p class="subtle">Возрастной режим ${state.ageGroup} · ${petStage()}</p></div></div>
      <div class="menu"><button data-route="progress">Прогресс <span>›</span></button><button data-route="achievements">Достижения <span>${state.achievements.length}/${C.achievements.length} ›</span></button><button data-route="settings">Настройки <span>›</span></button></div>
    </section>`;
  }

  function progressScreen() {
    const h = healthText();
    return `<section class="screen">${topbar('Прогресс', true)}
      <div class="card"><div class="pet-stage" style="height:190px">${petSVG()}</div><div class="center"><b>${petStage()}</b><p class="subtle">Развитие: ${Math.round(state.pet.development)}/100</p><div class="bar"><i style="width:${state.pet.development}%"></i></div></div></div>
      <div class="metric-grid"><div class="metric"><div class="label">Пройдено недель</div><div class="value">${state.weekHistory.length}</div></div><div class="metric"><div class="label">В копилке</div><div class="value">${fmt(state.wallet.savings)}</div></div><div class="metric"><div class="label">Состояние</div><div class="value compact-value">${h[0]}</div></div><div class="metric"><div class="label">Миссии</div><div class="value">${state.stats.tasksDone}</div></div></div>
    </section>`;
  }

  function achievementsScreen() {
    return `<section class="screen">${topbar('Достижения', true)}<div class="ach-grid">${C.achievements.map(a => `<div class="ach ${state.achievements.includes(a.id) ? '' : 'locked'}"><div class="aico">${illustration(a.icon,a.name||a.label||a.id)}</div><h3>${a.name}</h3><p>${a.desc}</p></div>`).join('')}</div></section>`;
  }

  function settingsScreen() {
    return `<section class="screen settings-screen"><header class="settings-header"><button class="linkbtn" data-back>← Назад</button><h1>Настройки</h1></header><div class="menu settings-list"><button data-toggle="sound" role="switch" aria-checked="${state.settings.sound}" aria-label="Звуки"><span>Звуки</span><span class="setting-control"><small>${state.settings.sound?'Вкл.':'Выкл.'}</small><span class="switch-track" aria-hidden="true"></span></span></button><button data-toggle="motion" role="switch" aria-checked="${state.settings.motion}" aria-label="Анимация"><span>Анимация</span><span class="setting-control"><small>${state.settings.motion?'Вкл.':'Выкл.'}</small><span class="switch-track" aria-hidden="true"></span></span></button></div><div class="settings-reset"><button class="linkbtn danger" data-reset>Начать заново</button><p class="subtle">Удалить сохранённый прогресс и начать новую игру.</p></div><p class="settings-note">Прогресс сохраняется на этом устройстве.</p>${pageArtwork('settings')}</section>`;
  }

  function weekSummaryScreen() {
    const s = state.weekSummary;
    if (!s) { route = 'home'; return homeScreen(); }
    return `<section class="screen week-screen summary-screen"><div class="week-kicker">Итоги недели ${s.week}</div><h1>Что получилось</h1><p class="week-lead">Здесь нет оценки. Это снимок последствий твоих решений.</p>
      <div class="summary-balance"><span>Начал неделю</span><b>${fmt(s.startingBalance)} ●</b><span>Закончил</span><b>${fmt(s.endingBalance)} ●</b></div>
      <div class="summary-grid"><div><span>Необходимое</span><b>${fmt(s.actual.necessary)}</b></div><div><span>Желания</span><b>${fmt(s.actual.wants)}</b></div><div><span>Отложил</span><b>${fmt(s.actual.savings)}</b></div><div><span>Доп. доход</span><b>${fmt(s.actual.extraIncome)}</b></div></div>
      <div class="section-title"><h2>План → факт</h2></div>${planFactSummaryHtml(s)}
      <div class="section-title"><h2>Что можно заметить</h2></div><div class="insights">${s.insights.map(x => `<div class="insight"><span>✦</span><p>${x}</p></div>`).join('')}</div>
      <div class="card pet-week-result"><div>${petSVG()}</div><div><b>${esc(state.pet.name)}</b><p>Настроение ${Math.round(state.pet.mood)} · благополучие ${petWellbeing()}</p><span>${s.petDelta.mood >= 0 ? 'Настроение сохранилось или выросло.' : 'К концу недели настроение стало ниже — возможно, было мало приятных активностей.'}</span></div></div>
      <button class="btn primary block" data-next-week>Получить доход новой недели</button>
    </section>`;
  }

  function planFactSummaryHtml(s) {
    const p = s.plan || { necessary: 0, wants: 0, savings: 0, reserve: 0 }, a = s.actual;
    const rows = [['Необходимое', p.necessary, a.necessary], ['Желания', p.wants, a.wants], ['Копилка', p.savings, a.savings], ['Осталось', p.reserve, s.endingBalance]];
    return `<div class="card plan-fact"><div class="pf-head"><span></span><b>План</b><b>Факт</b></div>${rows.map(([n, x, y]) => `<div class="pf-row"><span>${n}</span><b>${fmt(x)}</b><b>${fmt(y)}</b></div>`).join('')}</div>`;
  }

  function renderModal() {
    if (modal.type === 'event') {
      const e = C.events.find(x => x.id === modal.id);
      return `<div class="overlay" data-close-overlay><div class="sheet" data-sheet><div class="sheet-handle"></div><div class="eyebrow">${e.categoryLabel || 'Событие дня'}</div><h2>${e.title}</h2><p>${e.situation || e.text}</p><div class="event-meta"><span>${ageLabel(e.age)}</span><span>${e.learningOutcome || 'Сравнить последствия'}</span></div><div class="stack">${e.choices.map((c, i) => `<button class="choice event-choice" data-event-choice="${i}"><b>${c.text}</b>${choicePreview(c, e)}</button>`).join('')}</div></div></div>`;
    }
    if (modal.type === 'eventResult') {
      return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Что произошло</div><h2>${modal.title || 'Последствие решения'}</h2><div class="result-box"><p>${modal.result}</p></div>${modal.feedback ? feedbackHtml(modal.feedback) : ''}<button class="btn primary block" style="margin-top:12px" data-close-modal>Продолжить</button></div></div>`;
    }
    if (modal.type === 'financialFeedback') {
      return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Цена решения</div><h2>${modal.title}</h2>${feedbackHtml(modal.feedback)}<button class="btn primary block" style="margin-top:12px" data-close-modal>Понятно</button></div></div>`;
    }
    if (modal.type === 'saveFirst') {
      const n = Math.min(modal.amount || 200, state.wallet.balance);
      return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Перед началом недели</div><h2>Отложить сначала?</h2><p>В плане на копилку — ${fmt(modal.amount)} монет. Это не обязательно: можно оставить деньги на балансе и решить позже.</p><div class="grid2"><button class="btn good" data-save="${n}">Отложить ${fmt(n)}</button><button class="btn secondary" data-close-modal>Не сейчас</button></div></div></div>`;
    }
    if (modal.type === 'dayConfirm') {
      return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><h2>Завершить день без решений?</h2><p>Можно. Питомец проживёт день, его потребности немного изменятся. Это не штраф — просто течение игрового времени.</p><div class="grid2"><button class="btn primary" data-confirm-day>Завершить</button><button class="btn secondary" data-close-modal>Вернуться</button></div></div></div>`;
    }
    return '';
  }

  function ageLabel(age = []) { return age.length === 3 ? 'Все возраста' : age.join(', '); }
  function choicePreview(c, e) {
    const bits = [];
    if (c.cost) bits.push(`−${c.cost} ●`);
    if (c.income) bits.push(`+${c.income} ●`);
    if (c.save) bits.push(`${c.save} → копилка`);
    if (c.pet?.mood || c.mood) bits.push(`${(c.pet?.mood || c.mood) > 0 ? '+' : ''}${c.pet?.mood || c.mood} настроение`);
    if (!bits.length) bits.push('без прямой траты');
    return `<span>${bits.join(' · ')}</span>`;
  }

  function feedbackHtml(f) {
    const lines = [];
    if (f.balance != null) lines.push(`<div><span>Баланс</span><b>${fmt(f.balance)} ●</b></div>`);
    if (f.reserve != null) lines.push(`<div><span>Свободный резерв</span><b>${fmt(f.reserve)} ●</b></div>`);
    if (f.goalDelay > 0) lines.push(`<div><span>Влияние на цель</span><b>≈ +${f.goalDelay} нед.</b></div>`);
    else if (f.goalWeeks != null) lines.push(`<div><span>До цели</span><b>≈ ${f.goalWeeks} нед.</b></div>`);
    if (f.petMood != null) lines.push(`<div><span>Настроение</span><b>${f.petMood > 0 ? '+' : ''}${f.petMood}</b></div>`);
    return `<div class="feedback-grid">${lines.join('')}</div>`;
  }

  function renderOnboarding() {
    const step = state.onboardingStep || 0;
    const slides = [
      ['Это твой новый друг', 'Питомец будет жить вместе с твоими финансовыми решениями.'],
      ['Монеты нужны для заботы', 'Еда и уход важны, но хочется ещё игр, вещей и развлечений.'],
      ['Денег не бесконечно много', 'Иногда придётся выбирать между тем, что хочется сейчас, и тем, на что копишь.'],
      ['Главное — баланс', 'Не нужно экономить на всём. Нужно понимать цену своего решения.']
    ];
    if (step < 4) {
      app.innerHTML = `<section class="onboarding"><div class="brand">КопиХвост</div><div class="onboard-main"><div class="onboard-visual">${petSVG('mumo', '#7C8CF8', 'badge')}</div><div class="dots">${slides.map((_, i) => `<i class="${i === step ? 'active' : ''}"></i>`).join('')}</div><h1>${slides[step][0]}</h1><p>${slides[step][1]}</p></div><button class="btn primary block" data-onboard-next>${step === 3 ? 'Выбрать возраст' : 'Дальше'}</button></section>`;
      app.querySelector('[data-onboard-next]').onclick = () => { state.onboardingStep++; save(); render(); };
      return;
    }
    if (step === 4) {
      const ages = [
        ['7-11', '8–10 лет', 'Хочу / нужно, простые цели, магазин, подарки и резерв.'],
        ['12-14', '11–13 лет', 'Бюджет, подписки, сравнение цен, карта и мошенничество.'],
        ['15-17', '14–17 лет', 'Доход, подработка, кредит, договоры, риск и финансовые сервисы.']
      ];
      app.innerHTML = `<section class="onboarding"><div class="brand">КопиХвост</div><div class="onboard-main" style="align-content:start;padding-top:70px"><div><div class="eyebrow">Шаг 1 из 2</div><h1>Сколько тебе лет?</h1><p>Это меняет не только слова, но и ситуации внутри игры.</p></div><div class="age-grid">${ages.map(a => `<button class="select-card ${state.ageGroup === a[0] ? 'active' : ''}" data-age="${a[0]}"><h3>${a[1]}</h3><p>${a[2]}</p></button>`).join('')}</div></div><button class="btn primary block" data-age-next ${!state.ageGroup ? 'disabled' : ''}>Создать питомца</button></section>`;
      app.querySelectorAll('[data-age]').forEach(b => b.onclick = () => { state.ageGroup = b.dataset.age; save(); render(); });
      app.querySelector('[data-age-next]').onclick = () => { state.onboardingStep = 5; save(); render(); };
      return;
    }
    app.innerHTML = `<section class="onboarding"><div class="brand">КопиХвост</div><div class="onboard-main" style="align-content:start;padding-top:25px"><div><div class="eyebrow">Шаг 2 из 2</div><h1>${state.ageGroup === '15-17' ? 'Выбери компаньона' : 'Создай друга'}</h1><p>${state.ageGroup === '15-17' ? 'Персонаж останется частью мира, но не будет диктовать финансовые решения.' : 'Выбери характер, цвет и маленькую деталь.'}</p></div><div class="pet-grid">${C.pets.map(p => `<button class="select-card pet-pick ${state.pet.type === p.id ? 'active' : ''}" data-pet="${p.id}">${petSVG(p.id, state.pet.color, state.pet.accessory)}<div><h3>${p.name}</h3><p>${p.desc}</p></div></button>`).join('')}</div><div class="field"><label>Имя питомца</label><input id="petName" maxlength="14" value="${esc(state.pet.name)}"></div><div class="field"><label>Цвет акцента</label><div class="color-row">${C.petColors.map(c => `<button class="color-dot ${state.pet.color === c ? 'active' : ''}" style="background:${c}" data-color="${c}" aria-label="Цвет"></button>`).join('')}</div></div><div class="field"><label>Аксессуар</label><select id="accessory">${C.accessories.map(a => `<option value="${a.id}" ${state.pet.accessory === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}</select></div></div><button class="btn primary block" data-start>Получить 1000 монет</button></section>`;
    app.querySelectorAll('[data-pet]').forEach(b => b.onclick = () => { state.pet.type = b.dataset.pet; save(); render(); });
    app.querySelectorAll('[data-color]').forEach(b => b.onclick = e => { e.preventDefault(); state.pet.color = b.dataset.color; save(); render(); });
    app.querySelector('#accessory').onchange = e => { state.pet.accessory = e.target.value; save(); };
    app.querySelector('#petName').oninput = e => { state.pet.name = e.target.value; save(); };
    app.querySelector('[data-start]').onclick = () => {
      state.pet.name = (app.querySelector('#petName').value || 'Финни').trim().slice(0, 14);
      state.onboardingDone = true; state.onboardingStep = 6;
      tx('income', 1000, 'Доход', 'Стартовый недельный бюджет', 'onboarding');
      state.currentEventId = selectEventId(state, true);
      state.weekNeedsPlanning = true;
      track('pet_created', { type: state.pet.type, ageGroup: state.ageGroup });
      track('week_started', { week: 1, income: 1000 });
      save(); route = 'weekStart'; render();
    };
  }

  function bindCommon() {
    document.querySelectorAll('[data-route]').forEach(b => b.onclick = () => { route = b.dataset.route; taskResult = null; if (route !== 'weekStart') editingPlan = false; render(); window.scrollTo(0, 0); });
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {
      route = (route === 'shop' || route === 'task' || route === 'pet') ? 'home' : (route === 'savings' ? 'budget' : 'profile'); taskResult = null; render();
    });
    document.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => { taskScreen.id = b.dataset.openTask; route = 'task'; taskResult = null; render(); window.scrollTo(0, 0); });
    document.querySelectorAll('[data-action]').forEach(b => b.onclick = () => quickAction(b.dataset.action));
    document.querySelectorAll('[data-shop-cat]').forEach(b => b.onclick = () => { shopScreen.cat = b.dataset.shopCat; render(); });
    document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buyItem(b.dataset.buy));
    document.querySelectorAll('[data-task-choice]').forEach(b => b.onclick = () => chooseTask(Number(b.dataset.taskChoice)));
    document.querySelectorAll('[data-finish-task]').forEach(b => b.onclick = finishTask);
    document.querySelectorAll('[data-task-allocate]').forEach(b => b.onclick = resolveAllocationTask);
    document.querySelectorAll('[data-task-slider]').forEach(b => b.onclick = resolveSliderTask);
    document.querySelectorAll('[data-task-subscriptions]').forEach(b => b.onclick = resolveSubscriptionsTask);
    document.querySelectorAll('[data-savings]').forEach(b => b.onclick = () => { modal = null; route = 'savings'; render(); window.scrollTo(0, 0); });
    document.querySelectorAll('[data-goal]').forEach(b => b.onclick = () => selectGoal(b.dataset.goal));
    document.querySelectorAll('[data-event]').forEach(b => b.onclick = () => { modal = { type: 'event', id: b.dataset.event }; track('event_started', { eventId: b.dataset.event }); render(); });
    document.querySelectorAll('[data-event-choice]').forEach(b => b.onclick = () => resolveEvent(Number(b.dataset.eventChoice)));
    document.querySelectorAll('[data-close-overlay]').forEach(x => x.onclick = e => { if (e.target === x) { modal = null; render(); } });
    document.querySelectorAll('[data-sheet]').forEach(x => x.onclick = e => e.stopPropagation());
    document.querySelectorAll('[data-close-modal]').forEach(x => x.onclick = () => { modal = null; render(); });
    document.querySelectorAll('[data-save]').forEach(b => b.onclick = () => saveAmount(Number(b.dataset.save)));
    document.querySelectorAll('[data-save-custom]').forEach(b => b.onclick = () => { const n = Number(document.querySelector('#saveAmount')?.value || 0); if (n > 0) saveAmount(n); });
    document.querySelectorAll('[data-withdraw]').forEach(b => b.onclick = () => withdrawSaving(Number(b.dataset.withdraw)));
    document.querySelectorAll('[data-new-day]').forEach(b => b.onclick = requestNewDay);
    document.querySelectorAll('[data-confirm-day]').forEach(b => b.onclick = () => { modal = null; advanceDay(); });
    document.querySelectorAll('[data-next-week]').forEach(b => b.onclick = startNextWeek);
    document.querySelectorAll('[data-save-plan]').forEach(b => b.onclick = saveWeekPlan);
    document.querySelectorAll('[data-edit-plan]').forEach(b => b.onclick = () => { editingPlan = true; route = 'weekStart'; render(); window.scrollTo(0, 0); });
    document.querySelectorAll('[data-dismiss-wish]').forEach(b => b.onclick = dismissWish);
    document.querySelectorAll('[data-wish-buy]').forEach(b => b.onclick = () => { shopScreen.cat = C.items.find(i => i.id === b.dataset.wishBuy)?.category || 'Игры'; route = 'shop'; render(); });
    document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const k = b.dataset.toggle; state.settings[k] = !state.settings[k]; save(); render(); });
    document.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { if (confirm('Удалить локальный прогресс и начать заново?')) { localStorage.removeItem(STORAGE_KEY); state = freshState(); route = 'onboarding'; render(); } });
    const planInputs = ['planNecessary', 'planWants', 'planSavings', 'planReserve'].map(id => document.getElementById(id)).filter(Boolean);
    planInputs.forEach(x => x.addEventListener('input', updatePlanTotal));
    const slider = document.getElementById('goalSlider');
    if (slider) slider.oninput = () => { document.getElementById('sliderValue').textContent = slider.value; document.getElementById('sliderWeeks').textContent = `${Math.ceil(1200 / Number(slider.value))} недель`; };
  }

  function updatePlanTotal() {
    const ids = ['planNecessary', 'planWants', 'planSavings', 'planReserve'];
    const total = ids.reduce((sum, id) => sum + Math.max(0, Number(document.getElementById(id)?.value || 0)), 0);
    const el = document.getElementById('planTotal'); if (!el) return;
    const budget = Number(el.dataset.budget || planningBudget());
    el.textContent = `План: ${fmt(total)} из ${fmt(budget)}`;
    el.classList.toggle('over', total > budget);
  }

  function saveWeekPlan() {
    const n = Math.max(0, Number(document.getElementById('planNecessary')?.value || 0));
    const w = Math.max(0, Number(document.getElementById('planWants')?.value || 0));
    const s = Math.max(0, Number(document.getElementById('planSavings')?.value || 0));
    let r = Math.max(0, Number(document.getElementById('planReserve')?.value || 0));
    let total = n + w + s + r;
    const budget = planningBudget();
    if (total > budget) { toast(`План больше доступной суммы на ${fmt(total - budget)}`); return; }
    if (total < budget) r += budget - total;
    const wasEdit = !!planForWeek();
    state.weekPlan = { week: state.wallet.week, necessary: n, wants: w, savings: s, reserve: r, createdAt: state.weekPlan?.createdAt || Date.now(), updatedAt: Date.now() };
    if (!state.weekSnapshot || state.weekSnapshot.week !== state.wallet.week) {
      state.weekSnapshot = { week: state.wallet.week, startingBalance: state.wallet.balance, startingSavings: state.wallet.savings, pet: { satiety: state.pet.satiety, mood: state.pet.mood, energy: state.pet.energy, care: state.pet.care } };
    }
    state.weekNeedsPlanning = false;
    track('budget_planned', { necessary: n, wants: w, savings: s, reserve: r, edited: wasEdit || editingPlan });
    recalculateHealth(); save(); editingPlan = false; route = 'home';
    modal = s > 0 ? { type: 'saveFirst', amount: s } : null;
    render();
  }

  function quickAction(action) {
    if (action === 'feed') {
      if (spend(40, 'Необходимые расходы', 'Полезный обед', 'pet_care')) { state.wallet.needsSpent += 40; state.stats.needsFirst++; adjustPet({ satiety: 24, mood: 2 }); petBubble = 'Ммм, вкусно!'; track('pet_need_completed', { need: 'satiety' }); }
    } else if (action === 'care') {
      if (spend(60, 'Необходимые расходы', 'Уход за питомцем', 'pet_care')) { state.wallet.needsSpent += 60; state.stats.needsFirst++; adjustPet({ care: 26, mood: 2 }); petBubble = 'Теперь гораздо лучше ✦'; track('pet_need_completed', { need: 'care' }); }
    } else if (action === 'play') {
      if (spend(80, 'Желания', 'Игра с питомцем', 'pet_play')) { adjustPet({ mood: 18, energy: -8 }); petBubble = 'Ещё немного поиграем?'; }
    } else if (action === 'sidejob') {
      if (state.ageGroup !== '15-17') return;
      route = 'sidejob'; track('side_job_opened', { source:'legacy_quick_action' }); render(); return;
    }
    if (state.petWish && (action === 'play')) state.petWish = null;
    checkAchievements(); recalculateHealth(); save(); render();
    setTimeout(() => { petBubble = ''; if (route === 'home' || route === 'pet') render(); }, 1700);
  }

  function buyItem(id) {
    const item = C.items.find(x => x.id === id); if (!item) return;
    if (item.cosmetic && state.inventory.some(x => x.id === item.id)) { toast('Этот предмет уже есть'); return; }
    const beforeBalance = state.wallet.balance;
    const delay = item.need ? 0 : purchaseGoalDelay(item.price);
    const beforeFree = freeMoney();
    if (spend(item.price, item.need ? 'Необходимые расходы' : 'Желания', item.name, 'shop', { itemId: item.id })) {
      state.inventory.push({ id: item.id, boughtAt: Date.now() });
      if (item.need) { state.wallet.needsSpent += item.price; state.stats.needsFirst++; }
      else {
        if (item.price > beforeFree || (planForWeek() && actualsForWeek().wants > planForWeek().wants)) { state.stats.impulsePurchases++; track('impulse_purchase', { itemId: item.id, price: item.price }); }
      }
      adjustPet(item.effect || {});
      if (state.petWish && state.petWish.itemId === item.id) state.petWish = null;
      petBubble = `${illustration(item.icon,item.name||item.label||item.id)} Новая вещь!`;
      checkAchievements(); recalculateHealth(); save();
      modal = { type: 'financialFeedback', title: `${item.name}: −${fmt(item.price)} монет`, feedback: { balance: state.wallet.balance, reserve: freeMoney(), goalDelay: delay, petMood: item.effect?.mood || null } };
      track('purchase_completed', { itemId: item.id, price: item.price, need: !!item.need, balanceBefore: beforeBalance, balanceAfter: state.wallet.balance, goalDelay: delay });
      if (delay > 0) track('goal_delayed', { goalId: state.activeGoal, reason: 'purchase', weeks: delay });
      render();
      setTimeout(() => { petBubble = ''; if (!modal && ['home', 'pet', 'shop'].includes(route)) render(); }, 1700);
    }
  }

  function chooseTask(i) {
    const t = C.tasks.find(x => x.id === taskScreen.id); if (!t) return;
    const choice = t.choices[i]; taskResult = { taskId: t.id, choice };
    if (choice.impact?.mood) adjustPet({ mood: choice.impact.mood });
    if (choice.impact?.health > 0) state.stats.positiveDecisions++;
    if (t.badge === 'scam' && i === 1) unlock('scam');
    save(); render();
  }

  function resolveAllocationTask() {
    const vals = ['necessary', 'wants', 'savings', 'reserve'].map(k => Math.max(0, Number(document.getElementById(`task_${k}`)?.value || 0)));
    const t = C.tasks.find(x => x.id === taskScreen.id);
    const total = vals.reduce((a, b) => a + b, 0); const amount = t?.amount || 1000;
    let result = '';
    if (total > amount) result = `Ты распределил ${fmt(total)} монет, хотя доступно ${fmt(amount)}. План нужно уменьшить на ${fmt(total - amount)}.`;
    else if (vals[0] < 300) result = 'На необходимое оставлено мало. Если появится обычный расход на еду и уход, план придётся менять.';
    else if (vals[3] < 100) result = 'План почти весь расписан. Он работает, но для неожиданности осталось мало пространства.';
    else result = 'В плане есть место и для необходимого, и для желаний, и для будущего. Реальная неделя всё равно может его изменить.';
    taskResult = { taskId: taskScreen.id, choice: { result, impact: { health: total <= amount && vals[3] >= 100 ? 5 : 0 } } }; render();
  }

  function resolveSubscriptionsTask() {
    const t = C.tasks.find(x => x.id === taskScreen.id); const subs = t?.subscriptions || [];
    const kept = subs.filter((x,i) => document.getElementById(`sub_${i}`)?.checked);
    const weekly = kept.reduce((s,x)=>s+x.price,0); const removed = subs.filter(x=>!kept.includes(x));
    const unusedKept = kept.filter(x=>!x.used);
    const result = unusedKept.length ? `Ты оставил подписки на ${weekly} монет в неделю, включая то, чем почти не пользуешься. Небольшие регулярные суммы складываются.` : `Остались подписки на ${weekly} монет в неделю. Ты убрал ${removed.length} регулярных расхода и освободил деньги для других решений.`;
    taskResult = {taskId:taskScreen.id, choice:{result,impact:{health:unusedKept.length?-2:5}}}; render();
  }

  function resolveSliderTask() {
    const v = Number(document.getElementById('goalSlider')?.value || 200); const weeks = Math.ceil(1200 / v);
    taskResult = { taskId: taskScreen.id, choice: { result: `Если откладывать по ${v} монет за неделю, цель в 1200 займёт примерно ${weeks} игровых недель. Больший взнос ускоряет цель, но оставляет меньше денег на текущую жизнь.`, impact: { health: 3 } } }; render();
  }

  function finishTask() {
    const t = C.tasks.find(x => x.id === taskScreen.id); if (!t) return;
    if (!state.completedTasks.includes(t.id)) {
      state.completedTasks.push(t.id); state.stats.tasksDone++; state.xp += 10; adjustPet({ development: 4, energy: 1 }); earn(t.reward, `Миссия «${t.title}»`, 'task');
      if (t.cyberSafety) track('cyber_safety_task_completed', { taskId:t.id, topic:t.topic || null, ageGroup:state.ageGroup });
      toast(`Дополнительный доход: +${t.reward}`);
    }
    checkAchievements(); save(); taskResult = null; route = 'tasks'; render();
  }

  function selectGoal(id) {
    const g = C.goals.find(x => x.id === id); if (!g) return;
    if (state.activeGoal && state.activeGoal !== id && state.wallet.savings > 0) {
      const ok = confirm('Деньги останутся в копилке и станут прогрессом новой цели. Сменить цель?'); if (!ok) return;
      track('goal_delayed', { previousGoal: state.activeGoal, newGoal: id });
    }
    state.activeGoal = id; track('goal_selected', { goalId: id }); save(); toast(`Цель выбрана: ${g.name}`); render();
  }

  function saveAmount(n) {
    n = Math.round(Number(n) || 0);
    if (n <= 0 || n > state.wallet.balance) { toast('Проверь сумму'); return; }
    state.wallet.balance -= n; state.wallet.savings += n; state.goalContributions++;
    tx('saving', -n, 'Копилка', activeGoal() ? `Вклад в цель «${activeGoal().name}»` : 'Вклад в копилку', 'savings');
    state.dayActions.count++;
    state.stats.positiveDecisions++;
    track('savings_deposit', { amount: n, goalId: state.activeGoal });
    const g = activeGoal();
    if (g && state.wallet.savings >= goalTarget(g) && !state.completedGoals.includes(g.id)) {
      state.completedGoals.push(g.id); adjustPet({ development: 10, mood: 10 }); unlock('strategist', true); track('goal_completed', { goalId: g.id }); toast(`Цель достигнута: ${g.name}`);
    } else toast(`В копилку: +${n}`);
    checkAchievements(); recalculateHealth(); save(); modal = null; render();
  }

  function withdrawSaving(n) {
    n = Math.min(Number(n) || 0, state.wallet.savings); if (n <= 0) return;
    const beforeWeeks = weeksToGoal();
    state.wallet.savings -= n; state.wallet.balance += n;
    tx('saving_withdrawal', n, 'Копилка', 'Возврат из копилки', 'savings');
    state.dayActions.count++;
    track('savings_withdrawal', { amount: n, goalId: state.activeGoal });
    recalculateHealth(); save();
    const afterWeeks = weeksToGoal();
    modal = { type: 'financialFeedback', title: `Вернули ${fmt(n)} монет`, feedback: { balance: state.wallet.balance, reserve: freeMoney(), goalDelay: beforeWeeks != null && afterWeeks != null ? Math.max(0, afterWeeks - beforeWeeks) : 0, goalWeeks: afterWeeks } };
    render();
  }

  function resolveEvent(i) {
    const e = C.events.find(x => x.id === modal.id); const c = e?.choices[i]; if (!c) return;
    const beforeBalance = state.wallet.balance; const beforeWeeks = weeksToGoal();
    const choiceDelay = c.cost && c.kind !== 'necessary' ? purchaseGoalDelay(c.cost) : 0;
    if (c.cost && state.wallet.balance + (c.income || 0) < c.cost) { toast('Монет не хватает для этого решения'); return; }
    track('event_choice_selected', { eventId: e.id, choice: i });
    if (c.income) {
      state.wallet.balance += c.income; tx('income', c.income, 'Событие', e.title, c.source || 'event'); state.dayActions.count++; state.dayActions.income += c.income;
    }
    if (c.cost) {
      const kind = c.kind === 'necessary' ? 'Необходимые расходы' : 'Желания';
      state.wallet.balance -= c.cost; tx('expense', -c.cost, kind, e.title, 'event', { eventId: e.id }); state.dayActions.count++; if (kind === 'Необходимые расходы') state.dayActions.necessary += c.cost; else state.dayActions.optional += c.cost;
      if (kind === 'Желания' && planForWeek() && actualsForWeek().wants > planForWeek().wants) { state.stats.impulsePurchases++; track('impulse_purchase', { eventId: e.id, price: c.cost }); }
    }
    if (c.save) {
      const s = Math.min(c.save, state.wallet.balance); state.wallet.balance -= s; state.wallet.savings += s; state.goalContributions++; tx('saving', -s, 'Копилка', 'Вклад после события', 'event'); track('savings_deposit', { amount: s, source: 'event' });
    }
    if (c.withdraw) {
      const s = Math.min(c.withdraw, state.wallet.savings); state.wallet.savings -= s; state.wallet.balance += s; tx('saving_withdrawal', s, 'Копилка', 'Снятие после события', 'event'); track('savings_withdrawal', { amount: s, source: 'event' });
    }
    if (c.nextWeekCost) state.nextWeekObligations.push({amount:c.nextWeekCost, description:e.title, source:c.source || 'event'});
    if (c.goalTargetDelta && activeGoal()) {
      state.goalAdjustments[state.activeGoal] = (state.goalAdjustments[state.activeGoal] || 0) + c.goalTargetDelta;
    }
    const petEff = c.pet || {};
    if (c.mood != null) petEff.mood = (petEff.mood || 0) + c.mood;
    if (c.care != null) petEff.care = (petEff.care || 0) + c.care;
    if (Object.keys(petEff).length) adjustPet(petEff);
    if (c.health > 0) state.stats.positiveDecisions++;
    state.eventResolved = true;
    state.recentEventIds.push(e.id); state.recentEventIds = state.recentEventIds.slice(-8);
    state.dayActions.count++;
    recalculateHealth(); checkAchievements(); track('event_completed', { eventId: e.id, balanceDelta: state.wallet.balance - beforeBalance }); save();
    const afterWeeks = weeksToGoal();
    modal = { type: 'eventResult', title: e.title, result: c.result, feedback: { balance: state.wallet.balance, reserve: freeMoney(), goalDelay: Math.max(choiceDelay, beforeWeeks != null && afterWeeks != null ? Math.max(0, afterWeeks - beforeWeeks) : 0), goalWeeks: afterWeeks, petMood: petEff.mood || null } };
    render();
  }

  function requestNewDay() {
    if (state.dayActions.count === 0 && !state.eventResolved) { modal = { type: 'dayConfirm' }; render(); return; }
    advanceDay();
  }

  function applyEndOfDay() {
    const moodDrop = state.dayActions.optional === 0 ? -4 : -2;
    adjustPet({ satiety: -9, mood: moodDrop, energy: 10, care: -6 });
    if (state.pet.satiety < 35) { state.stats.petNeedsIgnored++; track('pet_need_ignored', { need: 'satiety' }); }
    if (state.pet.care < 35) { state.stats.petNeedsIgnored++; track('pet_need_ignored', { need: 'care' }); }
  }

  function advanceDay() {
    applyEndOfDay();
    if (state.wallet.day >= 7) { completeWeek(); return; }
    state.wallet.day++;
    state.wallet.nextIncomeIn = Math.max(0, 8 - state.wallet.day);
    state.eventResolved = false;
    state.dayActions = { count: 0, necessary: 0, optional: 0, income: 0, sideJob: false };
    state.currentEventId = selectEventId();
    maybeCreateWish();
    state.streak++;
    checkAchievements(); recalculateHealth(); save(); toast(`День ${state.wallet.day}. До дохода ${state.wallet.nextIncomeIn} дн.`); render();
  }

  function maybeCreateWish() {
    if (!C.petWishes?.length || state.wallet.day % 2 !== 0) { state.petWish = null; return; }
    const w = C.petWishes[(state.wallet.week * 3 + state.wallet.day) % C.petWishes.length];
    state.petWish = { id: w.id, itemId: w.itemId || null, createdDay: state.wallet.day };
  }

  function dismissWish() {
    if (!state.petWish) return;
    state.wishDismissedDay = `${state.wallet.week}:${state.wallet.day}`;
    state.petWish = null;
    petBubble = 'Хорошо, не сейчас'; save(); render(); setTimeout(() => { petBubble = ''; if (route === 'home') render(); }, 1500);
  }

  function completeWeek() {
    const plan = planForWeek() || { necessary: 0, wants: 0, savings: 0, reserve: 0 };
    const actual = actualsForWeek();
    const snap = state.weekSnapshot || { startingBalance: state.wallet.balance, pet: { mood: state.pet.mood } };
    const summary = {
      week: state.wallet.week,
      startingBalance: snap.startingBalance,
      endingBalance: state.wallet.balance,
      plan: { ...plan },
      actual,
      petDelta: { mood: state.pet.mood - (snap.pet?.mood ?? state.pet.mood), wellbeing: petWellbeing() },
      insights: weekInsights(plan, actual, snap)
    };
    state.weekSummary = summary;
    state.weekHistory.push(summary); state.weekHistory = state.weekHistory.slice(-20);
    if (isBalancedWeek(summary)) state.stats.weeksBalanced++;
    track('budget_plan_vs_fact', { week: state.wallet.week, plan, actual });
    track('week_completed', { week: state.wallet.week, endingBalance: state.wallet.balance, wellbeing: petWellbeing() });
    recalculateHealth(); checkAchievements(); save(); route = 'weekSummary'; render(); window.scrollTo(0, 0);
  }

  function isBalancedWeek(s) {
    const p = s.plan, a = s.actual;
    return a.savings >= p.savings * 0.7 && a.wants <= p.wants * 1.35 + 50 && s.endingBalance >= Math.min(100, p.reserve) && petWellbeing() >= 50;
  }

  function weekInsights(plan, actual, snap) {
    const out = [];
    if (actual.wants > plan.wants + 80) out.push(`На желания ушло на ${fmt(actual.wants - plan.wants)} монет больше, чем ты планировал. Это уменьшило свободу в конце недели.`);
    if (actual.savings >= plan.savings && actual.savings > 0) out.push(`Ты выполнил или превысил план накоплений и приблизил цель.`);
    else if (plan.savings > actual.savings + 50) out.push(`В копилку получилось отправить на ${fmt(plan.savings - actual.savings)} меньше плана. Можно посмотреть, какие решения изменили темп.`);
    if (state.wallet.balance < Math.max(80, plan.reserve * 0.5)) out.push('Свободный запас к концу недели стал небольшим: неожиданная трата потребовала бы менять план.');
    if (state.wallet.balance > plan.reserve + 250 && state.pet.mood < (snap.pet?.mood ?? state.pet.mood) - 8) out.push(`Денег осталось много, но настроение ${state.pet.name} снизилось. Экономить абсолютно на всём тоже не было целью.`);
    if (actual.necessary > plan.necessary + 60) out.push(`Необходимые расходы оказались выше плана на ${fmt(actual.necessary - plan.necessary)}. План пришлось адаптировать — это нормальная часть финансовой жизни.`);
    if (out.length < 2 && isBalancedWeek({ plan, actual, endingBalance: state.wallet.balance })) out.push('Ты сохранил запас, не отказался от всех желаний и продолжил движение к цели.');
    if (out.length < 2) out.push('План и факт не обязаны совпадать. Полезно понимать, какое событие или желание изменило исходный план.');
    return out.slice(0, 2);
  }

  function startNextWeek() {
    state.weekSummary = null;
    state.wallet.week++;
    state.wallet.day = 1;
    state.wallet.nextIncomeIn = 7;
    state.wallet.needsSpent = 0;
    state.wallet.balance += state.wallet.weeklyIncome;
    tx('income', state.wallet.weeklyIncome, 'Доход', `Доход за неделю ${state.wallet.week}`, 'weekly_income');
    const obligations = state.nextWeekObligations || [];
    for (const o of obligations) {
      const paid = Math.min(state.wallet.balance, o.amount);
      state.wallet.balance -= paid;
      tx('expense', -paid, 'Необходимые расходы', o.description || 'Обязательство прошлой недели', o.source || 'obligation');
    }
    state.nextWeekObligations = [];
    track('week_started', { week: state.wallet.week, income: state.wallet.weeklyIncome });
    state.weekPlan = null;
    state.weekSnapshot = null;
    state.weekNeedsPlanning = true;
    state.eventResolved = false;
    state.dayActions = { count: 0, necessary: 0, optional: 0, income: 0, sideJob: false };
    state.currentEventId = selectEventId();
    state.petWish = null;
    recalculateHealth(); save(); route = 'weekStart'; render(); window.scrollTo(0, 0);
  }


  // ===== V3 CUSTDEV GAME-DEPTH OVERRIDES =====
  function freshState() {
    return {
      version: 4,
      onboardingDone: false,
      onboardingStep: 0,
      ageGroup: null,
      pet: { type: 'cat', name: 'Финни', color: C.petColors[0], accessory: 'none', satiety: 72, mood: 74, energy: 78, care: 76, development: 8 },
      wallet: { balance: 1000, savings: 0, weeklyIncome: 1000, week: 1, day: 1, nextIncomeIn: 7, needsSpent: 0 },
      activeGoal: null,
      goalContributions: 0,
      goalAdjustments: {},
      completedGoals: [],
      inventory: [],
      completedTasks: [],
      achievements: [],
      transactions: [],
      financialHealth: 68,
      xp: 0,
      streak: 1,
      stats: { needsFirst: 0, positiveDecisions: 0, budgetViews: 0, tasksDone: 0, impulsePurchases: 0, reserveUsed: 0, petNeedsIgnored: 0, weeksBalanced: 0 },
      currentEventId: null,
      currentChainId: null,
      eventResolved: false,
      recentEventIds: [],
      weekNeedsPlanning: true,
      weekPlan: null,
      weekSnapshot: null,
      weekSummary: null,
      weekHistory: [],
      weekOpeningCharges: [],
      dayActions: { count: 0, necessary: 0, optional: 0, income: 0, sideJob: false },
      petWish: null,
      wishDismissedDay: null,
      analytics: [],
      nextWeekObligations: [],
      futureObligations: [],
      worldProgress: { stage: 1, areas: ['home'], unlocks: [], decor: [] },
      worldPlacements: {},
      currentWorldArea: 'home',
      storyChains: {},
      activityLimits: { week: 1, sideJobs: 0 },
      workState: { week: 1, shiftsUsed: 0, shiftsLimit: 3, activityUsage: {} },
      workSession: null,
      settings: { sound: true, motion: true },
      createdAt: Date.now()
    };
  }

  function migrateState(raw) {
    const base = freshState();
    if (!raw) return base;
    const migrated = {
      ...base,
      ...raw,
      version: 4,
      pet: { ...base.pet, ...(raw.pet || {}) },
      wallet: { ...base.wallet, ...(raw.wallet || {}) },
      stats: { ...base.stats, ...(raw.stats || {}) },
      settings: { ...base.settings, ...(raw.settings || {}) },
      dayActions: { ...base.dayActions, ...(raw.dayActions || {}) },
      activityLimits: { ...base.activityLimits, ...(raw.activityLimits || {}) },
      workState: { ...base.workState, ...(raw.workState || {}) },
      workSession: raw.workSession || null,
      goalAdjustments: raw.goalAdjustments || {},
      recentEventIds: raw.recentEventIds || [],
      weekHistory: raw.weekHistory || [],
      analytics: raw.analytics || [],
      weekOpeningCharges: raw.weekOpeningCharges || [],
      futureObligations: raw.futureObligations || [],
      worldProgress: { ...base.worldProgress, ...(raw.worldProgress || {}) },
      worldPlacements: raw.worldPlacements || {},
      storyChains: raw.storyChains || {}
    };
    if ((raw.version || 1) < 2 && raw.onboardingDone) {
      migrated.weekNeedsPlanning = true;
      migrated.weekPlan = null;
      migrated.weekSnapshot = null;
      migrated.weekSummary = null;
      migrated.eventResolved = false;
    }
    if ((raw.version || 1) < 3) {
      const legacy = raw.nextWeekObligations || [];
      legacy.forEach((o, idx) => migrated.futureObligations.push({
        id:`legacy_${idx}_${Date.now()}`, type:'plannedPayment', amount:Number(o.amount)||0,
        dueWeek:(raw.wallet?.week || 1) + 1, dueDay:1, remainingPayments:1,
        description:o.description || 'Обязательство прошлой недели', sourceId:o.source || 'legacy',
        category:'Необходимые расходы', recurring:false, createdWeek:raw.wallet?.week || 1, createdDay:raw.wallet?.day || 1
      }));
      migrated.nextWeekObligations = [];
      for (const entry of migrated.inventory || []) {
        const p = C.world?.placements?.[entry.id];
        if (p && !migrated.worldPlacements[entry.id]) migrated.worldPlacements[entry.id] = { ...p, placed:true };
      }
      const completedWeeks = migrated.weekHistory.length;
      migrated.worldProgress.stage = completedWeeks >= 8 ? 5 : completedWeeks >= 5 ? 4 : completedWeeks >= 3 ? 3 : completedWeeks >= 1 ? 2 : 1;
      migrated.worldProgress.areas = ['home'];
      if (migrated.worldProgress.stage >= 3) migrated.worldProgress.areas.push('park');
      if (migrated.worldProgress.stage >= 4) migrated.worldProgress.areas.push('city');
    }
    if ((raw.version || 1) < 4) {
      const legacyUsed = Number(raw.activityLimits?.week === migrated.wallet.week ? raw.activityLimits?.sideJobs : 0) || 0;
      migrated.workState = { week:migrated.wallet.week, shiftsUsed:legacyUsed, shiftsLimit:3, activityUsage:{} };
      migrated.workSession = null;
      migrated.activityLimits = { week:migrated.wallet.week, sideJobs:legacyUsed };
    }
    if (migrated.workState.week !== migrated.wallet.week) migrated.workState = { week:migrated.wallet.week, shiftsUsed:0, shiftsLimit:3, activityUsage:{} };
    if (!migrated.worldProgress.areas?.includes(migrated.currentWorldArea)) migrated.currentWorldArea = 'home';
    if (!migrated.currentEventId) migrated.currentEventId = selectEventId(migrated, true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }

  function petStage() {
    const lvl = petLevel();
    if (state.ageGroup === '15-17') return ['Начальный этап','Освоился','Компаньон','Активный ритм','Самостоятельный этап'][lvl - 1];
    if (state.ageGroup === '7-11') return ['Малыш','Подрос','Любопытный','Уверенный','Особый облик'][lvl - 1];
    return ['Малыш','Подросший','Взрослый','Уверенный','Финальный облик'][lvl - 1];
  }
  function ageModeClass() { return `age-${state.ageGroup || '12-14'}`; }
  function goalView(g = activeGoal()) {
    if (!g) return null;
    const v = C.goalPresentation?.[state.ageGroup]?.[g.id] || {};
    return { ...g, ...v };
  }
  function completedWeeks(s = state) { return (s.weekHistory || []).length; }
  function desiredWorldStage(s = state) {
    const w = completedWeeks(s);
    if (w >= 8 || (s.completedGoals || []).length >= 3) return 5;
    if (w >= 5 || (s.completedGoals || []).includes('trip')) return 4;
    if (w >= 3 || (s.completedGoals || []).includes('bike')) return 3;
    if (w >= 1 || Object.keys(s.worldPlacements || {}).length >= 2) return 2;
    return 1;
  }
  function recalculateWorldProgress(trackChanges = true) {
    const prev = Number(state.worldProgress?.stage || 1);
    const next = Math.max(prev, desiredWorldStage());
    let changed = false;
    state.worldProgress = state.worldProgress || {stage:1,areas:['home'],unlocks:[],decor:[]};
    state.worldProgress.areas = state.worldProgress.areas || ['home'];
    state.worldProgress.unlocks = state.worldProgress.unlocks || [];
    state.worldProgress.decor = state.worldProgress.decor || [];
    if (next > prev) {
      state.worldProgress.stage = next; changed = true;
      if (trackChanges) track('world_area_unlocked', { stage:next, reason:'macro_progress' });
    }
    for (const area of C.world?.areas || []) {
      if (area.unlockStage <= state.worldProgress.stage && !state.worldProgress.areas.includes(area.id)) {
        state.worldProgress.areas.push(area.id); changed = true;
        if (trackChanges) track('world_area_unlocked', { areaId:area.id, stage:state.worldProgress.stage });
      }
    }
    if (!state.worldProgress.areas.includes(state.currentWorldArea)) state.currentWorldArea = 'home';
    if (changed) save();
    return state.worldProgress.stage;
  }
  function worldStageData() {
    recalculateWorldProgress(false);
    return C.world?.stages?.find(x => x.id === state.worldProgress.stage) || C.world?.stages?.[0];
  }
  function nextWorldStageData() {
    const stage = state.worldProgress?.stage || 1;
    return C.world?.stages?.find(x => x.id === stage + 1) || null;
  }
  function ensurePlacement(itemId) {
    const p = C.world?.placements?.[itemId];
    if (!p) return;
    state.worldPlacements = state.worldPlacements || {};
    if (!state.worldPlacements[itemId]) {
      state.worldPlacements[itemId] = { ...p, placed:true };
      track('world_item_unlocked', { itemId, area:p.area, zone:p.zone });
    }
  }
  function applyGoalUnlock(goalId) {
    const u = C.goalUnlocksByAge?.[state.ageGroup]?.[goalId] || C.goalUnlocks?.[goalId]; if (!u) return [];
    const changes = [];
    state.worldProgress = state.worldProgress || {stage:1,areas:['home'],unlocks:[],decor:[]};
    state.worldProgress.areas ||= ['home']; state.worldProgress.unlocks ||= []; state.worldProgress.decor ||= [];
    if (u.area && !state.worldProgress.areas.includes(u.area)) {
      state.worldProgress.areas.push(u.area); changes.push(u.message || `Открыто: ${u.area}`);
      track('world_area_unlocked', { areaId:u.area, reason:'goal', goalId });
    }
    if (u.worldDecor && !state.worldProgress.decor.includes(u.worldDecor)) {
      state.worldProgress.decor.push(u.worldDecor); changes.push(u.message || 'Мир изменился.');
      track('world_item_unlocked', { decorId:u.worldDecor, reason:'goal', goalId });
    }
    if (!state.worldProgress.unlocks.includes(`goal:${goalId}`)) state.worldProgress.unlocks.push(`goal:${goalId}`);
    return [...new Set(changes)];
  }

  function petActivity() {
    const seed = state.wallet.week * 11 + state.wallet.day * 5 + state.inventory.length;
    const owns = id => state.inventory.some(x => x.id === id);
    if (state.pet.energy < 28) return {cls:'sleep', text:state.ageGroup === '15-17' ? 'отдыхает' : 'задремал'};
    if (state.currentWorldArea === 'park' && owns('special_bike') && seed % 3 === 0) return {cls:'bike', text:'катается по парку'};
    if (owns('interior_sofa') && seed % 5 === 0) return {cls:'sofa', text:'устроился на диване'};
    if (owns('game_ball') && seed % 4 === 0) return {cls:'play', text:'играет с мячом'};
    if (state.currentWorldArea !== 'home') return {cls:'wander', text:state.currentWorldArea === 'park' ? 'осматривается в парке' : 'смотрит на город'};
    return seed % 2 ? {cls:'look', text:'разглядывает комнату'} : {cls:'wander', text:'ходит по комнате'};
  }
  function petThought() {
    const list = C.petThoughts?.[state.ageGroup] || [];
    if (!list.length || (state.wallet.week + state.wallet.day) % 3 !== 0) return '';
    return list[(state.wallet.week * 2 + state.wallet.day) % list.length];
  }

  function ensureStoryChainsFor(s = state, shouldTrack = false) {
    s.storyChains ||= {};
    const stage = s === state ? desiredWorldStage(s) : (s.worldProgress?.stage || 1);
    for (const chain of C.eventChains || []) {
      if (!chain.ageGroup.includes(s.ageGroup) || stage < chain.unlockStage) continue;
      if (!s.storyChains[chain.id]) {
        s.storyChains[chain.id] = { startedWeek:s.wallet.week, stageIndex:0, completed:false, lastShownWeek:null };
        if (shouldTrack && s === state) track('story_chain_started', { chainId:chain.id });
      }
    }
  }
  function dueChainEventFor(s = state) {
    ensureStoryChainsFor(s, s === state);
    for (const chain of C.eventChains || []) {
      const cs = s.storyChains?.[chain.id]; if (!cs || cs.completed) continue;
      const stage = chain.stages[cs.stageIndex]; if (!stage) continue;
      const dueWeek = cs.startedWeek + (stage.weekOffset || 0);
      if (s.wallet.week >= dueWeek && cs.lastShownWeek !== s.wallet.week) return {chainId:chain.id,eventId:stage.eventId};
    }
    return null;
  }
  function advanceStoryChain(chainId, eventId) {
    const chain = C.eventChains?.find(x => x.id === chainId); const cs = state.storyChains?.[chainId];
    if (!chain || !cs || cs.completed) return;
    const stage = chain.stages[cs.stageIndex]; if (!stage || stage.eventId !== eventId) return;
    cs.lastShownWeek = state.wallet.week; cs.stageIndex++;
    if (cs.stageIndex >= chain.stages.length) {
      cs.completed = true;
      const r = chain.completionResult || {};
      if (r.worldDecor && !state.worldProgress.decor.includes(r.worldDecor)) state.worldProgress.decor.push(r.worldDecor);
      if (r.petMood) adjustPet({mood:r.petMood});
      track('story_chain_completed', { chainId });
    }
  }

  function selectEventId(s = state, ignoreRecent = false) {
    const due = dueChainEventFor(s);
    if (due) { s.currentChainId = due.chainId; return due.eventId; }
    s.currentChainId = null;
    const pool = eventPoolFor(s);
    if (!pool.length) return C.events[0]?.id || null;
    const recent = ignoreRecent ? [] : (s.recentEventIds || []).slice(-4);
    const eligible = pool.filter(e => !recent.includes(e.id));
    const list = eligible.length ? eligible : pool;
    const seed = (s.wallet.week * 17 + s.wallet.day * 7 + (s.ageGroup || '').length) % list.length;
    return list[seed].id;
  }

  function createFutureObligation(spec = {}, sourceId = 'event') {
    const dueInDays = Math.max(0, Number(spec.dueInDays || 0));
    const dueInWeeks = Math.max(0, Number(spec.dueInWeeks || 0));
    let dueWeek = state.wallet.week + dueInWeeks;
    let dueDay = Number(spec.dueDay || 1);
    if (dueInDays) {
      const absolute = (state.wallet.day - 1) + dueInDays;
      dueWeek = state.wallet.week + Math.floor(absolute / 7);
      dueDay = (absolute % 7) + 1;
    }
    if (!dueInDays && !dueInWeeks && !spec.dueDay) { dueWeek = state.wallet.week + 1; dueDay = 1; }
    const o = {
      id:uid(), type:spec.type || 'plannedPayment', amount:Math.max(0, Number(spec.amount)||0), dueWeek, dueDay,
      remainingPayments:Math.max(1, Number(spec.remainingPayments)||1), description:spec.description || 'Будущий платёж',
      sourceId, category:spec.category || 'Необходимые расходы', recurring:!!spec.recurring,
      createdWeek:state.wallet.week, createdDay:state.wallet.day
    };
    state.futureObligations.push(o);
    track('delayed_consequence_created', { obligationId:o.id, type:o.type, amount:o.amount, dueWeek:o.dueWeek, dueDay:o.dueDay, sourceId });
    if (o.recurring || o.type === 'subscription') track('recurring_expense_created', { obligationId:o.id, type:o.type, amount:o.amount });
    return o;
  }
  function obligationDue(o, week = state.wallet.week, day = state.wallet.day) {
    return o.dueWeek < week || (o.dueWeek === week && (o.dueDay || 1) <= day);
  }
  function processDueObligations({showModal=true, opening=false} = {}) {
    const due = (state.futureObligations || []).filter(o => obligationDue(o));
    if (!due.length) return [];
    const charges = [];
    const keep = [];
    for (const o of state.futureObligations) {
      if (!obligationDue(o)) { keep.push(o); continue; }
      const paid = Math.min(state.wallet.balance, o.amount);
      if (paid > 0) {
        state.wallet.balance -= paid;
        tx('expense', -paid, o.category || 'Необходимые расходы', o.description, o.type, {obligationId:o.id,sourceId:o.sourceId});
        if ((o.category || '') === 'Необходимые расходы') state.dayActions.necessary += paid; else state.dayActions.optional += paid;
      }
      charges.push({...o, paid});
      track('delayed_consequence_triggered', { obligationId:o.id, type:o.type, amount:o.amount, paid, sourceId:o.sourceId });
      if (o.recurring || o.type === 'subscription') track('recurring_expense_paid', { obligationId:o.id, type:o.type, amount:paid });
      let remaining = Math.max(0, (o.remainingPayments || 1) - 1);
      if (paid < o.amount) {
        keep.push({...o, id:uid(), amount:o.amount-paid, dueWeek:state.wallet.week + (state.wallet.day >= 7 ? 1 : 0), dueDay:state.wallet.day >= 7 ? 1 : state.wallet.day + 1, remainingPayments:Math.max(1,remaining)});
      } else if (remaining > 0) {
        keep.push({...o, id:uid(), dueWeek:o.dueWeek + 1, dueDay:o.dueDay || 1, remainingPayments:remaining});
      }
    }
    state.futureObligations = keep;
    if (opening) state.weekOpeningCharges = charges.map(c => ({description:c.description, amount:c.paid, type:c.type}));
    recalculateHealth(); save();
    if (showModal && charges.length) modal = {type:'delayedImpact', charges};
    return charges;
  }

  function healthText() {
    const s = recalculateHealth();
    if (state.ageGroup === '7-11') {
      if (state.wallet.balance >= needsReserve() + 100) return ['Денег должно хватить', 'Есть место и для нужного, и для некоторых желаний.'];
      if (state.wallet.balance >= needsReserve()) return ['Денег осталось немного', 'На важное пока хватает, а новые покупки лучше сравнить с планом.'];
      return ['Денег мало до следующей недели', 'Придётся решить, что можно отложить.'];
    }
    const load = (state.futureObligations || []).filter(o => o.dueWeek <= state.wallet.week + 1).reduce((a,o)=>a+o.amount,0);
    if (state.ageGroup === '15-17' && load >= state.wallet.weeklyIncome * .35) return ['Высокая нагрузка обязательствами', `В ближайшем бюджете уже занято около ${fmt(load)} монет.`];
    if (s >= 80) return ['Хороший запас', 'Есть резерв и пространство для решений.'];
    if (s >= 62) return ['Стабильно', 'Бюджет пока выдерживает текущий темп.'];
    if (s >= 45) return ['Мало свободных средств', 'Следующие траты лучше сверять с планом.'];
    return ['Есть риск', 'Запаса мало: неожиданная трата может изменить планы.'];
  }

  function render() {
    if (showingSplash) {
      app.innerHTML = `<section class="splash"><div><div class="splash-mark">${petSVG('mumo', '#7C8CF8', 'badge')}</div><h1>КопиХвост</h1><p>Твои деньги. Твои решения.</p></div></section>`;
      return;
    }
    if (!state.onboardingDone) { renderOnboarding(); return; }
    recalculateWorldProgress(); ensureStoryChainsFor(state, true);
    app.innerHTML = `<main class="app-shell ${ageModeClass()}">${renderScreen()}${renderNav()}</main>${modal ? renderModal() : ''}`;
    bindCommon();
  }

  function pageArtwork(kind) {
    const scenes={goals:['🪙','🎧','🗺️'],budget:['💰','🪙','📖'],tasks:['📖','🧩','🏆'],shop:['🪴','🛹','🎁'],sidejob:['◇','🎧','💰'],profile:['📷','🗺️','🧢'],progress:['🏠','🪴','🗺️'],achievements:['🏆','🎁','📷'],savings:['🪙','🎧','💰'],settings:['🎧','🪴','📖']};
    const objects=scenes[kind]; if(!objects)return '';
    return `<div class="page-artwork artwork-${kind}" aria-hidden="true"><span class="artwork-wash"></span><svg class="artwork-line" viewBox="0 0 440 120" preserveAspectRatio="none"><path d="M12 85 C65 22 129 125 199 66 S332 18 425 73" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 7"/><path d="M25 34 l9 -4 m-4 -8 l3 10 M399 95 l12 -4 m-3 -8 l-4 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>${objects.map((o,i)=>`<span class="artwork-object artwork-object-${i}">${illustration(o)}</span>`).join('')}</div>`;
  }

  function topbar(title, back = false) {
    const period = state.ageGroup === '7-11' ? `Неделя ${state.wallet.week} · день ${state.wallet.day}` : `Неделя ${state.wallet.week} · день ${state.wallet.day}`;
    return `<div class="topbar"><div>${back ? `<button class="linkbtn" data-back>← Назад</button>` : ''}<div class="eyebrow">${period}</div><h1>${title}</h1></div><div class="balance-pill"><span class="coin">●</span>${fmt(state.wallet.balance)}</div></div>${state.workSession&&route==='sidejob'?'':pageArtwork(route)}`;
  }

  function jarPlannerRow(label, id, value, icon, hint) {
    const stacks = Math.max(0, Math.round(value / 100));
    return `<div class="jar-plan"><div class="jar-label"><span>${icon}</span><div><b>${label}</b><small>${hint}</small></div></div><div class="coin-stacks">${Array.from({length:Math.min(10,stacks)},()=>'<i>●</i>').join('') || '<em>пусто</em>'}</div><div class="jar-controls"><button data-jar-delta="-100" data-jar-target="${id}">−</button><input id="${id}" type="number" value="${Math.max(0,Math.round(value))}" readonly><button data-jar-delta="100" data-jar-target="${id}">+</button></div></div>`;
  }

  function weekStartScreen() {
    const existing = planForWeek();
    const availableNow = state.wallet.balance;
    const available = planningBudget();
    const needs = existing?.necessary ?? expectedNeedsTotal();
    const wants = existing?.wants ?? Math.min(200, Math.max(0, available - needs));
    const savings = existing?.savings ?? Math.min(200, Math.max(0, available - needs - wants));
    const reserve = existing?.reserve ?? Math.max(0, available - needs - wants - savings);
    const g = goalView();
    const charges = state.weekOpeningCharges || [];
    if (state.ageGroup === '7-11') {
      return `<section class="screen week-screen junior-week"><div class="week-kicker">${editingPlan ? 'Можно поменять' : 'Новая неделя'}</div><h1>Разложим монеты</h1><p class="week-lead">Монет всего ${fmt(available)}. Перекладывай их между четырьмя коробками — всё сразу выбрать не получится.</p>
        ${charges.length ? `<div class="opening-charges"><b>Сначала произошло само</b>${charges.map(c=>`<span>${esc(c.description)} −${fmt(c.amount)}</span>`).join('')}</div>`:''}
        <div class="junior-jars">${jarPlannerRow('Нужно','planNecessary',needs,'●','еда и уход')}${jarPlannerRow('Хочу','planWants',wants,'★','игры и вещи')}${jarPlannerRow('Коплю','planSavings',savings,'◆',g ? g.name : 'на большую цель')}${jarPlannerRow('Оставлю','planReserve',reserve,'○','на потом')}</div>
        <div class="plan-total" id="planTotal" data-budget="${available}">Разложено: ${fmt(needs+wants+savings+reserve)} из ${fmt(available)}</div><button class="btn primary block" data-save-plan>${editingPlan?'Сохранить':'Начать неделю'}</button></section>`;
    }
    return `<section class="screen week-screen ${state.ageGroup==='15-17'?'teen-week':''}"><div class="week-kicker">${editingPlan ? 'План недели' : 'Новая неделя'}</div><h1>${editingPlan ? 'Обновить распределение' : `Неделя ${state.wallet.week}`}</h1><p class="week-lead">План показывает приоритеты. Он может меняться после событий.</p>
      <div class="card income-card"><span>Доход</span><b>+${fmt(state.wallet.weeklyIncome)} ●</b><small>Доступно после автоматических списаний: ${fmt(availableNow)} ●</small></div>
      ${charges.length ? `<div class="opening-charges"><b>Автоматические списания</b>${charges.map(c=>`<span>${esc(c.description)} −${fmt(c.amount)}</span>`).join('')}</div>`:''}
      <div class="week-context"><div><span>${state.ageGroup==='15-17'?'Базовые расходы':'Примерно необходимое'}</span><b>≈ ${fmt(expectedNeedsTotal())}</b></div><div><span>Текущая цель</span><b>${g ? `${illustration(g.icon,g.name||g.label||g.id)} ${esc(g.name)} · осталось ${fmt(Math.max(0,goalTarget(activeGoal())-goalSaved()))}`:'Не выбрана'}</b></div></div>
      <div class="section-title"><h2>${state.ageGroup==='15-17'?'Распределение':'Как распределить деньги?'}</h2></div><div class="plan-form">${planInput('Необходимое','planNecessary',needs,'Еда, уход и базовые расходы')}${planInput('Желания','planWants',wants,'Покупки и досуг')}${planInput('Копилка','planSavings',savings,'На текущую цель')}${planInput(state.ageGroup==='15-17'?'Свободный остаток':'Резерв','planReserve',reserve,'Оставить пространство для решений')}</div>
      <div class="plan-total" id="planTotal" data-budget="${available}">План: ${fmt(needs+wants+savings+reserve)} из ${fmt(available)}</div><button class="btn primary block" data-save-plan>${editingPlan?'Сохранить изменения':'Начать неделю'}</button></section>`;
  }

  function worldDecorHtml(area) {
    const decor = state.worldProgress?.decor || [];
    const bits = [];
    if (area === 'home' && decor.includes('comfort')) bits.push(`<div class="world-decor comfort">${illustration('🛋️')}</div>`);
    if (area === 'home' && decor.includes('room_plus')) bits.push(`<div class="world-decor room-plus">${illustration('🪟')}</div>`);
    if (area === 'park' && decor.includes('mobility')) bits.push(`<div class="world-decor mobility">${illustration('🚲')}</div>`);
    if (area === 'city' && decor.includes('festival')) bits.push(`<div class="world-decor festival">${illustration('🎟️')}</div>`);
    if (area === 'city' && decor.includes('festival_memory')) bits.push(`<div class="world-decor memory">${illustration('📷')}</div>`);
    return bits.join('');
  }
  function roomItemsHtml(area = state.currentWorldArea || 'home') {
    const entries = Object.entries(state.worldPlacements || {}).filter(([id,p]) => p.placed && p.area === area && state.inventory.some(x=>x.id===id));
    return `<div class="placed-items">${entries.map(([id,p])=>{const i=C.items.find(x=>x.id===id);return i?`<div class="placed-item zone-${p.zone}" title="${esc(i.name)}">${illustration(i.icon,i.name||i.label||i.id)}</div>`:''}).join('')}${worldDecorHtml(area)}</div>`;
  }
  function worldSceneHtml() {
    const area = state.currentWorldArea || 'home'; const act = petActivity(); const thought = petThought();
    const areas = (C.world?.areas || []).filter(a => state.worldProgress.areas.includes(a.id));
    return `<div class="world-wrap"><div class="world-tabs">${areas.map(a=>`<button data-world-area="${a.id}" class="${area===a.id?'active':''}">${illustration(a.icon,a.name||a.label||a.id)} ${a.name}</button>`).join('')}</div><div class="world-scene area-${area}">${roomItemsHtml(area)}${thought?`<div class="ambient-thought">${thought}</div>`:''}<button class="pet-stage pet-stage-button pet-motion-${act.cls}" aria-label="Открыть состояние питомца" data-route="pet">${petBubble?`<div class="pet-bubble">${petBubble}</div>`:''}${petSVG()}</button><div class="pet-activity">${esc(state.pet.name)} ${act.text}</div></div></div>`;
  }
  function worldProgressCard() {
    const s = worldStageData(); const next = nextWorldStageData();
    const remaining = next ? Math.max(0, next.unlockWeek - completedWeeks()) : 0;
    return `<div class="card world-progress-card"><div><div class="eyebrow">Развитие мира</div><h3>Этап ${s.id} · ${s.title}</h3><p>${s.note}</p></div>${next?`<div class="next-unlock"><b>${next.title}</b><span>${remaining<=1?'совсем близко':`ещё около ${remaining} нед.`}</span></div>`:'<div class="next-unlock"><b>Мир открыт</b><span>дальше решают цели и события</span></div>'}</div>`;
  }

  function homeScreen() {
    const g = goalView(); const baseGoal = activeGoal(); const event = currentEvent(); const h = healthText();
    const teen = state.ageGroup === '15-17'; const junior = state.ageGroup === '7-11';
    return `<section class="screen home-screen">${topbar(teen?'Жизнь':'Дом')}${worldSceneHtml()}<div class="pet-status-line"><b>${petStage()}</b><span>${petWellbeing()>=70?'в хорошем состоянии':petWellbeing()>=50?'в норме':'нужно немного внимания'}</span></div>
      <div class="stat-row ${teen?'compact-stats':''}">${miniStat(junior?'Сыт':'Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,teen?'◡':'☻')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat(junior?'Чисто':'Уход',state.pet.care,'✦')}</div>
      <div class="section-title"><h2>${junior?'Что случилось':'Текущая ситуация'}</h2><span class="soft-label">${event?.categoryLabel||'событие'}</span></div>${eventTeaser()}
      <div class="money-strip"><div><span>${junior?'Монеты':'Баланс'}</span><b>${fmt(state.wallet.balance)} ●</b></div><div><span>До дохода</span><b>${state.wallet.nextIncomeIn} дн.</b></div><div><span>${junior?'Хватит?':'Состояние'}</span><b>${h[0]}</b></div></div>
      ${g?`<div class="section-title"><h2>${junior?'Коплю на':'Текущая цель'}</h2><button data-route="goals">Открыть</button></div><div class="card goal-card"><div class="goal-icon">${illustration(g.icon,g.name||g.label||g.id)}</div><div><h3>${esc(g.name)}</h3><p>${fmt(goalSaved())} из ${fmt(goalTarget(baseGoal))} · ≈ ${weeksToGoal()} нед.</p><div class="bar green"><i style="width:${progressPct()}%"></i></div></div><div class="goal-progress">${progressPct()}%</div></div>`:`<div class="section-title"><h2>${junior?'На что будем копить?':'Долгосрочная цель'}</h2></div><button class="btn secondary block" data-route="goals">Выбрать цель</button>`}
      <div class="section-title"><h2>${teen?'Действия':'Что сделать?'}</h2></div><div class="quick-actions"><button class="action" data-action="feed"><span class="ico">${illustration('🥣')}</span><b>${teen?'Еда':'Покормить'}</b><small>40 ●</small></button><button class="action" data-action="play"><span class="ico">${illustration('⚽')}</span><b>${teen?'Досуг':'Играть'}</b><small>80 ●</small></button><button class="action" data-action="care"><span class="ico">${illustration('🫧')}</span><b>${teen?'Уход':'Ухаживать'}</b><small>60 ●</small></button><button class="action" data-route="shop"><span class="ico">${illustration('','shop')}</span><b>Магазин</b><small>выбрать</small></button></div>${teen?`<button class="work-entry" data-route="sidejob"><span class="work-entry-icon">${illustration('◇')}</span><span><b>${state.workSession?'Продолжить смену':'Подработка'}</b><small>${workShiftStatusShort()} · от +120 монет / −20 энергии</small></span><span aria-hidden="true">›</span></button>`:''}
      ${wishHtml()}${worldProgressCard()}<button class="btn primary block end-day" data-new-day>Завершить день ${state.wallet.day}</button></section>`;
  }

  function wishHtml() {
    if (!state.petWish) return '';
    const w = C.petWishes?.find(x=>x.id===state.petWish.id); if (!w) return '';
    const heading = state.ageGroup==='15-17' ? 'Идея на потом' : `${esc(state.pet.name)} думает`;
    return `<div class="card wish-card"><div class="round-icon">${illustration('☻')}</div><div><h3>${heading}</h3><p>${w.text}</p></div><div class="wish-actions">${w.itemId?`<button class="linkbtn" data-wish-buy="${w.itemId}">Посмотреть</button>`:`<button class="linkbtn" data-action="play">Заняться этим</button>`}<button class="linkbtn muted-link" data-dismiss-wish>Не сейчас</button></div></div>`;
  }

  function petScreen() {
    const teen = state.ageGroup==='15-17';
    return `<section class="screen">${topbar(teen?'Компаньон':state.pet.name,true)}${worldSceneHtml()}<div class="section-title"><h2>${teen?'Состояние':'Как себя чувствует'}</h2></div><div class="stat-row">${miniStat('Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,'◡')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat('Уход',state.pet.care,'✦')}</div><div class="section-title"><h2>${teen?'Активности':'Забота'}</h2></div><div class="grid2"><button class="btn secondary" data-action="feed">${teen?'Еда':'🥣 Покормить'} · 40</button><button class="btn secondary" data-action="care">${teen?'Уход':'🫧 Уход'} · 60</button><button class="btn secondary" data-action="play">${teen?'Досуг':'⚽ Играть'} · 80</button><button class="btn secondary" data-route="shop">Магазин</button></div><div class="section-title"><h2>Что появилось в мире</h2></div><div class="inventory-strip">${state.inventory.length?state.inventory.slice().reverse().map(x=>C.items.find(i=>i.id===x.id)).filter(Boolean).slice(0,16).map(i=>`<div class="inventory-chip">${illustration(i.icon,i.name||i.label||i.id)}<span>${i.name}</span></div>`).join(''):`<div class="need-note">Первые покупки будут видны прямо в пространстве.</div>`}</div></section>`;
  }

  function purchaseContext(item) {
    const afterBalance = Math.max(0,state.wallet.balance-item.price); const reserve = Math.max(0,afterBalance-needsReserve()); const delay = item.need?0:purchaseGoalDelay(item.price);
    if (state.ageGroup==='7-11') return delay>0?`Останется ${fmt(afterBalance)}. Большая цель станет дальше.`:`После покупки останется ${fmt(afterBalance)} монет.`;
    if (delay>0) return `Свободно ≈ ${fmt(reserve)}. Цель может сдвинуться примерно на ${delay} нед.`;
    return `После покупки свободно ≈ ${fmt(reserve)} монет.`;
  }

  function budgetScreen() {
    state.stats.budgetViews++; recalculateHealth(); checkAchievements(); save();
    const reserve=needsReserve(), free=freeMoney(), h=healthText(), plan=planForWeek(), actual=actualsForWeek();
    if (state.ageGroup==='7-11') return `<section class="screen">${topbar('Мои монеты')}<div class="junior-budget"><div class="junior-money-card"><span>Сейчас</span><b>${fmt(state.wallet.balance)} ●</b></div><div class="junior-money-card"><span>Коплю</span><b>${fmt(state.wallet.savings)} ●</b></div><div class="junior-money-card"><span>Нужно оставить</span><b>≈ ${fmt(reserve)} ●</b></div><div class="junior-money-card"><span>До следующей недели</span><b>${state.wallet.nextIncomeIn} дн.</b></div></div><div class="card junior-health"><b>${h[0]}</b><p>${h[1]}</p></div><div class="section-title"><h2>Как разложили</h2><button data-edit-plan>Поменять</button></div>${plan?`<div class="card simple-buckets"><span>Нужно <b>${fmt(plan.necessary)}</b></span><span>Хочу <b>${fmt(plan.wants)}</b></span><span>Коплю <b>${fmt(plan.savings)}</b></span><span>Оставлю <b>${fmt(plan.reserve)}</b></span></div>`:'<div class="need-note">Сначала разложи монеты в начале недели.</div>'}<div class="section-title"><h2>Что происходило</h2></div><div class="card history">${historyHtml()}</div></section>`;
    const obligations=(state.futureObligations||[]).filter(o=>o.dueWeek<=state.wallet.week+2).sort((a,b)=>a.dueWeek-b.dueWeek||a.dueDay-b.dueDay);
    return `<section class="screen">${topbar(state.ageGroup==='15-17'?'Бюджет':'Мой бюджет')}<div class="metric-grid"><div class="metric"><div class="label">Баланс</div><div class="value">${fmt(state.wallet.balance)}</div><div class="hint">в основном кошельке</div></div><div class="metric"><div class="label">До дохода</div><div class="value">${state.wallet.nextIncomeIn} дн.</div><div class="hint">+${fmt(state.wallet.weeklyIncome)} монет</div></div><div class="metric"><div class="label">Базовые расходы</div><div class="value money-orange">${fmt(reserve)}</div><div class="hint">оценка до конца недели</div></div><div class="metric"><div class="label">Свободно сейчас</div><div class="value money-green">${fmt(free)}</div><div class="hint">после базовых потребностей</div></div></div><div class="section-title"><h2>${state.ageGroup==='15-17'?'Устойчивость':'Финансовое здоровье'}</h2></div><div class="card health-card"><div class="health-dot ${state.financialHealth>=62?'stable':state.financialHealth>=45?'caution':'risk'}"></div><div><h3>${h[0]}</h3><p>${h[1]}</p></div></div>${state.ageGroup==='15-17'&&obligations.length?`<div class="section-title"><h2>Будущие списания</h2></div><div class="card obligation-list">${obligations.slice(0,5).map(o=>`<div><span>${esc(o.description)}</span><b>−${fmt(o.amount)} · нед. ${o.dueWeek}</b></div>`).join('')}</div>`:''}<div class="section-title"><h2>План → факт</h2><button data-edit-plan>Изменить план</button></div>${plan?planFactHtml(plan,actual):'<div class="need-note">У этой недели ещё нет плана.</div>'}<div class="section-title"><h2>Копилка</h2><button data-savings>Управлять</button></div><div class="card"><div class="goal-card"><div class="goal-icon">${illustration('🪙')}</div><div><h3>${fmt(state.wallet.savings)} монет</h3><p>${goalView()?`Для цели «${esc(goalView().name)}» · ≈ ${weeksToGoal()} нед.`:'Можно выбрать цель позже'}</p></div></div></div><div class="section-title"><h2>История</h2></div><div class="card history">${historyHtml()}</div></section>`;
  }

  function goalsScreen() {
    const title=state.ageGroup==='7-11'?'На что коплю':'Цели';
    const lead=state.ageGroup==='7-11'?'Большие вещи требуют нескольких недель. Когда цель достигнута, мир действительно меняется.':state.ageGroup==='15-17'?'Долгосрочная цель конкурирует с текущими расходами и может открывать новые возможности.':'Цели меняют не только цифру: после достижения могут открыться новые места и активности.';
    return `<section class="screen">${topbar(title)}<p class="subtle">${lead}</p><div class="goal-list">${C.goals.map(g=>{const v=goalView(g),target=goalTarget(g),active=state.activeGoal===g.id,pct=active?progressPct():0,done=state.completedGoals.includes(g.id);return `<div class="card goal-select ${active?'active':''} ${done?'goal-done':''}"><div class="goal-icon">${illustration(v.icon,v.name||v.label||v.id)}</div><div><h3>${esc(v.name)}</h3><p>${fmt(target)} монет · ${esc(v.note)}</p>${active?`<div class="bar green"><i style="width:${pct}%"></i></div><p class="goal-detail">${fmt(state.wallet.savings)} / ${fmt(target)} · ≈ ${weeksToGoal()} нед.</p>`:''}${done?'<span class="tag need">Открыто</span>':''}</div>${done?'':`<button class="linkbtn" data-goal="${g.id}">${active?'Выбрано':'Выбрать'}</button>`}</div>`}).join('')}</div><button class="btn secondary block" data-savings>Открыть копилку</button></section>`;
  }

  function profileScreen() {
    const ws=worldStageData();
    return `<section class="screen">${topbar('Профиль')}<div class="card profile-row"><div class="avatar">${petSVG()}</div><div><h3>${esc(state.pet.name)}</h3><p class="subtle">Режим ${state.ageGroup} · ${petStage()}</p></div></div><div class="card macro-card"><div class="eyebrow">Мир</div><h3>Этап ${ws.id} · ${ws.title}</h3><p>${ws.note}</p><div class="world-badges">${state.worldProgress.areas.map(a=>`<span>${C.world.areas.find(x=>x.id===a)?.name||a}</span>`).join('')}</div></div><div class="menu"><button data-route="progress">Прогресс мира <span>›</span></button><button data-route="achievements">Достижения <span>${state.achievements.length}/${C.achievements.length} ›</span></button><button data-route="settings">Настройки <span>›</span></button></div></section>`;
  }
  function progressScreen() {
    const h=healthText(),ws=worldStageData(),next=nextWorldStageData();
    return `<section class="screen">${topbar('Прогресс',true)}${worldProgressCard()}<div class="card"><div class="pet-stage" style="height:170px">${petSVG()}</div><div class="center"><b>${petStage()}</b><p class="subtle">Развитие питомца: ${Math.round(state.pet.development)}/100</p><div class="bar"><i style="width:${state.pet.development}%"></i></div></div></div><div class="metric-grid"><div class="metric"><div class="label">Пройдено недель</div><div class="value">${state.weekHistory.length}</div></div><div class="metric"><div class="label">Открыто мест</div><div class="value">${state.worldProgress.areas.length}</div></div><div class="metric"><div class="label">Предметов в мире</div><div class="value">${Object.keys(state.worldPlacements||{}).length}</div></div><div class="metric"><div class="label">${state.ageGroup==='7-11'?'Денег хватит?':'Состояние'}</div><div class="value compact-value">${h[0]}</div></div></div>${next?`<div class="card next-stage-detail"><b>Дальше: ${next.title}</b><p>${next.note}</p></div>`:''}</section>`;
  }

  function weekSummaryScreen() {
    const s=state.weekSummary;if(!s){route='home';return homeScreen();}
    const junior=state.ageGroup==='7-11';
    return `<section class="screen week-screen summary-screen"><div class="week-kicker">Неделя ${s.week} завершена</div><h1>${junior?'Что изменилось':'Итоги недели'}</h1><p class="week-lead">${junior?'Посмотрим на монеты, питомца и комнату.':'Снимок того, как решения изменили деньги и мир.'}</p><div class="summary-balance"><span>Было</span><b>${fmt(s.startingBalance)} ●</b><span>Осталось</span><b>${fmt(s.endingBalance)} ●</b></div><div class="summary-grid"><div><span>${junior?'На нужное':'Необходимое'}</span><b>${fmt(s.actual.necessary)}</b></div><div><span>${junior?'На хотелки':'Желания'}</span><b>${fmt(s.actual.wants)}</b></div><div><span>${junior?'В копилку':'Отложил'}</span><b>${fmt(s.actual.savings)}</b></div><div><span>Доп. доход</span><b>${fmt(s.actual.extraIncome)}</b></div></div>${s.actual.sideJobIncome>0?`<div class="work-income-summary"><span>Подработка</span><b>+${fmt(s.actual.sideJobIncome)} ●</b></div>`:''}${junior?'':`<div class="section-title"><h2>План → факт</h2></div>${planFactSummaryHtml(s)}`}<div class="section-title"><h2>Что изменила неделя</h2></div><div class="week-world-changes">${(s.worldChanges||[]).length?(s.worldChanges||[]).map(x=>`<div class="world-change">✦ <span>${x}</span></div>`).join(''):'<div class="world-change">○ <span>Мир не обязан меняться каждую неделю — крупные открытия требуют нескольких решений.</span></div>'}</div><div class="section-title"><h2>${junior?'Что можно заметить':'Наблюдения'}</h2></div><div class="insights">${s.insights.map(x=>`<div class="insight"><span>·</span><p>${x}</p></div>`).join('')}</div><div class="card pet-week-result"><div>${petSVG()}</div><div><b>${esc(state.pet.name)}</b><p>Настроение ${Math.round(state.pet.mood)} · состояние ${petWellbeing()}</p><span>${s.petDelta.mood>=0?'Неделя дала достаточно приятных моментов.':'На этой неделе приятных активностей было меньше.'}</span></div></div><button class="btn primary block" data-next-week>Перейти к новой неделе</button></section>`;
  }

  function renderModal() {
    if (modal.type==='event') {
      const e=C.events.find(x=>x.id===modal.id); if(!e) return '';
      return `<div class="overlay" data-close-overlay><div class="sheet" data-sheet><div class="sheet-handle"></div><div class="eyebrow">${e.categoryLabel||'Событие'}</div><h2>${e.title}</h2><p>${e.situation||e.text}</p><div class="stack">${e.choices.map((c,i)=>`<button class="choice event-choice" data-event-choice="${i}"><b>${c.text}</b>${choicePreview(c,e)}</button>`).join('')}</div></div></div>`;
    }
    if (modal.type==='eventResult') return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Что произошло</div><h2>${modal.title||'Последствие'}</h2><div class="result-box"><p>${modal.result}</p></div>${modal.feedback?feedbackHtml(modal.feedback):''}<button class="btn primary block" style="margin-top:12px" data-close-modal>Продолжить</button></div></div>`;
    if (modal.type==='delayedImpact') {
      const total=modal.charges.reduce((s,c)=>s+(c.paid||0),0);
      return `<div class="overlay"><div class="sheet delayed-sheet"><div class="sheet-handle"></div><div class="eyebrow">Произошло автоматически</div><h2>−${fmt(total)} монет</h2><div class="delayed-list">${modal.charges.map(c=>`<div><span>${esc(c.description)}</span><b>−${fmt(c.paid||0)}</b></div>`).join('')}</div><p class="subtle">Это последствие решения из прошлых игровых дней или недель.</p><button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;
    }
    if (modal.type==='goalUnlocked') return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Большая цель</div><h2>${esc(modal.title)}</h2><p>${esc(modal.message)}</p><div class="unlock-visual">${modal.icon||'✦'}</div><button class="btn primary block" data-close-modal>Посмотреть мир</button></div></div>`;
    if (modal.type==='financialFeedback') return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Цена решения</div><h2>${modal.title}</h2>${feedbackHtml(modal.feedback)}<button class="btn primary block" style="margin-top:12px" data-close-modal>Понятно</button></div></div>`;
    if (modal.type==='saveFirst') { const n=Math.min(modal.amount||200,state.wallet.balance); return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Перед неделей</div><h2>${state.ageGroup==='7-11'?'Сразу положить в копилку?':'Отложить сначала?'}</h2><p>Это не обязательно. Можно оставить деньги свободными и решить позже.</p><div class="grid2"><button class="btn good" data-save="${n}">Отложить ${fmt(n)}</button><button class="btn secondary" data-close-modal>Не сейчас</button></div></div></div>`; }
    if (modal.type==='workComplete') return `<div class="overlay"><div class="sheet work-complete-sheet"><div class="sheet-handle"></div><div class="eyebrow">Смена завершена</div><h2>+${fmt(modal.reward)} монет</h2><div class="feedback-grid"><div><span>Энергия</span><b>−${fmt(modal.energyCost)}</b></div><div><span>Баланс</span><b>${fmt(modal.balance)} ●</b></div><div><span>Осталось энергии</span><b>${Math.round(modal.energy)}⚡</b></div></div><p class="subtle">Деньги уже в обычном кошельке. Дальше решаешь сам: потратить, оставить или отложить.</p><button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;
    if (modal.type==='dayConfirm') return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><h2>Завершить день?</h2><p>Можно ничего не покупать. Потребности немного изменятся просто потому, что игровой день прошёл.</p><div class="grid2"><button class="btn primary" data-confirm-day>Завершить</button><button class="btn secondary" data-close-modal>Вернуться</button></div></div></div>`;
    return '';
  }

  function choicePreview(c,e) {
    const bits=[];
    if(c.cost)bits.push(`−${c.cost} ●`); if(c.income)bits.push(`+${c.income} ●`); if(c.save)bits.push(`${c.save} → копилка`); if(c.pet?.mood||c.mood)bits.push(`${(c.pet?.mood||c.mood)>0?'+':''}${c.pet?.mood||c.mood} настроение`);
    if(c.future)bits.push('последствие позже'); if(!bits.length)bits.push('без прямой траты');
    return `<span>${bits.slice(0,2).join(' · ')}</span>`;
  }
  function feedbackHtml(f) {
    const lines=[];
    if(f.balance!=null)lines.push(`<div><span>Баланс</span><b>${fmt(f.balance)} ●</b></div>`);
    if(f.petMood!=null)lines.push(`<div><span>Настроение</span><b>${f.petMood>0?'+':''}${f.petMood}</b></div>`);
    if(f.goalDelay>0)lines.push(`<div><span>${state.ageGroup==='7-11'?'Большая цель':'Влияние на цель'}</span><b>≈ +${f.goalDelay} нед.</b></div>`);
    else if(f.reserve!=null)lines.push(`<div><span>${state.ageGroup==='7-11'?'Останется свободно':'Свободно'}</span><b>${fmt(f.reserve)} ●</b></div>`);
    else if(f.goalWeeks!=null)lines.push(`<div><span>До цели</span><b>≈ ${f.goalWeeks} нед.</b></div>`);
    return `<div class="feedback-grid">${lines.slice(0,3).join('')}</div>`;
  }

  function bindCommon() {
    document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>{route=b.dataset.route;taskResult=null;if(route==='sidejob')track('side_job_opened',{source:'navigation'});if(route!=='weekStart')editingPlan=false;render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>{route=(route==='shop'||route==='task'||route==='pet'||route==='sidejob')?'home':(route==='savings'?'budget':'profile');taskResult=null;render();});
    document.querySelectorAll('[data-open-task]').forEach(b=>b.onclick=()=>{taskScreen.id=b.dataset.openTask;route='task';taskResult=null;render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>quickAction(b.dataset.action));
    document.querySelectorAll('[data-shop-cat]').forEach(b=>b.onclick=()=>{shopScreen.cat=b.dataset.shopCat;render();});
    document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>buyItem(b.dataset.buy));
    document.querySelectorAll('[data-task-choice]').forEach(b=>b.onclick=()=>chooseTask(Number(b.dataset.taskChoice)));
    document.querySelectorAll('[data-finish-task]').forEach(b=>b.onclick=finishTask);
    document.querySelectorAll('[data-task-allocate]').forEach(b=>b.onclick=resolveAllocationTask);
    document.querySelectorAll('[data-task-slider]').forEach(b=>b.onclick=resolveSliderTask);
    document.querySelectorAll('[data-task-subscriptions]').forEach(b=>b.onclick=resolveSubscriptionsTask);
    document.querySelectorAll('[data-savings]').forEach(b=>b.onclick=()=>{modal=null;route='savings';render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-goal]').forEach(b=>b.onclick=()=>selectGoal(b.dataset.goal));
    document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{modal={type:'event',id:b.dataset.event};track('event_started',{eventId:b.dataset.event,chainId:state.currentChainId});render();});
    document.querySelectorAll('[data-event-choice]').forEach(b=>b.onclick=()=>resolveEvent(Number(b.dataset.eventChoice)));
    document.querySelectorAll('[data-close-overlay]').forEach(x=>x.onclick=e=>{if(e.target===x){modal=null;render();}}); document.querySelectorAll('[data-sheet]').forEach(x=>x.onclick=e=>e.stopPropagation()); document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=()=>{modal=null;render();});
    document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>saveAmount(Number(b.dataset.save))); document.querySelectorAll('[data-save-custom]').forEach(b=>b.onclick=()=>{const n=Number(document.querySelector('#saveAmount')?.value||0);if(n>0)saveAmount(n);}); document.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=()=>withdrawSaving(Number(b.dataset.withdraw)));
    document.querySelectorAll('[data-new-day]').forEach(b=>b.onclick=requestNewDay); document.querySelectorAll('[data-confirm-day]').forEach(b=>b.onclick=()=>{modal=null;advanceDay();}); document.querySelectorAll('[data-next-week]').forEach(b=>b.onclick=startNextWeek); document.querySelectorAll('[data-save-plan]').forEach(b=>b.onclick=saveWeekPlan); document.querySelectorAll('[data-edit-plan]').forEach(b=>b.onclick=()=>{editingPlan=true;route='weekStart';render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-dismiss-wish]').forEach(b=>b.onclick=dismissWish); document.querySelectorAll('[data-wish-buy]').forEach(b=>b.onclick=()=>{shopScreen.cat=C.items.find(i=>i.id===b.dataset.wishBuy)?.category||'Игры';route='shop';render();});
    document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.toggle;state.settings[k]=!state.settings[k];save();render();}); document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>{if(confirm('Удалить локальный прогресс и начать заново?')){localStorage.removeItem(STORAGE_KEY);state=freshState();route='onboarding';render();}});
    document.querySelectorAll('[data-world-area]').forEach(b=>b.onclick=()=>{if(state.worldProgress.areas.includes(b.dataset.worldArea)){state.currentWorldArea=b.dataset.worldArea;save();render();}});
    document.querySelectorAll('[data-work-start]').forEach(b=>b.onclick=()=>startWorkActivity(b.dataset.workStart));
    document.querySelectorAll('[data-work-bin]').forEach(b=>b.onclick=()=>resolveWorkBin(b.dataset.workBin));
    document.querySelectorAll('[data-work-cancel]').forEach(b=>b.onclick=cancelWorkActivity);
    document.querySelectorAll('[data-jar-delta]').forEach(b=>b.onclick=()=>{const id=b.dataset.jarTarget,input=document.getElementById(id);if(!input)return;const delta=Number(b.dataset.jarDelta||0),budget=Number(document.getElementById('planTotal')?.dataset.budget||planningBudget());const current=Math.max(0,Number(input.value||0));input.value=Math.max(0,Math.min(budget,current+delta));renderJarValues();updatePlanTotal();});
    const planInputs=['planNecessary','planWants','planSavings','planReserve'].map(id=>document.getElementById(id)).filter(Boolean); planInputs.forEach(x=>x.addEventListener('input',updatePlanTotal));
    const slider=document.getElementById('goalSlider'); if(slider)slider.oninput=()=>{document.getElementById('sliderValue').textContent=slider.value;document.getElementById('sliderWeeks').textContent=`${Math.ceil(1200/Number(slider.value))} недель`;};
  }
  function renderJarValues(){document.querySelectorAll('.jar-plan').forEach(row=>{const input=row.querySelector('input');const area=row.querySelector('.coin-stacks');if(!input||!area)return;const stacks=Math.max(0,Math.round(Number(input.value||0)/100));area.innerHTML=Array.from({length:Math.min(10,stacks)},()=>'<i>●</i>').join('')||'<em>пусто</em>';});}

  function saveWeekPlan() {
    const n=Math.max(0,Number(document.getElementById('planNecessary')?.value||0)),w=Math.max(0,Number(document.getElementById('planWants')?.value||0)),s=Math.max(0,Number(document.getElementById('planSavings')?.value||0)); let r=Math.max(0,Number(document.getElementById('planReserve')?.value||0));
    let total=n+w+s+r; const budget=planningBudget(); if(total>budget){toast(`План больше доступной суммы на ${fmt(total-budget)}`);return;} if(total<budget)r+=budget-total;
    const wasEdit=!!planForWeek(); state.weekPlan={week:state.wallet.week,necessary:n,wants:w,savings:s,reserve:r,createdAt:state.weekPlan?.createdAt||Date.now(),updatedAt:Date.now()};
    if(!state.weekSnapshot||state.weekSnapshot.week!==state.wallet.week) state.weekSnapshot={week:state.wallet.week,startingBalance:state.wallet.balance,startingSavings:state.wallet.savings,pet:{satiety:state.pet.satiety,mood:state.pet.mood,energy:state.pet.energy,care:state.pet.care},worldStage:state.worldProgress.stage,inventoryIds:state.inventory.map(x=>x.id),areas:[...state.worldProgress.areas]};
    state.weekNeedsPlanning=false; track('budget_planned',{necessary:n,wants:w,savings:s,reserve:r,edited:wasEdit||editingPlan,ageMode:state.ageGroup}); track('age_mode_experience_started',{ageGroup:state.ageGroup,week:state.wallet.week}); recalculateHealth(); save(); editingPlan=false; route='home'; modal=s>0?{type:'saveFirst',amount:s}:null; render();
  }

  function quickAction(action) {
    if(action==='feed'){if(spend(40,'Необходимые расходы','Еда','pet_care')){state.wallet.needsSpent+=40;state.stats.needsFirst++;adjustPet({satiety:24,mood:2});petBubble=state.ageGroup==='15-17'?'Еда закрыта':'Ммм, вкусно!';track('pet_need_completed',{need:'satiety'});}}
    else if(action==='care'){if(spend(60,'Необходимые расходы','Уход','pet_care')){state.wallet.needsSpent+=60;state.stats.needsFirst++;adjustPet({care:26,mood:2});petBubble=state.ageGroup==='15-17'?'Стало комфортнее':'Теперь гораздо лучше ✦';track('pet_need_completed',{need:'care'});}}
    else if(action==='play'){if(spend(80,'Желания',state.ageGroup==='15-17'?'Досуг':'Игра с питомцем','pet_play')){adjustPet({mood:18,energy:-8});petBubble=state.ageGroup==='15-17'?'Неплохой перерыв':'Ещё немного поиграем?';}}
    else if(action==='sidejob'){if(state.difficultyMode!=='medium')return;route='sidejob';track('side_job_opened',{source:'quick_action'});render();return;}
    if(state.petWish&&action==='play')state.petWish=null; checkAchievements(); recalculateHealth(); save(); render(); setTimeout(()=>{petBubble='';if(route==='home'||route==='pet')render();},1700);
  }

  function buyItem(id) {
    const item=C.items.find(x=>x.id===id);if(!item)return;if(item.cosmetic&&state.inventory.some(x=>x.id===item.id)){toast('Этот предмет уже есть');return;}
    const beforeBalance=state.wallet.balance,delay=item.need?0:purchaseGoalDelay(item.price),beforeFree=freeMoney();
    if(spend(item.price,item.need?'Необходимые расходы':'Желания',item.name,'shop',{itemId:item.id})){
      state.inventory.push({id:item.id,boughtAt:Date.now(),week:state.wallet.week,day:state.wallet.day}); ensurePlacement(item.id);
      if(item.need){state.wallet.needsSpent+=item.price;state.stats.needsFirst++;} else if(item.price>beforeFree||(planForWeek()&&actualsForWeek().wants>planForWeek().wants)){state.stats.impulsePurchases++;track('impulse_purchase',{itemId:item.id,price:item.price});}
      adjustPet(item.effect||{});if(state.petWish&&state.petWish.itemId===item.id)state.petWish=null;petBubble=state.ageGroup==='15-17'?'Пространство изменилось':`${illustration(item.icon,item.name||item.label||item.id)} Теперь это здесь`;
      checkAchievements();recalculateHealth();recalculateWorldProgress();save();modal={type:'financialFeedback',title:`Куплено: ${item.name}`,feedback:{balance:state.wallet.balance,reserve:freeMoney(),goalDelay:delay,petMood:item.effect?.mood||null}};track('purchase_completed',{itemId:item.id,price:item.price,need:!!item.need,balanceBefore:beforeBalance,balanceAfter:state.wallet.balance,goalDelay:delay});if(delay>0)track('goal_delayed',{goalId:state.activeGoal,reason:'purchase',weeks:delay});render();
    }
  }

  function maybeCreateWish() {
    if (!C.petWishes?.length || state.wallet.day % 2 !== 0) { state.petWish = null; return; }
    const w = C.petWishes[(state.wallet.week * 3 + state.wallet.day) % C.petWishes.length];
    state.petWish = { id:w.id, itemId:w.itemId || null, createdDay:state.wallet.day };
    track('pet_wish_shown', { wishId:w.id, itemId:w.itemId || null });
  }
  function dismissWish() {
    if (!state.petWish) return;
    const skipped = {...state.petWish};
    state.wishDismissedDay = `${state.wallet.week}:${state.wallet.day}`;
    state.petWish = null;
    track('pet_wish_skipped', { wishId:skipped.id, itemId:skipped.itemId || null });
    if (skipped.itemId) track('optional_purchase_delayed', { itemId:skipped.itemId, reason:'pet_wish_skipped' });
    petBubble = state.ageGroup === '15-17' ? 'Оставим на потом' : 'Хорошо, не сейчас';
    save(); render(); setTimeout(() => { petBubble = ''; if (route === 'home') render(); }, 1500);
  }

  function completeActiveGoal(g) {
    const target=goalTarget(g); if(state.wallet.savings<target||state.completedGoals.includes(g.id))return false;
    state.wallet.savings=Math.max(0,state.wallet.savings-target); tx('goal_purchase',-target,'Цель',`Достигнута цель «${goalView(g).name}»`,'goal',{goalId:g.id}); state.completedGoals.push(g.id); const changes=applyGoalUnlock(g.id); adjustPet({development:10,mood:10}); unlock('strategist',true); track('goal_completed',{goalId:g.id}); track('long_term_goal_completed',{goalId:g.id,unlock:changes}); state.activeGoal=null; recalculateWorldProgress(); modal={type:'goalUnlocked',title:goalView(g).name,message:changes[0]||'Цель изменила игровой мир и открыла новый этап.',icon:goalView(g).icon}; return true;
  }
  function saveAmount(n) {
    n=Math.round(Number(n)||0);if(n<=0||n>state.wallet.balance){toast('Проверь сумму');return;}state.wallet.balance-=n;state.wallet.savings+=n;state.goalContributions++;tx('saving',-n,'Копилка',activeGoal()?`Вклад в цель «${goalView().name}»`:'Вклад в копилку','savings');state.dayActions.count++;state.stats.positiveDecisions++;track('savings_deposit',{amount:n,goalId:state.activeGoal});const g=activeGoal();const done=g?completeActiveGoal(g):false;if(!done)toast(`В копилку: +${n}`);checkAchievements();recalculateHealth();save();if(!done)modal=null;render();
  }
  function selectGoal(id) {
    const g=C.goals.find(x=>x.id===id);if(!g||state.completedGoals.includes(id))return;if(state.activeGoal&&state.activeGoal!==id&&state.wallet.savings>0){const ok=confirm('Деньги останутся в копилке и станут прогрессом новой цели. Сменить цель?');if(!ok)return;track('goal_delayed',{previousGoal:state.activeGoal,newGoal:id});}state.activeGoal=id;track('goal_selected',{goalId:id});save();toast(`Цель выбрана: ${goalView(g).name}`);render();
  }

  function eventImmediateText(e,c) {
    if(c.future) return c.result || 'Решение принято. Пока ничего не списалось.';
    if(e.mechanicType==='role') return c.result;
    if(c.income&&c.save) return 'Часть денег появилась на балансе, часть сразу ушла в копилку.';
    if(c.income) return 'Деньги появились на балансе.';
    if(c.cost&&((c.pet?.mood||c.mood)>0)) return 'Покупка сделана. Настроение заметно изменилось.';
    if(c.cost) return 'Расход прошёл. Новый остаток уже виден в бюджете.';
    if(c.withdraw) return 'Деньги вернулись из копилки на баланс.';
    if(c.goalTargetDelta) return 'Условия цели изменились. Новый срок пересчитан.';
    return (c.result||'Решение принято.').split('. ').slice(0,1).join('. ') + (c.result?.includes('.')?'.':'');
  }
  function resolveEvent(i) {
    const e=C.events.find(x=>x.id===modal.id),c=e?.choices[i];if(!c)return;const beforeBalance=state.wallet.balance,beforeWeeks=weeksToGoal(),choiceDelay=c.cost&&c.kind!=='necessary'?purchaseGoalDelay(c.cost):0;
    if(c.cost&&state.wallet.balance+(c.income||0)<c.cost){toast('Монет не хватает для этого решения');return;}track('event_choice_selected',{eventId:e.id,choice:i,chainId:state.currentChainId});
    if(c.income){state.wallet.balance+=c.income;tx('income',c.income,'Событие',e.title,c.source||'event');state.dayActions.count++;state.dayActions.income+=c.income;}
    if(c.cost){const kind=c.kind==='necessary'?'Необходимые расходы':'Желания';state.wallet.balance-=c.cost;tx('expense',-c.cost,kind,e.title,'event',{eventId:e.id});state.dayActions.count++;if(kind==='Необходимые расходы')state.dayActions.necessary+=c.cost;else state.dayActions.optional+=c.cost;if(kind==='Желания'&&planForWeek()&&actualsForWeek().wants>planForWeek().wants){state.stats.impulsePurchases++;track('impulse_purchase',{eventId:e.id,price:c.cost});}}
    if(c.save){const s=Math.min(c.save,state.wallet.balance);state.wallet.balance-=s;state.wallet.savings+=s;state.goalContributions++;tx('saving',-s,'Копилка','Вклад после события','event');track('savings_deposit',{amount:s,source:'event'});}
    if(c.withdraw){const s=Math.min(c.withdraw,state.wallet.savings);state.wallet.savings-=s;state.wallet.balance+=s;tx('saving_withdrawal',s,'Копилка','Снятие после события','event');track('savings_withdrawal',{amount:s,source:'event'});}
    if(c.nextWeekCost)createFutureObligation({type:c.source==='credit'?'credit':'plannedPayment',amount:c.nextWeekCost,dueInWeeks:1,remainingPayments:1,description:e.title,category:'Необходимые расходы'},e.id);
    if(c.future)createFutureObligation(c.future,e.id);
    if(c.goalTargetDelta&&activeGoal())state.goalAdjustments[state.activeGoal]=(state.goalAdjustments[state.activeGoal]||0)+c.goalTargetDelta;
    const petEff={...(c.pet||{})};if(c.mood!=null)petEff.mood=(petEff.mood||0)+c.mood;if(c.care!=null)petEff.care=(petEff.care||0)+c.care;if(Object.keys(petEff).length)adjustPet(petEff);if(c.health>0)state.stats.positiveDecisions++;
    const chainId=state.currentChainId; if(chainId)advanceStoryChain(chainId,e.id);
    state.eventResolved=true;state.recentEventIds.push(e.id);state.recentEventIds=state.recentEventIds.slice(-8);state.dayActions.count++;recalculateHealth();checkAchievements();track('event_completed',{eventId:e.id,balanceDelta:state.wallet.balance-beforeBalance,chainId});save();const afterWeeks=weeksToGoal();modal={type:'eventResult',title:e.title,result:eventImmediateText(e,c),feedback:{balance:state.wallet.balance,reserve:freeMoney(),goalDelay:Math.max(choiceDelay,beforeWeeks!=null&&afterWeeks!=null?Math.max(0,afterWeeks-beforeWeeks):0),goalWeeks:afterWeeks,petMood:petEff.mood||null}};render();
  }

  function advanceDay() {
    applyEndOfDay(); if(state.wallet.day>=7){completeWeek();return;} state.wallet.day++;state.wallet.nextIncomeIn=Math.max(0,8-state.wallet.day);state.eventResolved=false;state.dayActions={count:0,necessary:0,optional:0,income:0,sideJob:false};state.currentEventId=selectEventId();maybeCreateWish();state.streak++;const charges=processDueObligations({showModal:false});checkAchievements();recalculateHealth();save();if(charges.length)modal={type:'delayedImpact',charges};else toast(`День ${state.wallet.day}. До дохода ${state.wallet.nextIncomeIn} дн.`);render();
  }

  function completeWeek() {
    const plan=planForWeek()||{necessary:0,wants:0,savings:0,reserve:0},actual=actualsForWeek(),snap=state.weekSnapshot||{startingBalance:state.wallet.balance,pet:{mood:state.pet.mood},worldStage:state.worldProgress.stage,inventoryIds:[],areas:['home']};
    const itemsBought=state.inventory.filter(x=>x.week===state.wallet.week).map(x=>C.items.find(i=>i.id===x.id)?.name).filter(Boolean); const beforeStage=state.worldProgress.stage;
    const summary={week:state.wallet.week,startingBalance:snap.startingBalance,endingBalance:state.wallet.balance,plan:{...plan},actual,petDelta:{mood:state.pet.mood-(snap.pet?.mood??state.pet.mood),wellbeing:petWellbeing()},insights:weekInsights(plan,actual,snap),worldChanges:[]};
    state.weekHistory.push(summary);state.weekHistory=state.weekHistory.slice(-20);recalculateWorldProgress(); if(itemsBought.length)summary.worldChanges.push(`В мире появилось: ${itemsBought.slice(0,3).join(', ')}.`);if(state.worldProgress.stage>beforeStage)summary.worldChanges.push(`Открыт новый этап: ${worldStageData().title}.`);const newAreas=state.worldProgress.areas.filter(a=>!(snap.areas||[]).includes(a));newAreas.forEach(a=>summary.worldChanges.push(`Открыта локация «${C.world.areas.find(x=>x.id===a)?.name||a}».`));if(state.completedGoals.some(g=>state.transactions.some(t=>t.week===state.wallet.week&&t.meta?.goalId===g)))summary.worldChanges.push('Большая цель изменила доступные возможности.');
    state.weekSummary=summary;if(isBalancedWeek(summary))state.stats.weeksBalanced++;track('budget_plan_vs_fact',{week:state.wallet.week,plan,actual});track('week_completed',{week:state.wallet.week,endingBalance:state.wallet.balance,wellbeing:petWellbeing(),worldStage:state.worldProgress.stage});recalculateHealth();checkAchievements();save();route='weekSummary';render();window.scrollTo(0,0);
  }

  function startNextWeek() {
    state.weekSummary=null;state.wallet.week++;state.wallet.day=1;state.wallet.nextIncomeIn=7;state.wallet.needsSpent=0;state.wallet.balance+=state.wallet.weeklyIncome;tx('income',state.wallet.weeklyIncome,'Доход',`Доход за неделю ${state.wallet.week}`,'weekly_income');state.weekOpeningCharges=[];state.dayActions={count:0,necessary:0,optional:0,income:0,sideJob:false};processDueObligations({showModal:false,opening:true});track('week_started',{week:state.wallet.week,income:state.wallet.weeklyIncome,automaticCharges:state.weekOpeningCharges.reduce((a,x)=>a+x.amount,0),available:state.wallet.balance});state.weekPlan=null;state.weekSnapshot=null;state.weekNeedsPlanning=true;state.eventResolved=false;state.currentEventId=selectEventId();state.petWish=null;if(state.activityLimits.week!==state.wallet.week)state.activityLimits={week:state.wallet.week,sideJobs:0};state.workState={week:state.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};state.workSession=null;recalculateWorldProgress();recalculateHealth();save();route='weekStart';render();window.scrollTo(0,0);
  }

  // ===== V5 AGE, GUIDANCE, SAFETY AND CONFIRMATION OVERRIDES =====
  function freshState() {
    return {
      version:6,
      onboardingDone:false,
      onboardingStep:0,
      onboardingIntroCompleted:false,
      helpLastTopic:null,
      ageMigrationPending:false,
      legacyAgeGroup:null,
      ageGroup:null,
      difficultyMode:null,
      pet:{type:'cat',name:'Финни',color:C.petColors[0],accessory:'none',satiety:72,mood:74,energy:78,care:76,development:8},
      wallet:{balance:1000,savings:0,weeklyIncome:1000,week:1,day:1,nextIncomeIn:7,needsSpent:0},
      activeGoal:null,goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],
      financialHealth:68,xp:0,streak:1,
      stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},
      currentEventId:null,currentChainId:null,eventResolved:false,recentEventIds:[],
      weekNeedsPlanning:true,weekPlan:null,weekSnapshot:null,weekSummary:null,weekHistory:[],weekOpeningCharges:[],
      dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,wishDismissedDay:null,
      analytics:[],nextWeekObligations:[],futureObligations:[],
      worldProgress:{stage:1,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},
      activityLimits:{week:1,sideJobs:0},workState:{week:1,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,
      settings:{sound:true,motion:true},createdAt:Date.now()
    };
  }

  function migrateState(raw) {
    const base=freshState();
    if(!raw) return base;
    const rawVersion=Number(raw.version||1);
    const migrated={
      ...base,...raw,version:6,
      pet:{...base.pet,...(raw.pet||{})},wallet:{...base.wallet,...(raw.wallet||{})},stats:{...base.stats,...(raw.stats||{})},
      settings:{...base.settings,...(raw.settings||{})},dayActions:{...base.dayActions,...(raw.dayActions||{})},
      activityLimits:{...base.activityLimits,...(raw.activityLimits||{})},workState:{...base.workState,...(raw.workState||{})},workSession:raw.workSession||null,
      goalAdjustments:raw.goalAdjustments||{},completedGoals:raw.completedGoals||[],inventory:raw.inventory||[],completedTasks:raw.completedTasks||[],
      achievements:raw.achievements||[],transactions:raw.transactions||[],recentEventIds:raw.recentEventIds||[],weekHistory:raw.weekHistory||[],
      analytics:raw.analytics||[],weekOpeningCharges:raw.weekOpeningCharges||[],futureObligations:raw.futureObligations||[],
      worldProgress:{...base.worldProgress,...(raw.worldProgress||{})},worldPlacements:raw.worldPlacements||{},storyChains:raw.storyChains||{}
    };
    if(rawVersion<2&&raw.onboardingDone){migrated.weekNeedsPlanning=true;migrated.weekPlan=null;migrated.weekSnapshot=null;migrated.weekSummary=null;migrated.eventResolved=false;}
    if(rawVersion<3){
      for(const [idx,o] of (raw.nextWeekObligations||[]).entries()) migrated.futureObligations.push({id:`legacy_${idx}_${Date.now()}`,type:'plannedPayment',amount:Number(o.amount)||0,dueWeek:(raw.wallet?.week||1)+1,dueDay:1,remainingPayments:1,description:o.description||'Обязательство прошлой недели',sourceId:o.source||'legacy',category:'Необходимые расходы',recurring:false,createdWeek:raw.wallet?.week||1,createdDay:raw.wallet?.day||1});
      migrated.nextWeekObligations=[];
      for(const entry of migrated.inventory){const p=C.world?.placements?.[entry.id];if(p&&!migrated.worldPlacements[entry.id])migrated.worldPlacements[entry.id]={...p,placed:true};}
      const weeks=migrated.weekHistory.length;migrated.worldProgress.stage=weeks>=8?5:weeks>=5?4:weeks>=3?3:weeks>=1?2:1;migrated.worldProgress.areas=['home'];if(migrated.worldProgress.stage>=3)migrated.worldProgress.areas.push('park');if(migrated.worldProgress.stage>=4)migrated.worldProgress.areas.push('city');
    }
    if(rawVersion<4){const used=Number(raw.activityLimits?.week===migrated.wallet.week?raw.activityLimits?.sideJobs:0)||0;migrated.workState={week:migrated.wallet.week,shiftsUsed:used,shiftsLimit:3,activityUsage:{}};migrated.workSession=null;migrated.activityLimits={week:migrated.wallet.week,sideJobs:used};}
    if(rawVersion<5){
      const oldAge=raw.ageGroup;
      migrated.legacyAgeGroup=['8-10','11-13','14-17'].includes(oldAge)?oldAge:null;
      if(oldAge==='8-10'){migrated.ageGroup='7-11';migrated.ageMigrationPending=false;}
      else if(oldAge==='11-13'){migrated.ageGroup='12-14';migrated.ageMigrationPending=!!raw.onboardingDone;}
      else if(oldAge==='14-17'){migrated.ageGroup='15-17';migrated.ageMigrationPending=!!raw.onboardingDone;}
      else if(!['7-11','12-14','15-17'].includes(oldAge)) migrated.ageGroup=null;
      migrated.onboardingIntroCompleted=!!raw.onboardingDone;
      if(!raw.onboardingDone) migrated.onboardingStep=0;
    }
    // v6: remove age from the product UI and migrate to two difficulty modes without losing progress.
    if(rawVersion<6 || !['easy','medium'].includes(migrated.difficultyMode)){
      const source=raw.difficultyMode || raw.ageGroup || migrated.ageGroup || null;
      if(['easy','7-11','8-10'].includes(source)) migrated.difficultyMode='easy';
      else if(['medium','12-14','15-17','11-13','14-17'].includes(source)) migrated.difficultyMode='medium';
      else migrated.difficultyMode=raw.onboardingDone?'easy':null;
    }
    // Compatibility adapter for historical content metadata only. UI and new analytics use difficultyMode.
    migrated.ageGroup=migrated.difficultyMode==='easy'?'7-11':migrated.difficultyMode==='medium'?'12-14':null;
    migrated.ageMigrationPending=false;
    if(!C.accessories.some(a=>a.id===migrated.pet.accessory)) migrated.pet.accessory='none';
    if(!['7-11','12-14','15-17'].includes(migrated.ageGroup)&&migrated.onboardingDone){migrated.ageGroup='7-11';migrated.ageMigrationPending=true;}
    if(migrated.workState.week!==migrated.wallet.week)migrated.workState={week:migrated.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};
    if(!migrated.worldProgress.areas?.includes(migrated.currentWorldArea))migrated.currentWorldArea='home';
    if(!migrated.currentEventId&&migrated.difficultyMode){const pool=eventPoolFor(migrated);migrated.currentEventId=pool.length?pool[(migrated.wallet.week*17+migrated.wallet.day*7)%pool.length].id:(C.events[0]?.id||null);}
    localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
    return migrated;
  }

  // V11 layered character renderer: detailed base art + independently animated regions + accessory anchors.
  function petSVG(type=state.pet.type,color=state.pet.color,accessory=state.pet.accessory) {
    const petType=['cat','dog','mumo'].includes(type)?type:'cat';
    const accent=/^#[0-9a-f]{6}$/i.test(String(color||''))?color:(C.petColors?.[0]||'#F0A56B');
    const petMeta=C.pets.find(p=>p.id===petType)||C.pets[0];
    const art=`${petMeta?.art||`assets/pets/${petType}.webp`}?v=20260918d`;
    const rid=`petv11-${++petRenderSeq}`;
    const layouts={
      cat:{
        head:'<ellipse cx="321" cy="277" rx="228" ry="194"/>',
        body:'<path d="M139 345 C178 319 232 323 320 329 C412 321 482 340 512 402 C542 463 537 610 501 702 C475 761 405 784 320 780 C227 785 159 756 131 697 C99 627 102 441 139 345Z"/>',
        earL:'<path d="M62 85 C83 28 161 20 238 143 L246 255 L107 260 C70 210 48 145 62 85Z"/>',
        earR:'<path d="M397 143 C469 23 553 28 580 87 C594 144 571 213 535 260 L397 256Z"/>',
        tail:'<path d="M16 366 C53 322 130 332 175 380 C220 429 211 493 176 535 C145 571 142 621 181 654 C132 701 63 683 33 630 C2 575 26 526 54 490 C82 454 69 417 16 366Z"/>',
        eyeY:287,mouthY:374,browY:229,cheekY:360
      },
      dog:{
        head:'<ellipse cx="320" cy="287" rx="230" ry="190"/>',
        body:'<path d="M143 365 C183 334 238 333 321 339 C408 332 472 349 506 408 C542 470 531 621 498 704 C469 760 404 783 320 779 C230 783 163 756 135 700 C101 630 105 455 143 365Z"/>',
        earL:'<path d="M43 142 C77 73 154 70 236 170 C242 234 217 316 145 359 C78 347 42 302 37 239 C34 202 34 169 43 142Z"/>',
        earR:'<path d="M404 168 C484 75 566 78 599 144 C609 181 608 232 594 269 C574 323 526 349 474 351 C424 314 399 236 404 168Z"/>',
        tail:'<path d="M14 404 C57 365 124 379 177 423 C219 458 233 506 209 547 C184 591 129 599 94 575 C126 543 126 506 99 480 C73 455 41 441 14 404Z"/>',
        eyeY:294,mouthY:378,browY:236,cheekY:363
      },
      mumo:{
        head:'<ellipse cx="321" cy="285" rx="235" ry="198"/><circle cx="255" cy="103" r="67"/><circle cx="389" cy="91" r="65"/>',
        body:'<path d="M139 364 C181 329 239 332 320 337 C407 330 475 351 509 414 C541 473 534 620 500 705 C473 762 404 784 320 780 C231 784 160 758 133 700 C99 629 103 455 139 364Z"/>',
        earL:'<path d="M24 174 C53 112 131 100 234 182 C244 246 210 322 131 350 C69 343 31 309 16 257 C7 225 8 197 24 174Z"/>',
        earR:'<path d="M407 180 C504 107 580 115 616 178 C632 211 632 245 618 277 C595 329 548 352 490 351 C426 316 397 246 407 180Z"/>',
        tail:'<path d="M12 454 C45 410 110 412 180 457 C221 485 229 536 202 576 C170 623 111 632 65 603 C89 569 85 535 59 510 C39 490 23 475 12 454Z"/>',
        eyeY:290,mouthY:378,browY:230,cheekY:362
      }
    };
    const l=layouts[petType];
    const moodValues=['satiety','mood','energy','care'].map(k=>Number(state.pet?.[k]??0));
    const moodAverage=moodValues.reduce((sum,n)=>sum+n,0)/Math.max(1,moodValues.length);
    const moodWeakest=Math.min(...moodValues);
    const expression=(moodAverage>=70&&moodWeakest>=45)?'happy':((moodAverage<45||moodWeakest<25)?'sad':'neutral');
    const accessoryMeta=C.accessories.find(a=>a.id===accessory);
    const slot=accessoryMeta?.slot||({cap:'head',headphones:'head',glasses:'face',scarf:'neck',bow:'neck',badge:'chest',backpack:'back'}[accessory]||'none');
    const accessoryShapes={
      cap:`<g class="pet-accessory-shape pet-cap"><path d="M192 208 Q320 111 449 207 L430 251 Q321 222 204 253Z" fill="url(#${rid}-accent)"/><path d="M414 232 Q494 225 514 264 Q450 278 398 259Z" fill="${accent}"/><path d="M233 197 Q320 154 405 197" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="10" stroke-linecap="round"/></g>`,
      headphones:`<g class="pet-accessory-shape pet-headphones"><path d="M154 319 Q149 137 320 130 Q491 139 486 319" fill="none" stroke="#31394e" stroke-width="27" stroke-linecap="round"/><rect x="127" y="286" width="70" height="113" rx="31" fill="url(#${rid}-accent)"/><rect x="443" y="286" width="70" height="113" rx="31" fill="url(#${rid}-accent)"/><path d="M145 316v54M495 316v54" stroke="#fff" stroke-opacity=".34" stroke-width="9" stroke-linecap="round"/></g>`,
      glasses:`<g class="pet-accessory-shape pet-glasses" fill="none" stroke="#30384d" stroke-width="15"><ellipse cx="237" cy="${l.eyeY}" rx="72" ry="59"/><ellipse cx="403" cy="${l.eyeY}" rx="72" ry="59"/><path d="M309 ${l.eyeY-4} Q320 ${l.eyeY-15} 331 ${l.eyeY-4}M165 ${l.eyeY-4} L116 ${l.eyeY-23}M475 ${l.eyeY-4} L524 ${l.eyeY-23}"/></g>`,
      scarf:`<g class="pet-accessory-shape pet-scarf"><path d="M169 443 Q320 506 471 443 L458 504 Q321 550 181 504Z" fill="url(#${rid}-accent)"/><path d="M390 493 L462 625 L398 642 L350 515Z" fill="${accent}"/><path d="M207 470 Q321 510 433 470" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="10" stroke-linecap="round"/></g>`,
      bow:`<g class="pet-accessory-shape pet-bow"><path d="M317 473 Q238 417 194 468 Q224 550 314 509Z" fill="url(#${rid}-accent)"/><path d="M323 473 Q402 417 446 468 Q416 550 326 509Z" fill="url(#${rid}-accent)"/><circle cx="320" cy="491" r="31" fill="#30384d"/><circle cx="311" cy="482" r="8" fill="#fff" opacity=".35"/></g>`,
      badge:`<g class="pet-accessory-shape pet-badge"><circle cx="421" cy="501" r="42" fill="#f4d46f" stroke="#fff8d8" stroke-width="8"/><path d="M421 476 l9 18 20 3-15 14 4 20-18-10-18 10 4-20-15-14 20-3Z" fill="${accent}"/></g>`,
      backpack:`<g class="pet-accessory-shape pet-backpack"><path d="M113 375 Q57 402 76 578 Q82 632 150 622 L185 415Z" fill="url(#${rid}-accent)"/><path d="M527 375 Q583 402 564 578 Q558 632 490 622 L455 415Z" fill="url(#${rid}-accent)"/><path d="M115 409 Q164 330 228 354M525 409 Q476 330 412 354" fill="none" stroke="#30384d" stroke-opacity=".65" stroke-width="18" stroke-linecap="round"/></g>`
    };
    const accessoryMarkup=slot==='none'?'':`<g class="pet-accessory-slot slot-${slot}" data-slot="${slot}" data-accessory="${accessory}">${accessoryShapes[accessory]||''}</g>`;
    const facePatch=expression==='happy'?'':`<ellipse class="pet-expression-patch" cx="320" cy="${l.mouthY}" rx="66" ry="42" fill="#fbf4ed" opacity="${expression==='sad'?'.86':'.63'}"/>`;
    const expressionMarkup=expression==='happy'
      ? `<g class="pet-expression pet-expression-happy"><path class="pet-mouth" d="M285 ${l.mouthY} Q320 ${l.mouthY+37} 355 ${l.mouthY}" fill="none" stroke="#5a342f" stroke-width="9" stroke-linecap="round" opacity=".32"/></g>`
      : expression==='sad'
        ? `<g class="pet-expression pet-expression-sad"><path class="pet-mouth" d="M288 ${l.mouthY+19} Q320 ${l.mouthY-13} 352 ${l.mouthY+19}" fill="none" stroke="#503735" stroke-width="10" stroke-linecap="round"/><path class="pet-brows" d="M190 ${l.browY} Q235 ${l.browY+24} 278 ${l.browY+12}M362 ${l.browY+12} Q405 ${l.browY+24} 450 ${l.browY}" fill="none" stroke="#553b36" stroke-width="11" stroke-linecap="round" opacity=".72"/></g>`
        : `<g class="pet-expression pet-expression-neutral"><path class="pet-mouth" d="M292 ${l.mouthY+8} Q320 ${l.mouthY+14} 348 ${l.mouthY+8}" fill="none" stroke="#503735" stroke-width="9" stroke-linecap="round" opacity=".88"/></g>`;
    return `<svg class="pet-svg pet-layered pet-type-${petType} expression-${expression}${petBubble?' is-reacting':''}" viewBox="0 0 640 800" style="--pet-accent:${accent}" aria-label="Питомец ${esc(state.pet.name)}" role="img">
      <defs>
        <clipPath id="${rid}-body">${l.body}</clipPath>
        <clipPath id="${rid}-head">${l.head}</clipPath>
        <clipPath id="${rid}-ear-l">${l.earL}</clipPath>
        <clipPath id="${rid}-ear-r">${l.earR}</clipPath>
        <clipPath id="${rid}-tail">${l.tail}</clipPath>
        <linearGradient id="${rid}-accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset=".68" stop-color="${accent}"/><stop offset="1" stop-color="#30384d" stop-opacity=".78"/></linearGradient>
      </defs>
      <ellipse class="pet-shadow" cx="320" cy="735" rx="182" ry="31" fill="#26314c" opacity=".13"/>
      <g class="pet-composite">
        ${slot==='back'?accessoryMarkup:''}
        <g class="pet-tail"><image class="pet-art-layer" href="${art}" x="0" y="0" width="640" height="800" preserveAspectRatio="xMidYMid meet" clip-path="url(#${rid}-tail)"/></g>
        <g class="pet-body">
          <image class="pet-art-layer pet-core pet-body-art" href="${art}" x="0" y="0" width="640" height="800" preserveAspectRatio="xMidYMid meet" clip-path="url(#${rid}-body)"/>
          <image class="pet-art-layer pet-head-art" href="${art}" x="0" y="0" width="640" height="800" preserveAspectRatio="xMidYMid meet" clip-path="url(#${rid}-head)"/>
          <path class="pet-color-wash" d="M139 345 C177 321 240 323 320 331 C410 323 477 346 509 410 C536 465 530 606 500 700 C468 755 402 777 320 775 C232 780 164 754 135 698 C104 625 105 449 139 345Z" fill="${accent}" opacity=".10"/>
        </g>
        <g class="pet-ears">
          <g class="pet-ear pet-ear-left"><image class="pet-art-layer" href="${art}" x="0" y="0" width="640" height="800" preserveAspectRatio="xMidYMid meet" clip-path="url(#${rid}-ear-l)"/></g>
          <g class="pet-ear pet-ear-right"><image class="pet-art-layer" href="${art}" x="0" y="0" width="640" height="800" preserveAspectRatio="xMidYMid meet" clip-path="url(#${rid}-ear-r)"/></g>
        </g>
        <g class="pet-face">
          ${facePatch}
          <g class="pet-gaze"><circle cx="248" cy="${l.eyeY-25}" r="9" fill="#fff" opacity=".30"/><circle cx="412" cy="${l.eyeY-25}" r="9" fill="#fff" opacity=".30"/></g>
          <g class="pet-eyes"><path d="M183 ${l.eyeY} Q237 ${l.eyeY+34} 291 ${l.eyeY}" fill="none" stroke="#473331" stroke-width="18" stroke-linecap="round"/><path d="M349 ${l.eyeY} Q403 ${l.eyeY+34} 457 ${l.eyeY}" fill="none" stroke="#473331" stroke-width="18" stroke-linecap="round"/></g>
          <ellipse class="pet-nose" cx="320" cy="${l.mouthY-47}" rx="13" ry="7" fill="#fff" opacity=".18"/>
          <g class="pet-cheeks"><ellipse cx="194" cy="${l.cheekY}" rx="38" ry="17" fill="${accent}" opacity=".13"/><ellipse cx="446" cy="${l.cheekY}" rx="38" ry="17" fill="${accent}" opacity=".13"/></g>
          ${expressionMarkup}
        </g>
        ${slot!=='back'?accessoryMarkup:''}
      </g>
    </svg>`;
  }

  function learningArtwork(kind) {
    const accent={limited:'#c86f48',needs:'#56785f',wants:'#b45e6b',savings:'#d1a64e',help:'#6f8069',adult:'#8a6551'}[kind]||'#56785f';
    const extra=kind==='savings'?'<path d="M142 54v34M125 71h34"/>':kind==='needs'?'<path d="M130 67l9 9 20-24"/>':kind==='wants'?'<path d="M143 51c18 0 20 25 0 38-20-13-18-38 0-38z"/>':kind==='adult'?'<path d="M126 50h35v43h-35zM133 61h21M133 71h17M133 81h19"/>':'<path d="M129 58h31M129 70h25M129 82h18"/>';
    return `<svg class="learning-art" viewBox="0 0 220 150" aria-hidden="true"><path d="M34 113c19-42 51-72 88-68 31 3 46 28 62 67" fill="#e7eadc"/><path d="M30 116h160" stroke="#bdc5b2" stroke-width="3" stroke-linecap="round"/><g fill="#fffdf8" stroke="${accent}" stroke-width="4"><path d="M52 72h50l-5 47H57z"/><path d="M62 72c0-17 28-17 28 0" fill="none"/>${extra}</g><circle cx="77" cy="91" r="8" fill="${accent}"/><path d="M46 126c22 7 45 7 68 0M126 126c17 5 35 5 52 0" stroke="#c99971" stroke-width="3" stroke-linecap="round"/></svg>`;
  }

  function render() {
    if(showingSplash){app.innerHTML=`<section class="splash"><div><div class="splash-mark">${petSVG('mumo','#7C8CF8','badge')}</div><h1>КопиХвост</h1><p>Твои деньги. Твои решения.</p></div></section>`;return;}
    if(introReplay){renderIntroReplay();return;}
    if(!state.onboardingDone){renderOnboarding();return;}
    if(state.ageMigrationPending){renderAgeMigration();return;}
    recalculateWorldProgress();ensureStoryChainsFor(state,true);
    app.innerHTML=`<main class="app-shell ${ageModeClass()}">${renderScreen()}${renderNav()}</main>${modal?renderModal():''}`;
    bindCommon();
  }

  function renderNav() {
    if(['weekStart','weekSummary','help','adultGate','adult'].includes(route))return '';
    const nav=[['home','⌂','Дом'],['tasks','◫','Задания'],['budget','◒','Бюджет'],['goals','◎','Цели'],['profile','○','Профиль']];
    return `<nav class="nav" aria-label="Основная навигация">${nav.map(([r,i,l])=>`<button data-route="${r}" class="${route===r?'active':''}" ${route===r?'aria-current="page"':''}>${illustration(({home:'🏠',tasks:'📖',budget:'💰',goals:'🪙',profile:'profile'})[r])}${l}</button>`).join('')}</nav>`;
  }

  function renderScreen() {
    if(route==='help')return helpScreen();if(route==='adultGate')return adultGateScreen();if(route==='adult')return adultUnlocked?adultScreen():adultGateScreen();
    if(route==='weekStart')return weekStartScreen();if(route==='weekSummary')return weekSummaryScreen();if(route==='home')return homeScreen();if(route==='tasks')return tasksScreen();if(route==='budget')return budgetScreen();if(route==='goals')return goalsScreen();if(route==='profile')return profileScreen();if(route==='shop')return shopScreen();if(route==='pet')return petScreen();if(route==='savings')return savingsScreen();if(route==='task')return taskScreen();if(route==='sidejob')return sideJobScreen();if(route==='progress')return progressScreen();if(route==='achievements')return achievementsScreen();if(route==='settings')return settingsScreen();return homeScreen();
  }

  function topbar(title,back=false) {
    const showHelp=route!=='help';
    return `<header class="topbar"><div class="topbar-title">${back?'<button class="linkbtn back-button" data-back>← Назад</button>':''}<div class="eyebrow">Неделя ${state.wallet.week} · день ${state.wallet.day}</div><h1>${esc(title)}</h1></div><div class="topbar-actions">${showHelp?'<button class="help-button" data-help><b>?</b><span>Помощь</span></button>':''}<div class="balance-pill"><span class="coin">●</span>${fmt(state.wallet.balance)}</div></div></header>${state.workSession&&route==='sidejob'?'':pageArtwork(route)}`;
  }

  function skipInitialIntro(){const step=Number(state.onboardingStep||0);state.onboardingIntroCompleted=true;state.onboardingStep=(C.introSlides||[]).length;track('intro_skipped',{replay:false,step});save();render();}
  function advanceInitialIntro(){const slides=C.introSlides||[],step=Number(state.onboardingStep||0);if(step>=slides.length)return;if(step===slides.length-1){state.onboardingIntroCompleted=true;track('intro_completed',{replay:false});}state.onboardingStep=step+1;save();render();}

  function renderOnboarding() {
    const slides=C.introSlides||[];const step=Math.max(0,Number(state.onboardingStep||0));
    if(step<slides.length){
      if(!state.analytics.some(x=>x.name==='intro_started'&&!x.replay)){track('intro_started',{replay:false});save();}
      const slide=slides[step];
      app.innerHTML=`<section class="onboarding intro-onboarding"><header class="onboard-header"><div class="brand">КопиХвост</div><button class="skip-link" data-intro-skip>Пропустить</button></header><div class="onboard-main"><div class="onboard-visual">${learningArtwork(slide.art)}</div><div class="dots" aria-label="Экран ${step+1} из ${slides.length}">${slides.map((_,i)=>`<i class="${i===step?'active':''}"></i>`).join('')}</div><h1>${esc(slide.title)}</h1><p>${esc(slide.text)}</p></div><button class="btn primary block" data-onboard-next>${step===slides.length-1?'Выбрать возраст':'Дальше'}</button></section>`;
      app.querySelector('[data-intro-skip]').onclick=skipInitialIntro;
      app.querySelector('[data-onboard-next]').onclick=advanceInitialIntro;return;
    }
    if(step===slides.length){
      const ages=[['7-11','7–11 лет','Нужно, хочу, коплю и оставлю. Простые решения и безопасный интернет.'],['12-14','12–14 лет','Бюджет, подписки, покупки онлайн и защита игровых аккаунтов.'],['15-17','15–17 лет','Подработка, обязательства, полная стоимость и защита финансовых аккаунтов.']];
      app.innerHTML=`<section class="onboarding"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main age-select-main"><div><div class="eyebrow">Шаг 1 из 2</div><h1>Сколько тебе лет?</h1><p>Это меняет слова, ситуации и доступные задания.</p></div><div class="age-grid">${ages.map(a=>`<button class="select-card ${state.ageGroup===a[0]?'active':''}" data-age="${a[0]}"><h3>${a[1]}</h3><p>${a[2]}</p></button>`).join('')}</div></div><button class="btn primary block" data-age-next ${!state.ageGroup?'disabled':''}>Создать питомца</button></section>`;
      app.querySelectorAll('[data-age]').forEach(b=>b.onclick=()=>{state.ageGroup=b.dataset.age;save();render();});app.querySelector('[data-age-next]').onclick=()=>{state.onboardingStep=slides.length+1;save();render();};return;
    }
    app.innerHTML=`<section class="onboarding pet-create"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main pet-create-main"><div><div class="eyebrow">Шаг 2 из 2</div><h1>${state.ageGroup==='15-17'?'Выбери компаньона':'Создай друга'}</h1><p>${state.ageGroup==='15-17'?'Он будет частью мира и не станет оценивать твои решения.':'Выбери питомца, цвет акцента и аксессуар.'}</p></div><div class="pet-grid">${C.pets.map(p=>`<button class="select-card pet-pick ${state.pet.type===p.id?'active':''}" data-pet="${p.id}">${petSVG(p.id,state.pet.color,state.pet.accessory)}<div><h3>${p.name}</h3><p>${p.desc}</p></div></button>`).join('')}</div><div class="field"><label for="petName">Имя питомца</label><input id="petName" maxlength="14" value="${esc(state.pet.name)}"></div><div class="field"><label>Цвет акцента</label><div class="color-row">${C.petColors.map(c=>`<button class="color-dot ${state.pet.color===c?'active':''}" style="background:${c}" data-color="${c}" aria-label="Выбрать цвет ${c}"></button>`).join('')}</div></div><div class="field accessory-field"><label for="accessory">Аксессуар</label><select id="accessory">${C.accessories.map(a=>`<option value="${a.id}" ${state.pet.accessory===a.id?'selected':''}>${a.name}</option>`).join('')}</select></div></div><div class="onboard-actions"><button class="btn primary block" data-start>Получить 1000 монет</button></div></section>`;
    const rememberName=()=>{const input=app.querySelector('#petName');if(input)state.pet.name=(input.value||'Финни').slice(0,14);};
    app.querySelectorAll('[data-pet]').forEach(b=>b.onclick=()=>{rememberName();state.pet.type=b.dataset.pet;save();render();});app.querySelectorAll('[data-color]').forEach(b=>b.onclick=e=>{e.preventDefault();rememberName();state.pet.color=b.dataset.color;save();render();});
    app.querySelector('#accessory').onchange=e=>{rememberName();state.pet.accessory=e.target.value;track('accessory_selected',{accessory:e.target.value,petType:state.pet.type});save();render();};app.querySelector('#petName').oninput=e=>{state.pet.name=e.target.value;save();};
    app.querySelector('[data-start]').onclick=()=>{rememberName();state.pet.name=(state.pet.name||'Финни').trim().slice(0,14)||'Финни';state.onboardingDone=true;state.onboardingIntroCompleted=true;state.onboardingStep=slides.length+2;tx('income',1000,'Доход','Стартовый недельный бюджет','onboarding');state.currentEventId=selectEventId(state,true);state.weekNeedsPlanning=true;track('pet_created',{type:state.pet.type,ageGroup:state.ageGroup,accessory:state.pet.accessory});track('week_started',{week:1,income:1000});save();route='weekStart';render();};
  }

  function renderIntroReplay() {
    const slides=C.introSlides||[],step=Math.min(introReplayStep,slides.length-1),slide=slides[step];
    app.innerHTML=`<section class="onboarding intro-onboarding"><header class="onboard-header"><div class="brand">Как всё работает</div><button class="skip-link" data-replay-end="skip">Закрыть</button></header><div class="onboard-main"><div class="onboard-visual">${learningArtwork(slide.art)}</div><div class="dots" aria-label="Экран ${step+1} из ${slides.length}">${slides.map((_,i)=>`<i class="${i===step?'active':''}"></i>`).join('')}</div><h1>${esc(slide.title)}</h1><p>${esc(slide.text)}</p></div><button class="btn primary block" data-replay-next>${step===slides.length-1?'Вернуться в помощь':'Дальше'}</button></section>`;
    app.querySelector('[data-replay-end]').onclick=()=>finishIntroReplay(true);app.querySelector('[data-replay-next]').onclick=()=>{if(step===slides.length-1)finishIntroReplay(false);else{introReplayStep++;render();}};
  }
  function startIntroReplay(){introReplay=true;introReplayStep=0;track('intro_started',{replay:true});save();render();}
  function finishIntroReplay(skipped){track(skipped?'intro_skipped':'intro_completed',{replay:true,step:introReplayStep});save();introReplay=false;introReplayStep=0;route='help';render();}

  function renderAgeMigration() {
    const ages=[['7-11','7–11 лет'],['12-14','12–14 лет'],['15-17','15–17 лет']];
    app.innerHTML=`<section class="onboarding migration-screen"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main"><div class="onboard-visual compact-art">${learningArtwork('help')}</div><div><div class="eyebrow">Одно уточнение</div><h1>Выбери свой возраст</h1><p>Диапазоны стали точнее. Профиль, монеты, покупки, цели и прогресс сохранятся.</p></div><div class="age-grid">${ages.map(a=>`<button class="select-card" data-migrated-age="${a[0]}"><h3>${a[1]}</h3></button>`).join('')}</div></div></section>`;
    app.querySelectorAll('[data-migrated-age]').forEach(b=>b.onclick=()=>{state.ageGroup=b.dataset.migratedAge;state.ageMigrationPending=false;state.ageMigrationCompletedAt=Date.now();state.currentEventId=selectEventId(state,true);track('age_mode_experience_started',{ageGroup:state.ageGroup,migratedFrom:state.legacyAgeGroup});save();render();});
  }

  function activeTaskForAge(){return ageTaskList().find(t=>!state.completedTasks.includes(t.id))||null;}
  function homeScreen() {
    const g=goalView(),baseGoal=activeGoal(),event=currentEvent(),h=healthText(),task=activeTaskForAge(),teen=state.ageGroup==='15-17',junior=state.ageGroup==='7-11';
    return `<section class="screen home-screen">${topbar(teen?'Жизнь':'Дом')}${worldSceneHtml()}<div class="pet-status-line"><b>${petStage()}</b><span>${petWellbeing()>=70?'в хорошем состоянии':petWellbeing()>=50?'в норме':'нужно немного внимания'}</span></div><div class="stat-row ${teen?'compact-stats':''}">${miniStat(junior?'Сыт':'Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,teen?'◡':'☻')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat(junior?'Чисто':'Уход',state.pet.care,'✦')}</div>
      <div class="money-strip home-money"><div><span>${junior?'Монеты':'Баланс'}</span><b>${fmt(state.wallet.balance)} ●</b></div><button data-savings><span>В копилке</span><b>${fmt(state.wallet.savings)} ●</b></button><div><span>До дохода</span><b>${state.wallet.nextIncomeIn} дн.</b></div><div><span>${junior?'Хватит?':'Состояние'}</span><b>${h[0]}</b></div></div>
      ${g?`<div class="section-title compact-title"><h2>${junior?'Коплю на':'Текущая цель'}</h2><button data-route="goals">Открыть</button></div><div class="card goal-card compact-card"><div class="goal-icon">${illustration(g.icon,g.name||g.label||g.id)}</div><div><h3>${esc(g.name)}</h3><p>${fmt(goalSaved())} из ${fmt(goalTarget(baseGoal))} · ≈ ${weeksToGoal()} нед.</p><div class="bar green"><i style="width:${progressPct()}%"></i></div></div><div class="goal-progress">${progressPct()}%</div></div>`:`<div class="section-title compact-title"><h2>${junior?'На что будем копить?':'Текущая цель'}</h2></div><button class="btn secondary block" data-route="goals">Выбрать цель</button>`}
      <div class="section-title compact-title"><h2>Активное задание</h2><button data-route="tasks">Все</button></div>${task?`<div class="active-task-card"><div class="active-task-art">${learningArtwork(task.cyberSafety?'help':'needs')}</div><div><span>${taskTypeLabel(task.mechanicType)}</span><h3>${esc(task.title)}</h3><p>Награда +${fmt(task.reward)} ●</p></div><button class="btn secondary" data-open-task="${task.id}">${taskResult?.taskId===task.id?'Продолжить':'Начать'}</button></div>`:`<div class="empty-state small-empty">${learningArtwork('savings')}<div><b>Все доступные задания выполнены</b><button class="linkbtn" data-route="tasks">Открыть список</button></div></div>`}
      <div class="section-title compact-title"><h2>${junior?'Что случилось':'Текущая ситуация'}</h2><span class="soft-label">${event?.categoryLabel||'событие'}</span></div>${eventTeaser()}
      <div class="section-title"><h2>${teen?'Действия':'Что сделать?'}</h2></div><div class="quick-actions"><button class="action" data-action="feed"><span class="ico">${illustration('🥣')}</span><b>${teen?'Еда':'Покормить'}</b><small>40 ●</small></button><button class="action" data-action="play"><span class="ico">${illustration('⚽')}</span><b>${teen?'Досуг':'Играть'}</b><small>80 ●</small></button><button class="action" data-action="care"><span class="ico">${illustration('🫧')}</span><b>${teen?'Уход':'Ухаживать'}</b><small>60 ●</small></button><button class="action" data-route="shop"><span class="ico">${illustration('','shop')}</span><b>Магазин</b><small>выбрать</small></button></div>${teen?`<button class="work-entry" data-route="sidejob"><span class="work-entry-icon">${illustration('◇')}</span><span><b>${state.workSession?'Продолжить смену':'Подработка'}</b><small>${workShiftStatusShort()} · от +120 монет / −20 энергии</small></span><span aria-hidden="true">›</span></button>`:''}${wishHtml()}${worldProgressCard()}<button class="btn primary block end-day" data-new-day>Завершить день ${state.wallet.day}</button></section>`;
  }

  function savingsScreen() {
    const g=goalView(),saved=state.wallet.savings,amounts=[50,100,saved].filter((n,i,a)=>n>0&&n<=saved&&a.indexOf(n)===i);
    return `<section class="screen">${topbar('Копилка',true)}<div class="savings-visual">${learningArtwork('savings')}</div><div class="card savings-hero"><div class="big-money">${fmt(saved)}</div><div class="muted">монет отложено${g?` на «${esc(g.name)}»`:''}</div>${g?`<div class="bar green" style="height:10px;margin-top:16px"><i style="width:${progressPct()}%"></i></div><p class="subtle">${fmt(saved)} из ${fmt(goalTarget())} · ${progressPct()}% · ≈ ${weeksToGoal()} нед.</p>`:'<p class="subtle">Можно копить без выбранной цели и выбрать её позже.</p>'}</div><div class="section-title"><h2>Отложить монеты</h2></div><div class="save-controls">${[50,100,200].map(n=>`<button data-save="${n}">+${n}</button>`).join('')}</div><div class="save-custom"><input type="number" min="1" inputmode="numeric" placeholder="Другая сумма" id="saveAmount"><button class="btn primary" data-save-custom>Отложить</button></div>${saved>0?`<div class="section-title"><h2>Вернуть на баланс</h2></div><div class="withdraw-options">${amounts.map(n=>`<button class="btn secondary" data-withdraw="${n}">${n===saved?'Всю сумму':fmt(n)+' ●'}</button>`).join('')}</div>`:''}<p class="subtle">Перед возвратом приложение покажет новый остаток и примерный срок цели.</p></section>`;
  }

  function profileScreen() {
    const ws=worldStageData();
    return `<section class="screen">${topbar('Профиль')}<div class="card profile-row"><div class="avatar">${petSVG()}</div><div><h3>${esc(state.pet.name)}</h3><p class="subtle">Режим ${state.ageGroup} · ${petStage()}</p></div></div><div class="card macro-card"><div class="eyebrow">Мир</div><h3>Этап ${ws.id} · ${ws.title}</h3><p>${ws.note}</p><div class="world-badges">${state.worldProgress.areas.map(a=>`<span>${C.world.areas.find(x=>x.id===a)?.name||a}</span>`).join('')}</div></div><div class="menu"><button data-route="progress">Прогресс мира <span>›</span></button><button data-route="achievements">Достижения <span>${state.achievements.length}/${C.achievements.length} ›</span></button><button data-help>Как всё работает <span>›</span></button><button data-route="adultGate">Для взрослых <span>›</span></button><button data-route="settings">Настройки <span>›</span></button></div></section>`;
  }

  function helpScreen() {
    const topics=(C.helpTopics||[]).filter(t=>t.ages.includes(state.ageGroup));const selected=topics.find(t=>t.id===state.helpLastTopic);
    if(selected)return `<section class="screen help-screen">${topbar('Помощь',true)}<div class="help-article-art">${learningArtwork(selected.id==='virus'||selected.id==='links'?'help':'savings')}</div><article class="help-article"><div class="eyebrow">Как всё работает</div><h2>${esc(selected.title)}</h2><p>${esc(selected.text)}</p><div class="help-example"><b>Пример</b><span>${esc(selected.example)}</span></div></article><button class="btn secondary block" data-help-list>К списку тем</button></section>`;
    return `<section class="screen help-screen">${topbar('Как всё работает',true)}<div class="help-hero">${learningArtwork('help')}<div><h2>Короткие подсказки</h2><p>Каждая тема — на один небольшой экран.</p></div></div><div class="help-list">${topics.map(t=>`<button data-help-topic="${t.id}"><span>${esc(t.title)}</span><b>›</b></button>`).join('')}</div><button class="btn secondary block replay-intro" data-replay-intro>Повторить вводное знакомство</button></section>`;
  }

  function adultGateScreen() {
    return `<section class="screen adult-screen">${topbar('Для взрослых',true)}<div class="adult-illustration">${learningArtwork('adult')}</div><h2>Информация для взрослого</h2><p>Это обзор учебного прогресса, а не строгий родительский контроль. Чтобы случайно не открыть раздел во время игры, удерживайте кнопку три секунды.</p><button class="adult-hold" data-adult-hold><span class="adult-hold-progress" aria-hidden="true"></span><b>Удерживать 3 секунды</b><small>Отпустите — отсчёт начнётся заново</small></button></section>`;
  }

  function completedLearningTopics() {
    return C.tasks.filter(t=>state.completedTasks.includes(t.id)).map(t=>t.topic||t.learningOutcome||t.title).filter((x,i,a)=>a.indexOf(x)===i);
  }
  function adultScreen() {
    const g=goalView(),topics=completedLearningTopics(),world=worldStageData();
    return `<section class="screen adult-screen">${topbar('Для взрослых',true)}<div class="adult-summary"><div>${learningArtwork('adult')}</div><div><div class="eyebrow">Цель приложения</div><h2>Учиться принимать финансовые решения без оценки ребёнка</h2><p>Питомец, недели и цели показывают последствия выбора в безопасной игровой среде.</p></div></div><div class="adult-metrics"><div><span>Возрастной режим</span><b>${state.ageGroup}</b></div><div><span>Завершено недель</span><b>${state.weekHistory.length}</b></div><div><span>Выполнено заданий</span><b>${state.completedTasks.length}</b></div><div><span>Мир</span><b>Этап ${world.id}</b></div></div><div class="section-title"><h2>Текущая цель</h2></div><div class="adult-goal"><b>${g?esc(g.name):'Пока не выбрана'}</b><span>${g?`${fmt(state.wallet.savings)} из ${fmt(goalTarget())} монет`:'Ребёнок сможет выбрать её в разделе целей.'}</span></div><div class="section-title"><h2>Развитие питомца и мира</h2></div><div class="progress-pair"><div><span>Питомец</span><b>${Math.round(state.pet.development)} / 100</b></div><div><span>Открыто мест</span><b>${state.worldProgress.areas.length} / ${C.world.areas.length}</b></div></div><div class="section-title"><h2>Пройденные темы</h2></div>${topics.length?`<div class="topic-chips">${topics.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'<div class="empty-state small-empty"><div><b>Темы ещё не завершены</b><span>Они появятся после выполнения игровых заданий.</span></div></div>'}<div class="section-title"><h2>Чему учат механики</h2></div><div class="adult-mechanics">${(C.adultMechanics||[]).map(([n,d])=>`<details><summary>${esc(n)}</summary><p>${esc(d)}</p></details>`).join('')}</div><div class="adult-reset"><button class="linkbtn danger" data-reset>Удалить локальный профиль</button><p>Будут удалены данные только на этом устройстве. Потребуется отдельное подтверждение.</p></div></section>`;
  }

  function taskTypeLabel(type){return ({allocation:'Распредели бюджет',subscriptions:'Найди лишнее',goal_slider:'Что изменится?',compare:'Сравни предложения',role:'Смена роли',safety:'Безопасность в интернете'}[type]||'Финансовая ситуация');}

  function purchasePreview(id) {
    const item=C.items.find(x=>x.id===id);if(!item)return null;const enough=state.wallet.balance>=item.price,after=state.wallet.balance-item.price,delay=item.need?0:purchaseGoalDelay(item.price);return {item,enough,after,missing:Math.max(0,-after),delay,category:item.need?'Нужно':'Желание'};
  }
  function openPurchaseConfirmation(id){const p=purchasePreview(id);if(!p)return;modal={type:'purchaseConfirm',itemId:id};track('purchase_confirmation_opened',{itemId:id,price:p.item.price,enough:p.enough});save();render();}
  function confirmPurchase(id){const p=purchasePreview(id);if(!p?.enough)return false;track('purchase_confirmation_confirmed',{itemId:id,price:p.item.price});save();modal=null;buyItem(id);return true;}

  function weeksForSavedAmount(saved) {const g=activeGoal();if(!g)return null;const remain=Math.max(0,goalTarget(g)-Math.max(0,saved));if(!remain)return 0;return Math.max(1,Math.ceil(remain/Math.max(50,savingsTempo())));}
  function withdrawalPreview(amount){const n=Math.min(Math.max(0,Number(amount)||0),state.wallet.savings),after=state.wallet.savings-n;return {amount:n,before:state.wallet.savings,after,remaining:activeGoal()?Math.max(0,goalTarget()-after):null,beforeWeeks:weeksForSavedAmount(state.wallet.savings),afterWeeks:weeksForSavedAmount(after)};}
  function openWithdrawalPreview(amount){const p=withdrawalPreview(amount);if(!p.amount)return;modal={type:'withdrawalPreview',amount:p.amount};track('savings_withdrawal_previewed',{amount:p.amount,goalId:state.activeGoal,beforeWeeks:p.beforeWeeks,afterWeeks:p.afterWeeks});save();render();}
  function confirmWithdrawal(amount){const p=withdrawalPreview(amount);if(!p.amount)return false;track('savings_withdrawal_confirmed',{amount:p.amount,goalId:state.activeGoal,beforeWeeks:p.beforeWeeks,afterWeeks:p.afterWeeks});save();modal=null;withdrawSaving(p.amount);return true;}

  function completeAdultHold(elapsed){if(Number(elapsed)<3000)return false;adultUnlocked=true;route='adult';track('adult_section_opened',{ageGroup:state.ageGroup});save();render();return true;}
  function resetProfile(){localStorage.removeItem(STORAGE_KEY);state=freshState();adultUnlocked=false;introReplay=false;modal=null;route='onboarding';render();}

  function renderModal() {
    if(modal.type==='purchaseConfirm'){
      const p=purchasePreview(modal.itemId);if(!p)return '';
      const effect=p.item.effect?.mood?`Настроение ${p.item.effect.mood>0?'+':''}${p.item.effect.mood}`:p.item.effect?.satiety?`Сытость +${p.item.effect.satiety}`:p.item.effect?.care?`Уход +${p.item.effect.care}`:p.delay>0?`Цель примерно на ${p.delay} нед. дальше`:'Мир питомца изменится';
      return `<div class="overlay" data-close-overlay><div class="sheet confirmation-sheet" data-sheet><div class="sheet-handle"></div><div class="confirmation-art">${illustration(p.item.icon,p.item.name||p.item.id)}</div><div class="eyebrow">${p.category}</div><h2>${esc(p.item.name)}</h2><div class="confirmation-facts"><div><span>Цена</span><b>${fmt(p.item.price)} ●</b></div><div><span>Баланс после</span><b>${p.enough?fmt(p.after)+' ●':'Не хватает '+fmt(p.missing)+' ●'}</b></div><div><span>Влияние</span><b>${esc(effect)}</b></div></div>${p.enough?`<div class="grid2"><button class="btn primary" data-confirm-buy="${p.item.id}">Купить</button><button class="btn secondary" data-purchase-cancel>Не сейчас</button></div>`:`<div class="insufficient-actions"><p>Покупка не выполнена. Можно выбрать следующее действие без снятия денег из копилки.</p><button class="btn secondary" data-purchase-cancel>Вернуться</button><button class="btn secondary" data-modal-route="tasks">Открыть задания</button>${state.ageGroup==='15-17'?'<button class="btn secondary" data-modal-route="sidejob">Открыть подработку</button>':''}</div>`}</div></div>`;
    }
    if(modal.type==='withdrawalPreview'){
      const p=withdrawalPreview(modal.amount);return `<div class="overlay" data-close-overlay><div class="sheet confirmation-sheet" data-sheet><div class="sheet-handle"></div><div class="preview-illustration">${learningArtwork('savings')}</div><div class="eyebrow">До операции</div><h2>Вернуть ${fmt(p.amount)} монет?</h2><div class="confirmation-facts four"><div><span>В копилке</span><b>${fmt(p.before)} → ${fmt(p.after)}</b></div><div><span>До цели останется</span><b>${p.remaining==null?'Цель не выбрана':fmt(p.remaining)+' ●'}</b></div><div><span>Срок был</span><b>${p.beforeWeeks==null?'—':`≈ ${p.beforeWeeks} нед.`}</b></div><div><span>Срок станет</span><b>${p.afterWeeks==null?'—':`≈ ${p.afterWeeks} нед.`}</b></div></div><div class="grid2"><button class="btn primary" data-confirm-withdraw="${p.amount}">Вернуть на баланс</button><button class="btn secondary" data-withdraw-cancel>Оставить в копилке</button></div></div></div>`;
    }
    if(modal.type==='resetConfirm')return `<div class="overlay" data-close-overlay><div class="sheet" data-sheet><div class="sheet-handle"></div><div class="eyebrow">Подтверждение</div><h2>Удалить локальный профиль?</h2><p>Будут удалены баланс, копилка, цели, покупки, прогресс, задания и история недель на этом устройстве.</p><div class="grid2"><button class="btn danger-button" data-confirm-reset>Удалить</button><button class="btn secondary" data-close-modal>Отмена</button></div></div></div>`;
    if(modal.type==='event'){const e=C.events.find(x=>x.id===modal.id);if(!e)return '';return `<div class="overlay" data-close-overlay><div class="sheet" data-sheet><div class="sheet-handle"></div><div class="eyebrow">${e.categoryLabel||'Событие'}</div><h2>${e.title}</h2><p>${e.situation||e.text}</p><div class="stack">${e.choices.map((c,i)=>`<button class="choice event-choice" data-event-choice="${i}"><b>${c.text}</b>${choicePreview(c,e)}</button>`).join('')}</div></div></div>`;}
    if(modal.type==='eventResult')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Что произошло</div><h2>${modal.title||'Последствие'}</h2><div class="result-box"><p>${modal.result}</p></div>${modal.feedback?feedbackHtml(modal.feedback):''}<button class="btn primary block" style="margin-top:12px" data-close-modal>Продолжить</button></div></div>`;
    if(modal.type==='delayedImpact'){const total=modal.charges.reduce((s,c)=>s+(c.paid||0),0);return `<div class="overlay"><div class="sheet delayed-sheet"><div class="sheet-handle"></div><div class="eyebrow">Произошло автоматически</div><h2>−${fmt(total)} монет</h2><div class="delayed-list">${modal.charges.map(c=>`<div><span>${esc(c.description)}</span><b>−${fmt(c.paid||0)}</b></div>`).join('')}</div><p class="subtle">Это последствие решения из прошлых игровых дней или недель.</p><button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;}
    if(modal.type==='goalUnlocked')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Большая цель</div><h2>${esc(modal.title)}</h2><p>${esc(modal.message)}</p><div class="unlock-visual">${modal.icon||'✦'}</div><button class="btn primary block" data-close-modal>Посмотреть мир</button></div></div>`;
    if(modal.type==='financialFeedback')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Цена решения</div><h2>${modal.title}</h2>${feedbackHtml(modal.feedback)}<button class="btn primary block" style="margin-top:12px" data-close-modal>Понятно</button></div></div>`;
    if(modal.type==='saveFirst'){const n=Math.min(modal.amount||200,state.wallet.balance);return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Перед неделей</div><h2>${state.ageGroup==='7-11'?'Сразу положить в копилку?':'Отложить сначала?'}</h2><p>Это не обязательно. Можно оставить деньги свободными и решить позже.</p><div class="grid2"><button class="btn good" data-save="${n}">Отложить ${fmt(n)}</button><button class="btn secondary" data-close-modal>Не сейчас</button></div></div></div>`;}
    if(modal.type==='workComplete')return `<div class="overlay"><div class="sheet work-complete-sheet"><div class="sheet-handle"></div><div class="eyebrow">Смена завершена</div><h2>+${fmt(modal.reward)} монет</h2><div class="feedback-grid"><div><span>Энергия</span><b>−${fmt(modal.energyCost)}</b></div><div><span>Баланс</span><b>${fmt(modal.balance)} ●</b></div><div><span>Осталось энергии</span><b>${Math.round(modal.energy)}⚡</b></div></div><p class="subtle">Деньги уже в обычном кошельке. Дальше решаешь сам: потратить, оставить или отложить.</p><button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;
    if(modal.type==='dayConfirm')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><h2>Завершить день?</h2><p>Можно ничего не покупать. Потребности немного изменятся просто потому, что игровой день прошёл.</p><div class="grid2"><button class="btn primary" data-confirm-day>Завершить</button><button class="btn secondary" data-close-modal>Вернуться</button></div></div></div>`;
    return '';
  }

  function cancelTrackedModal() {
    if(modal?.type==='purchaseConfirm')track('purchase_confirmation_cancelled',{itemId:modal.itemId});
    if(modal?.type==='withdrawalPreview')track('savings_withdrawal_cancelled',{amount:modal.amount,goalId:state.activeGoal});
    save();modal=null;render();
  }

  function bindCommon() {
    document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>{route=b.dataset.route;taskResult=null;if(route==='sidejob')track('side_job_opened',{source:'navigation'});if(route!=='weekStart')editingPlan=false;render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>{route=route==='help'?(helpReturnRoute||'profile'):['adult','adultGate'].includes(route)?'profile':(route==='shop'||route==='task'||route==='pet'||route==='sidejob')?'home':route==='savings'?'budget':'profile';taskResult=null;render();});
    document.querySelectorAll('[data-help]').forEach(b=>b.onclick=()=>{helpReturnRoute=route;state.helpLastTopic=null;route='help';track('help_opened',{source:helpReturnRoute});save();render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-help-topic]').forEach(b=>b.onclick=()=>{state.helpLastTopic=b.dataset.helpTopic;track('help_topic_opened',{topicId:state.helpLastTopic});save();render();window.scrollTo(0,0);});document.querySelectorAll('[data-help-list]').forEach(b=>b.onclick=()=>{state.helpLastTopic=null;save();render();});document.querySelectorAll('[data-replay-intro]').forEach(b=>b.onclick=startIntroReplay);
    document.querySelectorAll('[data-open-task]').forEach(b=>b.onclick=()=>{taskScreen.id=b.dataset.openTask;route='task';taskResult=null;render();window.scrollTo(0,0);});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>quickAction(b.dataset.action));document.querySelectorAll('[data-shop-cat]').forEach(b=>b.onclick=()=>{shopScreen.cat=b.dataset.shopCat;render();});document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>openPurchaseConfirmation(b.dataset.buy));
    document.querySelectorAll('[data-confirm-buy]').forEach(b=>b.onclick=()=>confirmPurchase(b.dataset.confirmBuy));document.querySelectorAll('[data-purchase-cancel],[data-withdraw-cancel]').forEach(b=>b.onclick=cancelTrackedModal);document.querySelectorAll('[data-modal-route]').forEach(b=>b.onclick=()=>{const target=b.dataset.modalRoute;if(modal?.type==='purchaseConfirm')track('purchase_confirmation_cancelled',{itemId:modal.itemId,next:target});save();modal=null;route=target;if(target==='sidejob')track('side_job_opened',{source:'purchase_shortage'});render();});
    document.querySelectorAll('[data-task-choice]').forEach(b=>b.onclick=()=>chooseTask(Number(b.dataset.taskChoice)));document.querySelectorAll('[data-finish-task]').forEach(b=>b.onclick=finishTask);document.querySelectorAll('[data-task-allocate]').forEach(b=>b.onclick=resolveAllocationTask);document.querySelectorAll('[data-task-slider]').forEach(b=>b.onclick=resolveSliderTask);document.querySelectorAll('[data-task-subscriptions]').forEach(b=>b.onclick=resolveSubscriptionsTask);
    document.querySelectorAll('[data-savings]').forEach(b=>b.onclick=()=>{modal=null;route='savings';render();window.scrollTo(0,0);});document.querySelectorAll('[data-goal]').forEach(b=>b.onclick=()=>selectGoal(b.dataset.goal));document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{modal={type:'event',id:b.dataset.event};track('event_started',{eventId:b.dataset.event,chainId:state.currentChainId});render();});document.querySelectorAll('[data-event-choice]').forEach(b=>b.onclick=()=>resolveEvent(Number(b.dataset.eventChoice)));
    document.querySelectorAll('[data-close-overlay]').forEach(x=>x.onclick=e=>{if(e.target===x)cancelTrackedModal();});document.querySelectorAll('[data-sheet]').forEach(x=>x.onclick=e=>e.stopPropagation());document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=()=>{modal=null;render();});
    document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>saveAmount(Number(b.dataset.save)));document.querySelectorAll('[data-save-custom]').forEach(b=>b.onclick=()=>{const n=Number(document.querySelector('#saveAmount')?.value||0);if(n>0)saveAmount(n);});document.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=()=>openWithdrawalPreview(Number(b.dataset.withdraw)));document.querySelectorAll('[data-confirm-withdraw]').forEach(b=>b.onclick=()=>confirmWithdrawal(Number(b.dataset.confirmWithdraw)));
    document.querySelectorAll('[data-new-day]').forEach(b=>b.onclick=requestNewDay);document.querySelectorAll('[data-confirm-day]').forEach(b=>b.onclick=()=>{modal=null;advanceDay();});document.querySelectorAll('[data-next-week]').forEach(b=>b.onclick=startNextWeek);document.querySelectorAll('[data-save-plan]').forEach(b=>b.onclick=saveWeekPlan);document.querySelectorAll('[data-edit-plan]').forEach(b=>b.onclick=()=>{editingPlan=true;route='weekStart';render();window.scrollTo(0,0);});document.querySelectorAll('[data-dismiss-wish]').forEach(b=>b.onclick=dismissWish);document.querySelectorAll('[data-wish-buy]').forEach(b=>b.onclick=()=>{shopScreen.cat=C.items.find(i=>i.id===b.dataset.wishBuy)?.category||'Игры';route='shop';render();});
    document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.toggle;state.settings[k]=!state.settings[k];if(k==='motion'){track(state.settings.motion?'motion_enabled':'motion_disabled',{difficultyMode:state.difficultyMode});syncMotionPreference();}save();render();});document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>{modal={type:'resetConfirm'};render();});document.querySelectorAll('[data-confirm-reset]').forEach(b=>b.onclick=resetProfile);
    document.querySelectorAll('[data-world-area]').forEach(b=>b.onclick=()=>{if(state.worldProgress.areas.includes(b.dataset.worldArea)){state.currentWorldArea=b.dataset.worldArea;save();render();}});document.querySelectorAll('[data-work-start]').forEach(b=>b.onclick=()=>startWorkActivity(b.dataset.workStart));document.querySelectorAll('[data-work-bin]').forEach(b=>b.onclick=()=>resolveWorkBin(b.dataset.workBin));document.querySelectorAll('[data-work-cancel]').forEach(b=>b.onclick=cancelWorkActivity);
    document.querySelectorAll('[data-jar-delta]').forEach(b=>b.onclick=()=>{const id=b.dataset.jarTarget,input=document.getElementById(id);if(!input)return;const delta=Number(b.dataset.jarDelta||0),budget=Number(document.getElementById('planTotal')?.dataset.budget||planningBudget());const current=Math.max(0,Number(input.value||0));input.value=Math.max(0,Math.min(budget,current+delta));renderJarValues();updatePlanTotal();});const planInputs=['planNecessary','planWants','planSavings','planReserve'].map(id=>document.getElementById(id)).filter(Boolean);planInputs.forEach(x=>x.addEventListener('input',updatePlanTotal));const slider=document.getElementById('goalSlider');if(slider)slider.oninput=()=>{document.getElementById('sliderValue').textContent=slider.value;document.getElementById('sliderWeeks').textContent=`${Math.ceil(1200/Number(slider.value))} недель`;};
    document.querySelectorAll('[data-adult-hold]').forEach(b=>{const stop=()=>{clearTimeout(adultHoldTimer);adultHoldTimer=null;adultHoldStartedAt=0;b.classList.remove('holding');};b.onpointerdown=e=>{e.preventDefault();stop();adultHoldStartedAt=Date.now();b.classList.add('holding');adultHoldTimer=setTimeout(()=>completeAdultHold(Date.now()-adultHoldStartedAt),3000);};b.onpointerup=stop;b.onpointerleave=stop;b.onpointercancel=stop;b.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!adultHoldStartedAt){e.preventDefault();adultHoldStartedAt=Date.now();b.classList.add('holding');adultHoldTimer=setTimeout(()=>completeAdultHold(Date.now()-adultHoldStartedAt),3000);}};b.onkeyup=stop;});
  }

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
    return state.settings?.motion!==false;
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
    let u=null; for(const key of ageKeys){if(!u)u=C.goalUnlocksByAge?.[key]?.[goalId]||null;} u=u||C.goalUnlocks?.[goalId]; if(!u)return[];
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
    if(showingSplash){app.innerHTML=`<section class="splash"><div><div class="splash-mark">${petSVG('mumo','#7C8CF8','badge')}</div><h1>КопиХвост</h1><p>Твои деньги. Твои решения.</p></div></section>`;syncMotionPreference();return;}
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
      app.innerHTML=`<section class="onboarding intro-onboarding"><header class="onboard-header"><div class="brand">КопиХвост</div><button class="skip-link" data-intro-skip>Пропустить</button></header><div class="onboard-main"><div class="onboard-visual">${learningArtwork(slide.art)}</div><div class="dots" aria-label="Экран ${step+1} из ${slides.length}">${slides.map((_,i)=>`<i class="${i===step?'active':''}"></i>`).join('')}</div><h1>${esc(slide.title)}</h1><p>${esc(slide.text)}</p></div><button class="btn primary block" data-onboard-next>${step===slides.length-1?'Выбрать режим':'Дальше'}</button></section>`;
      app.querySelector('[data-intro-skip]').onclick=skipInitialIntro;app.querySelector('[data-onboard-next]').onclick=advanceInitialIntro;return;
    }
    if(step===slides.length){
      const modes=[['easy','Лёгкий','Меньше текста, проще ситуации и больше подсказок.'],['medium','Средний','Больше самостоятельных решений и сложнее финансовые ситуации.']];
      app.innerHTML=`<section class="onboarding difficulty-onboarding"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main age-select-main"><div><div class="eyebrow">Шаг 1 из 2</div><h1>Как будем играть?</h1><p>Выбери режим, с которым начнёшь игру.</p></div><div class="age-grid difficulty-grid">${modes.map(m=>`<button class="select-card ${state.difficultyMode===m[0]?'active':''}" data-difficulty="${m[0]}"><h3>${m[1]}</h3><p>${m[2]}</p></button>`).join('')}</div></div><button class="btn primary block" data-difficulty-next ${!state.difficultyMode?'disabled':''}>Создать питомца</button></section>`;
      app.querySelectorAll('[data-difficulty]').forEach(b=>b.onclick=()=>{setDifficulty(b.dataset.difficulty,{initial:true});render();});
      app.querySelector('[data-difficulty-next]').onclick=()=>{state.onboardingStep=slides.length+1;save();render();};return;
    }
    app.innerHTML=`<section class="onboarding pet-create"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main pet-create-main"><div><div class="eyebrow">Шаг 2 из 2</div><h1>Создай друга</h1><p>Выбери питомца, цвет акцента и аксессуар.</p></div><div class="pet-grid">${C.pets.map(p=>`<button class="select-card pet-pick ${state.pet.type===p.id?'active':''}" data-pet="${p.id}">${petSVG(p.id,state.pet.color,state.pet.accessory)}<div><h3>${p.name}</h3><p>${p.desc}</p></div></button>`).join('')}</div><div class="field"><label for="petName">Имя питомца</label><input id="petName" maxlength="14" value="${esc(state.pet.name)}"></div><div class="field"><label>Цвет акцента</label><div class="color-row">${C.petColors.map(c=>`<button class="color-dot ${state.pet.color===c?'active':''}" style="background:${c}" data-color="${c}" aria-label="Выбрать цвет ${c}"></button>`).join('')}</div></div><div class="field accessory-field"><label for="accessory">Аксессуар</label><select id="accessory">${C.accessories.map(a=>`<option value="${a.id}" ${state.pet.accessory===a.id?'selected':''}>${a.name}</option>`).join('')}</select></div></div><div class="onboard-actions"><button class="btn primary block" data-start>Получить 1000 монет</button></div></section>`;
    const rememberName=()=>{const input=app.querySelector('#petName');if(input)state.pet.name=(input.value||'Финни').slice(0,14);};
    app.querySelectorAll('[data-pet]').forEach(b=>b.onclick=()=>{rememberName();state.pet.type=b.dataset.pet;save();render();});app.querySelectorAll('[data-color]').forEach(b=>b.onclick=e=>{e.preventDefault();rememberName();state.pet.color=b.dataset.color;save();render();});
    app.querySelector('#accessory').onchange=e=>{rememberName();state.pet.accessory=e.target.value;track('accessory_selected',{accessory:e.target.value,petType:state.pet.type});save();render();};app.querySelector('#petName').oninput=e=>{state.pet.name=e.target.value;save();};
    app.querySelector('[data-start]').onclick=()=>{rememberName();state.pet.name=(state.pet.name||'Финни').trim().slice(0,14)||'Финни';if(!state.difficultyMode)setDifficulty('easy',{initial:true});state.onboardingDone=true;state.onboardingIntroCompleted=true;state.onboardingStep=slides.length+2;tx('income',1000,'Доход','Стартовый недельный бюджет','onboarding');state.currentEventId=selectEventId(state,true);state.weekNeedsPlanning=true;track('pet_created',{type:state.pet.type,difficultyMode:state.difficultyMode,accessory:state.pet.accessory});track('week_started',{week:1,income:1000});save();route='weekStart';render();};
  }

  function renderAgeMigration(){
    app.innerHTML=`<section class="onboarding migration-screen"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main"><div class="onboard-visual compact-art">${learningArtwork('help')}</div><div><div class="eyebrow">Режим игры</div><h1>Выбери сложность</h1><p>Монеты, покупки, цели и весь прогресс сохранятся.</p></div><div class="age-grid difficulty-grid"><button class="select-card" data-migrated-difficulty="easy"><h3>Лёгкий</h3><p>Проще ситуации и больше подсказок.</p></button><button class="select-card" data-migrated-difficulty="medium"><h3>Средний</h3><p>Больше самостоятельных решений.</p></button></div></div></section>`;
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
    return `<section class="screen settings-screen"><header class="settings-header"><button class="linkbtn" data-back>← Назад</button><h1>Настройки</h1></header><div class="settings-group interface-settings"><div class="section-title"><h2>Интерфейс</h2></div><div class="menu settings-list"><button data-toggle="motion" role="switch" aria-checked="${state.settings.motion!==false}" aria-label="Анимация интерфейса"><span class="setting-copy"><b>Анимация</b><small>Движения питомца, переходы и реакции на действия</small></span><span class="setting-control"><small>${state.settings.motion!==false?'Вкл.':'Выкл.'}</small><span class="switch-track" aria-hidden="true"></span></span></button><button data-toggle="sound" role="switch" aria-checked="${state.settings.sound!==false}" aria-label="Звуки"><span class="setting-copy"><b>Звуки</b><small>Звуковые реакции приложения</small></span><span class="setting-control"><small>${state.settings.sound!==false?'Вкл.':'Выкл.'}</small><span class="switch-track" aria-hidden="true"></span></span></button></div></div><div class="settings-reset"><button class="linkbtn danger" data-reset>Начать заново</button><p class="subtle">Удалить сохранённый прогресс и начать новую игру.</p></div><p class="settings-note">Прогресс сохраняется на этом устройстве.</p>${pageArtwork('settings')}</section>`;
  }

  function createParentPuzzle(){
    const a=6+Math.floor(Math.random()*7),b=3+Math.floor(Math.random()*7),correct=a+b;
    const values=new Set([correct]);
    for(const delta of [1,-1,2,-2,3,-3]){if(values.size>=4)break;const value=correct+delta;if(value>0)values.add(value);}
    const options=[...values].slice(0,4);for(let i=options.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[options[i],options[j]]=[options[j],options[i]];}
    parentPuzzleState={a,b,correct,options,attempted:false};return parentPuzzleState;
  }
  function parentPuzzle(){return parentPuzzleState||createParentPuzzle();}
  function chooseParentPuzzle(answer){
    const p=parentPuzzle();if(!p.attempted){p.attempted=true;track('parent_gate_attempted',{difficultyMode:state.difficultyMode});}
    if(Number(answer)!==p.correct){track('parent_gate_failed',{type:'quick_sum'});parentGateMessage='Не получилось — попробуйте другой пример.';createParentPuzzle();render();return false;}
    adultUnlocked=true;track('parent_gate_completed',{type:'quick_sum'});track('adult_section_opened',{difficultyMode:state.difficultyMode});save();route='adult';parentPuzzleState=null;parentGateMessage='';render();return true;
  }
  function lockAdultGate(){adultUnlocked=false;parentPuzzleState=null;parentGateMessage='';}
  function completeAdultHold(){return false;}
  function adultGateScreen(){
    const p=parentPuzzle();return `<section class="screen adult-screen parent-quiz-screen">${topbar('Для взрослых',true)}<div class="adult-illustration">${learningArtwork('adult')}</div><h2>Небольшая проверка</h2><p>Чтобы открыть раздел, выберите ответ: <b>${p.a} + ${p.b} = ?</b></p><div class="parent-quiz" aria-label="Проверка для взрослого">${p.options.map(x=>`<button class="parent-answer" data-parent-puzzle="${x}">${x}</button>`).join('')}</div>${parentGateMessage?`<p class="parent-gate-message" role="status">${parentGateMessage}</p>`:''}<p class="subtle">Это защита от случайного входа, а не пароль.</p></section>`;
  }
  function adultScreen(){
    const g=goalView(),topics=completedLearningTopics(),world=worldStageData();return `<section class="screen adult-screen">${topbar('Для взрослых',true)}<div class="adult-summary"><div>${learningArtwork('adult')}</div><div><div class="eyebrow">Цель приложения</div><h2>Учиться принимать финансовые решения без оценки ребёнка</h2><p>Питомец, недели и цели показывают последствия выбора в безопасной игровой среде.</p></div></div><div class="adult-metrics"><div><span>Режим игры</span><b>${difficultyLabel()}</b></div><div><span>Завершено недель</span><b>${state.weekHistory.length}</b></div><div><span>Выполнено заданий</span><b>${state.completedTasks.length}</b></div><div><span>Мир</span><b>Этап ${world.id}</b></div></div><div class="section-title"><h2>Текущая цель</h2></div><div class="adult-goal"><b>${g?esc(g.name):'Пока не выбрана'}</b><span>${g?`${fmt(state.wallet.savings)} из ${fmt(goalTarget())} монет`:'Ребёнок сможет выбрать её в разделе целей.'}</span></div><div class="section-title"><h2>Пройденные темы</h2></div>${topics.length?`<div class="topic-chips">${topics.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'<div class="empty-state small-empty"><div><b>Темы ещё не завершены</b><span>Они появятся после выполнения игровых заданий.</span></div></div>'}<div class="section-title"><h2>Чему учат механики</h2></div><div class="adult-mechanics">${(C.adultMechanics||[]).map(([n,d])=>`<details><summary>${esc(n)}</summary><p>${esc(d)}</p></details>`).join('')}</div><div class="adult-reset"><button class="linkbtn danger" data-reset>Удалить локальный профиль</button><p>Будут удалены данные только на этом устройстве. Потребуется отдельное подтверждение.</p></div></section>`;
  }

  if(document?.addEventListener&&!window.__finpetV6Events){
    window.__finpetV6Events=true;
    document.addEventListener('click',e=>{
      const puzzle=e.target?.closest?.('[data-parent-puzzle]');if(puzzle){e.preventDefault();chooseParentPuzzle(puzzle.dataset.parentPuzzle);return;}
      const gate=e.target?.closest?.('[data-route="adultGate"]');if(gate){track('parent_gate_opened',{source:'profile'});save();}
    },true);
    document.addEventListener('click',e=>{if(route==='adult'&&e.target?.closest?.('[data-back]'))lockAdultGate();},true);
  }
  // ===== END V6 OVERRIDES =====
  window.FINPET_DEV = {
    freshState, migrateState, actualsForWeek, weeksToGoal, healthText, version:6,
    getState:()=>JSON.parse(JSON.stringify(state)),
    getModal:()=>modal?JSON.parse(JSON.stringify(modal)):null,
    setRoute:r=>{route=r;render();return app.innerHTML;},
    renderHome:()=>homeScreen(),
    renderPet:(type,color,accessory)=>petSVG(type,color,accessory),
    setAccessory:id=>{if(!C.accessories.some(a=>a.id===id))return false;state.pet.accessory=id;track('accessory_selected',{accessory:id,petType:state.pet.type});save();render();return true;},
    desiredWorldStage:(s)=>desiredWorldStage(s||state),
    worldStage:()=>state.worldProgress.stage,
    createFutureObligation, processDueObligations,
    getContent:()=>C,
    work:{normalize:normalizeWorkState,available:availableWorkActivities,start:startWorkActivity,sort:resolveWorkBin,cancel:cancelWorkActivity},
    confirmations:{purchasePreview,openPurchase:openPurchaseConfirmation,confirmPurchase,cancel:cancelTrackedModal,withdrawalPreview,openWithdrawal:openWithdrawalPreview,confirmWithdrawal},
    intro:{initialSkip:skipInitialIntro,initialAdvance:advanceInitialIntro,startReplay:startIntroReplay,finishReplay:finishIntroReplay},
    adult:{isUnlocked:()=>adultUnlocked,completeHold:completeAdultHold,createPuzzle:createParentPuzzle,choosePuzzle:chooseParentPuzzle,lock:lockAdultGate,getPuzzle:()=>JSON.parse(JSON.stringify(parentPuzzle()))},
    difficulty:{label:difficultyLabel,ages:modeAges,set:setDifficulty},
    motion:{enabled:motionEnabled,sync:syncMotionPreference},
    actions:{buyItem,saveAmount,completeWeek,startNextWeek,advanceDay,selectGoal}
  };
  // ===== END V5 OVERRIDES =====
  // ===== END V3 OVERRIDES =====


  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(reg=>reg.update()).catch(() => {});
  render();
})();
