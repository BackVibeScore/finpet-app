(() => {
  const C = window.FINPET_CONTENT;
  const STORAGE_KEY = 'finpet_mvp_state_v1'; // keep key for backward-compatible migration
  const DEMO_STORAGE_KEY = 'finpet_demo_state_v1';
  const app = document.getElementById('app');
  let demoMode = false;
  let state = migrateState(loadRawState(STORAGE_KEY), STORAGE_KEY);
  window.FINPET_STORAGE?.saveState?.(STORAGE_KEY, state);
  let route = !state.onboardingDone ? 'onboarding' : (state.weekSummary ? 'weekSummary' : (state.weekNeedsPlanning ? 'weekStart' : 'home'));
  let modal = null;
  let taskResult = null;
  let toastTimer = null;
  let petBubble = '';
  let showingSplash = true;
  let editingPlan = false;
  let introReplay = false;
  let introReplayStep = 0;
  let adultUnlocked = false;
  let helpReturnRoute = 'profile';
  setTimeout(() => { showingSplash = false; render(); }, 650);

  function loadRawState(storageKey = STORAGE_KEY) {
    try {
      if (window.FINPET_STORAGE?.loadSync) return window.FINPET_STORAGE.loadSync(storageKey);
      return JSON.parse(localStorage.getItem(storageKey));
    } catch (e) { return null; }
  }

  function save() {
    const storageKey = demoMode ? DEMO_STORAGE_KEY : STORAGE_KEY;
    if (window.FINPET_STORAGE?.saveState) window.FINPET_STORAGE.saveState(storageKey, state);
    else localStorage.setItem(storageKey, JSON.stringify(state));
  }
  function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, Number(n) || 0)); }
  function esc(s = '') { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function fmt(n) { return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)); }
  function isJunior(){ return state.difficultyMode==='easy'; }
  function moneyLabel(){ return isJunior()?'Монет осталось':'Баланс'; }
  function displayTxCategory(category){
    if(!isJunior()) return category;
    if(category==='Необходимые расходы') return 'Нужно';
    if(category==='Желания') return 'Хочу';
    if(category==='Доход'||category==='Подработка') return 'Получил монеты';
    if(category==='Цель') return 'На что копим';
    return category;
  }
  function itemEffectText(item){
    const bits=[];
    if(Number(item?.effect?.satiety)>0) bits.push(`Сытость +${item.effect.satiety}`);
    if(Number(item?.effect?.mood)>0) bits.push(`Настроение +${item.effect.mood}`);
    const health=Number(item?.effect?.health ?? item?.effect?.care);if(health>0)bits.push(`Здоровье +${health}`);
    if(Number(item?.effect?.energy)>0) bits.push(`Энергия +${item.effect.energy}`);
    if(Number(item?.effect?.energy)<0) bits.push(`Энергия ${item.effect.energy}`);
    if(item?.cosmetic) bits.push('Меняет вид или комнату');
    return bits.join(' · ')||'Появится в мире питомца';
  }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`); }

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
    const normalized={...effect};if(normalized.health==null&&normalized.care!=null)normalized.health=normalized.care;delete normalized.care;
    const before={satiety:state.pet.satiety,mood:state.pet.mood,health:state.pet.health};
    for(const k of ['satiety','mood','energy','health','development'])if(normalized[k]!=null)state.pet[k]=clamp(state.pet[k]+normalized[k]);
    state.pet.health=state.pet.health;
    state.petNeedAlertFlags=state.petNeedAlertFlags||{satiety:false,mood:false,health:false};
    for(const key of ['satiety','mood','health']){
      if(before[key]>0&&state.pet[key]<=0)track('pet_critical_need_reached',{need:key,valueBefore:before[key],valueAfter:state.pet[key]});
      if(before[key]>=30&&state.pet[key]<30&&!state.petNeedAlertFlags[key]){state.petNeedAlertFlags[key]=true;track('pet_need_low_warning',{need:key,value:state.pet[key]});}
      if(state.pet[key]>=35)state.petNeedAlertFlags[key]=false;
    }
    checkAchievements();save();
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

  function planForWeek() {
    if (state.initialWeekPlan && state.initialWeekPlan.week === state.wallet.week) return state.initialWeekPlan;
    return state.weekPlan && state.weekPlan.week === state.wallet.week ? state.weekPlan : null;
  }
  function planningBudget() {
    const snap = state.weekSnapshot && state.weekSnapshot.week === state.wallet.week ? state.weekSnapshot : null;
    return snap ? Math.max(state.wallet.balance, snap.startingBalance + actualsForWeek().extraIncome) : state.wallet.balance;
  }
  function actualsForWeek(week = state.wallet.week) {
    const items = state.transactions.filter(t => t.week === week);
    let necessary = 0, wants = 0, savings = 0, extraIncome = 0, sideJobIncome = 0, activity = 0;
    items.forEach(t => {
      if (t.type === 'expense') {
        if (t.source === 'activity' || t.category === 'Занятие') activity += -t.amount;
        else if (t.category === 'Необходимые расходы') necessary += -t.amount;
        else wants += -t.amount;
      } else if (t.type === 'saving') savings += -t.amount;
      else if (t.type === 'saving_withdrawal') savings -= t.amount;
      else if ((t.type === 'income' || t.type === 'reward') && !['weekly_income', 'onboarding'].includes(t.source)) { extraIncome += t.amount; if (['side_job','work_shift'].includes(t.source)) sideJobIncome += t.amount; }
    });
    return { necessary, wants, savings: Math.max(0, savings), extraIncome, sideJobIncome, activity };
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
  function petWellbeing() { return Math.round((state.pet.satiety + state.pet.mood + state.pet.energy + state.pet.health) / 4); }
  function criticalPetNeeds(){
    const defs=[
      {id:'food',key:'satiety',label:'Сытость',problem:`${state.pet.name} очень голоден`,action:'Найти еду дома',effect:20},
      {id:'mood',key:'mood',label:'Настроение',problem:`${state.pet.name} совсем грустно`,action:'Обнять питомца',effect:15},
      {id:'health',key:'health',label:'Здоровье',problem:`${state.pet.name} плохо себя чувствует`,action:'Позаботиться дома',effect:15}
    ];
    return defs.filter(x=>Number(state.pet[x.key])<=0);
  }
  function canAdvanceDay(){return criticalPetNeeds().length===0;}
  function emergencyCareState(){
    state.emergencyCare=state.emergencyCare||{week:state.wallet.week,food:0,mood:0,health:0,history:[]};
    state.emergencyCare.history=Array.isArray(state.emergencyCare.history)?state.emergencyCare.history:[];
    if(state.emergencyCare.week!==state.wallet.week){
      state.emergencyCare.week=state.wallet.week;state.emergencyCare.food=0;state.emergencyCare.mood=0;state.emergencyCare.health=0;
    }
    return state.emergencyCare;
  }
  function emergencyCareForWeek(week=state.wallet.week){
    const history=emergencyCareState().history.filter(x=>x.week===week);
    return {food:history.filter(x=>x.need==='food').length,mood:history.filter(x=>x.need==='mood').length,health:history.filter(x=>x.need==='health'||x.need==='care').length,total:history.length};
  }
  function blockDayForCriticalNeeds(source='day'){
    const needs=criticalPetNeeds();if(!needs.length)return true;
    track('day_advance_blocked_pet_need',{source,needs:needs.map(x=>x.id),balance:state.wallet.balance});
    modal={type:'criticalPetNeeds',source,needs:needs.map(x=>x.id)};save();render();return false;
  }
  function emergencyPetCare(needId){
    const need=criticalPetNeeds().find(x=>x.id===needId);if(!need)return false;
    const before=Number(state.pet[need.key])||0,balanceBefore=state.wallet.balance,savingsBefore=state.wallet.savings;
    state.pet[need.key]=clamp(before+need.effect);
    const ec=emergencyCareState();ec[need.id]=(Number(ec[need.id])||0)+1;
    ec.history.push({id:uid(),week:state.wallet.week,day:state.wallet.day,need:need.id,valueBefore:before,valueAfter:state.pet[need.key],balance:state.wallet.balance,timestamp:Date.now()});
    ec.history=ec.history.slice(-120);
    track('emergency_pet_care_used',{need:need.id,week:state.wallet.week,day:state.wallet.day,balance:balanceBefore,valueBefore:before,valueAfter:state.pet[need.key]});
    recalculateHealth();save();
    modal={type:'emergencyCareResult',need:need.id,label:need.label,before,after:state.pet[need.key],remaining:criticalPetNeeds().map(x=>x.id),balanceBefore,savingsBefore};
    render();return true;
  }
  function emergencyCareButtonsHtml(){
    const needs=criticalPetNeeds();if(!needs.length)return '';
    return `<div class="emergency-care-panel"><b>Сначала помоги питомцу</b><p>Когда ему станет лучше, можно продолжить день.</p><div class="emergency-care-actions">${needs.map(x=>`<button class="btn secondary" data-emergency-care="${x.id}"><span>${x.id==='food'?'🥣':x.id==='mood'?'♥':'✦'}</span>${esc(x.action)}<small>Бесплатно</small></button>`).join('')}</div></div>`;
  }
  function lowPetNeedsHtml(){
    const low=[
      state.pet.satiety>0&&state.pet.satiety<30?{icon:'🥣',title:`${state.pet.name} проголодался`,text:'Сытость уже ниже 30. Скоро стоит покормить питомца.'}:null,
      state.pet.mood>0&&state.pet.mood<30?{icon:'♥',title:`${state.pet.name} грустно`,text:'Можно поиграть вместе или выбрать другое приятное занятие.'}:null,
      state.pet.health>0&&state.pet.health<30?{icon:'✦',title:'Стоит позаботиться о здоровье',text:`Здоровье ${state.pet.name} стало низким.`}:null
    ].filter(Boolean);if(!low.length)return '';
    return `<div class="low-needs-panel">${low.map(x=>`<button data-route="pet"><span>${x.icon}</span><span><b>${esc(x.title)}</b><small>${esc(x.text)}</small></span><span>›</span></button>`).join('')}</div>`;
  }
  function petLevel() { return Math.min(5, Math.max(1, Math.floor(state.pet.development / 20) + 1)); }function activeGoal() { return C.goals.find(g => g.id === state.activeGoal); }
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

  function clubsState() {
    state.clubs = state.clubs || {unlocked:false,unlockedWeek:null,activeId:null,joinedWeek:null,currentWeekDecision:null,choiceSkippedWeek:null,pendingId:null,pendingStop:false,skippedWeeks:[],history:[],progress:{}};
    state.clubs.skippedWeeks = Array.isArray(state.clubs.skippedWeeks) ? state.clubs.skippedWeeks : [];
    state.clubs.history = Array.isArray(state.clubs.history) ? state.clubs.history : [];
    state.clubs.progress = state.clubs.progress || {};
    return state.clubs;
  }
  function sectionById(id = clubsState().activeId) { return (C.sections || []).find(x => x.id === id) || null; }
  function sectionProgress(id) {
    const cs=clubsState(); if(!id)return {paidWeeks:0,streak:0,rewards:[]};
    cs.progress[id]=cs.progress[id]||{paidWeeks:0,streak:0,rewards:[]};
    cs.progress[id].rewards=Array.isArray(cs.progress[id].rewards)?cs.progress[id].rewards:[];
    return cs.progress[id];
  }
  function totalSectionPaidWeeks(){return Object.values(clubsState().progress||{}).reduce((n,p)=>n+(Number(p?.paidWeeks)||0),0);}
  function syncSectionUnlock(trackChange=true){
    const cs=clubsState();
    if(!demoMode && state.wallet.week>=3 && !cs.unlocked){
      cs.unlocked=true;cs.unlockedWeek=state.wallet.week;
      if(trackChange)track('activity_unlocked',{week:state.wallet.week});
    }
    return !!cs.unlocked;
  }
  function sectionRecordForWeek(week=state.wallet.week){return [...clubsState().history].reverse().find(x=>x.week===week&&['paid','skipped'].includes(x.status))||null;}
  function sectionDecisionPending(){
    if(demoMode||!syncSectionUnlock(false))return false;
    const cs=clubsState();
    if(!cs.activeId)return cs.choiceSkippedWeek!==state.wallet.week;
    return !(cs.currentWeekDecision&&cs.currentWeekDecision.week===state.wallet.week);
  }
  function applyPendingSectionChange(){
    const cs=clubsState();
    if(cs.pendingStop){
      cs.activeId=null;cs.joinedWeek=null;cs.pendingStop=false;cs.pendingId=null;cs.currentWeekDecision=null;
    }else if(cs.pendingId){
      cs.activeId=cs.pendingId;cs.joinedWeek=state.wallet.week;cs.pendingId=null;cs.currentWeekDecision=null;
    }
  }
  function applySectionMilestones(section,progress){
    const fresh=[];
    for(const m of section?.milestones||[]){
      if(progress.paidWeeks>=m.weeks&&!progress.rewards.includes(m.id)){
        progress.rewards.push(m.id);fresh.push(m);
        const decorId=`section_${section.id}_${m.id}`;
        state.worldProgress=state.worldProgress||{stage:1,areas:['home'],unlocks:[],decor:[]};
        state.worldProgress.decor=state.worldProgress.decor||[];
        if(!state.worldProgress.decor.includes(decorId))state.worldProgress.decor.push(decorId);
        track('activity_progress_reward',{activityId:section.id,rewardId:m.id,paidWeeks:progress.paidWeeks});
      }
    }
    return fresh;
  }
  function selectSection(id){
    const section=sectionById(id),cs=clubsState(); if(!section||!syncSectionUnlock(false))return false;
    if(cs.activeId&&cs.activeId!==id){modal={type:'sectionSwitchConfirm',sectionId:id};render();return false;}
    if(cs.activeId===id)return true;
    if(state.weekNeedsPlanning&&!planForWeek()){
      cs.activeId=id;cs.joinedWeek=state.wallet.week;cs.currentWeekDecision=null;cs.choiceSkippedWeek=null;
      track('activity_selected',{activityId:id,week:state.wallet.week,price:section.price,startsWeek:state.wallet.week});save();route='weekStart';render();return true;
    }
    cs.pendingId=id;cs.pendingStop=false;
    track('activity_selected',{activityId:id,week:state.wallet.week,price:section.price,startsWeek:state.wallet.week+1});save();
    modal=buildFinancialFeedback(`Выбрано: ${section.name}`,[{label:'Цена',value:`${fmt(section.price)} монет в неделю`},{label:'Начнётся',value:`со следующей недели`}],'На этой неделе план уже начался, поэтому новое занятие начнётся со следующей недели.',[{label:'Продолжить',route:'activities'}]);render();return true;
  }
  function confirmSectionSwitch(id){
    const section=sectionById(id),cs=clubsState();if(!section||!cs.activeId||cs.activeId===id)return false;
    const previous=cs.activeId;cs.pendingId=id;cs.pendingStop=false;modal=null;
    track('activity_changed',{fromActivityId:previous,activityId:id,effectiveWeek:state.wallet.week+1});save();
    modal=buildFinancialFeedback(`Со следующей недели — ${section.name}`,[{label:'Сейчас',value:sectionById(previous)?.name||previous},{label:'Потом',value:section.name}],'Уже оплаченная неделя не меняется. Новое занятие начнётся на следующей неделе.',[{label:'Продолжить',route:'activities'}]);render();return true;
  }
  function requestSectionStop(){if(!clubsState().activeId)return false;modal={type:'sectionStopConfirm'};render();return true;}
  function confirmSectionStop(){
    const cs=clubsState(),id=cs.activeId;if(!id)return false;cs.pendingStop=true;cs.pendingId=null;modal=null;
    track('activity_cancelled',{activityId:id,effectiveWeek:state.wallet.week+1});save();
    modal=buildFinancialFeedback('Занятия закончатся',[{label:'Сейчас',value:sectionById(id)?.name||id},{label:'Со следующей недели',value:'оплаты не будет'}],'Эта неделя остаётся как есть. На следующей неделе монеты на занятие больше не понадобятся.',[{label:'Продолжить',route:'activities'}]);render();return true;
  }
  function skipSectionChoice(){
    const cs=clubsState();if(cs.activeId)return false;cs.choiceSkippedWeek=state.wallet.week;
    track('activity_choice_deferred',{week:state.wallet.week});save();route='weekStart';render();return true;
  }
  function paySectionWeek(){
    const cs=clubsState(),section=sectionById();if(!section||!syncSectionUnlock(false))return false;
    if(cs.currentWeekDecision?.week===state.wallet.week)return false;
    const before=state.wallet.balance;
    if(before<section.price){
      track('activity_payment_failed',{activityId:section.id,week:state.wallet.week,price:section.price,balanceBefore:before,missing:section.price-before});
      modal={type:'sectionShortage',sectionId:section.id,missing:section.price-before};save();render();return false;
    }
    state.wallet.balance-=section.price;
    tx('expense',-section.price,'Занятие',section.name,'activity',{activityId:section.id});
    cs.currentWeekDecision={week:state.wallet.week,status:'paid',activityId:section.id,amount:section.price};
    cs.history.push({week:state.wallet.week,status:'paid',activityId:section.id,amount:section.price,timestamp:Date.now()});
    cs.history=cs.history.slice(-80);
    const progress=sectionProgress(section.id);progress.paidWeeks++;progress.streak++;
    const rewards=applySectionMilestones(section,progress);
    if(section.effect)adjustPet(section.effect);
    state.weekOpeningCharges=state.weekOpeningCharges||[];
    if(!state.weekOpeningCharges.some(x=>x.type==='activity'&&x.activityId===section.id))state.weekOpeningCharges.push({description:section.name,amount:section.price,type:'activity',activityId:section.id});
    track('activity_week_paid',{activityId:section.id,week:state.wallet.week,price:section.price,balanceBefore:before,balanceAfter:state.wallet.balance,paidWeeks:progress.paidWeeks,streak:progress.streak});
    recalculateHealth();save();route='weekStart';
    modal=buildFinancialFeedback(`${section.name} оплачен`,[{label:'Занятие',value:`−${fmt(section.price)} монет`},{label:moneyLabel(),value:`${fmt(before)} → ${fmt(state.wallet.balance)} ●`},{label:'Посещений',value:String(progress.paidWeeks)}],rewards.length?`Новое открытие: ${rewards.map(x=>x.label).join(', ')}.`:'Теперь составь план на оставшиеся монеты.',[{label:'Составить план',route:'weekStart'}]);render();return true;
  }
  function skipSectionWeek(){
    const cs=clubsState(),section=sectionById();if(!section)return false;
    if(cs.currentWeekDecision?.week===state.wallet.week)return false;
    cs.currentWeekDecision={week:state.wallet.week,status:'skipped',activityId:section.id,amount:0};
    if(!cs.skippedWeeks.includes(state.wallet.week))cs.skippedWeeks.push(state.wallet.week);
    cs.history.push({week:state.wallet.week,status:'skipped',activityId:section.id,amount:0,timestamp:Date.now()});cs.history=cs.history.slice(-80);
    const progress=sectionProgress(section.id);progress.streak=0;
    track('activity_week_skipped',{activityId:section.id,week:state.wallet.week,price:section.price,balanceAfter:state.wallet.balance,paidWeeks:progress.paidWeeks,streak:0});
    save();route='weekStart';modal=buildFinancialFeedback('На этой неделе — перерыв',[{label:section.name,value:'0 монет'},{label:moneyLabel(),value:`${fmt(state.wallet.balance)} ●`}],'Прогресс занятия на этой неделе не растёт, зато монеты остаются у тебя.',[{label:'Составить план',route:'weekStart'}]);render();return true;
  }
  function sectionWorldRewardsHtml(area){
    const rewards=[];
    for(const section of C.sections||[]){
      const p=sectionProgress(section.id);
      for(const m of section.milestones||[])if(p.rewards.includes(m.id)&&(m.area||'home')===area)rewards.push({icon:m.worldIcon||section.icon,label:m.label});
    }
    if(!rewards.length)return '';
    return `<div class="section-world-rewards" aria-label="Открытия занятий">${rewards.slice(-4).map(x=>`<span title="${esc(x.label)}">${x.icon}</span>`).join('')}</div>`;
  }
  function sectionHomeCard(){
    if(demoMode||!syncSectionUnlock(false))return '';
    const cs=clubsState(),section=sectionById();
    if(!section)return `<div class="section-title compact-title"><h2>Новое занятие</h2></div><button class="section-home-card section-home-empty" data-route="activities"><span class="section-card-icon">✦</span><span><b>Выбрать секцию или кружок</b><small>За некоторые занятия нужно платить снова каждую неделю.</small></span><span>›</span></button>`;
    const p=sectionProgress(section.id),decision=sectionRecordForWeek(),status=decision?.status==='paid'?`оплачено ${fmt(section.price)} ●`:decision?.status==='skipped'?'перерыв':state.weekNeedsPlanning?'нужно решить перед планом':'на следующей неделе решишь снова';
    return `<div class="section-title compact-title"><h2>Занятие</h2><button data-route="activities">Открыть</button></div><button class="section-home-card" data-route="activities"><span class="section-card-icon">${section.icon}</span><span><b>${esc(section.name)}</b><small>${status} · ${p.paidWeeks} посещ.</small></span><span>›</span></button>`;
  }
  function sectionGateScreen(){
    if(demoMode||!syncSectionUnlock(false))return '';
    const cs=clubsState(),section=sectionById();
    if(!section&&cs.choiceSkippedWeek!==state.wallet.week){
      return `<section class="screen week-screen section-gate-screen"><div class="week-kicker">Новая возможность</div><h1>${esc(state.pet.name)} хочет новое занятие</h1><p class="week-lead">Выбери, что попробовать. У каждого занятия своя цена за одну неделю.</p><div class="section-picker">${(C.sections||[]).map(x=>`<button class="section-option" data-section-select="${x.id}"><span class="section-option-icon">${x.icon}</span><span><b>${esc(x.name)}</b><small>${esc(x.note)}</small><strong>${fmt(x.price)} монет в неделю</strong></span><span>›</span></button>`).join('')}</div><button class="linkbtn block section-later" data-section-choice-skip>Пока без занятия</button></section>`;
    }
    if(section&&!(cs.currentWeekDecision&&cs.currentWeekDecision.week===state.wallet.week)){
      const enough=state.wallet.balance>=section.price,missing=Math.max(0,section.price-state.wallet.balance),p=sectionProgress(section.id);
      return `<section class="screen week-screen section-gate-screen"><div class="week-kicker">Перед планом недели</div><div class="section-decision-icon">${section.icon}</div><h1>Продолжать ${esc(section.name.toLowerCase())}?</h1><p class="week-lead">${esc(section.name)} стоит ${fmt(section.price)} монет на эту неделю. После решения составишь план на то, что останется.</p><div class="section-decision-facts"><div><span>Сейчас</span><b>${fmt(state.wallet.balance)} ●</b></div><div><span>После оплаты</span><b>${enough?fmt(state.wallet.balance-section.price)+' ●':'не хватает '+fmt(missing)+' ●'}</b></div><div><span>Уже посещено</span><b>${p.paidWeeks}</b></div></div><button class="btn primary block" data-section-pay ${enough?'':'disabled'}>${enough?`Продолжить · ${fmt(section.price)} ●`:`Не хватает ${fmt(missing)} монет`}</button><button class="btn secondary block" data-section-skip>Сделать перерыв</button>${!enough?'<button class="linkbtn block" data-route="budget">Посмотреть, куда ушли монеты</button>':''}</section>`;
    }
    return '';
  }
  function sectionsScreen(){
    syncSectionUnlock(false);const cs=clubsState(),active=sectionById(),activeProgress=active?sectionProgress(active.id):null,pending=sectionById(cs.pendingId);
    const status=active?(sectionRecordForWeek()?.status==='paid'?'Эта неделя оплачена':sectionRecordForWeek()?.status==='skipped'?'На этой неделе перерыв':'На следующей неделе снова будет выбор'):'Пока ничего не выбрано';
    return `<section class="screen sections-screen">${topbar(active?'Моё занятие':'Выбери занятие',true)}${active?`<div class="section-active-hero"><span class="section-hero-icon">${active.icon}</span><div><div class="eyebrow">${status}</div><h2>${esc(active.name)}</h2><p>${fmt(active.price)} монет в неделю · посещено ${activeProgress.paidWeeks} раз</p></div></div><div class="section-title"><h2>Что уже открылось</h2></div><div class="section-milestones">${(active.milestones||[]).map(m=>`<div class="${activeProgress.rewards.includes(m.id)?'done':''}"><span>${activeProgress.rewards.includes(m.id)?m.worldIcon:'○'}</span><div><b>${esc(m.label)}</b><small>${m.weeks} посещ.</small></div></div>`).join('')}</div>${pending?`<div class="need-note">Со следующей недели: ${esc(pending.name)} · ${fmt(pending.price)} монет.</div>`:cs.pendingStop?'<div class="need-note">Со следующей недели занятия закончатся.</div>':''}<div class="section-actions"><button class="btn secondary block" data-section-change>Выбрать другое занятие</button><button class="linkbtn danger block" data-section-stop>Больше не ходить</button></div>`:''}<div class="section-title"><h2>${active?'Другие занятия':'Что попробуем?'}</h2></div><div class="section-picker">${(C.sections||[]).map(x=>{const same=active?.id===x.id;return `<button class="section-option ${same?'active':''}" ${same?'disabled':`data-section-select="${x.id}"`}><span class="section-option-icon">${x.icon}</span><span><b>${esc(x.name)}</b><small>${esc(x.note)}</small><strong>${fmt(x.price)} монет в неделю</strong></span><span>${same?'✓':'›'}</span></button>`}).join('')}</div><div class="section-learning-note"><b>Почему цена снова появляется?</b><span>Некоторые траты повторяются. Перед каждой новой неделей ты сам решаешь, продолжать занятие или сделать перерыв.</span></div></section>`;
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
    if (['satiety','mood','energy','health'].every(k => state.pet[k] >= 55)) unlock('care_balance');
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
  function isPersistentShopItem(item){ return !!(item && C.world?.placements?.[item.id]); }
  function generatedItemArt(itemId){
    return ({
      care_brush:'assets/item-haircut.webp',
      health_vaccine:'assets/item-prevention.webp',
      game_cinema:'assets/item-cinema.webp',
      special_bike:'assets/item-bike.webp'
    })[itemId]||null;
  }
  function generatedArt(src,label=''){
    return `<img class="generated-item-art" src="${src}" alt="" aria-hidden="true" data-art-label="${esc(label)}">`;
  }
  function shopItemIllustration(item){
    const generated=generatedItemArt(item?.id);
    if(generated)return generatedArt(generated,item?.name||'');
    const foodIndex={food_basic:0,food_snack:1,food_treat:2}[item?.id];
    if(foodIndex!=null)return `<span class="shop-food-art food-art-${foodIndex}" aria-hidden="true"></span>`;
    return illustration(item?.icon,item?.name||item?.label||item?.id||'');
  }
  function goalIllustration(g,view=goalView(g)){
    if(g?.id==='bike')return generatedArt('assets/goal-bike.webp',view?.name||'Велосипед');
    return illustration(view?.icon,view?.name||g?.name||g?.id||'');
  }
  function eventGeneratedIllustration(e){
    if(e?.id==='e42')return generatedArt('assets/item-cinema.webp','Поход в кино');
    if(e?.id==='e43')return generatedArt('assets/item-prevention.webp','Профилактика');
    return '';
  }
  function eventIllustration(e){ return eventGeneratedIllustration(e)||illustration(e?.icon,e?.title||e?.id||''); }
  function completedGoalWorldArt(area){
    if(area==='park'&&state.completedGoals.includes('bike'))return `<div class="goal-bike-world">${generatedArt('assets/item-bike.webp','Велосипед')}</div>`;
    return '';
  }
  function purchaseUseText(item){
    if(isPersistentShopItem(item)){
      if(item.category==='Одежда')return 'Покупка добавлена в гардероб и остаётся у питомца.';
      if(item.category==='Интерьер')return 'Вещь появилась в комнате и остаётся там.';
      if(item.category==='Игры')return 'Игрушка появилась в комнате. Ею можно пользоваться дальше.';
      if(item.category==='Одежда')return 'Одежда добавлена питомцу и остаётся после покупки.';
      return 'Вещь появилась в подходящем месте мира питомца.';
    }
    if(item.category==='Еда')return 'Еда использована сразу и изменила состояние питомца.';
    if(item.category==='Здоровье')return 'Покупка применена сразу. В комнате она не остаётся отдельным предметом.';
    if(item.id==='game_cinema'||item.id==='special_ticket')return 'Это разовое событие. После покупки оно не остаётся предметом в комнате.';
    return 'Эффект покупки применён сразу.';
  }
  function planInput(label, id, value, hint) {
    return `<label class="plan-row"><div><b>${label}</b><span>${hint}</span></div><div class="plan-amount"><input id="${id}" type="number" min="0" step="10" value="${Math.max(0, Math.round(value))}" inputmode="numeric"><span>●</span></div></label>`;
  }

  function miniStat(label, val, ico) { const critical=Number(val)<=0;return `<div class="mini-stat ${critical?'critical':''}"><b>${Math.round(val)}</b><span>${label}</span><div class="bar"><i style="width:${val}%"></i></div>${critical?'<small>Нужно помочь</small>':''}</div>`; }
  function currentEvent() { return C.events.find(x => x.id === state.currentEventId) || eventPoolFor()[0] || C.events[0]; }

  function eventTeaser() {
    if (state.eventResolved) return `<div class="card"><div class="task-teaser"><div class="round-icon">✓</div><div><h3>Решение принято</h3><p>Можно заняться питомцем или завершить игровой день.</p></div></div></div>`;
    const e = currentEvent();
    return `<button class="card task-teaser event-card" data-event="${e.id}"><div class="round-icon">${eventIllustration(e)}</div><div><h3>${e.title}</h3><p>${e.situation || e.text}</p></div><span class="chevron">›</span></button>`;
  }

  function normalizeWorkState() {
    state.workState = state.workState || {week:state.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};
    if (state.workState.week !== state.wallet.week) state.workState = {week:state.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};
    state.workState.shiftsLimit = 3;
    state.workState.activityUsage ||= {};
    state.activityLimits = {week:state.wallet.week, sideJobs:state.workState.shiftsUsed};
    return state.workState;
  }  function workShiftStatusShort() {
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

  function shopScreen() {
    const cat = shopScreen.cat || 'Еда'; const cats = ['Еда','Здоровье','Игры','Одежда','Интерьер','Особое'];
    const items = C.items.filter(i => i.category === cat && (!i.condition || i.condition===state.healthCondition));
    return `<section class="screen">${topbar('Магазин', true)}
      <div class="tabs">${cats.map(c => `<button class="chip ${c === cat ? 'active' : ''}" data-shop-cat="${c}">${c}</button>`).join('')}</div>
      <div class="shop-list">${items.map(item => {
        const owned = isPersistentShopItem(item) && state.inventory.some(x => x.id === item.id);
        return `<div class="card shop-item shop-item-v2"><div class="shop-ico ${item.category==='Еда'?'food-visual':''}">${shopItemIllustration(item)}</div><div><h3>${item.name}</h3><p>${isJunior()?(item.need?'Нужно питомцу':'Для радости'):(item.need?'Базовая потребность':'Желание / улучшение мира')}</p><span class="tag ${item.need ? 'need' : 'want'}">${item.need ? 'Нужно' : (isJunior()?'Хочу':'Желание')}</span><div class="item-effect-text">${esc(itemEffectText(item))}</div><div class="item-context">${purchaseContext(item)}</div></div><div class="center"><div class="price">${fmt(item.price)} ●</div><button class="linkbtn" data-buy="${item.id}" ${owned ? 'disabled' : ''}>${owned ? 'Уже есть' : 'Купить'}</button></div></div>`;
      }).join('')}</div>
    </section>`;
  }

  function tasksScreen() {
    const list = ageTaskList();
    return `<section class="screen">${topbar('Задания')}
      <div class="soft-note"><b>${isJunior()?'Дополнительные задания':'Дополнительные миссии'}</b><span>${isJunior()?'Тут можно потренироваться и получить ещё монеты.':'Основная финансовая жизнь проходит в неделе, событиях и покупках. Здесь можно попробовать отдельные механики и получить небольшой дополнительный доход.'}</span></div>
      <div class="task-list">${list.map(t => {
        const done = state.completedTasks.includes(t.id);
        return `<button class="card task-card ${done ? 'done' : ''}" data-open-task="${t.id}"><div class="task-head"><h3>${done ? '✓ ' : ''}${t.title}</h3><span class="reward">+${t.reward} ●</span></div><p>${t.setup}</p><span class="tag">${taskTypeLabel(t.mechanicType)}</span></button>`;
      }).join('')}</div>
    </section>`;
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
      body = `<div class="mini-allocation"><div class="allocation-total">${isJunior()?'Разложи':'Распредели'} ${fmt(amount)} монет</div>${['necessary', 'wants', 'savings', 'reserve'].map((k, i) => `<label><span>${(isJunior()?['Нужно','Хочу','Коплю','Оставлю']:['Необходимое','Желания','Копилка','Резерв'])[i]}</span><input type="number" id="task_${k}" min="0" step="10" value="${defaults[i]}"></label>`).join('')}<button class="btn primary block" data-task-allocate>${isJunior()?'Посмотреть, что будет':'Посмотреть последствия'}</button></div>`;
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

  function planFactHtml(plan, actual) {
    const junior=isJunior();
    const rows=junior?[['Нужно',plan.necessary,actual.necessary],['Хочу',plan.wants,actual.wants],['Коплю',plan.savings,actual.savings],['Оставлю',plan.reserve,Math.max(0,state.wallet.balance)]]
      :[['Необходимое',plan.necessary,actual.necessary],['Желания',plan.wants,actual.wants],['Копилка',plan.savings,actual.savings],['Резерв',plan.reserve,Math.max(0,state.wallet.balance)]];
    return `<div class="card plan-fact"><div class="pf-head"><span></span><b>${junior?'Планировал':'План'}</b><b>${junior?'Получилось':'Факт'}</b></div>${rows.map(([n,p,f])=>`<div class="pf-row"><span>${n}</span><b>${fmt(p)}</b><b class="${f>p*1.2&&(n==='Желания'||n==='Хочу')?'over':''}">${fmt(f)}</b></div>`).join('')}${planInsight(plan,actual)?`<div class="pf-insight">${planInsight(plan,actual)}</div>`:''}</div>`;
  }
  function juniorPlanProgress(kind){
    const plan=planForWeek(); if(!isJunior()||!plan)return null;
    const actual=actualsForWeek();
    const map={
      necessary:{label:'По плану на нужное',planned:plan.necessary,used:actual.necessary},
      wants:{label:'По плану на хотелки',planned:plan.wants,used:actual.wants},
      savings:{label:'По плану в копилку',planned:plan.savings,used:actual.savings}
    };
    const x=map[kind]; if(!x)return null;
    const over=Math.max(0,x.used-x.planned),left=Math.max(0,x.planned-x.used);
    return {label:x.label,value:over>0?`на ${fmt(over)} больше`:`${fmt(x.used)} из ${fmt(x.planned)}`,left,over,planned:x.planned,used:x.used};
  }
  function juniorPlanTrackerHtml(plan,actual){
    if(!plan)return '<div class="need-note">Сначала составь план в начале недели.</div>';
    const rows=[
      ['На нужное',plan.necessary,actual.necessary,'потрачено'],
      ['На хотелки',plan.wants,actual.wants,'потрачено'],
      ['В копилку',plan.savings,actual.savings,'положено']
    ];
    return `<div class="weekly-plan-track">${rows.map(([label,p,a,verb])=>{const over=Math.max(0,a-p);return `<div class="${over?'over':''}"><span>${label}</span><b>${fmt(a)} из ${fmt(p)}</b><small>${over?`на ${fmt(over)} больше плана`:verb}</small></div>`}).join('')}<div><span>Пока не трачу</span><b>${fmt(state.wallet.balance)} монет</b><small>хотел оставить ${fmt(plan.reserve)}</small></div></div><p class="plan-live-note">План ничего не запрещает. Он помогает замечать, куда уходят монеты.</p>`;
  }
  function planInsight(plan,actual){
    if(isJunior()){
      if(actual.wants>plan.wants+80)return `На хотелки ушло на ${fmt(actual.wants-plan.wants)} монет больше, чем ты планировал.`;
      if(actual.savings+50<plan.savings)return `В копилку положили на ${fmt(plan.savings-actual.savings)} монет меньше, чем хотели.`;
      if(actual.necessary>plan.necessary+60)return `На нужное ушло на ${fmt(actual.necessary-plan.necessary)} монет больше.`;
      return 'Пока всё идёт близко к плану.';
    }
    if(actual.wants>plan.wants+80)return `На желания уже ушло на ${fmt(actual.wants-plan.wants)} больше плана.`;
    if(actual.savings+50<plan.savings)return `До планового взноса в копилку пока не хватает ${fmt(plan.savings-actual.savings)}.`;
    if(actual.necessary>plan.necessary+60)return `Необходимые расходы оказались выше плана на ${fmt(actual.necessary-plan.necessary)}.`;
    return 'Пока план и фактические решения близки. Он может измениться после новых событий.';
  }
  function historyHtml(){
    if(!state.transactions.length)return `<div class="empty">${isJunior()?'Пока с монетами ничего не происходило.':'Пока нет операций.'}</div>`;
    return state.transactions.slice(0,16).map(t=>`<div class="tx"><div class="tx-icon">${iconForTx(t)}</div><div><b>${esc(t.description)}</b><p>${esc(displayTxCategory(t.category))} · нед. ${t.week||state.wallet.week}, день ${t.day||1}</p></div><div class="tx-amount ${t.amount>=0?'pos':'neg'}">${t.amount>0?'+':''}${fmt(t.amount)}</div></div>`).join('');
  }
  function achievementsScreen() {
    return `<section class="screen">${topbar('Достижения', true)}<div class="ach-grid">${C.achievements.map(a => `<div class="ach ${state.achievements.includes(a.id) ? '' : 'locked'}"><div class="aico">${illustration(a.icon,a.name||a.label||a.id)}</div><h3>${a.name}</h3><p>${a.desc}</p></div>`).join('')}</div></section>`;
  }

  function planFactSummaryHtml(s){
    const p=s.plan||{necessary:0,wants:0,savings:0,reserve:0},a=s.actual,junior=isJunior();
    const rows=junior?[['Нужно',p.necessary,a.necessary],['Хочу',p.wants,a.wants],['Коплю',p.savings,a.savings],['Оставлю',p.reserve,s.endingBalance]]
      :[['Необходимое',p.necessary,a.necessary],['Желания',p.wants,a.wants],['Копилка',p.savings,a.savings],['Осталось',p.reserve,s.endingBalance]];
    return `<div class="card plan-fact"><div class="pf-head"><span></span><b>${junior?'Планировал':'План'}</b><b>${junior?'Получилось':'Факт'}</b></div>${rows.map(([n,x,y])=>`<div class="pf-row"><span>${n}</span><b>${fmt(x)}</b><b>${fmt(y)}</b></div>`).join('')}</div>`;
  }
  function ageLabel(age = []) { return age.length === 3 ? 'Все возраста' : age.join(', '); }
  function updatePlanTotal() {
    const ids = ['planNecessary', 'planWants', 'planSavings', 'planReserve'];
    const total = ids.reduce((sum, id) => sum + Math.max(0, Number(document.getElementById(id)?.value || 0)), 0);
    const el = document.getElementById('planTotal'); if (!el) return;
    const budget = Number(el.dataset.budget || planningBudget());
    el.textContent = isJunior()?`Запланировано: ${fmt(total)} из ${fmt(budget)}`:`План: ${fmt(total)} из ${fmt(budget)}`;
    el.classList.toggle('over', total > budget);
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
    if(total>amount)result=isJunior()?`Ты разложил ${fmt(total)} монет, а есть только ${fmt(amount)}. Убери ${fmt(total-amount)} монет.`:`Ты распределил ${fmt(total)} монет, хотя доступно ${fmt(amount)}. План нужно уменьшить на ${fmt(total-amount)}.`;
    else if(vals[0]<300)result=isJunior()?'На еду и здоровье оставлено мало. Возможно, придётся отложить одну из хотелок.':'На необходимое оставлено мало. Если появится обычный расход на еду и здоровье, план придётся менять.';
    else if(vals[3]<100)result=isJunior()?'Почти все монеты уже заняты. На всякий случай осталось совсем немного.':'План почти весь расписан. Он работает, но для неожиданности осталось мало пространства.';
    else result=isJunior()?'Монеты есть и на нужное, и на хотелки, и на копилку. Немного осталось на потом.':'В плане есть место и для необходимого, и для желаний, и для будущего. Реальная неделя всё равно может его изменить.';
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
      const beforeBalance = state.wallet.balance;
      state.completedTasks.push(t.id); state.stats.tasksDone++; state.xp += 10; adjustPet({ energy: 1 }); earn(t.reward, `Миссия «${t.title}»`, 'task');
      if (t.cyberSafety) track('cyber_safety_task_completed', { taskId:t.id, topic:t.topic || null, ageGroup:state.ageGroup });
      modal = buildFinancialFeedback(
        'Задание выполнено',
        [{label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`},{label:isJunior()?'Получил':'Награда',value:`+${fmt(t.reward)} ●`}],
        isJunior()?'Монеты за задание уже добавлены. Питомец растёт по итогам всей недели.':'Награда за задание добавлена в обычный баланс. Развитие питомца рассчитывается по итогам всей недели.',
        [{label:'Продолжить',route:'tasks'},{label:isJunior()?'Открыть монеты':'Открыть бюджет',route:'budget'}]
      );
    }
    checkAchievements(); save(); taskResult = null; route = 'tasks'; render();
  }

  function withdrawSaving(n) {
    n = Math.min(Number(n) || 0, state.wallet.savings); if (n <= 0) return;
    const beforeWeeks = weeksToGoal(), beforeBalance = state.wallet.balance, beforeSavings = state.wallet.savings;
    state.wallet.savings -= n; state.wallet.balance += n;
    tx('saving_withdrawal', n, 'Копилка', 'Возврат из копилки', 'savings');
    state.dayActions.count++;
    track('savings_withdrawal', { amount: n, goalId: state.activeGoal });
    recalculateHealth(); save();
    const afterWeeks = weeksToGoal();
    modal = buildFinancialFeedback(
      `Вернули ${fmt(n)} монет`,
      [
        {label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`},
        {label:'В копилке',value:`${fmt(beforeSavings)} → ${fmt(state.wallet.savings)} ●`},
        afterWeeks!=null?{label:'До покупки',value:`≈ ${afterWeeks} нед.`}:null
      ],
      isJunior()?(beforeWeeks!=null&&afterWeeks!=null&&afterWeeks>beforeWeeks?'Ты взял монеты из копилки. До выбранной покупки теперь немного дальше.':'Монеты вернулись из копилки.'):(beforeWeeks!=null&&afterWeeks!=null&&afterWeeks>beforeWeeks?'Часть накоплений вернулась на текущие расходы, поэтому путь к цели стал длиннее.':'Монеты вернулись из копилки на текущий баланс.'),
      [{label:'Продолжить',route:'savings'},{label:isJunior()?'Открыть монеты':'Открыть бюджет',route:'budget'}]
    );
    render();
  }

  function requestNewDay() {
    if(!canAdvanceDay()){blockDayForCriticalNeeds('button');return false;}
    if (state.dayActions.count === 0 && !state.eventResolved) { modal = { type: 'dayConfirm' }; render(); return false; }
    return advanceDay();
  }

  function applyEndOfDay() {
    const moodDrop=state.dayActions.optional===0?-4:-2;adjustPet({satiety:-9,mood:moodDrop,energy:10,health:-6});
    if(state.pet.satiety<35){state.stats.petNeedsIgnored++;track('pet_need_ignored',{need:'satiety'});}
    if(state.pet.health<35){state.stats.petNeedsIgnored++;track('pet_need_ignored',{need:'health'});}
  }

  function isBalancedWeek(s) {
    const p = s.plan, a = s.actual;
    return a.savings >= p.savings * 0.7 && a.wants <= p.wants * 1.35 + 50 && s.endingBalance >= Math.min(100, p.reserve) && petWellbeing() >= 50;
  }

  function weekInsights(plan,actual,snap){
    const out=[];
    if(isJunior()){
      if(actual.wants>plan.wants+80)out.push(`На хотелки ушло на ${fmt(actual.wants-plan.wants)} монет больше, чем ты планировал.`);
      if(actual.savings>=plan.savings&&actual.savings>0)out.push('Ты положил в копилку столько, сколько хотел. До покупки стало ближе.');
      else if(plan.savings>actual.savings+50)out.push(`В копилку получилось положить на ${fmt(plan.savings-actual.savings)} монет меньше.`);
      if(state.wallet.balance<Math.max(80,plan.reserve*.5))out.push('Монет на потом осталось мало. Неожиданная трата могла бы помешать плану.');
      if(actual.necessary>plan.necessary+60)out.push(`На нужное ушло на ${fmt(actual.necessary-plan.necessary)} монет больше, чем думали в начале недели.`);
      if(out.length<2&&isBalancedWeek({plan,actual,endingBalance:state.wallet.balance}))out.push('Ты позаботился о нужном, положил монеты в копилку и оставил немного на потом.');
      if(out.length<2)out.push('План может меняться. Главное — заметить, куда ушли монеты.');
      return out.slice(0,2);
    }
    if(actual.wants>plan.wants+80)out.push(`На желания ушло на ${fmt(actual.wants-plan.wants)} монет больше, чем ты планировал. Это уменьшило свободу в конце недели.`);
    if(actual.savings>=plan.savings&&actual.savings>0)out.push('Ты выполнил или превысил план накоплений и приблизил цель.');
    else if(plan.savings>actual.savings+50)out.push(`В копилку получилось отправить на ${fmt(plan.savings-actual.savings)} меньше плана. Можно посмотреть, какие решения изменили темп.`);
    if(state.wallet.balance<Math.max(80,plan.reserve*.5))out.push('Свободный запас к концу недели стал небольшим: неожиданная трата потребовала бы менять план.');
    if(state.wallet.balance>plan.reserve+250&&state.pet.mood<(snap.pet?.mood??state.pet.mood)-8)out.push(`Денег осталось много, но настроение ${state.pet.name} снизилось. Экономить абсолютно на всём тоже не было целью.`);
    if(actual.necessary>plan.necessary+60)out.push(`Необходимые расходы оказались выше плана на ${fmt(actual.necessary-plan.necessary)}. План пришлось адаптировать — это нормальная часть финансовой жизни.`);
    if(out.length<2&&isBalancedWeek({plan,actual,endingBalance:state.wallet.balance}))out.push('Ты сохранил запас, не отказался от всех желаний и продолжил движение к цели.');
    if(out.length<2)out.push('План и факт не обязаны совпадать. Полезно понимать, какое событие или желание изменило исходный план.');
    return out.slice(0,2);
  }

  function calculatePeriodDevelopment(plan, actual, endingBalance = state.wallet.balance) {
    const p = plan || {necessary:0,wants:0,savings:0,reserve:0};
    const a = actual || {necessary:0,wants:0,savings:0};
    const requiredTarget = Math.max(100, Math.min(expectedNeedsTotal(), Number(p.necessary) || expectedNeedsTotal()));
    const necessaryCovered = a.necessary >= requiredTarget * 0.75;
    const necessaryClose = necessaryCovered && Math.abs(a.necessary - Number(p.necessary || 0)) <= Math.max(80, Number(p.necessary || 0) * 0.3);
    const wantsWithinPlan = a.wants <= Number(p.wants || 0) * 1.2 + 40;
    const savingsMet = Number(p.savings || 0) > 0 && a.savings >= Number(p.savings || 0) * 0.8;
    const reserveKept = endingBalance >= Math.max(80, Math.min(250, Number(p.reserve || 0) * 0.6));
    let score = 0;
    if (necessaryCovered) score += 2;
    if (necessaryClose) score += 1;
    if (wantsWithinPlan) score += 1;
    if (savingsMet) score += 2;
    if (reserveKept) score += 1;
    const explanation=isJunior()
      ?(score>=6?'Ты позаботился о важном и положил монеты в копилку. Поэтому питомец немного вырос.':score>=3?'Часть недели получилась по плану. Питомец продолжает расти.':'В эту неделю получилось не всё. Ничего страшного — впереди новая неделя.')
      :(score>=6?'Ты закрыл важные расходы, держался рядом с планом и регулярно откладывал. Питомец стал увереннее.':score>=3?'Часть плана получилась хорошо. Развитие продолжается, а в следующей неделе можно улучшить ещё один шаг.':'Важные решения были не все закрыты по плану. Прогресс не обнуляется — следующая неделя даёт новую попытку.');
    return {score,necessaryCovered,necessaryClose,wantsWithinPlan,savingsMet,reserveKept,explanation};
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
  function petActivity() {
    const seed = state.wallet.week * 11 + state.wallet.day * 5 + state.inventory.length;
    const owns = id => state.inventory.some(x => x.id === id);
    if (state.pet.energy < 28) return {cls:'sleep', text:state.ageGroup === '15-17' ? 'отдыхает' : 'задремал'};
    if (state.currentWorldArea === 'park' && owns('special_bike') && seed % 3 === 0) return {cls:'bike', text:'катается по парку'};
    if (owns('interior_sofa') && seed % 5 === 0) return {cls:'sofa', text:'устроился на диване'};
    if (owns('game_ball') && seed % 4 === 0) return {cls:'play', text:'играет с мячом'};
    if (state.currentWorldArea !== 'home') return {cls:'wander', text:state.currentWorldArea === 'park' ? 'осматривается в парке' : 'смотрит на город'};
    return seed % 2 ? {cls:'look', text:'разглядывает комнату'} : {cls:'wander', text:'ходит по комнате'};
  }  function dueChainEventFor(s = state) {
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
      if (state.wallet.balance >= needsReserve() + 100) return ['Денег должно хватить', 'Есть место и для нужного, и для некоторых хотелок.'];
      if (state.wallet.balance >= needsReserve()) return ['Монет осталось немного', 'На важное пока хватает, а новые покупки лучше сравнить с планом.'];
      return ['Монет мало до следующей недели', 'Придётся решить, что можно отложить.'];
    }
    const load = (state.futureObligations || []).filter(o => o.dueWeek <= state.wallet.week + 1).reduce((a,o)=>a+o.amount,0);
    if (state.ageGroup === '15-17' && load >= state.wallet.weeklyIncome * .35) return ['Высокая нагрузка обязательствами', `В ближайшем бюджете уже занято около ${fmt(load)} монет.`];
    if (s >= 80) return ['Хороший запас', 'Есть резерв и пространство для решений.'];
    if (s >= 62) return ['Стабильно', 'Бюджет пока выдерживает текущий темп.'];
    if (s >= 45) return ['Мало свободных средств', 'Следующие траты лучше сверять с планом.'];
    return ['Есть риск', 'Запаса мало: неожиданная трата может изменить планы.'];
  }

  function pageArtwork(kind) {
    const scenes={goals:['🪙','🎧','🗺️'],budget:['💰','🪙','📖'],tasks:['📖','🧩','🏆'],shop:['🪴','🛹','🎁'],sidejob:['◇','🎧','💰'],profile:['📷','🗺️','🧢'],progress:['🏠','🪴','🗺️'],achievements:['🏆','🎁','📷'],savings:['🪙','🎧','💰'],settings:['🎧','🪴','📖']};
    const objects=scenes[kind]; if(!objects)return '';
    return `<div class="page-artwork artwork-${kind}" aria-hidden="true"><span class="artwork-wash"></span><svg class="artwork-line" viewBox="0 0 440 120" preserveAspectRatio="none"><path d="M12 85 C65 22 129 125 199 66 S332 18 425 73" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 7"/><path d="M25 34 l9 -4 m-4 -8 l3 10 M399 95 l12 -4 m-3 -8 l-4 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>${objects.map((o,i)=>`<span class="artwork-object artwork-object-${i}">${illustration(o)}</span>`).join('')}</div>`;
  }

  function jarPlannerRow(label, id, value, icon, hint) {
    const stacks = Math.max(0, Math.round(value / 100));
    return `<div class="jar-plan"><div class="jar-label"><span>${icon}</span><div><b>${label}</b><small>${hint}</small></div></div><div class="coin-stacks">${Array.from({length:Math.min(10,stacks)},()=>'<i>●</i>').join('') || '<em>пусто</em>'}</div><div class="jar-controls"><button data-jar-delta="-100" data-jar-target="${id}">−</button><input id="${id}" type="number" value="${Math.max(0,Math.round(value))}" readonly><button data-jar-delta="100" data-jar-target="${id}">+</button></div></div>`;
  }

  function weekStartScreen() {
    const sectionGate=sectionGateScreen();if(sectionGate)return sectionGate;
    const existing = planForWeek();
    const availableNow = state.wallet.balance;
    const available = planningBudget();
    const needs = existing?.necessary ?? expectedNeedsTotal();
    const wants = existing?.wants ?? Math.min(200, Math.max(0, available - needs));
    const savings = existing?.savings ?? Math.min(200, Math.max(0, available - needs - wants));
    const reserve = existing?.reserve ?? Math.max(0, available - needs - wants - savings);
    const g = goalView();
    const charges = state.weekOpeningCharges || [];
    const demo = demoStrip();
    if (state.ageGroup === '7-11') {
      return `<section class="screen week-screen junior-week">${demo}<div class="week-kicker">${editingPlan ? 'План на неделю' : 'Новая неделя'}</div><h1>Как хочешь потратить монеты?</h1><p class="week-lead">У тебя ${fmt(available)} монет. Составь план на неделю. Потом посмотрим, как получилось на самом деле.</p>
        ${charges.length ? `<div class="opening-charges"><b>Уже потрачено до плана</b>${charges.map(c=>`<span>${esc(c.description)} −${fmt(c.amount)}</span>`).join('')}</div>`:''}
        <div class="junior-jars">${jarPlannerRow('На нужное','planNecessary',needs,'●','еда, здоровье и важные вещи')}${jarPlannerRow('На хотелки','planWants',wants,'★','игры, вещи и развлечения')}${jarPlannerRow('В копилку','planSavings',savings,'◆',g ? `коплю на ${g.name}` : 'на большую покупку')}${jarPlannerRow('Пока не трачу','planReserve',reserve,'○','оставлю на потом')}</div>
        <div class="plan-total" id="planTotal" data-budget="${available}">Запланировано: ${fmt(needs+wants+savings+reserve)} из ${fmt(available)}</div>
        <div class="plan-explainer"><b>Это только план</b><span>Монеты не разделяются по коробкам. Во время недели ты всё равно решаешь сам.</span></div>
        <button class="btn primary block" data-save-plan>${editingPlan?'Сохранить план':'Запомнить план'}</button></section>`;
    }
    return `<section class="screen week-screen ${state.ageGroup==='15-17'?'teen-week':''}">${demo}<div class="week-kicker">${editingPlan ? 'План недели' : 'Новая неделя'}</div><h1>${editingPlan ? 'Обновить распределение' : `Неделя ${state.wallet.week}`}</h1><p class="week-lead">План показывает приоритеты. Он может меняться после событий.</p>
      <div class="card income-card"><span>Доход</span><b>+${fmt(state.wallet.weeklyIncome)} ●</b><small>Доступно после автоматических списаний: ${fmt(availableNow)} ●</small></div>
      ${charges.length ? `<div class="opening-charges"><b>Автоматические списания</b>${charges.map(c=>`<span>${esc(c.description)} −${fmt(c.amount)}</span>`).join('')}</div>`:''}
      <div class="week-context"><div><span>${state.ageGroup==='15-17'?'Базовые расходы':'Примерно необходимое'}</span><b>≈ ${fmt(expectedNeedsTotal())}</b></div><div><span>Текущая цель</span><b>${g ? `${illustration(g.icon,g.name||g.label||g.id)} ${esc(g.name)} · осталось ${fmt(Math.max(0,goalTarget(activeGoal())-goalSaved()))}`:'Не выбрана'}</b></div></div>
      <div class="section-title"><h2>${state.ageGroup==='15-17'?'Распределение':'Как распределить деньги?'}</h2></div><div class="plan-form">${planInput('Необходимое','planNecessary',needs,'Еда, здоровье и базовые расходы')}${planInput('Желания','planWants',wants,'Покупки и досуг')}${planInput('Копилка','planSavings',savings,'На текущую цель')}${planInput(state.ageGroup==='15-17'?'Свободный остаток':'Резерв','planReserve',reserve,'Оставить пространство для решений')}</div>
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
    return `<div class="placed-items">${entries.map(([id,p])=>{const i=C.items.find(x=>x.id===id);return i?`<div class="placed-item zone-${p.zone}" title="${esc(i.name)}">${shopItemIllustration(i)}</div>`:''}).join('')}${worldDecorHtml(area)}</div>`;
  }
  function worldSceneHtml() {
    const area = state.currentWorldArea || 'home'; const act = petActivity(); const thought = petThought();
    const areas = (C.world?.areas || []).filter(a => state.worldProgress.areas.includes(a.id));
    return `<div class="world-wrap"><div class="world-tabs">${areas.map(a=>`<button data-world-area="${a.id}" class="${area===a.id?'active':''}">${illustration(a.icon,a.name||a.label||a.id)} ${a.name}</button>`).join('')}</div><div class="world-scene area-${area}">${roomItemsHtml(area)}${completedGoalWorldArt(area)}${sectionWorldRewardsHtml(area)}${thought?`<div class="ambient-thought">${thought}</div>`:''}<button class="pet-stage pet-stage-button pet-motion-${act.cls}" aria-label="Открыть состояние питомца" data-route="pet">${petBubble?`<div class="pet-bubble">${petBubble}</div>`:''}${petSVG()}</button><div class="pet-activity">${esc(state.pet.name)} ${act.text}</div></div></div>`;
  }
  function worldProgressCard() {
    const s = worldStageData(); const next = nextWorldStageData();
    const remaining = next ? Math.max(0, next.unlockWeek - completedWeeks()) : 0;
    return `<div class="card world-progress-card"><div><div class="eyebrow">${isJunior()?'Как меняется мир':'Развитие мира'}</div><h3>Этап ${s.id} · ${s.title}</h3><p>${s.note}</p></div>${next?`<div class="next-unlock"><b>${next.title}</b><span>${remaining<=1?'совсем близко':`ещё около ${remaining} нед.`}</span></div>`:'<div class="next-unlock"><b>Мир открыт</b><span>дальше решают цели и события</span></div>'}</div>`;
  }

  function wishHtml() {
    if (!state.petWish) return '';
    const w = C.petWishes?.find(x=>x.id===state.petWish.id); if (!w) return '';
    const heading = state.ageGroup==='15-17' ? 'Идея на потом' : `${esc(state.pet.name)} думает`;
    return `<div class="card wish-card"><div class="round-icon">${illustration('☻')}</div><div><h3>${heading}</h3><p>${w.text}</p></div><div class="wish-actions">${w.itemId?`<button class="linkbtn" data-wish-buy="${w.itemId}">Посмотреть</button>`:`<button class="linkbtn" data-action="play">Заняться этим</button>`}<button class="linkbtn muted-link" data-dismiss-wish>Не сейчас</button></div></div>`;
  }

  function purchaseContext(item) {
    const afterBalance = Math.max(0,state.wallet.balance-item.price); const reserve = Math.max(0,afterBalance-needsReserve()); const delay = item.need?0:purchaseGoalDelay(item.price);
    if(state.ageGroup==='7-11'){
      const plan=planForWeek(),actual=actualsForWeek(),key=item.need?'necessary':'wants',label=item.need?'нужное':'хотелки';
      if(plan){
        const after=(actual[key]||0)+item.price,planned=plan[key]||0;
        const planText=after>planned?`Это на ${fmt(after-planned)} монет больше плана на ${label}.`:`По плану на ${label} останется ${fmt(planned-after)} монет.`;
        return `${planText} После покупки останется ${fmt(afterBalance)} монет.${delay>0?` До ${esc(goalView()?.name||'большой покупки')} станет немного дальше.`:''}`;
      }
      return delay>0?`После покупки останется ${fmt(afterBalance)} монет. До ${esc(goalView()?.name||'большой покупки')} станет немного дальше.`:`После покупки останется ${fmt(afterBalance)} монет.`;
    }
    if (delay>0) return `Свободно ≈ ${fmt(reserve)}. Цель может сдвинуться примерно на ${delay} нед.`;
    return `После покупки свободно ≈ ${fmt(reserve)} монет.`;
  }

  function goalsScreen(){
    const junior=isJunior(),title=junior?'На что будем копить?':'Цели';
    const lead=junior?'Выбери вещь или приключение. Монеты из копилки будут приближать тебя к этой цели.':state.ageGroup==='15-17'?'Долгосрочная цель конкурирует с текущими расходами и может открывать новые возможности.':'Цели меняют не только цифру: после достижения могут открыться новые места и активности.';
    return `<section class="screen">${topbar(title)}<p class="subtle">${lead}</p><div class="goal-list">${C.goals.map(g=>{const v=goalView(g),target=goalTarget(g),active=state.activeGoal===g.id,pct=active?progressPct():0,done=state.completedGoals.includes(g.id),remain=Math.max(0,target-state.wallet.savings);if(junior)return `<div class="card goal-select ${active?'active':''} ${done?'goal-done':''}"><div class="goal-icon">${goalIllustration(g,v)}</div><div><h3>${esc(v.name)}</h3><p>${esc(v.note)}</p><div class="goal-kid-numbers"><span>Нужно: <b>${fmt(target)} монет</b></span><span>В копилке: <b>${fmt(state.wallet.savings)}</b></span><span>Осталось: <b>${fmt(remain)}</b></span></div>${active?`<div class="bar green"><i style="width:${pct}%"></i></div><p class="goal-detail">Примерно ${weeksToGoal()} нед.</p>`:''}${done?'<span class="tag need">Готово</span>':''}</div>${done?'':`<button class="linkbtn" data-goal="${g.id}">${active?'Копим сюда':'Копить на это'}</button>`}</div>`;return `<div class="card goal-select ${active?'active':''} ${done?'goal-done':''}"><div class="goal-icon">${goalIllustration(g,v)}</div><div><h3>${esc(v.name)}</h3><p>${fmt(target)} монет · ${esc(v.note)}</p>${active?`<div class="bar green"><i style="width:${pct}%"></i></div><p class="goal-detail">${fmt(state.wallet.savings)} / ${fmt(target)} · ≈ ${weeksToGoal()} нед.</p>`:''}${done?'<span class="tag need">Открыто</span>':''}</div>${done?'':`<button class="linkbtn" data-goal="${g.id}">${active?'Выбрано':'Выбрать'}</button>`}</div>`}).join('')}</div><button class="btn secondary block" data-savings>Открыть копилку</button></section>`;
  }
  function progressScreen() {
    const h=healthText(),ws=worldStageData(),next=nextWorldStageData();
    return `<section class="screen">${topbar(isJunior()?'Как всё меняется':'Прогресс',true)}${worldProgressCard()}<div class="card"><div class="pet-stage" style="height:170px">${petSVG()}</div><div class="center"><b>${petStage()}</b><p class="subtle">${isJunior()?'Как растёт питомец':'Развитие питомца'}: ${Math.round(state.pet.development)}/100</p><div class="bar"><i style="width:${state.pet.development}%"></i></div></div></div><div class="metric-grid"><div class="metric"><div class="label">Пройдено недель</div><div class="value">${state.weekHistory.length}</div></div><div class="metric"><div class="label">Открыто мест</div><div class="value">${state.worldProgress.areas.length}</div></div><div class="metric"><div class="label">Предметов в мире</div><div class="value">${Object.keys(state.worldPlacements||{}).length}</div></div><div class="metric"><div class="label">${state.ageGroup==='7-11'?'Денег хватит?':'Состояние'}</div><div class="value compact-value">${h[0]}</div></div></div>${next?`<div class="card next-stage-detail"><b>Дальше: ${next.title}</b><p>${next.note}</p></div>`:''}</section>`;
  }

  function weekSummaryScreen() {
    const s=state.weekSummary;if(!s){route='home';return homeScreen();}
    const junior=state.ageGroup==='7-11';
    return `<section class="screen week-screen summary-screen">${demoStrip()}<div class="week-kicker">Неделя ${s.week} завершена</div><h1>${junior?'Что изменилось':'Итоги недели'}</h1><p class="week-lead">${junior?'Посмотрим на монеты, питомца и комнату.':'Снимок того, как решения изменили деньги и мир.'}</p><div class="summary-balance"><span>Было</span><b>${fmt(s.startingBalance)} ●</b><span>Осталось</span><b>${fmt(s.endingBalance)} ●</b></div><div class="summary-grid"><div><span>${junior?'На нужное':'Необходимое'}</span><b>${fmt(s.actual.necessary)}</b></div><div><span>${junior?'На хотелки':'Желания'}</span><b>${fmt(s.actual.wants)}</b></div><div><span>${junior?'В копилку':'Отложил'}</span><b>${fmt(s.actual.savings)}</b></div><div><span>${junior?'Получил ещё':'Доп. доход'}</span><b>${fmt(s.actual.extraIncome)}</b></div></div>${s.actual.sideJobIncome>0?`<div class="work-income-summary"><span>Подработка</span><b>+${fmt(s.actual.sideJobIncome)} ●</b></div>`:''}${s.emergencyCare?.total?`<div class="emergency-week-summary"><b>Питомцу понадобилась бесплатная помощь</b><span>${[s.emergencyCare.food?`еда ×${s.emergencyCare.food}`:'',s.emergencyCare.mood?`настроение ×${s.emergencyCare.mood}`:'',s.emergencyCare.health?`здоровье ×${s.emergencyCare.health}`:''].filter(Boolean).join(' · ')}</span></div>`:''}${s.section?`<div class="section-week-summary"><span>${sectionById(s.section.activityId)?.icon||'✦'} ${esc(sectionById(s.section.activityId)?.name||'Занятие')}</span><b>${s.section.status==='paid'?`−${fmt(s.section.amount)} ●`:'перерыв'}</b></div>`:''}${junior?`<div class="section-title"><h2>Как планировал → как получилось</h2></div>${planFactSummaryHtml(s)}`:`<div class="section-title"><h2>План → факт</h2></div>${planFactSummaryHtml(s)}`}<div class="section-title"><h2>Что изменила неделя</h2></div><div class="week-world-changes">${(s.worldChanges||[]).length?(s.worldChanges||[]).map(x=>`<div class="world-change">✦ <span>${x}</span></div>`).join(''):'<div class="world-change">○ <span>Мир не обязан меняться каждую неделю — крупные открытия требуют нескольких решений.</span></div>'}</div><div class="section-title"><h2>${junior?'Что можно заметить':'Наблюдения'}</h2></div><div class="insights">${s.insights.map(x=>`<div class="insight"><span>·</span><p>${x}</p></div>`).join('')}</div><div class="card development-result"><div class="development-result-head"><div><div class="eyebrow">${junior?'Почему вырос питомец':'Почему изменился питомец'}</div><h3>${petStage()}</h3></div><b>${s.development?.delta>0?'+':''}${s.development?.delta||0}</b></div><p>${esc(s.development?.reason||(junior?'Питомец растёт по итогам всей недели.':'Развитие рассчитывается по итогам всего игрового периода.'))}</p></div><div class="card pet-week-result"><div>${petSVG()}</div><div><b>${esc(state.pet.name)}</b><p>Настроение ${Math.round(state.pet.mood)} · состояние ${petWellbeing()}</p><span>${s.petDelta.mood>=0?'Неделя дала достаточно приятных моментов.':'На этой неделе приятных активностей было меньше.'}</span></div></div>${demoMode&&state.wallet.week>=Number(state.demoSession?.targetPeriods||5)?'<div class="demo-final-actions"><button class="btn primary block" data-demo-exit>Завершить демо</button><button class="btn secondary block" data-demo-reset>Пройти демо заново</button></div>':'<button class="btn primary block" data-next-week>Перейти к новой неделе</button>'}</section>`;
  }

  function choicePreview(c,e) {
    const bits=[];
    if(c.cost)bits.push(`−${c.cost} ●`); if(c.income)bits.push(`+${c.income} ●`); if(c.save)bits.push(`${c.save} → копилка`); if(c.pet?.mood||c.mood)bits.push(`${(c.pet?.mood||c.mood)>0?'+':''}${c.pet?.mood||c.mood} настроение`); if(c.pet?.health)bits.push(`${c.pet.health>0?'+':''}${c.pet.health} здоровье`);
    if(c.future)bits.push('последствие позже'); if(!bits.length)bits.push('без прямой траты');
    return `<span>${bits.slice(0,2).join(' · ')}</span>`;
  }
  function feedbackHtml(f) {
    const lines=[];
    if(f.balance!=null)lines.push(`<div><span>${moneyLabel()}</span><b>${fmt(f.balance)} ●</b></div>`);
    if(f.petMood!=null)lines.push(`<div><span>Настроение</span><b>${f.petMood>0?'+':''}${f.petMood}</b></div>`);if(f.petHealth!=null)lines.push(`<div><span>Здоровье</span><b>${f.petHealth>0?'+':''}${f.petHealth}</b></div>`);
    if(f.goalDelay>0)lines.push(`<div><span>${isJunior()?'До покупки станет дольше':'Влияние на цель'}</span><b>≈ +${f.goalDelay} нед.</b></div>`);
    else if(f.reserve!=null)lines.push(`<div><span>${state.ageGroup==='7-11'?'Останется свободно':'Свободно'}</span><b>${fmt(f.reserve)} ●</b></div>`);
    else if(f.goalWeeks!=null)lines.push(`<div><span>До цели</span><b>≈ ${f.goalWeeks} нед.</b></div>`);
    return `<div class="feedback-grid">${lines.slice(0,3).join('')}</div>`;
  }
  function buildFinancialFeedback(title,changes=[],reason='',actions=[]) {
    return {type:'financialFeedback',title,changes:(changes||[]).filter(Boolean),reason,actions:(actions||[]).filter(Boolean)};
  }
  function financialFeedbackHtml(m) {
    const rows=(m.changes||[]).filter(Boolean);
    const changed=rows.length?`<div class="feedback-change-list">${rows.map(x=>`<div><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')}</div>`:(m.feedback?feedbackHtml(m.feedback):'<p class="subtle">Данные обновлены.</p>');
    const actions=(m.actions&&m.actions.length?m.actions:[{label:'Продолжить'}]).map((a,i)=>a.route?`<button class="btn ${i===0?'primary':'secondary'}" data-feedback-route="${esc(a.route)}">${esc(a.label)}</button>`:`<button class="btn ${i===0?'primary':'secondary'}" data-close-modal>${esc(a.label)}</button>`).join('');
    return `<div class="feedback-section"><h3>Что изменилось</h3>${changed}</div><div class="feedback-section"><h3>Почему</h3><p>${esc(m.reason||(isJunior()?'Так получилось после твоего действия.':'Это результат выбранного финансового действия.'))}</p></div><div class="feedback-section"><h3>Что дальше</h3><div class="feedback-actions">${actions}</div></div>`;
  }
  function renderJarValues(){document.querySelectorAll('.jar-plan').forEach(row=>{const input=row.querySelector('input');const area=row.querySelector('.coin-stacks');if(!input||!area)return;const stacks=Math.max(0,Math.round(Number(input.value||0)/100));area.innerHTML=Array.from({length:Math.min(10,stacks)},()=>'<i>●</i>').join('')||'<em>пусто</em>';});}

  function confirmWeekPlan(input) {
    if (state.initialWeekPlan && state.initialWeekPlan.week === state.wallet.week) return {ok:false,reason:'locked',plan:state.initialWeekPlan};
    const n=Math.max(0,Number(input?.necessary)||0),w=Math.max(0,Number(input?.wants)||0),savings=Math.max(0,Number(input?.savings)||0); let reserve=Math.max(0,Number(input?.reserve)||0);
    let total=n+w+savings+reserve; const budget=planningBudget();
    if(total>budget) return {ok:false,reason:'over',over:total-budget};
    if(total<budget) reserve+=budget-total;
    const plan={week:state.wallet.week,necessary:n,wants:w,savings,reserve,createdAt:Date.now(),updatedAt:Date.now()};
    state.weekPlan={...plan}; state.initialWeekPlan={...plan};
    if(!state.weekSnapshot||state.weekSnapshot.week!==state.wallet.week) state.weekSnapshot={week:state.wallet.week,startingBalance:state.wallet.balance,startingSavings:state.wallet.savings,pet:{satiety:state.pet.satiety,mood:state.pet.mood,energy:state.pet.energy,health:state.pet.health,development:state.pet.development},worldStage:state.worldProgress.stage,inventoryIds:state.inventory.map(x=>x.id),areas:[...state.worldProgress.areas]};
    state.weekNeedsPlanning=false; track('budget_planned',{necessary:n,wants:w,savings,reserve,edited:false,ageMode:state.ageGroup}); track('age_mode_experience_started',{ageGroup:state.ageGroup,week:state.wallet.week}); recalculateHealth(); save();
    return {ok:true,plan:{...plan}};
  }

  function saveWeekPlan() {
    if(state.initialWeekPlan&&state.initialWeekPlan.week===state.wallet.week){toast(isJunior()?'План на эту неделю уже сохранён':'План этой недели уже подтверждён');route='budget';render();return;}
    const result=confirmWeekPlan({
      necessary:Number(document.getElementById('planNecessary')?.value||0),
      wants:Number(document.getElementById('planWants')?.value||0),
      savings:Number(document.getElementById('planSavings')?.value||0),
      reserve:Number(document.getElementById('planReserve')?.value||0)
    });
    if(!result.ok){if(result.reason==='over')toast(`План больше доступной суммы на ${fmt(result.over)}`);return;}
    editingPlan=false;route='home';modal=result.plan.savings>0?{type:'saveFirst',amount:result.plan.savings}:null;render();
  }

  function quickAction(action) {
    const beforeBalance=state.wallet.balance,beforeMood=state.pet.mood,beforeSatiety=state.pet.satiety,beforeHealth=state.pet.health;
    let title='',reason='',changed=false;
    if(action==='feed'){if(spend(40,'Необходимые расходы','Полезная еда','pet_care')){state.wallet.needsSpent+=40;state.stats.needsFirst++;adjustPet({satiety:30,health:5});petBubble=state.ageGroup==='15-17'?'Еда закрыта':'Ммм, вкусно!';track('pet_need_completed',{need:'satiety'});title='Питомец поел';reason=isJunior()?'Полезная еда помогает сытости и немного поддерживает здоровье.':'Это важная трата: сытость выросла, здоровье немного поддержано.';changed=true;}}
    else if(action==='care'){if(spend(60,'Необходимые расходы','Гигиена','pet_care')){state.wallet.needsSpent+=60;state.stats.needsFirst++;adjustPet({health:25});petBubble=state.ageGroup==='15-17'?'Стало комфортнее':'Теперь гораздо лучше ✦';track('pet_need_completed',{need:'health'});title='Позаботились о здоровье';reason=isJunior()?'Гигиена помогает питомцу хорошо себя чувствовать.':'Это важная трата на здоровье питомца.';changed=true;}}
    else if(action==='play'){if(spend(80,'Желания',state.ageGroup==='15-17'?'Досуг':'Игра с питомцем','pet_play')){adjustPet({mood:18,energy:-8});petBubble=state.ageGroup==='15-17'?'Неплохой перерыв':'Ещё немного поиграем?';title='Поиграли вместе';reason=isJunior()?'Игра — это хотелка. Питомцу веселее, но монет стало меньше.':'Это необязательный расход: настроение выросло, но свободных монет стало меньше.';changed=true;}}
    else if(action==='sidejob'){if(state.difficultyMode!=='medium')return;route='sidejob';track('side_job_opened',{source:'quick_action'});render();return;}
    if(state.petWish&&action==='play')state.petWish=null; checkAchievements(); recalculateHealth(); save();
    if(changed){
      const changes=[{label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`}];
      if(state.pet.mood!==beforeMood)changes.push({label:'Настроение',value:`${beforeMood} → ${state.pet.mood}`});
      if(state.pet.satiety!==beforeSatiety)changes.push({label:'Сытость',value:`${beforeSatiety} → ${state.pet.satiety}`});
      if(state.pet.health!==beforeHealth)changes.push({label:'Здоровье',value:`${beforeHealth} → ${state.pet.health}`});
      const planProgress=juniorPlanProgress(action==='play'?'wants':'necessary'); if(planProgress)changes.push({label:planProgress.label,value:planProgress.value});
      modal=buildFinancialFeedback(title,changes,reason,[{label:'Продолжить',route:'home'},{label:isJunior()?'Посмотреть план':'Открыть бюджет',route:'budget'}]);
    }
    render(); setTimeout(()=>{petBubble='';if(!modal&&(route==='home'||route==='pet'))render();},1700);
  }

  function buyItem(id) {
    const item=C.items.find(x=>x.id===id);if(!item)return;const persistent=isPersistentShopItem(item);if(persistent&&state.inventory.some(x=>x.id===item.id)){toast('Этот предмет уже есть');return;}
    petBubble='';
    const placement=persistent?C.world?.placements?.[item.id]:null;
    const beforeBalance=state.wallet.balance,beforeMood=state.pet.mood,beforeHealth=state.pet.health,beforeSatiety=state.pet.satiety,delay=item.need?0:purchaseGoalDelay(item.price),beforeFree=freeMoney();
    if(spend(item.price,item.need?'Необходимые расходы':'Желания',item.name,'shop',{itemId:item.id})){
      if(persistent){
        state.inventory.push({id:item.id,boughtAt:Date.now(),week:state.wallet.week,day:state.wallet.day});
        ensurePlacement(item.id);
        if(placement?.area)state.currentWorldArea=placement.area;
      }
      if(item.need){state.wallet.needsSpent+=item.price;state.stats.needsFirst++;} else if(item.price>beforeFree||(planForWeek()&&actualsForWeek().wants>planForWeek().wants)){state.stats.impulsePurchases++;track('impulse_purchase',{itemId:item.id,price:item.price});}
      const itemEffect={...(item.effect||{})};delete itemEffect.development;adjustPet(itemEffect);if(item.cures&&state.healthCondition===item.cures)state.healthCondition=null;if(state.petWish&&state.petWish.itemId===item.id)state.petWish=null;
      checkAchievements();recalculateHealth();recalculateWorldProgress();save();
      const changes=[{label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`}];
      if(state.pet.satiety!==beforeSatiety)changes.push({label:'Сытость',value:`${beforeSatiety} → ${state.pet.satiety}`});
      if(state.pet.mood!==beforeMood)changes.push({label:'Настроение',value:`${beforeMood} → ${state.pet.mood}`});
      if(state.pet.health!==beforeHealth)changes.push({label:'Здоровье',value:`${beforeHealth} → ${state.pet.health}`});
      if(delay>0)changes.push({label:isJunior()?'До покупки':'До цели',value:`примерно +${delay} нед.`});
      const planProgress=juniorPlanProgress(item.need?'necessary':'wants'); if(planProgress)changes.push({label:planProgress.label,value:planProgress.value});
      const purchaseActions=persistent
        ? [{label:placement?.area==='park'?'Посмотреть в парке':placement?.area==='city'?'Посмотреть в городе':'Посмотреть в комнате',route:'home'},{label:'Продолжить покупки',route:'shop'},{label:isJunior()?'Посмотреть план':'Открыть бюджет',route:'budget'}]
        : item.category==='Еда'
          ? [{label:'Посмотреть состояние',route:'pet'},{label:'Выбрать ещё',route:'shop'},{label:isJunior()?'Посмотреть план':'Открыть бюджет',route:'budget'}]
          : [{label:'Продолжить покупки',route:'shop'},{label:isJunior()?'Посмотреть план':'Открыть бюджет',route:'budget'}];
      modal=buildFinancialFeedback(
        `Куплено: ${item.name}`,
        changes,
        isJunior()?purchaseUseText(item):(item.need?'Покупка применена. Она поддерживает состояние питомца и учитывается в необходимых расходах.':'Покупка применена и уменьшила сумму для других решений.'),
        purchaseActions
      );
      track('purchase_completed',{itemId:item.id,price:item.price,need:!!item.need,balanceBefore:beforeBalance,balanceAfter:state.wallet.balance,goalDelay:delay});if(delay>0)track('goal_delayed',{goalId:state.activeGoal,reason:'purchase',weeks:delay});render();
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
    const goalName=goalView(g).name,goalIcon=goalView(g).icon;
    state.wallet.savings=Math.max(0,state.wallet.savings-target); tx('goal_purchase',-target,'Цель',`Достигнута цель «${goalName}»`,'goal',{goalId:g.id}); state.completedGoals.push(g.id); const changes=applyGoalUnlock(g.id); adjustPet({mood:10}); unlock('strategist',true); track('goal_completed',{goalId:g.id}); track('long_term_goal_completed',{goalId:g.id,unlock:changes}); state.activeGoal=null; recalculateWorldProgress(); modal={type:'goalUnlocked',goalId:g.id,title:goalName,message:changes[0]||(isJunior()?'Готово! Ты накопил нужную сумму.':'Цель изменила игровой мир и открыла новый этап.'),icon:goalIcon,changes:[{label:isJunior()?'На что копили':'Цель',value:isJunior()?'Готово':'достигнута'},{label:'В копилке',value:`${fmt(state.wallet.savings)} ●`}],reason:isJunior()?'Ты понемногу клал монеты в копилку и собрал нужную сумму.':'Ты регулярно откладывал монеты и набрал нужную сумму. Рост питомца считается отдельно — по итогам всей недели.'}; return true;
  }
  function saveAmount(n) {
    n=Math.round(Number(n)||0);if(n<=0||n>state.wallet.balance){toast('Проверь сумму');return;}
    const beforeBalance=state.wallet.balance,beforeSavings=state.wallet.savings,beforeWeeks=weeksToGoal();
    state.wallet.balance-=n;state.wallet.savings+=n;state.goalContributions++;tx('saving',-n,'Копилка',activeGoal()?`Вклад в цель «${goalView().name}»`:'Вклад в копилку','savings');state.dayActions.count++;state.stats.positiveDecisions++;track('savings_deposit',{amount:n,goalId:state.activeGoal});const g=activeGoal();const done=g?completeActiveGoal(g):false;checkAchievements();recalculateHealth();save();
    if(!done){
      const afterWeeks=weeksToGoal();
      modal=buildFinancialFeedback(
        `Отложено ${fmt(n)} монет`,
        [{label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`},{label:'В копилке',value:`${fmt(beforeSavings)} → ${fmt(state.wallet.savings)} ●`},afterWeeks!=null?{label:isJunior()?'До покупки':'До цели',value:`≈ ${afterWeeks} нед.`}:null,isJunior()&&juniorPlanProgress('savings')?{label:juniorPlanProgress('savings').label,value:juniorPlanProgress('savings').value}:null],
        isJunior()?(beforeWeeks!=null&&afterWeeks!=null&&afterWeeks<beforeWeeks?`До ${esc(goalView()?.name||'покупки')} стало ближе.`:'Монеты теперь лежат в копилке.'):(beforeWeeks!=null&&afterWeeks!=null&&afterWeeks<beforeWeeks?'Большая цель стала ближе.':'Монеты отделены от текущих трат и теперь лежат в копилке.'),
        [{label:'Продолжить',route:'savings'},{label:isJunior()?'Открыть монеты':'Открыть бюджет',route:'budget'}]
      );
    }
    render();
  }
  function selectGoal(id) {
    const g=C.goals.find(x=>x.id===id);if(!g||state.completedGoals.includes(id))return;if(state.activeGoal&&state.activeGoal!==id&&state.wallet.savings>0){const ok=confirm('Деньги останутся в копилке и станут прогрессом новой цели. Сменить цель?');if(!ok)return;track('goal_delayed',{previousGoal:state.activeGoal,newGoal:id});}state.activeGoal=id;track('goal_selected',{goalId:id});save();const chosen=goalView(g);modal=buildFinancialFeedback(isJunior()?`Теперь копим на ${chosen.name}`:'Цель выбрана',[{label:isJunior()?'На что копим':'Цель',value:chosen.name},{label:isJunior()?'Нужно':'Стоимость',value:`${fmt(goalTarget(g))} ●`}],isJunior()?'Монеты из копилки теперь будут показывать, сколько осталось до этой покупки.':'Теперь каждое пополнение копилки будет показывать, насколько эта цель стала ближе.',[{label:'Продолжить',route:'goals'},{label:'Открыть копилку',route:'savings'}]);render();
  }

  function openEvent(id){
    const e=C.events.find(x=>x.id===id);if(!e)return false;const key=`${state.wallet.week}:${state.wallet.day}:${id}`;
    state.healthEventsApplied=state.healthEventsApplied||[];if(e.healthCondition)state.healthCondition=e.healthCondition;
    if(e.healthDeltaOnOpen&&!state.healthEventsApplied.includes(key)){adjustPet({health:e.healthDeltaOnOpen});state.healthEventsApplied.push(key);state.healthEventsApplied=state.healthEventsApplied.slice(-40);}
    modal={type:'event',id};track('event_started',{eventId:id,chainId:state.currentChainId});save();render();return true;
  }
  function eventImmediateText(e,c){
    if(isJunior()){
      if(c.future)return c.result||'Решение сохранено. Что-то может измениться позже.';
      if(c.income&&c.save)return 'Часть монет пришла на руки, а часть сразу ушла в копилку.';
      if(c.income)return 'Монет стало больше.';
      if(c.cost&&((c.pet?.mood||c.mood)>0))return 'Монет стало меньше, а настроение питомца изменилось.';
      if(c.cost)return 'Монет стало меньше. Новый остаток уже виден.';
      if(c.withdraw)return 'Монеты вернулись из копилки.';
      if(c.goalTargetDelta)return 'До выбранной покупки теперь нужно накопить больше.';
      return (c.result||'Готово.').split('. ').slice(0,1).join('. ')+(c.result?.includes('.')?'.':'');
    }
    if(c.future)return c.result||'Решение принято. Пока ничего не списалось.';
    if(e.mechanicType==='role')return c.result;
    if(c.income&&c.save)return 'Часть денег появилась на балансе, часть сразу ушла в копилку.';
    if(c.income)return 'Деньги появились на балансе.';
    if(c.cost&&((c.pet?.mood||c.mood)>0))return 'Покупка сделана. Настроение заметно изменилось.';
    if(c.cost)return 'Расход прошёл. Новый остаток уже виден в бюджете.';
    if(c.withdraw)return 'Деньги вернулись из копилки на баланс.';
    if(c.goalTargetDelta)return 'Условия цели изменились. Новый срок пересчитан.';
    return (c.result||'Решение принято.').split('. ').slice(0,1).join('. ')+(c.result?.includes('.')?'.':'');
  }
  function resolveEvent(i) {
    const e=C.events.find(x=>x.id===modal.id),c=e?.choices[i];if(!c)return;const beforeBalance=state.wallet.balance,beforeHealth=state.pet.health,beforeWeeks=weeksToGoal(),choiceDelay=c.cost&&c.kind!=='necessary'?purchaseGoalDelay(c.cost):0;
    if(c.cost&&state.wallet.balance+(c.income||0)<c.cost){toast('Монет не хватает для этого решения');return;}track('event_choice_selected',{eventId:e.id,choice:i,chainId:state.currentChainId});
    if(c.income){state.wallet.balance+=c.income;tx('income',c.income,'Событие',e.title,c.source||'event');state.dayActions.count++;state.dayActions.income+=c.income;}
    if(c.cost){const kind=c.kind==='necessary'?'Необходимые расходы':'Желания';state.wallet.balance-=c.cost;tx('expense',-c.cost,kind,e.title,'event',{eventId:e.id});state.dayActions.count++;if(kind==='Необходимые расходы')state.dayActions.necessary+=c.cost;else state.dayActions.optional+=c.cost;if(kind==='Желания'&&planForWeek()&&actualsForWeek().wants>planForWeek().wants){state.stats.impulsePurchases++;track('impulse_purchase',{eventId:e.id,price:c.cost});}}
    if(c.save){const s=Math.min(c.save,state.wallet.balance);state.wallet.balance-=s;state.wallet.savings+=s;state.goalContributions++;tx('saving',-s,'Копилка','Вклад после события','event');track('savings_deposit',{amount:s,source:'event'});}
    if(c.withdraw){const s=Math.min(c.withdraw,state.wallet.savings);state.wallet.savings-=s;state.wallet.balance+=s;tx('saving_withdrawal',s,'Копилка','Снятие после события','event');track('savings_withdrawal',{amount:s,source:'event'});}
    if(c.nextWeekCost)createFutureObligation({type:c.source==='credit'?'credit':'plannedPayment',amount:c.nextWeekCost,dueInWeeks:1,remainingPayments:1,description:e.title,category:'Необходимые расходы'},e.id);
    if(c.future)createFutureObligation(c.future,e.id);
    if(c.goalTargetDelta&&activeGoal())state.goalAdjustments[state.activeGoal]=(state.goalAdjustments[state.activeGoal]||0)+c.goalTargetDelta;
    const petEff={...(c.pet||{})};delete petEff.development;if(c.mood!=null)petEff.mood=(petEff.mood||0)+c.mood;if(c.healthDelta!=null)petEff.health=(petEff.health||0)+c.healthDelta;if(c.care!=null)petEff.health=(petEff.health||0)+c.care;if(Object.keys(petEff).length)adjustPet(petEff);if(c.clearHealthCondition)state.healthCondition=null;if(c.health>0)state.stats.positiveDecisions++;
    const chainId=state.currentChainId; if(chainId)advanceStoryChain(chainId,e.id);
    state.eventResolved=true;state.recentEventIds.push(e.id);state.recentEventIds=state.recentEventIds.slice(-8);state.dayActions.count++;recalculateHealth();checkAchievements();track('event_completed',{eventId:e.id,balanceDelta:state.wallet.balance-beforeBalance,chainId});save();const afterWeeks=weeksToGoal();modal={type:'eventResult',title:e.title,result:eventImmediateText(e,c),feedback:{balance:state.wallet.balance,reserve:freeMoney(),goalDelay:Math.max(choiceDelay,beforeWeeks!=null&&afterWeeks!=null?Math.max(0,afterWeeks-beforeWeeks):0),goalWeeks:afterWeeks,petMood:petEff.mood||null,petHealth:state.pet.health!==beforeHealth?state.pet.health-beforeHealth:null}};render();
  }

  function advanceDay() {
    if(!canAdvanceDay())return blockDayForCriticalNeeds('advance_day');
    applyEndOfDay();
    if(state.wallet.day>=7){completeWeek();return true;}
    state.wallet.day++;state.wallet.nextIncomeIn=Math.max(0,8-state.wallet.day);state.eventResolved=false;state.dayActions={count:0,necessary:0,optional:0,income:0,sideJob:false};state.currentEventId=selectEventId();maybeCreateWish();state.streak++;const charges=processDueObligations({showModal:false});checkAchievements();recalculateHealth();save();if(charges.length)modal={type:'delayedImpact',charges};else toast(`День ${state.wallet.day}. До дохода ${state.wallet.nextIncomeIn} дн.`);render();return true;
  }

  function completeWeek() {
    const plan=planForWeek()||{necessary:0,wants:0,savings:0,reserve:0},actual=actualsForWeek(),snap=state.weekSnapshot||{startingBalance:state.wallet.balance,pet:{mood:state.pet.mood,development:state.pet.development},worldStage:state.worldProgress.stage,inventoryIds:[],areas:['home']};
    const development=calculatePeriodDevelopment(plan,actual,state.wallet.balance),developmentBefore=Number(state.pet.development)||0;
    state.pet.development=clamp(developmentBefore+development.score);
    const itemsBought=state.inventory.filter(x=>x.week===state.wallet.week).map(x=>C.items.find(i=>i.id===x.id)?.name).filter(Boolean); const beforeStage=state.worldProgress.stage;
    const summary={week:state.wallet.week,startingBalance:state.weekOpeningBalance??snap.startingBalance,endingBalance:state.wallet.balance,plan:{...plan},actual,section:sectionRecordForWeek(state.wallet.week),emergencyCare:emergencyCareForWeek(state.wallet.week),development:{before:developmentBefore,after:state.pet.development,delta:state.pet.development-developmentBefore,reason:development.explanation,checks:development},petDelta:{mood:state.pet.mood-(snap.pet?.mood??state.pet.mood),development:state.pet.development-(snap.pet?.development??developmentBefore),wellbeing:petWellbeing()},insights:weekInsights(plan,actual,snap),worldChanges:[]};
    if(summary.section?.status==='paid')summary.insights.unshift(`${sectionById(summary.section.activityId)?.name||'Занятие'} стоил ${fmt(summary.section.amount)} монет, поэтому план начинался с меньшей суммы.`);
    else if(summary.section?.status==='skipped')summary.insights.unshift(`На этой неделе был перерыв в занятии, поэтому монеты на него не тратились.`);
    if(summary.emergencyCare.total)summary.insights.unshift('На этой неделе питомцу понадобилась бесплатная помощь. Она не считается денежной тратой.');
    state.weekHistory.push(summary);state.weekHistory=state.weekHistory.slice(-20);recalculateWorldProgress(); if(itemsBought.length)summary.worldChanges.push(`В мире появилось: ${itemsBought.slice(0,3).join(', ')}.`);if(state.worldProgress.stage>beforeStage)summary.worldChanges.push(`Открыт новый этап: ${worldStageData().title}.`);const newAreas=state.worldProgress.areas.filter(a=>!(snap.areas||[]).includes(a));newAreas.forEach(a=>summary.worldChanges.push(`Открыта локация «${C.world.areas.find(x=>x.id===a)?.name||a}».`));if(state.completedGoals.some(g=>state.transactions.some(t=>t.week===state.wallet.week&&t.meta?.goalId===g)))summary.worldChanges.push('Большая цель изменила доступные возможности.');
    state.weekSummary=summary;if(isBalancedWeek(summary))state.stats.weeksBalanced++;track('budget_plan_vs_fact',{week:state.wallet.week,plan,actual});track('period_development_calculated',{week:state.wallet.week,score:development.score,before:developmentBefore,after:state.pet.development});track('week_completed',{week:state.wallet.week,endingBalance:state.wallet.balance,wellbeing:petWellbeing(),worldStage:state.worldProgress.stage});recalculateHealth();checkAchievements();save();route='weekSummary';render();window.scrollTo(0,0);
  }

  function startNextWeek() {
    if(demoMode&&state.wallet.week>=Number(state.demoSession?.targetPeriods||5)){modal={type:'demoFinished'};render();return false;}
    if(!canAdvanceDay())return blockDayForCriticalNeeds('next_week');
    const beforeBalance=state.wallet.balance;
    state.weekSummary=null;state.wallet.week++;state.wallet.day=1;state.wallet.nextIncomeIn=7;state.wallet.needsSpent=0;state.wallet.balance+=state.wallet.weeklyIncome;tx('income',state.wallet.weeklyIncome,'Доход',`Доход за неделю ${state.wallet.week}`,'weekly_income');state.weekOpeningCharges=[];applyPendingSectionChange();clubsState().currentWeekDecision=null;clubsState().choiceSkippedWeek=null;syncSectionUnlock(true);state.emergencyCare={...emergencyCareState(),week:state.wallet.week,food:0,mood:0,health:0};state.dayActions={count:0,necessary:0,optional:0,income:0,sideJob:false};processDueObligations({showModal:false,opening:true});state.weekOpeningBalance=state.wallet.balance;track('week_started',{week:state.wallet.week,income:state.wallet.weeklyIncome,automaticCharges:state.weekOpeningCharges.reduce((a,x)=>a+x.amount,0),available:state.wallet.balance});state.weekPlan=null;state.initialWeekPlan=null;state.weekSnapshot=null;state.weekNeedsPlanning=true;state.eventResolved=false;state.currentEventId=selectEventId();state.petWish=null;if(state.activityLimits.week!==state.wallet.week)state.activityLimits={week:state.wallet.week,sideJobs:0};state.workState={week:state.wallet.week,shiftsUsed:0,shiftsLimit:3,activityUsage:{}};state.workSession=null;recalculateWorldProgress();recalculateHealth();route='weekStart';
    if(demoMode){prepareDemoPeriod();modal={type:'demoPeriodIntro',period:state.wallet.week};}
    else if(isJunior()){modal=buildFinancialFeedback(`Новая неделя`,[{label:'Получил монеты',value:`+${fmt(state.wallet.weeklyIncome)} ●`},{label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`}],state.weekOpeningCharges.length?'Новые монеты пришли. Игра уже учла то, что нужно было оплатить.':sectionDecisionPending()?'Перед планом недели сначала решим, что делать с занятием.':'Новые монеты пришли. Сначала придумай, как хочешь потратить их на этой неделе.',[{label:sectionDecisionPending()?'Продолжить':'Составить план',route:'weekStart'}]);}
    else{modal=buildFinancialFeedback(`Новый период: неделя ${state.wallet.week}`,[{label:'Доход',value:`+${fmt(state.wallet.weeklyIncome)} ●`},{label:moneyLabel(),value:`${fmt(beforeBalance)} → ${fmt(state.wallet.balance)} ●`}],state.weekOpeningCharges.length?'Доход начислен, а обязательства из прошлых решений уже учтены в доступном балансе.':'Периодический игровой доход начислен. Теперь его нужно распределить до начала недели.',[{label:'Распределить бюджет',route:'weekStart'}]);}
    save();render();window.scrollTo(0,0);return true;
  }
  function freshState() {
    return {
      version:6,
      onboardingDone:false,
      onboardingStep:0,
      onboardingModeChoice:null,
      onboardingIntroCompleted:false,
      helpLastTopic:null,
      ageMigrationPending:false,
      legacyAgeGroup:null,
      ageGroup:null,
      difficultyMode:null,
      pet:{type:'cat',name:'Финни',color:C.petColors[0],accessory:'none',satiety:72,mood:74,energy:78,health:76,care:76,development:8},
      wallet:{balance:1000,savings:0,weeklyIncome:1000,week:1,day:1,nextIncomeIn:7,needsSpent:0},
      activeGoal:null,goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],
      financialHealth:68,xp:0,streak:1,
      stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},
      currentEventId:null,currentChainId:null,eventResolved:false,recentEventIds:[],
      weekNeedsPlanning:true,weekPlan:null,initialWeekPlan:null,weekSnapshot:null,weekSummary:null,weekHistory:[],weekOpeningCharges:[],weekOpeningBalance:1000,
      clubs:{unlocked:false,unlockedWeek:null,activeId:null,joinedWeek:null,currentWeekDecision:null,choiceSkippedWeek:null,pendingId:null,pendingStop:false,skippedWeeks:[],history:[],progress:{}},
      emergencyCare:{week:1,food:0,mood:0,health:0,history:[]},petNeedAlertFlags:{satiety:false,mood:false,health:false},healthCondition:null,healthEventsApplied:[],
      dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,wishDismissedDay:null,
      analytics:[],nextWeekObligations:[],futureObligations:[],
      worldProgress:{stage:1,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},
      activityLimits:{week:1,sideJobs:0},workState:{week:1,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,
      settings:{sound:true,motion:true},createdAt:Date.now()
    };
  }

  function migrateState(raw, storageKey = STORAGE_KEY) {
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
      worldProgress:{...base.worldProgress,...(raw.worldProgress||{})},worldPlacements:raw.worldPlacements||{},storyChains:raw.storyChains||{},
      clubs:{...base.clubs,...(raw.clubs||{}),skippedWeeks:raw.clubs?.skippedWeeks||[],history:raw.clubs?.history||[],progress:{...(raw.clubs?.progress||{})}},
      emergencyCare:{...base.emergencyCare,...(raw.emergencyCare||{}),history:raw.emergencyCare?.history||[]},
      weekOpeningBalance:raw.weekOpeningBalance??base.weekOpeningBalance
    };
    const migratedHealth=Math.max(0,Math.min(100,Number(raw.pet?.health ?? raw.pet?.care ?? migrated.pet.health ?? migrated.pet.care ?? 76)));
    migrated.pet.health=migratedHealth;migrated.pet.care=migratedHealth;
    migrated.emergencyCare.health=Number(raw.emergencyCare?.health ?? raw.emergencyCare?.care ?? migrated.emergencyCare.health ?? 0)||0;
    migrated.emergencyCare.history=(migrated.emergencyCare.history||[]).map(x=>x.need==='care'?{...x,need:'health'}:x);
    migrated.petNeedAlertFlags={satiety:false,mood:false,health:false,...(raw.petNeedAlertFlags||{})};
    migrated.healthCondition=raw.healthCondition||null;
    migrated.healthEventsApplied=Array.isArray(raw.healthEventsApplied)?raw.healthEventsApplied:[];
    if(!migrated.clubs.unlocked&&migrated.wallet.week>=3)migrated.clubs.unlocked=true;
    if(!migrated.initialWeekPlan && migrated.weekPlan && migrated.weekPlan.week===migrated.wallet.week) migrated.initialWeekPlan={...migrated.weekPlan};
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
    if (window.FINPET_STORAGE?.saveState) window.FINPET_STORAGE.saveState(storageKey,migrated);
    else localStorage.setItem(storageKey,JSON.stringify(migrated));
    return migrated;
  }

  const DEMO_PERIODS = [
    {id:'budget',title:'План на неделю',lead:'Сначала разложим монеты, выберем, на что копить, позаботимся о питомце и положим часть в копилку.',steps:[
      {id:'plan',label:'Составь план',route:'weekStart',hint:'Реши, сколько хочешь потратить на нужное, хотелки и копилку, а сколько пока не тратить. Нажми «Запомнить план».'},
      {id:'goal',label:'Выбери, на что копить',route:'goals',hint:'Открой раздел «Копим» и выбери большую покупку.'},
      {id:'necessary',label:'Потрать на нужное',route:'home',hint:'Покорми питомца или позаботься о здоровье. Так увидишь разницу между «нужно» и «хочу».'},
      {id:'savings',label:'Положи в копилку',route:'savings',hint:'Положи часть монет в копилку и посмотри, сколько осталось до покупки.'},
      {id:'finish',label:'Посмотри итог недели',route:'home',hint:'Сравни, что хотел сделать и как получилось. Ещё увидишь, почему вырос питомец.'}
    ]},
    {id:'needs-wants',title:'Хочу или нужно?',lead:'Сначала потратим на то, что нужно питомцу, а потом — на хотелку.',steps:[
      {id:'plan',label:'Составь новый план',route:'weekStart',hint:'Реши заранее, сколько хочешь потратить. Оставь немного и на хотелки.'},
      {id:'necessary',label:'Сначала сделай нужное',route:'home',hint:'Потрать на то, что нужно питомцу — например, покорми его.'},
      {id:'optional',label:'Теперь выбери хотелку',route:'home',hint:'Поиграй с питомцем или купи хотелку. Сравни с тратой на нужное.'},
      {id:'finish',label:'Сравни решения',route:'home',hint:'Закончи неделю и посмотри, чем план отличается от того, как получилось.'}
    ]},
    {id:'shortage',title:'Когда монет не хватает',lead:'Монет стало мало. Попробуем дорогую покупку и посмотрим, что предложит игра.',steps:[
      {id:'plan',label:'Составь план с тем, что осталось',route:'weekStart',hint:'После неожиданной траты монет стало меньше. Реши, как хочешь потратить оставшиеся.'},
      {id:'shortage',label:'Попробуй дорогую покупку',route:'shop',hint:'Нажми кнопку ниже. Монет специально не хватит — посмотри, что предложит игра.'},
      {id:'task',label:'Заработай ещё монеты',route:'tasks',hint:'Выполни задание и получи ещё монеты.'},
      {id:'finish',label:'Посмотри, что получилось',route:'home',hint:'Закончи неделю и посмотри, как нехватка монет всё изменила.'}
    ]},
    {id:'plan-fact',title:'Как хотел → как получилось',lead:'Сначала составим план, потом потратим монеты и сравним результат.',steps:[
      {id:'plan',label:'Составь план',route:'weekStart',hint:'Реши заранее, сколько хочешь потратить. После кнопки «Запомнить план» он останется для сравнения.'},
      {id:'optional',label:'Купи хотелку',route:'home',hint:'Потрать немного на хотелку. Потом сравним это с планом.'},
      {id:'savings',label:'Положи в копилку',route:'savings',hint:'Положи часть монет в копилку. Это тоже появится в итоге недели.'},
      {id:'necessary',label:'Потрать на нужное',route:'home',hint:'Теперь потрать на то, что нужно питомцу.'},
      {id:'finish',label:'Посмотри, что получилось',route:'home',hint:'Закончи неделю. План останется тем же, а рядом будет видно, как получилось.'}
    ]},
    {id:'growth',title:'Как растёт питомец',lead:'Последняя неделя покажет, как несколько недель решений помогают питомцу расти.',steps:[
      {id:'plan',label:'Составь план на последнюю неделю',route:'weekStart',hint:'Ещё раз реши заранее, как хочешь потратить монеты. Это последняя неделя демо.'},
      {id:'necessary',label:'Позаботься о питомце',route:'home',hint:'Потрать на то, что нужно питомцу.'},
      {id:'savings',label:'Снова положи в копилку',route:'savings',hint:'Положи монеты в копилку. Если делать это каждую неделю, питомец растёт быстрее.'},
      {id:'finish',label:'Посмотри, как вырос питомец',route:'home',hint:'Закончи пятую неделю. После этого демо завершится.'}
    ]}
  ];
  function freshDemoState(petOverride = null) {
    const d=freshState();
    d.onboardingDone=true;d.onboardingIntroCompleted=true;d.onboardingStep=(C.introSlides||[]).length+2;
    d.difficultyMode='easy';d.ageGroup='7-11';d.ageMigrationPending=false;d.onboardingModeChoice='demo';
    d.pet={...d.pet,...(petOverride||{}),development:8};
    d.wallet={...d.wallet,balance:1000,savings:0,weeklyIncome:1000,week:1,day:1,nextIncomeIn:7};
    d.activeGoal=null;d.currentEventId=(C.events.find(e=>(e.age||[]).includes('7-11'))||C.events[0]||{}).id||null;
    d.demoSession={targetPeriods:5,startedAt:Date.now(),starterPet:{...d.pet},shortageWeeks:[],periodIntroSeen:[]};
    return d;
  }
  function demoPeriodConfig(week=state.wallet.week) {
    return DEMO_PERIODS[Math.max(0,Math.min(DEMO_PERIODS.length-1,Number(week||1)-1))];
  }
  function prepareDemoPeriod() {
    if(!demoMode) return;
    state.demoSession=state.demoSession||{targetPeriods:5,shortageWeeks:[],periodIntroSeen:[]};
    state.demoSession.shortageWeeks=state.demoSession.shortageWeeks||[];
    state.demoSession.periodIntroSeen=state.demoSession.periodIntroSeen||[];
    if(state.wallet.week===3 && !state.demoSession.shortagePrepared){
      const targetBalance=520;
      if(state.wallet.balance>targetBalance){
        const amount=state.wallet.balance-targetBalance;
        state.wallet.balance=targetBalance;
        tx('expense',-amount,'Необходимые расходы','Неожиданная трата','demo_setup');
        state.weekOpeningCharges=state.weekOpeningCharges||[];
        state.weekOpeningCharges.push({description:'Неожиданная трата',amount});
      }
      state.demoSession.shortagePrepared=true;
    }
  }
  function startDemoMode(options = {}) {
    const selectedPet={...(options.pet||state.pet||{})};
    const fromOnboarding=!!options.fromOnboarding||!state.onboardingDone;
    if(!demoMode){
      if(fromOnboarding){
        state.onboardingStep=(C.introSlides||[]).length;
        state.onboardingModeChoice=null;
        state.difficultyMode=null;
        state.ageGroup=null;
      }
      save();
    }
    demoMode=true;state=freshDemoState(selectedPet);tx('income',1000,'Доход','Стартовый демонстрационный бюджет','onboarding');adultUnlocked=false;modal={type:'demoPeriodIntro',period:1};taskResult=null;editingPlan=false;prepareDemoPeriod();save();route='weekStart';track('demo_started',{targetPeriods:5,source:fromOnboarding?'mode_select':'developer'});save();render();window.scrollTo(0,0);return true;
  }
  function resetDemoMode() {
    if(!demoMode) return startDemoMode();
    const starterPet={...(state.demoSession?.starterPet||state.pet||{})};
    if(window.FINPET_STORAGE?.remove) window.FINPET_STORAGE.remove(DEMO_STORAGE_KEY); else localStorage.removeItem(DEMO_STORAGE_KEY);
    state=freshDemoState(starterPet);tx('income',1000,'Доход','Стартовый демонстрационный бюджет','onboarding');adultUnlocked=false;modal={type:'demoPeriodIntro',period:1};taskResult=null;editingPlan=false;prepareDemoPeriod();save();route='weekStart';track('demo_reset',{targetPeriods:5});save();render();window.scrollTo(0,0);return true;
  }
  function exitDemoMode() {
    if(!demoMode) return false;
    save();demoMode=false;state=migrateState(loadRawState(STORAGE_KEY),STORAGE_KEY);adultUnlocked=false;modal=null;taskResult=null;editingPlan=false;route=state.onboardingDone?'home':'onboarding';render();window.scrollTo(0,0);return true;
  }
  function demoCompletePeriod() {
    if(!demoMode) return false;
    if(state.weekSummary){
      if(state.wallet.week>=Number(state.demoSession?.targetPeriods||5)){modal={type:'demoFinished'};render();}
      return true;
    }
    if(!planForWeek()){toast('Сначала подтвердите план периода');return false;}
    completeWeek();
    if(state.wallet.week>=Number(state.demoSession?.targetPeriods||5)){modal={type:'demoFinished'};render();}
    return true;
  }
  function demoStepDone(step) {
    const week=state.wallet.week,actual=actualsForWeek();
    if(step.id==='plan') return !!planForWeek();
    if(step.id==='goal') return !!state.activeGoal||state.completedGoals.length>0;
    if(step.id==='necessary') return actual.necessary>0;
    if(step.id==='optional') return actual.wants>0;
    if(step.id==='savings') return actual.savings>0;
    if(step.id==='task') return state.transactions.some(t=>t.week===week&&t.source==='task');
    if(step.id==='shortage') return (state.demoSession?.shortageWeeks||[]).includes(week);
    if(step.id==='finish') return !!state.weekSummary;
    return false;
  }
  function demoGuideState() {
    const period=demoPeriodConfig(),steps=period.steps.map(x=>({...x,done:demoStepDone(x)}));
    const current=steps.find(x=>!x.done)||steps[steps.length-1];
    return {period,steps,current,completed:steps.filter(x=>x.done).length,total:steps.length};
  }
  function currentDemoAction(step) {
    if(!step||step.done) return '';
    if(step.id==='finish') return '<button class="btn primary demo-next-button" data-demo-complete>Закончить эту неделю</button>';
    if(step.id==='shortage') return '<button class="btn primary demo-next-button" data-demo-shortage>Показать покупку без денег</button>';
    if(step.id==='necessary') return '<button class="btn primary demo-next-button" data-demo-direct="feed">Покормить питомца · 40 ●</button>';
    if(step.id==='optional') return '<button class="btn primary demo-next-button" data-demo-direct="play">Поиграть · 80 ●</button>';
    if(step.id==='savings'&&state.wallet.balance>=100) return '<button class="btn primary demo-next-button" data-demo-save="100">Отложить 100 ●</button>';
    const here=route===step.route;
    return here?'<div class="demo-do-here">↓ Сделайте действие на этом экране</div>':`<button class="btn primary demo-next-button" data-demo-guide-route="${esc(step.route)}">Перейти и сделать</button>`;
  }
  function demoStrip() {
    if(!demoMode) return '';
    const target=Number(state.demoSession?.targetPeriods||5),periodNumber=Math.min(target,Math.max(1,state.wallet.week)),guide=demoGuideState();
    const finalComplete=state.weekSummary&&state.wallet.week>=target;
    return `<aside class="demo-director" aria-label="Сценарий демо-режима"><div class="demo-director-head"><div><span class="demo-word">DEMO</span><span>Неделя ${periodNumber} из ${target}</span></div><button class="demo-finish-link" data-demo-exit>Завершить демо</button></div><div class="demo-story"><span>Что попробуем</span><h3>${esc(guide.period.title)}</h3><p>${esc(guide.period.lead)}</p></div><div class="demo-current"><div class="demo-current-count">Шаг ${Math.min(guide.completed+1,guide.total)} из ${guide.total}</div><strong>${finalComplete?'Демо завершено':esc(guide.current.label)}</strong><p>${finalComplete?'Пять недель пройдены. Дальше демо не продолжается.':esc(guide.current.hint)}</p>${finalComplete?'<button class="btn primary demo-next-button" data-demo-exit>Завершить демо</button>':currentDemoAction(guide.current)}</div><div class="demo-progress" aria-label="Прогресс сценария">${guide.steps.map(x=>`<i class="${x.done?'done':x.id===guide.current.id?'current':''}" title="${esc(x.label)}"></i>`).join('')}</div><button class="demo-reset-link" data-demo-reset>Начать демо заново</button></aside>`;
  }

  function petSVG(type=state.pet.type,color=state.pet.color,accessory=state.pet.accessory) {
    const face=type==='dog'
      ? `<g class="pet-ears pet-ears-dog"><path class="pet-ear pet-ear-left" d="M48 75 C32 52 31 31 48 28 C58 27 66 39 70 51" fill="#71564b"/><path class="pet-ear pet-ear-right" d="M152 75 C168 52 169 31 152 28 C142 27 134 39 130 51" fill="#71564b"/></g>`
      : type==='cat'
        ? `<g class="pet-ears pet-ears-cat"><path class="pet-ear pet-ear-left" d="M49 62 L53 25 L78 52 Z" fill="${color}"/><path class="pet-ear pet-ear-right" d="M151 62 L147 25 L122 52 Z" fill="${color}"/></g>`
        : `<g class="pet-ears pet-ears-mumo"><path class="pet-ear pet-ear-left" d="M58 54 C42 35 47 22 59 31 L76 52 Z" fill="${color}"/><path class="pet-ear pet-ear-right" d="M142 54 C158 35 153 22 141 31 L124 52 Z" fill="${color}"/></g>`;
    const extra=type==='mumo'?`<g class="pet-forehead"><circle cx="100" cy="52" r="10" fill="#fff" opacity=".85"/><circle cx="100" cy="52" r="4" fill="#26314c"/></g>`:'';
    const y=type==='dog'?4:type==='mumo'?-1:0;
    const moodValues=['satiety','mood','energy','care'].map(k=>Number(state.pet?.[k]??0));
    const moodAverage=moodValues.reduce((sum,n)=>sum+n,0)/Math.max(1,moodValues.length);
    const moodWeakest=Math.min(...moodValues);
    const expression=(moodAverage>=70&&moodWeakest>=45)?'happy':((moodAverage<45||moodWeakest<25)?'sad':'neutral');
    const expressionMarkup=expression==='happy'
      ? '<g class="pet-expression pet-expression-happy"><path class="pet-mouth" d="M87 116 Q100 132 113 116" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/></g>'
      : expression==='sad'
        ? '<g class="pet-expression pet-expression-sad"><path class="pet-mouth" d="M88 126 Q100 112 112 126" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/><path class="pet-brows" d="M67 86 Q76 81 84 87M116 87 Q124 81 133 86" stroke="#26314c" stroke-width="3" fill="none" stroke-linecap="round"/></g>'
        : '<g class="pet-expression pet-expression-neutral"><path class="pet-mouth" d="M91 120 Q100 122 109 120" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/></g>';
    const tail=type==='mumo'?'':(type==='dog'
      ? '<path class="pet-tail" d="M148 133 Q176 127 170 105 Q166 94 157 100" fill="none" stroke="'+color+'" stroke-width="15" stroke-linecap="round"/>'
      : '<path class="pet-tail" d="M149 137 Q181 137 178 109 Q176 91 160 91" fill="none" stroke="'+color+'" stroke-width="14" stroke-linecap="round"/>');
    const behind=accessory==='backpack'?`<g transform="translate(0 ${y})"><path d="M40 89 Q24 94 28 143 Q30 163 51 160 L58 102Z" fill="#b45e3d"/><path d="M160 89 Q176 94 172 143 Q170 163 149 160 L142 102Z" fill="#b45e3d"/><path d="M39 101 Q52 80 67 83" fill="none" stroke="#6b3d2d" stroke-width="6"/></g>`:'';
    const accessories={
      cap:`<g transform="translate(0 ${y})"><path d="M62 50 Q100 28 138 50 L130 61 H67 Z" fill="#285441"/><path d="M127 56 Q153 56 158 66 Q139 67 124 64Z" fill="#285441"/></g>`,
      scarf:'<path d="M57 137 Q100 151 143 137 L139 153 Q101 165 61 151Z" fill="#c86f48"/><path d="M119 149 L136 181 L119 184 L108 154Z" fill="#c86f48"/>',
      badge:'<circle cx="135" cy="139" r="10" fill="#e7c76b"/><path d="M135 133 l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z" fill="#765516"/>',
      glasses:`<g transform="translate(0 ${y})" fill="none" stroke="#31473d" stroke-width="4"><rect x="60" y="88" width="34" height="23" rx="10"/><rect x="106" y="88" width="34" height="23" rx="10"/><path d="M94 97 Q100 93 106 97M60 95 L49 91M140 95 L151 91"/></g>`,
      headphones:`<g transform="translate(0 ${y})"><path d="M55 98 Q55 55 100 55 Q145 55 145 98" fill="none" stroke="#3f5c72" stroke-width="8"/><rect x="47" y="91" width="17" height="35" rx="8" fill="#d27a52"/><rect x="136" y="91" width="17" height="35" rx="8" fill="#d27a52"/></g>`,
      bow:`<g transform="translate(0 ${y})"><path d="M99 139 Q76 122 65 139 Q77 158 99 147Z" fill="#b45e6b"/><path d="M101 139 Q124 122 135 139 Q123 158 101 147Z" fill="#b45e6b"/><circle cx="100" cy="143" r="7" fill="#7d3948"/></g>`,
      backpack:''
    };
    return `<svg class="pet-svg expression-${expression}${petBubble?' is-reacting':''}" viewBox="0 0 200 200" aria-label="Питомец ${esc(state.pet.name)}" role="img"><ellipse class="pet-shadow" cx="100" cy="177" rx="61" ry="13" fill="#7c88aa" opacity=".16"/>${tail}<g class="pet-body">${face}${behind}<path class="pet-core" d="M45 102 C45 65 67 48 100 48 C133 48 155 65 155 102 L151 135 C147 163 129 176 100 176 C71 176 53 163 49 135 Z" fill="${color}"/>${extra}<g class="pet-face"><g class="pet-gaze"><g class="pet-eyes"><ellipse cx="77" cy="98" rx="8" ry="10" fill="#26314c"/><ellipse cx="123" cy="98" rx="8" ry="10" fill="#26314c"/><circle cx="74" cy="94" r="2.5" fill="#fff"/><circle cx="120" cy="94" r="2.5" fill="#fff"/></g></g><path class="pet-nose" d="M96 108 Q100 111 104 108 Q100 115 96 108Z" fill="#26314c" opacity=".78"/>${expressionMarkup}<g class="pet-cheeks"><ellipse cx="61" cy="116" rx="10" ry="5" fill="#fff" opacity=".16"/><ellipse cx="139" cy="116" rx="10" ry="5" fill="#fff" opacity=".16"/></g></g>${accessories[accessory]||''}</g></svg>`;
  }

  function learningArtwork(kind) {
    const accent={limited:'#c86f48',needs:'#56785f',wants:'#b45e6b',savings:'#d1a64e',help:'#6f8069',adult:'#8a6551'}[kind]||'#56785f';
    const extra=kind==='savings'?'<path d="M142 54v34M125 71h34"/>':kind==='needs'?'<path d="M130 67l9 9 20-24"/>':kind==='wants'?'<path d="M143 51c18 0 20 25 0 38-20-13-18-38 0-38z"/>':kind==='adult'?'<path d="M126 50h35v43h-35zM133 61h21M133 71h17M133 81h19"/>':'<path d="M129 58h31M129 70h25M129 82h18"/>';
    return `<svg class="learning-art" viewBox="0 0 220 150" aria-hidden="true"><path d="M34 113c19-42 51-72 88-68 31 3 46 28 62 67" fill="#e7eadc"/><path d="M30 116h160" stroke="#bdc5b2" stroke-width="3" stroke-linecap="round"/><g fill="#fffdf8" stroke="${accent}" stroke-width="4"><path d="M52 72h50l-5 47H57z"/><path d="M62 72c0-17 28-17 28 0" fill="none"/>${extra}</g><circle cx="77" cy="91" r="8" fill="${accent}"/><path d="M46 126c22 7 45 7 68 0M126 126c17 5 35 5 52 0" stroke="#c99971" stroke-width="3" stroke-linecap="round"/></svg>`;
  }

  function profileNavIcon(){
    return `<span class="nav-profile-icon" aria-hidden="true"><svg viewBox="0 0 32 32" role="presentation"><circle class="profile-ring" cx="16" cy="16" r="14"/><circle class="profile-head" cx="16" cy="12" r="4.2"/><path class="profile-shoulders" d="M8.6 24.3c.9-4.1 3.7-6.3 7.4-6.3s6.5 2.2 7.4 6.3"/></svg></span>`;
  }
  function renderNav(){
    if(['weekStart','weekSummary','help','adultGate','adult'].includes(route))return '';
    const easy=isJunior(),nav=[['home','⌂','Дом'],['tasks','◫','Задания'],['budget','◒',easy?'Монеты':'Бюджет'],['goals','◎',easy?'Копим':'Цели'],['profile','○','Профиль']];
    return `<nav class="nav" aria-label="Основная навигация">${nav.map(([r,i,l])=>`<button data-route="${r}" class="${route===r?'active':''}" ${route===r?'aria-current="page"':''}>${r==='profile'?profileNavIcon():illustration(({home:'🏠',tasks:'📖',budget:'💰',goals:'🪙'})[r])}${l}</button>`).join('')}</nav>`;
  }

  function renderScreen() {
    if(route==='help')return helpScreen();if(route==='adultGate')return adultGateScreen();if(route==='adult')return adultUnlocked?adultScreen():adultGateScreen();
    if(route==='weekStart')return weekStartScreen();if(route==='weekSummary')return weekSummaryScreen();if(route==='home')return homeScreen();if(route==='tasks')return tasksScreen();if(route==='budget')return budgetScreen();if(route==='goals')return goalsScreen();if(route==='profile')return profileScreen();if(route==='activities')return sectionsScreen();if(route==='shop')return shopScreen();if(route==='pet')return petScreen();if(route==='savings')return savingsScreen();if(route==='task')return taskScreen();if(route==='sidejob')return sideJobScreen();if(route==='progress')return progressScreen();if(route==='achievements')return achievementsScreen();if(route==='settings')return settingsScreen();return homeScreen();
  }

  function topbar(title,back=false) {
    const showHelp=route!=='help';
    return `<header class="topbar"><div class="topbar-title">${back?'<button class="linkbtn back-button" data-back>← Назад</button>':''}<div class="eyebrow">Неделя ${state.wallet.week} · день ${state.wallet.day}</div><h1>${esc(title)}</h1></div><div class="topbar-actions">${showHelp?'<button class="help-button" data-help><b>?</b><span>Помощь</span></button>':''}<div class="balance-pill"><span class="coin">●</span>${fmt(state.wallet.balance)}</div></div></header>${demoStrip()}${state.workSession&&route==='sidejob'?'':pageArtwork(route)}`;
  }

  function skipInitialIntro(){const step=Number(state.onboardingStep||0);state.onboardingIntroCompleted=true;state.onboardingStep=(C.introSlides||[]).length;track('intro_skipped',{replay:false,step});save();render();}
  function advanceInitialIntro(){const slides=C.introSlides||[],step=Number(state.onboardingStep||0);if(step>=slides.length)return;if(step===slides.length-1){state.onboardingIntroCompleted=true;track('intro_completed',{replay:false});}state.onboardingStep=step+1;save();render();}

  function renderIntroReplay() {
    const slides=C.introSlides||[],step=Math.min(introReplayStep,slides.length-1),slide=slides[step];
    app.innerHTML=`<section class="onboarding intro-onboarding"><header class="onboard-header"><div class="brand">Как всё работает</div><button class="skip-link" data-replay-end="skip">Закрыть</button></header><div class="onboard-main"><div class="onboard-visual">${learningArtwork(slide.art)}</div><div class="dots" aria-label="Экран ${step+1} из ${slides.length}">${slides.map((_,i)=>`<i class="${i===step?'active':''}"></i>`).join('')}</div><h1>${esc(slide.title)}</h1><p>${esc(slide.text)}</p></div><button class="btn primary block" data-replay-next>${step===slides.length-1?'Вернуться в помощь':'Дальше'}</button></section>`;
    app.querySelector('[data-replay-end]').onclick=()=>finishIntroReplay(true);app.querySelector('[data-replay-next]').onclick=()=>{if(step===slides.length-1)finishIntroReplay(false);else{introReplayStep++;render();}};
  }
  function startIntroReplay(){introReplay=true;introReplayStep=0;track('intro_started',{replay:true});save();render();}
  function finishIntroReplay(skipped){track(skipped?'intro_skipped':'intro_completed',{replay:true,step:introReplayStep});save();introReplay=false;introReplayStep=0;route='help';render();}

  function activeTaskForAge(){return ageTaskList().find(t=>!state.completedTasks.includes(t.id))||null;}
  function savingsScreen(){
    const g=goalView(),saved=state.wallet.savings,amounts=[50,100,saved].filter((n,i,a)=>n>0&&n<=saved&&a.indexOf(n)===i),junior=isJunior(),remain=g?Math.max(0,goalTarget()-saved):null,pace=Math.max(50,savingsTempo()),weeks=g?weeksToGoal():null;
    if(junior)return `<section class="screen">${topbar('Копилка',true)}<div class="savings-visual">${learningArtwork('savings')}</div><div class="card savings-hero"><div class="muted">В копилке</div><div class="big-money">${fmt(saved)} ●</div>${g?`<h3>Копим на ${esc(g.name)}</h3><p>До ${esc(g.name)} осталось ${fmt(remain)} монет.</p><div class="bar green" style="height:10px;margin-top:16px"><i style="width:${progressPct()}%"></i></div><p class="subtle">Если откладывать примерно по ${fmt(pace)} монет, понадобится около ${weeks} нед.</p>`:'<p class="subtle">Пока не выбрали, на что копить. Это можно сделать позже.</p>'}</div><div class="section-title"><h2>Положить в копилку</h2></div><div class="save-controls">${[50,100,200].map(n=>`<button data-save="${n}">+${n}</button>`).join('')}</div><div class="save-custom"><input type="number" min="1" inputmode="numeric" placeholder="Другая сумма" id="saveAmount"><button class="btn primary" data-save-custom>Положить</button></div>${saved>0?`<div class="section-title"><h2>Взять из копилки</h2></div><div class="withdraw-options">${amounts.map(n=>`<button class="btn secondary" data-withdraw="${n}">${n===saved?'Всё':fmt(n)+' ●'}</button>`).join('')}</div>`:''}<p class="subtle">Перед тем как взять монеты, покажем, как изменится путь до покупки.</p></section>`;
    return `<section class="screen">${topbar('Копилка',true)}<div class="savings-visual">${learningArtwork('savings')}</div><div class="card savings-hero"><div class="big-money">${fmt(saved)}</div><div class="muted">монет отложено${g?` на «${esc(g.name)}»`:''}</div>${g?`<div class="bar green" style="height:10px;margin-top:16px"><i style="width:${progressPct()}%"></i></div><p class="subtle">${fmt(saved)} из ${fmt(goalTarget())} · ${progressPct()}% · ≈ ${weeksToGoal()} нед.</p>`:'<p class="subtle">Можно копить без выбранной цели и выбрать её позже.</p>'}</div><div class="section-title"><h2>Отложить монеты</h2></div><div class="save-controls">${[50,100,200].map(n=>`<button data-save="${n}">+${n}</button>`).join('')}</div><div class="save-custom"><input type="number" min="1" inputmode="numeric" placeholder="Другая сумма" id="saveAmount"><button class="btn primary" data-save-custom>Отложить</button></div>${saved>0?`<div class="section-title"><h2>Вернуть на баланс</h2></div><div class="withdraw-options">${amounts.map(n=>`<button class="btn secondary" data-withdraw="${n}">${n===saved?'Всю сумму':fmt(n)+' ●'}</button>`).join('')}</div>`:''}<p class="subtle">Перед возвратом приложение покажет новый остаток и примерный срок цели.</p></section>`;
  }
  function completedLearningTopics() {
    return C.tasks.filter(t=>state.completedTasks.includes(t.id)).map(t=>t.topic||t.learningOutcome||t.title).filter((x,i,a)=>a.indexOf(x)===i);
  }
  function taskTypeLabel(type){const easy={allocation:'Разложи монеты',subscriptions:'Найди лишнее',goal_slider:'Что изменится?',compare:'Сравни варианты',role:'Попробуй роль',safety:'Безопасность в интернете'};const medium={allocation:'Распредели бюджет',subscriptions:'Найди лишнее',goal_slider:'Что изменится?',compare:'Сравни предложения',role:'Смена роли',safety:'Безопасность в интернете'};return (isJunior()?easy:medium)[type]||(isJunior()?'Задача про деньги':'Финансовая ситуация');}

  function purchasePreview(id) {
    const item=C.items.find(x=>x.id===id);if(!item)return null;const enough=state.wallet.balance>=item.price,after=state.wallet.balance-item.price,delay=item.need?0:purchaseGoalDelay(item.price);return {item,enough,after,missing:Math.max(0,-after),delay,category:item.need?'Нужно':'Желание'};
  }
  function openPurchaseConfirmation(id){const p=purchasePreview(id);if(!p)return;if(demoMode&&!p.enough){state.demoSession=state.demoSession||{};state.demoSession.shortageWeeks=state.demoSession.shortageWeeks||[];if(!state.demoSession.shortageWeeks.includes(state.wallet.week))state.demoSession.shortageWeeks.push(state.wallet.week);}modal={type:'purchaseConfirm',itemId:id};track('purchase_confirmation_opened',{itemId:id,price:p.item.price,enough:p.enough});save();render();}
  function confirmPurchase(id){const p=purchasePreview(id);if(!p?.enough)return false;track('purchase_confirmation_confirmed',{itemId:id,price:p.item.price});save();modal=null;buyItem(id);return true;}

  function weeksForSavedAmount(saved) {const g=activeGoal();if(!g)return null;const remain=Math.max(0,goalTarget(g)-Math.max(0,saved));if(!remain)return 0;return Math.max(1,Math.ceil(remain/Math.max(50,savingsTempo())));}
  function withdrawalPreview(amount){const n=Math.min(Math.max(0,Number(amount)||0),state.wallet.savings),after=state.wallet.savings-n;return {amount:n,before:state.wallet.savings,after,remaining:activeGoal()?Math.max(0,goalTarget()-after):null,beforeWeeks:weeksForSavedAmount(state.wallet.savings),afterWeeks:weeksForSavedAmount(after)};}
  function openWithdrawalPreview(amount){const p=withdrawalPreview(amount);if(!p.amount)return;modal={type:'withdrawalPreview',amount:p.amount};track('savings_withdrawal_previewed',{amount:p.amount,goalId:state.activeGoal,beforeWeeks:p.beforeWeeks,afterWeeks:p.afterWeeks});save();render();}
  function confirmWithdrawal(amount){const p=withdrawalPreview(amount);if(!p.amount)return false;track('savings_withdrawal_confirmed',{amount:p.amount,goalId:state.activeGoal,beforeWeeks:p.beforeWeeks,afterWeeks:p.afterWeeks});save();modal=null;withdrawSaving(p.amount);return true;}
  function resetProfile(){if(demoMode){resetDemoMode();return;}if(window.FINPET_STORAGE?.remove)window.FINPET_STORAGE.remove(STORAGE_KEY);else localStorage.removeItem(STORAGE_KEY);state=freshState();adultUnlocked=false;introReplay=false;modal=null;route='onboarding';render();}

  function renderModal() {
    if(modal.type==='demoPeriodIntro'){
      const n=Math.max(1,Math.min(DEMO_PERIODS.length,Number(modal.period||state.wallet.week))),p=DEMO_PERIODS[n-1];
      return `<div class="overlay"><div class="sheet demo-period-sheet"><div class="sheet-handle"></div><div class="demo-modal-kicker">DEMO · неделя ${n} из ${DEMO_PERIODS.length}</div><h2>${esc(p.title)}</h2><p>${esc(p.lead)}</p><div class="demo-period-roadmap">${p.steps.map((s,i)=>`<div><span>${i+1}</span><b>${esc(s.label)}</b></div>`).join('')}</div><button class="btn primary block" data-close-modal>Начать неделю</button>${n>1?'<button class="demo-finish-link block-link" data-demo-exit>Завершить демо сейчас</button>':''}</div></div>`;
    }
    if(modal.type==='demoFinished'){
      const growth=state.pet.development-8;
      return `<div class="overlay"><div class="sheet demo-finished-sheet"><div class="sheet-handle"></div><div class="demo-modal-kicker">Демонстрация завершена</div><h2>5 недель пройдено</h2><p>Вы посмотрели план на неделю, нужные траты, хотелки, нехватку монет, копилку и рост питомца.</p><div class="demo-finish-metrics"><div><span>Недель</span><b>5 / 5</b></div><div><span>Развитие питомца</span><b>${growth>=0?'+':''}${growth}</b></div></div><button class="btn primary block" data-demo-exit>Завершить демо</button><button class="btn secondary block" data-demo-reset>Пройти заново</button></div></div>`;
    }
    if(modal.type==='criticalPetNeeds'){
      const needs=criticalPetNeeds();
      return `<div class="overlay"><div class="sheet critical-needs-sheet"><div class="sheet-handle"></div><div class="critical-needs-icon">♥</div><h2>Сначала помоги питомцу</h2><p>${needs.length>1?'Нужно исправить несколько вещей:':'Сейчас нужна помощь:'}</p><div class="critical-needs-list">${needs.map(x=>`<div><span>${x.id==='food'?'🥣':x.id==='mood'?'♥':'✦'}</span><b>${esc(x.problem)}</b><button class="btn secondary" data-emergency-care="${x.id}">${esc(x.action)} <small>Бесплатно</small></button></div>`).join('')}</div><p class="subtle">Когда питомцу станет лучше, можно продолжить день.</p><button class="linkbtn block" data-close-modal>Вернуться</button></div></div>`;
    }
    if(modal.type==='emergencyCareResult'){
      const still=criticalPetNeeds();
      return `<div class="overlay"><div class="sheet emergency-result-sheet"><div class="sheet-handle"></div><div class="eyebrow">Бесплатная помощь</div><h2>Стало лучше</h2><div class="feedback-change-list"><div><span>${esc(modal.label)}</span><b>${fmt(modal.before)} → ${fmt(modal.after)}</b></div><div><span>${moneyLabel()}</span><b>${fmt(state.wallet.balance)} ●</b></div></div><p>${modal.need==='food'?`${esc(state.pet.name)} поел. Сытость немного выросла.`:modal.need==='mood'?`${esc(state.pet.name)} стало веселее.`:`${esc(state.pet.name)} теперь немного лучше.`}</p>${still.length?`<div class="need-note">Ещё нужно помочь: ${still.map(x=>esc(x.label.toLowerCase())).join(', ')}.</div>`:''}<button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;
    }
    if(modal.type==='sectionSwitchConfirm'){const next=sectionById(modal.sectionId),current=sectionById();if(!next||!current)return '';return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Смена занятия</div><h2>Перейти на ${esc(next.name.toLowerCase())}?</h2><p>Сейчас питомец ходит на ${esc(current.name.toLowerCase())}. Уже оплаченная неделя не изменится.</p><div class="grid2"><button class="btn primary" data-section-switch-confirm="${next.id}">Перейти со следующей недели</button><button class="btn secondary" data-close-modal>Оставить ${esc(current.name)}</button></div></div></div>`;}
    if(modal.type==='sectionStopConfirm'){const current=sectionById();if(!current)return '';return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Занятие</div><h2>Больше не ходить на ${esc(current.name.toLowerCase())}?</h2><p>На следующих неделях ${fmt(current.price)} монет больше не понадобятся. Уже пройденные занятия и открытия сохранятся.</p><div class="grid2"><button class="btn primary" data-section-stop-confirm>Закончить</button><button class="btn secondary" data-close-modal>Оставить</button></div></div></div>`;}
    if(modal.type==='sectionShortage'){const current=sectionById(modal.sectionId);if(!current)return '';return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Занятие</div><h2>На ${esc(current.name.toLowerCase())} не хватает ${fmt(modal.missing)} монет</h2><p>Монеты из копилки сами не берутся. Можно сделать перерыв на эту неделю.</p><div class="stack"><button class="btn primary block" data-section-skip>Сделать перерыв</button><button class="btn secondary block" data-feedback-route="budget">Посмотреть монеты</button></div></div></div>`;}
    if(modal.type==='purchaseConfirm'){
      const p=purchasePreview(modal.itemId);if(!p)return '';
      const effect=itemEffectText(p.item)||(p.delay>0?`Цель примерно на ${p.delay} нед. дальше`:'Мир питомца изменится');
      const actions=p.enough?`<div class="grid2"><button class="btn primary" data-confirm-buy="${p.item.id}">Купить</button><button class="btn secondary" data-purchase-cancel>Не сейчас</button></div>`:`<div class="feedback-section shortage-feedback"><h3>Что изменилось</h3><p>Покупка не выполнена.</p></div><div class="feedback-section"><h3>Почему</h3><p>${isJunior()?`Не хватает ${fmt(p.missing)} монет. Монеты из копилки сами не берутся.`:`Не хватает ${fmt(p.missing)} монет. Накопления не снимаются автоматически.`}</p></div><div class="feedback-section"><h3>Что дальше</h3><div class="insufficient-actions"><button class="btn secondary" data-purchase-cancel>Вернуться</button><button class="btn secondary" data-modal-route="tasks">Открыть задания</button>${state.ageGroup==='15-17'?'<button class="btn secondary" data-modal-route="sidejob">Открыть подработку</button>':''}</div></div>`;
      return `<div class="overlay" data-close-overlay><div class="sheet confirmation-sheet" data-sheet><div class="sheet-handle"></div><div class="confirmation-art ${p.item.category==='Еда'?'confirmation-food-art':''}">${shopItemIllustration(p.item)}</div><div class="eyebrow">${p.category}</div><h2>${esc(p.item.name)}</h2><div class="confirmation-facts"><div><span>Цена</span><b>${fmt(p.item.price)} ●</b></div><div><span>${isJunior()?'После покупки':'Баланс после'}</span><b>${p.enough?fmt(p.after)+' ●':'Не хватает '+fmt(p.missing)+' ●'}</b></div><div><span>${isJunior()?'Что изменится':'Влияние'}</span><b>${esc(effect)}</b></div></div>${actions}</div></div>`;
    }
    if(modal.type==='withdrawalPreview'){
      const p=withdrawalPreview(modal.amount),g=goalView();
      if(isJunior())return `<div class="overlay" data-close-overlay><div class="sheet confirmation-sheet" data-sheet><div class="sheet-handle"></div><div class="preview-illustration">${learningArtwork('savings')}</div><div class="eyebrow">Копилка</div><h2>Хочешь взять ${fmt(p.amount)} монет?</h2><div class="confirmation-facts four"><div><span>В копилке</span><b>${fmt(p.before)} → ${fmt(p.after)}</b></div><div><span>${g?`До ${esc(g.name)} останется`:'До покупки'}</span><b>${p.remaining==null?'Сначала выбери, на что копить':fmt(p.remaining)+' ●'}</b></div><div><span>Было</span><b>${p.beforeWeeks==null?'—':`≈ ${p.beforeWeeks} нед.`}</b></div><div><span>Станет</span><b>${p.afterWeeks==null?'—':`≈ ${p.afterWeeks} нед.`}</b></div></div><div class="grid2"><button class="btn primary" data-confirm-withdraw="${p.amount}">Взять ${fmt(p.amount)}</button><button class="btn secondary" data-withdraw-cancel>Оставить</button></div></div></div>`;
      return `<div class="overlay" data-close-overlay><div class="sheet confirmation-sheet" data-sheet><div class="sheet-handle"></div><div class="preview-illustration">${learningArtwork('savings')}</div><div class="eyebrow">До операции</div><h2>Вернуть ${fmt(p.amount)} монет?</h2><div class="confirmation-facts four"><div><span>В копилке</span><b>${fmt(p.before)} → ${fmt(p.after)}</b></div><div><span>До цели останется</span><b>${p.remaining==null?'Цель не выбрана':fmt(p.remaining)+' ●'}</b></div><div><span>Срок был</span><b>${p.beforeWeeks==null?'—':`≈ ${p.beforeWeeks} нед.`}</b></div><div><span>Срок станет</span><b>${p.afterWeeks==null?'—':`≈ ${p.afterWeeks} нед.`}</b></div></div><div class="grid2"><button class="btn primary" data-confirm-withdraw="${p.amount}">Вернуть на баланс</button><button class="btn secondary" data-withdraw-cancel>Оставить в копилке</button></div></div></div>`;
    }
    if(modal.type==='resetConfirm')return `<div class="overlay" data-close-overlay><div class="sheet" data-sheet><div class="sheet-handle"></div><div class="eyebrow">Подтверждение</div><h2>Удалить локальный профиль?</h2><p>Будут удалены баланс, копилка, цели, покупки, прогресс, задания и история недель на этом устройстве.</p><div class="grid2"><button class="btn danger-button" data-confirm-reset>Удалить</button><button class="btn secondary" data-close-modal>Отмена</button></div></div></div>`;
    if(modal.type==='event'){const e=C.events.find(x=>x.id===modal.id);if(!e)return '';const eventArt=eventGeneratedIllustration(e);return `<div class="overlay" data-close-overlay><div class="sheet" data-sheet><div class="sheet-handle"></div><div class="eyebrow">${e.categoryLabel||'Событие'}</div><h2>${e.title}</h2>${eventArt?`<div class="event-generated-art">${eventArt}</div>`:''}<p>${e.situation||e.text}</p><div class="stack">${e.choices.map((c,i)=>`<button class="choice event-choice" data-event-choice="${i}"><b>${c.text}</b>${choicePreview(c,e)}</button>`).join('')}</div></div></div>`;}
    if(modal.type==='eventResult')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><h2>${modal.title||(isJunior()?'Что получилось':'Последствие')}</h2><div class="feedback-section"><h3>Что изменилось</h3>${modal.feedback?feedbackHtml(modal.feedback):'<p>Решение сохранено.</p>'}</div><div class="feedback-section"><h3>Почему</h3><p>${esc(modal.result||(isJunior()?'Это произошло после твоего выбора.':'Это последствие выбранного решения.'))}</p></div><div class="feedback-section"><h3>Что дальше</h3><button class="btn primary block" data-close-modal>Продолжить</button></div></div></div>`;
    if(modal.type==='delayedImpact'){const total=modal.charges.reduce((s,c)=>s+(c.paid||0),0);return `<div class="overlay"><div class="sheet delayed-sheet"><div class="sheet-handle"></div><div class="eyebrow">Произошло автоматически</div><h2>−${fmt(total)} монет</h2><div class="delayed-list">${modal.charges.map(c=>`<div><span>${esc(c.description)}</span><b>−${fmt(c.paid||0)}</b></div>`).join('')}</div><p class="subtle">${isJunior()?'Это случилось из-за выбора в прошлой неделе.':'Это последствие решения из прошлых игровых дней или недель.'}</p><button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;}
    if(modal.type==='goalUnlocked')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">${isJunior()?'Мы накопили!':'Большая цель'}</div><h2>${esc(modal.title)}</h2><div class="unlock-visual">${modal.goalId?goalIllustration(C.goals.find(x=>x.id===modal.goalId)):(modal.icon||'✦')}</div><div class="feedback-section"><h3>Что изменилось</h3><div class="feedback-change-list">${(modal.changes||[]).map(x=>`<div><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')}</div></div><div class="feedback-section"><h3>Почему</h3><p>${esc(modal.reason||modal.message)}</p></div><div class="feedback-section"><h3>Что дальше</h3><p>${esc(modal.message)}</p><button class="btn primary block" data-close-modal>Посмотреть мир</button></div></div></div>`;
    if(modal.type==='financialFeedback')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><h2>${esc(modal.title)}</h2>${financialFeedbackHtml(modal)}</div></div>`;
    if(modal.type==='saveFirst'){const n=Math.min(modal.amount||200,state.wallet.balance);return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><div class="eyebrow">Перед неделей</div><h2>${state.ageGroup==='7-11'?'Сразу положить в копилку?':'Отложить сначала?'}</h2><p>${isJunior()?'Не обязательно. Можно оставить монеты и решить позже.':'Это не обязательно. Можно оставить деньги свободными и решить позже.'}</p><div class="grid2"><button class="btn good" data-save="${n}">${isJunior()?'Положить':'Отложить'} ${fmt(n)}</button><button class="btn secondary" data-close-modal>Не сейчас</button></div></div></div>`;}
    if(modal.type==='workComplete')return `<div class="overlay"><div class="sheet work-complete-sheet"><div class="sheet-handle"></div><div class="eyebrow">Смена завершена</div><h2>+${fmt(modal.reward)} монет</h2><div class="feedback-grid"><div><span>Энергия</span><b>−${fmt(modal.energyCost)}</b></div><div><span>Баланс</span><b>${fmt(modal.balance)} ●</b></div><div><span>Осталось энергии</span><b>${Math.round(modal.energy)}⚡</b></div></div><p class="subtle">Деньги уже в обычном кошельке. Дальше решаешь сам: потратить, оставить или отложить.</p><button class="btn primary block" data-close-modal>Продолжить</button></div></div>`;
    if(modal.type==='dayConfirm')return `<div class="overlay"><div class="sheet"><div class="sheet-handle"></div><h2>Завершить день?</h2><p>${isJunior()?'Можно ничего не покупать. Просто пройдёт ещё один игровой день.':'Можно ничего не покупать. Потребности немного изменятся просто потому, что игровой день прошёл.'}</p><div class="grid2"><button class="btn primary" data-confirm-day>Завершить</button><button class="btn secondary" data-close-modal>Вернуться</button></div></div></div>`;
    return '';
  }

  function cancelTrackedModal() {
    if(modal?.type==='purchaseConfirm')track('purchase_confirmation_cancelled',{itemId:modal.itemId});
    if(modal?.type==='withdrawalPreview')track('savings_withdrawal_cancelled',{amount:modal.amount,goalId:state.activeGoal});
    save();modal=null;render();
  }

  function bindCommon() {
    document.querySelectorAll('[data-emergency-care]').forEach(b=>b.onclick=()=>emergencyPetCare(b.dataset.emergencyCare));
    document.querySelectorAll('[data-section-select]').forEach(b=>b.onclick=()=>selectSection(b.dataset.sectionSelect));
    document.querySelectorAll('[data-section-pay]').forEach(b=>b.onclick=paySectionWeek);
    document.querySelectorAll('[data-section-skip]').forEach(b=>b.onclick=()=>{modal=null;skipSectionWeek();});
    document.querySelectorAll('[data-section-choice-skip]').forEach(b=>b.onclick=skipSectionChoice);
    document.querySelectorAll('[data-section-switch-confirm]').forEach(b=>b.onclick=()=>confirmSectionSwitch(b.dataset.sectionSwitchConfirm));
    document.querySelectorAll('[data-section-stop]').forEach(b=>b.onclick=requestSectionStop);
    document.querySelectorAll('[data-section-stop-confirm]').forEach(b=>b.onclick=confirmSectionStop);
    document.querySelectorAll('[data-section-change]').forEach(b=>b.onclick=()=>{document.querySelector('.section-picker')?.scrollIntoView?.({behavior:'smooth',block:'start'});});
    document.querySelectorAll('[data-demo-start]').forEach(b=>b.onclick=startDemoMode);
    document.querySelectorAll('[data-demo-reset]').forEach(b=>b.onclick=resetDemoMode);
    document.querySelectorAll('[data-demo-exit]').forEach(b=>b.onclick=exitDemoMode);
    document.querySelectorAll('[data-demo-complete]').forEach(b=>b.onclick=demoCompletePeriod);
    document.querySelectorAll('[data-demo-guide-route]').forEach(b=>b.onclick=()=>{route=b.dataset.demoGuideRoute||'home';render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-demo-direct]').forEach(b=>b.onclick=()=>quickAction(b.dataset.demoDirect));
    document.querySelectorAll('[data-demo-save]').forEach(b=>b.onclick=()=>saveAmount(Number(b.dataset.demoSave)||100));
    document.querySelectorAll('[data-demo-shortage]').forEach(b=>b.onclick=()=>{const candidate=[...C.items].sort((a,b)=>b.price-a.price).find(x=>x.price>state.wallet.balance)||C.items.find(x=>x.id==='special_console');if(candidate)openPurchaseConfirmation(candidate.id);});
    document.querySelectorAll('[data-feedback-route]').forEach(b=>b.onclick=()=>{const target=b.dataset.feedbackRoute;modal=null;route=target||'home';render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>{route=b.dataset.route;taskResult=null;if(route==='sidejob')track('side_job_opened',{source:'navigation'});if(route!=='weekStart')editingPlan=false;render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>{route=route==='help'?(helpReturnRoute||'profile'):['adult','adultGate'].includes(route)?'profile':(route==='shop'||route==='task'||route==='pet'||route==='sidejob')?'home':route==='savings'?'budget':'profile';taskResult=null;render();});
    document.querySelectorAll('[data-help]').forEach(b=>b.onclick=()=>{helpReturnRoute=route;state.helpLastTopic=null;route='help';track('help_opened',{source:helpReturnRoute});save();render();window.scrollTo(0,0);});
    document.querySelectorAll('[data-help-topic]').forEach(b=>b.onclick=()=>{state.helpLastTopic=b.dataset.helpTopic;track('help_topic_opened',{topicId:state.helpLastTopic});save();render();window.scrollTo(0,0);});document.querySelectorAll('[data-help-list]').forEach(b=>b.onclick=()=>{state.helpLastTopic=null;save();render();});document.querySelectorAll('[data-replay-intro]').forEach(b=>b.onclick=startIntroReplay);
    document.querySelectorAll('[data-open-task]').forEach(b=>b.onclick=()=>{taskScreen.id=b.dataset.openTask;route='task';taskResult=null;render();window.scrollTo(0,0);});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>quickAction(b.dataset.action));document.querySelectorAll('[data-shop-cat]').forEach(b=>b.onclick=()=>{shopScreen.cat=b.dataset.shopCat;render();});document.querySelectorAll('[data-shop-open]').forEach(b=>b.onclick=()=>{shopScreen.cat=b.dataset.shopOpen;route='shop';render();window.scrollTo(0,0);});document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>openPurchaseConfirmation(b.dataset.buy));
    document.querySelectorAll('[data-confirm-buy]').forEach(b=>b.onclick=()=>confirmPurchase(b.dataset.confirmBuy));document.querySelectorAll('[data-purchase-cancel],[data-withdraw-cancel]').forEach(b=>b.onclick=cancelTrackedModal);document.querySelectorAll('[data-modal-route]').forEach(b=>b.onclick=()=>{const target=b.dataset.modalRoute;if(modal?.type==='purchaseConfirm')track('purchase_confirmation_cancelled',{itemId:modal.itemId,next:target});save();modal=null;route=target;if(target==='sidejob')track('side_job_opened',{source:'purchase_shortage'});render();});
    document.querySelectorAll('[data-task-choice]').forEach(b=>b.onclick=()=>chooseTask(Number(b.dataset.taskChoice)));document.querySelectorAll('[data-finish-task]').forEach(b=>b.onclick=finishTask);document.querySelectorAll('[data-task-allocate]').forEach(b=>b.onclick=resolveAllocationTask);document.querySelectorAll('[data-task-slider]').forEach(b=>b.onclick=resolveSliderTask);document.querySelectorAll('[data-task-subscriptions]').forEach(b=>b.onclick=resolveSubscriptionsTask);
    document.querySelectorAll('[data-savings]').forEach(b=>b.onclick=()=>{modal=null;route='savings';render();window.scrollTo(0,0);});document.querySelectorAll('[data-goal]').forEach(b=>b.onclick=()=>selectGoal(b.dataset.goal));document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>openEvent(b.dataset.event));document.querySelectorAll('[data-event-choice]').forEach(b=>b.onclick=()=>resolveEvent(Number(b.dataset.eventChoice)));
    document.querySelectorAll('[data-close-overlay]').forEach(x=>x.onclick=e=>{if(e.target===x)cancelTrackedModal();});document.querySelectorAll('[data-sheet]').forEach(x=>x.onclick=e=>e.stopPropagation());document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=()=>{modal=null;render();});
    document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>saveAmount(Number(b.dataset.save)));document.querySelectorAll('[data-save-custom]').forEach(b=>b.onclick=()=>{const n=Number(document.querySelector('#saveAmount')?.value||0);if(n>0)saveAmount(n);});document.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=()=>openWithdrawalPreview(Number(b.dataset.withdraw)));document.querySelectorAll('[data-confirm-withdraw]').forEach(b=>b.onclick=()=>confirmWithdrawal(Number(b.dataset.confirmWithdraw)));
    document.querySelectorAll('[data-new-day]').forEach(b=>b.onclick=requestNewDay);document.querySelectorAll('[data-confirm-day]').forEach(b=>b.onclick=()=>{modal=null;advanceDay();});document.querySelectorAll('[data-next-week]').forEach(b=>b.onclick=startNextWeek);document.querySelectorAll('[data-save-plan]').forEach(b=>b.onclick=saveWeekPlan);document.querySelectorAll('[data-edit-plan]').forEach(b=>b.onclick=()=>{editingPlan=true;route='weekStart';render();window.scrollTo(0,0);});document.querySelectorAll('[data-dismiss-wish]').forEach(b=>b.onclick=dismissWish);document.querySelectorAll('[data-wish-buy]').forEach(b=>b.onclick=()=>{shopScreen.cat=C.items.find(i=>i.id===b.dataset.wishBuy)?.category||'Игры';route='shop';render();});
    document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.toggle;state.settings[k]=!state.settings[k];if(k==='motion'){track(state.settings.motion?'motion_enabled':'motion_disabled',{difficultyMode:state.difficultyMode});syncMotionPreference();}save();render();});document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>{modal={type:'resetConfirm'};render();});document.querySelectorAll('[data-confirm-reset]').forEach(b=>b.onclick=resetProfile);
    document.querySelectorAll('[data-world-area]').forEach(b=>b.onclick=()=>{if(state.worldProgress.areas.includes(b.dataset.worldArea)){state.currentWorldArea=b.dataset.worldArea;save();render();}});document.querySelectorAll('[data-work-start]').forEach(b=>b.onclick=()=>startWorkActivity(b.dataset.workStart));document.querySelectorAll('[data-work-bin]').forEach(b=>b.onclick=()=>resolveWorkBin(b.dataset.workBin));document.querySelectorAll('[data-work-cancel]').forEach(b=>b.onclick=cancelWorkActivity);
    document.querySelectorAll('[data-jar-delta]').forEach(b=>b.onclick=()=>{const id=b.dataset.jarTarget,input=document.getElementById(id);if(!input)return;const delta=Number(b.dataset.jarDelta||0),budget=Number(document.getElementById('planTotal')?.dataset.budget||planningBudget());const current=Math.max(0,Number(input.value||0));input.value=Math.max(0,Math.min(budget,current+delta));renderJarValues();updatePlanTotal();});const planInputs=['planNecessary','planWants','planSavings','planReserve'].map(id=>document.getElementById(id)).filter(Boolean);planInputs.forEach(x=>x.addEventListener('input',updatePlanTotal));const slider=document.getElementById('goalSlider');if(slider)slider.oninput=()=>{document.getElementById('sliderValue').textContent=slider.value;document.getElementById('sliderWeeks').textContent=`${Math.ceil(1200/Number(slider.value))} недель`;};
  }
  let parentPuzzleState = null;
  let parentGateMessage = '';

  function difficultyLabel(mode=state.difficultyMode){ if(demoMode)return 'Демо'; return mode==='medium'?'Средний':'Лёгкий'; }
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
    try { window.FINPET_ANALYTICS?.event?.(name, props); } catch (e) {}
    if(name==='income_received'&&props.amount) showMotionFeedback('+'+fmt(props.amount),'income');
    else if(name==='expense_completed'&&props.amount) showMotionFeedback('−'+fmt(props.amount),'expense');
    else if(name==='savings_deposit'&&props.amount) showMotionFeedback('+'+fmt(props.amount)+' в копилку','saving');
    else if(name==='goal_completed') showMotionFeedback(isJunior()?'Накопили!':'Цель достигнута','goal');
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
    const demoStepClass=demoMode?` demo-step-${demoGuideState().current.id}`:'';
    app.innerHTML=`<main class="app-shell ${ageModeClass()} ${demoMode?'demo-mode':''}${demoStepClass}">${renderScreen()}${renderNav()}</main>${modal?renderModal():''}`;
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
      const selected=state.onboardingModeChoice||state.difficultyMode;
      const modes=[
        ['easy','Лёгкий','Меньше текста, проще ситуации и больше подсказок.'],
        ['medium','Средний','Больше самостоятельных решений и сложнее финансовые ситуации.'],
        ['demo','Демо','5 коротких сценариев: приложение само ведёт по ключевым механикам.']
      ];
      app.innerHTML=`<section class="onboarding difficulty-onboarding"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main age-select-main"><div><div class="eyebrow">Шаг 1 из 2</div><h1>Как будем играть?</h1><p>Выбери обычный режим или быстрый сценарий знакомства.</p></div><div class="age-grid difficulty-grid difficulty-grid-three">${modes.map(m=>`<button class="select-card mode-card mode-${m[0]} ${selected===m[0]?'active':''}" data-difficulty="${m[0]}"><h3>${m[1]}</h3><p>${m[2]}</p></button>`).join('')}</div></div><button class="btn primary block" data-difficulty-next ${!selected?'disabled':''}>Создать питомца</button></section>`;
      app.querySelectorAll('[data-difficulty]').forEach(b=>b.onclick=()=>{
        const mode=b.dataset.difficulty;
        state.onboardingModeChoice=mode;
        if(mode==='demo'){
          state.difficultyMode='easy';syncModeCompatibility(state);state.ageMigrationPending=false;state.currentChainId=null;state.currentEventId=selectEventId(state,true);track('demo_mode_selected',{source:'onboarding'});save();
        }else setDifficulty(mode,{initial:true});
        render();
      });
      app.querySelector('[data-difficulty-next]').onclick=()=>{state.onboardingStep=slides.length+1;save();render();};return;
    }
    const isDemoChoice=state.onboardingModeChoice==='demo';
    app.innerHTML=`<section class="onboarding pet-create"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main pet-create-main"><div><div class="eyebrow">Шаг 2 из 2${isDemoChoice?' · Демо':''}</div><h1>Создай друга</h1><p>${isDemoChoice?'Выбери питомца — он будет сопровождать быстрый демонстрационный сценарий.':'Выбери питомца, цвет и аксессуар.'}</p></div><div class="pet-grid">${C.pets.map(p=>`<button class="select-card pet-pick ${state.pet.type===p.id?'active':''}" data-pet="${p.id}">${petSVG(p.id,state.pet.color,state.pet.accessory)}<div><h3>${p.name}</h3><p>${p.desc}</p></div></button>`).join('')}</div><div class="field"><label for="petName">Имя питомца</label><input id="petName" maxlength="14" value="${esc(state.pet.name)}"></div><div class="field"><label>Основной цвет</label><div class="color-row">${C.petColors.map(c=>`<button class="color-dot ${state.pet.color===c?'active':''}" style="background:${c}" data-color="${c}" aria-label="Выбрать цвет ${c}"></button>`).join('')}</div></div><div class="field accessory-field"><label for="accessory">Аксессуар</label><select id="accessory">${C.accessories.map(a=>`<option value="${a.id}" ${state.pet.accessory===a.id?'selected':''}>${a.name}</option>`).join('')}</select></div></div><div class="onboard-actions"><button class="btn primary block" data-start>${isDemoChoice?'Начать демо':'Получить 1000 монет'}</button></div></section>`;
    const rememberName=()=>{const input=app.querySelector('#petName');if(input)state.pet.name=(input.value||'Финни').slice(0,14);};
    app.querySelectorAll('[data-pet]').forEach(b=>b.onclick=()=>{rememberName();state.pet.type=b.dataset.pet;save();render();});app.querySelectorAll('[data-color]').forEach(b=>b.onclick=e=>{e.preventDefault();rememberName();state.pet.color=b.dataset.color;save();render();});
    app.querySelector('#accessory').onchange=e=>{rememberName();state.pet.accessory=e.target.value;track('accessory_selected',{accessory:e.target.value,petType:state.pet.type});save();render();};app.querySelector('#petName').oninput=e=>{state.pet.name=e.target.value;save();};
    app.querySelector('[data-start]').onclick=()=>{rememberName();state.pet.name=(state.pet.name||'Финни').trim().slice(0,14)||'Финни';if(state.onboardingModeChoice==='demo'){const selectedPet={...state.pet};track('pet_created',{type:selectedPet.type,difficultyMode:'demo',accessory:selectedPet.accessory});save();startDemoMode({pet:selectedPet,fromOnboarding:true});return;}if(!state.difficultyMode)setDifficulty('easy',{initial:true});state.onboardingDone=true;state.onboardingIntroCompleted=true;state.onboardingStep=slides.length+2;tx('income',1000,'Доход','Стартовый недельный бюджет','onboarding');state.currentEventId=selectEventId(state,true);state.weekNeedsPlanning=true;track('pet_created',{type:state.pet.type,difficultyMode:state.difficultyMode,accessory:state.pet.accessory});track('week_started',{week:1,income:1000});save();route='weekStart';render();};
  }

  function renderAgeMigration(){
    app.innerHTML=`<section class="onboarding migration-screen"><header class="onboard-header"><div class="brand">КопиХвост</div></header><div class="onboard-main"><div class="onboard-visual compact-art">${learningArtwork('help')}</div><div><div class="eyebrow">Режим игры</div><h1>Выбери сложность</h1><p>Монеты, покупки, цели и весь прогресс сохранятся.</p></div><div class="age-grid difficulty-grid"><button class="select-card" data-migrated-difficulty="easy"><h3>Лёгкий</h3><p>Проще ситуации и больше подсказок.</p></button><button class="select-card" data-migrated-difficulty="medium"><h3>Средний</h3><p>Больше самостоятельных решений.</p></button></div></div></section>`;
    app.querySelectorAll('[data-migrated-difficulty]').forEach(b=>b.onclick=()=>{setDifficulty(b.dataset.migratedDifficulty);state.ageMigrationPending=false;state.currentEventId=selectEventId(state,true);save();render();});
  }

  function homeScreen(){
    const g=goalView(),baseGoal=activeGoal(),event=currentEvent(),h=healthText(),task=activeTaskForAge(),easy=state.difficultyMode==='easy',medium=state.difficultyMode==='medium';
    return `<section class="screen home-screen">${topbar('Дом')}${worldSceneHtml()}<div class="pet-status-line"><b>${petStage()}</b><span>${petWellbeing()>=70?'в хорошем состоянии':petWellbeing()>=50?'в норме':'нужно немного внимания'}</span></div><div class="stat-row">${miniStat(easy?'Сыт':'Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,'☻')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat('Здоровье',state.pet.health,'✦')}</div>
      ${lowPetNeedsHtml()}<div class="money-strip home-money"><div><span>${easy?'Монеты':'Баланс'}</span><b>${fmt(state.wallet.balance)} ●</b></div><button data-savings><span>В копилке</span><b>${fmt(state.wallet.savings)} ●</b></button><div><span>${easy?'До новых монет':'До дохода'}</span><b>${state.wallet.nextIncomeIn} дн.</b></div><div><span>${easy?'Хватит?':'Состояние'}</span><b>${h[0]}</b></div></div>
      ${g?`<div class="section-title compact-title"><h2>${easy?'Коплю на':'Текущая цель'}</h2><button data-route="goals">Открыть</button></div><div class="card goal-card compact-card"><div class="goal-icon">${illustration(g.icon,g.name||g.label||g.id)}</div><div><h3>${esc(g.name)}</h3><p>${fmt(goalSaved())} из ${fmt(goalTarget(baseGoal))} · ≈ ${weeksToGoal()} нед.</p><div class="bar green"><i style="width:${progressPct()}%"></i></div></div><div class="goal-progress">${progressPct()}%</div></div>`:`<div class="section-title compact-title"><h2>${easy?'На что будем копить?':'Текущая цель'}</h2></div><button class="btn secondary block" data-route="goals">${easy?'Выбрать, на что копить':'Выбрать цель'}</button>`}
      ${sectionHomeCard()}
      <div class="section-title compact-title"><h2>${easy?'Задание':'Активное задание'}</h2><button data-route="tasks">Все</button></div>${task?`<div class="active-task-card"><div class="active-task-art">${learningArtwork(task.cyberSafety?'help':'needs')}</div><div><span>${taskTypeLabel(task.mechanicType)}</span><h3>${esc(task.title)}</h3><p>${easy?'Получишь':'Награда'} +${fmt(task.reward)} ●</p></div><button class="btn secondary" data-open-task="${task.id}">Начать</button></div>`:`<div class="empty-state small-empty">${learningArtwork('savings')}<div><b>Все доступные задания выполнены</b><button class="linkbtn" data-route="tasks">Открыть список</button></div></div>`}
      <div class="section-title compact-title"><h2>${easy?'Что случилось':'Текущая ситуация'}</h2><span class="soft-label">${event?.categoryLabel||'событие'}</span></div>${eventTeaser()}
      ${emergencyCareButtonsHtml()}<div class="section-title"><h2>Что сделать?</h2></div><div class="quick-actions"><button class="action" data-shop-open="Еда"><span class="ico food-action-icon">${shopItemIllustration(C.items.find(x=>x.id==='food_basic'))}</span><b>Покормить</b><small>выбрать еду</small></button><button class="action" data-action="play"><span class="ico">${illustration('⚽')}</span><b>Поиграть</b><small>80 ●</small></button><button class="action" data-action="care"><span class="ico">${illustration('🫧')}</span><b>Здоровье</b><small>60 ●</small></button><button class="action" data-route="shop"><span class="ico">${illustration('','shop')}</span><b>Магазин</b><small>выбрать</small></button></div>${medium?`<button class="work-entry" data-route="sidejob"><span class="work-entry-icon">${illustration('◇')}</span><span><b>${state.workSession?'Продолжить смену':'Подработка'}</b><small>${workShiftStatusShort()} · дополнительный доход</small></span><span aria-hidden="true">›</span></button>`:''}${wishHtml()}${worldProgressCard()}${criticalPetNeeds().length?'<p class="end-day-critical-note">Перед новым днём нужно помочь питомцу</p>':''}<button class="btn primary block end-day ${criticalPetNeeds().length?'needs-care':''}" data-new-day>Завершить день ${state.wallet.day}</button></section>`;
  }

  function petScreen(){
    return `<section class="screen">${topbar(state.pet.name,true)}${worldSceneHtml()}${lowPetNeedsHtml()}<div class="section-title"><h2>Как себя чувствует</h2></div><div class="stat-row">${miniStat('Сытость',state.pet.satiety,'🥣')}${miniStat('Настроение',state.pet.mood,'☻')}${miniStat('Энергия',state.pet.energy,'⚡')}${miniStat('Здоровье',state.pet.health,'✦')}</div><div class="section-title"><h2>Забота о здоровье</h2></div>${emergencyCareButtonsHtml()}<div class="grid2"><button class="btn secondary" data-shop-open="Еда">Выбрать еду</button><button class="btn secondary" data-action="care">Здоровье · 60</button><button class="btn secondary" data-action="play">Поиграть · 80</button><button class="btn secondary" data-route="shop">Магазин</button></div><div class="section-title"><h2>Что появилось в мире</h2></div><div class="inventory-strip">${state.inventory.slice().reverse().map(x=>C.items.find(i=>i.id===x.id)).filter(i=>i&&isPersistentShopItem(i)).slice(0,16).length?state.inventory.slice().reverse().map(x=>C.items.find(i=>i.id===x.id)).filter(i=>i&&isPersistentShopItem(i)).slice(0,16).map(i=>`<div class="inventory-chip">${illustration(i.icon,i.name||i.label||i.id)}<span>${i.name}</span></div>`).join(''):`<div class="need-note">Здесь появятся вещи, которые остаются у питомца: игрушки, одежда и предметы комнаты.</div>`}</div></section>`;
  }

  function budgetScreen(){
    state.stats.budgetViews++;recalculateHealth();checkAchievements();save();const reserve=needsReserve(),free=freeMoney(),h=healthText(),plan=planForWeek(),actual=actualsForWeek();
    if(state.difficultyMode==='easy') return `<section class="screen">${topbar('Мои монеты')}<div class="junior-budget"><div class="junior-money-card"><span>Монет осталось</span><b>${fmt(state.wallet.balance)} ●</b></div><div class="junior-money-card"><span>В копилке</span><b>${fmt(state.wallet.savings)} ●</b></div><div class="junior-money-card"><span>На важное ещё</span><b>≈ ${fmt(reserve)} ●</b></div><div class="junior-money-card"><span>До следующей недели</span><b>${state.wallet.nextIncomeIn} дн.</b></div></div><div class="card junior-health"><b>${h[0]}</b><p>${h[1]}</p></div><div class="section-title"><h2>Мой план на неделю</h2><span class="soft-label">План сохранён</span></div>${juniorPlanTrackerHtml(plan,actual)}<div class="section-title"><h2>Что происходило</h2></div><div class="card history">${historyHtml()}</div></section>`;
    const obligations=(state.futureObligations||[]).filter(o=>o.dueWeek<=state.wallet.week+2).sort((a,b)=>a.dueWeek-b.dueWeek||a.dueDay-b.dueDay);
    return `<section class="screen">${topbar('Мой бюджет')}<div class="metric-grid"><div class="metric"><div class="label">Баланс</div><div class="value">${fmt(state.wallet.balance)}</div></div><div class="metric"><div class="label">До дохода</div><div class="value">${state.wallet.nextIncomeIn} дн.</div></div><div class="metric"><div class="label">Нужно предусмотреть</div><div class="value money-orange">${fmt(reserve)}</div></div><div class="metric"><div class="label">Свободно сейчас</div><div class="value money-green">${fmt(free)}</div></div></div><div class="section-title"><h2>Состояние бюджета</h2></div><div class="card health-card"><div class="health-dot ${state.financialHealth>=62?'stable':state.financialHealth>=45?'caution':'risk'}"></div><div><h3>${h[0]}</h3><p>${h[1]}</p></div></div>${obligations.length?`<div class="section-title"><h2>Будущие списания</h2></div><div class="card obligation-list">${obligations.slice(0,5).map(o=>`<div><span>${esc(o.description)}</span><b>−${fmt(o.amount)} · нед. ${o.dueWeek}</b></div>`).join('')}</div>`:''}<div class="section-title"><h2>План → факт</h2><span class="soft-label">${isJunior()?'План готов':'План подтверждён'}</span></div>${plan?planFactHtml(plan,actual):'<div class="need-note">У этой недели ещё нет плана.</div>'}<div class="section-title"><h2>Копилка</h2><button data-savings>Открыть</button></div><div class="card"><div class="goal-card"><div class="goal-icon">${illustration('🪙')}</div><div><h3>${fmt(state.wallet.savings)} монет</h3><p>${goalView()?`Для цели «${esc(goalView().name)}» · ≈ ${weeksToGoal()} нед.`:'Можно выбрать цель позже'}</p></div></div></div><div class="section-title"><h2>История</h2></div><div class="card history">${historyHtml()}</div></section>`;
  }

  function profileScreen(){
    const ws=worldStageData();return `<section class="screen">${topbar('Профиль')}<div class="card profile-row"><div class="avatar">${petSVG()}</div><div><h3>${esc(state.pet.name)}</h3><p class="subtle">${difficultyLabel()} режим · ${petStage()}</p></div></div><div class="card macro-card"><div class="eyebrow">Мир</div><h3>Этап ${ws.id} · ${ws.title}</h3><p>${ws.note}</p><div class="world-badges">${state.worldProgress.areas.map(a=>`<span>${C.world.areas.find(x=>x.id===a)?.name||a}</span>`).join('')}</div></div><div class="menu">${syncSectionUnlock(false)?'<button data-route="activities">Занятие <span>›</span></button>':''}<button data-route="progress">${isJunior()?'Как всё меняется':'Прогресс мира'} <span>›</span></button><button data-route="achievements">Достижения <span>${state.achievements.length}/${C.achievements.length} ›</span></button><button data-help>Как всё работает <span>›</span></button><button data-route="adultGate">Для взрослых <span>›</span></button><button data-route="settings">Настройки <span>›</span></button></div></section>`;
  }

  function helpScreen(){
    const topics=(C.helpTopics||[]).filter(t=>modeIncludes(t.ages)).filter(t=>t.id!=='regular-spending'||totalSectionPaidWeeks()>=2);const selected=topics.find(t=>t.id===state.helpLastTopic);
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
    const g=goalView(),topics=completedLearningTopics(),world=worldStageData();return `<section class="screen adult-screen">${topbar('Для взрослых',true)}<div class="adult-summary"><div>${learningArtwork('adult')}</div><div><div class="eyebrow">Цель приложения</div><h2>Учиться принимать финансовые решения без оценки ребёнка</h2><p>Питомец, недели и цели показывают последствия выбора в безопасной игровой среде.</p></div></div><div class="adult-metrics"><div><span>Режим игры</span><b>${difficultyLabel()}</b></div><div><span>Завершено недель</span><b>${state.weekHistory.length}</b></div><div><span>Выполнено заданий</span><b>${state.completedTasks.length}</b></div><div><span>Мир</span><b>Этап ${world.id}</b></div></div><div class="section-title"><h2>Текущая цель</h2></div><div class="adult-goal"><b>${g?esc(g.name):'Пока не выбрана'}</b><span>${g?`${fmt(state.wallet.savings)} из ${fmt(goalTarget())} монет`:'Ребёнок сможет выбрать её в разделе целей.'}</span></div><div class="section-title"><h2>Пройденные темы</h2></div>${topics.length?`<div class="topic-chips">${topics.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'<div class="empty-state small-empty"><div><b>Темы ещё не завершены</b><span>Они появятся после выполнения игровых заданий.</span></div></div>'}<div class="section-title"><h2>Чему учат механики</h2></div><div class="adult-mechanics">${(C.adultMechanics||[]).map(([n,d])=>`<details><summary>${esc(n)}</summary><p>${esc(d)}</p></details>`).join('')}</div>${demoMode?'':`<div class="adult-reset"><button class="linkbtn danger" data-reset>Удалить локальный профиль</button><p>Будут удалены данные только на этом устройстве. Потребуется отдельное подтверждение.</p></div>`}</section>`;
  }

  if(document?.addEventListener&&!window.__finpetV6Events){
    window.__finpetV6Events=true;
    document.addEventListener('click',e=>{
      const puzzle=e.target?.closest?.('[data-parent-puzzle]');if(puzzle){e.preventDefault();chooseParentPuzzle(puzzle.dataset.parentPuzzle);return;}
      const gate=e.target?.closest?.('[data-route="adultGate"]');if(gate){track('parent_gate_opened',{source:'profile'});save();}
    },true);
    document.addEventListener('click',e=>{if(route==='adult'&&e.target?.closest?.('[data-back]'))lockAdultGate();},true);
  }
  window.FINPET_HANDLE_ANDROID_BACK = () => {
    if (modal) { cancelTrackedModal(); return true; }
    if (['home','onboarding','weekStart','weekSummary'].includes(route)) return false;
    if (route === 'help') route = helpReturnRoute || 'profile';
    else if (['adult','adultGate','settings','progress','achievements','activities'].includes(route)) route = 'profile';
    else if (['shop','task','pet','sidejob'].includes(route)) route = 'home';
    else if (route === 'savings') route = 'budget';
    else route = 'home';
    taskResult = null;
    render();
    return true;
  };

  window.FINPET_DEV = {
    freshState, migrateState, actualsForWeek, weeksToGoal, healthText, calculatePeriodDevelopment, version:6,
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
    planning:{confirm:confirmWeekPlan,initial:()=>state.initialWeekPlan?JSON.parse(JSON.stringify(state.initialWeekPlan)):null},
    sections:{list:()=>JSON.parse(JSON.stringify(C.sections||[])),state:()=>JSON.parse(JSON.stringify(clubsState())),sync:syncSectionUnlock,select:selectSection,pay:paySectionWeek,skip:skipSectionWeek,switchTo:confirmSectionSwitch,stop:confirmSectionStop,active:()=>sectionById()?JSON.parse(JSON.stringify(sectionById())):null,progress:id=>JSON.parse(JSON.stringify(sectionProgress(id||clubsState().activeId))),record:week=>JSON.parse(JSON.stringify(sectionRecordForWeek(week)||null))},
    critical:{needs:()=>JSON.parse(JSON.stringify(criticalPetNeeds())),canAdvance:canAdvanceDay,emergency:emergencyPetCare,week:week=>JSON.parse(JSON.stringify(emergencyCareForWeek(week||state.wallet.week)))},
    demo:{start:startDemoMode,reset:resetDemoMode,exit:exitDemoMode,completePeriod:demoCompletePeriod,isActive:()=>demoMode,guide:()=>JSON.parse(JSON.stringify(demoGuideState())),periods:()=>JSON.parse(JSON.stringify(DEMO_PERIODS))},
    feedback:{build:buildFinancialFeedback},
    actions:{buyItem,saveAmount,completeWeek,startNextWeek,advanceDay,selectGoal,quickAction,resolveEvent,openEvent,setShopCategory:(cat)=>{shopScreen.cat=cat;route='shop';render();}}
  };
  if (!window.__FINPET_ANDROID__ && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(reg=>reg.update()).catch(() => {});
  render();
})();
