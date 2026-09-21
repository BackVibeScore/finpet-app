const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto,path=require('path');
const ROOT=__dirname+'/..';
function element(){return {innerHTML:'',dataset:{},style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},remove:()=>{},scrollIntoView:()=>{}}}
function seed(){return {version:6,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:'7-11',difficultyMode:'easy',pet:{type:'cat',name:'Финни',color:'#7C8CF8',accessory:'none',satiety:60,mood:70,energy:80,health:70,development:10},wallet:{balance:1000,savings:0,weeklyIncome:1000,week:3,day:2,nextIncomeIn:6,needsSpent:0},activeGoal:null,goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:true,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:3,necessary:400,wants:200,savings:200,reserve:200},initialWeekPlan:{week:3,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:3,startingBalance:1000,startingSavings:0,pet:{mood:70,health:70,development:10},worldStage:2,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1},{week:2}],weekOpeningCharges:[],weekOpeningBalance:1000,clubs:{unlocked:true,unlockedWeek:3,activeId:null,joinedWeek:null,currentWeekDecision:null,choiceSkippedWeek:3,pendingId:null,pendingStop:false,skippedWeeks:[],history:[],progress:{}},emergencyCare:{week:3,food:0,mood:0,health:0,history:[]},dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:3,sideJobs:0},workState:{week:3,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}}}
function boot(){const timers=[];const app=element(),store={finpet_mvp_state_v1:JSON.stringify(seed())};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};const document={documentElement:{dataset:{}},getElementById:id=>id==='app'?app:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:element,body:{appendChild:()=>{}},addEventListener:()=>{}};const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,Math,matchMedia:()=>({matches:false}),setTimeout:(fn,ms)=>{timers.push(fn);return timers.length},clearTimeout:()=>{}};sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb);vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb);timers.shift()?.();return {dev:sb.window.FINPET_DEV,app}}
function assert(v,m){if(!v)throw new Error(m)}
let r=boot(),d=r.dev;
d.actions.setShopCategory('Здоровье');let rendered=r.app.innerHTML;assert(rendered.includes('assets/item-haircut.webp')&&rendered.includes('assets/item-prevention.webp'),'health generated art not rendered');
d.actions.setShopCategory('Игры');rendered=r.app.innerHTML;assert(rendered.includes('assets/item-cinema.webp'),'cinema generated art not rendered');
d.actions.setShopCategory('Особое');rendered=r.app.innerHTML;assert(rendered.includes('assets/item-bike.webp'),'bike shop generated art not rendered');
rendered=d.setRoute('goals');assert(rendered.includes('assets/goal-bike.webp'),'bike goal generated art not rendered');
const before=d.getState();d.actions.buyItem('food_basic');let s=d.getState();
assert(s.pet.satiety>before.pet.satiety,'food effect missing');
assert(!s.inventory.some(x=>x.id==='food_basic'),'consumable food incorrectly stored in inventory');
assert(!s.worldPlacements.food_basic,'consumable food incorrectly placed in room');

d.actions.buyItem('interior_lamp');s=d.getState();assert(s.inventory.some(x=>x.id==='interior_lamp')&&s.worldPlacements.interior_lamp?.placed,'durable room item no longer persists');assert(s.currentWorldArea==='home','durable purchase did not select its logical world area');assert(d.getModal()?.actions?.[0]?.label==='Посмотреть в комнате','durable purchase feedback does not lead to room');
const src=fs.readFileSync(ROOT+'/app.js','utf8'),css=fs.readFileSync(ROOT+'/styles.css','utf8'),sw=fs.readFileSync(ROOT+'/sw.js','utf8');
assert(src.includes('food_basic:0,food_snack:1,food_treat:2')&&src.includes('shopItemIllustration(item)'),'food illustration mapping missing');
assert(src.includes("confirmation-art ${p.item.category==='Еда'?'confirmation-food-art':''}")&&src.includes('shopItemIllustration(p.item)'),'purchase confirmation does not use food artwork');
assert(src.includes("data-shop-open=\"Еда\""),'feed action does not open food choices');
assert(!src.includes('Теперь это здесь'),'shop purchase still creates the old item speech bubble');
assert(src.includes("petBubble='';")&&src.includes("item.category==='Еда'"),'shop purchase does not explicitly clear pet bubble / distinguish food');
assert(css.includes('V20 SHOP SEMANTICS')&&css.includes('V21 PURCHASE PRESENTATION')&&css.includes('V22 GENERATED ITEM ART')&&css.includes('V23 ACTION MENU + REGENERATED FOOD ART')&&css.includes('V24 CONSISTENT ACTION NAVIGATION')&&css.includes('V25 HOME FLOW HIERARCHY'),'shop presentation styles missing');
assert(fs.existsSync(path.join(ROOT,'assets/food-items.webp'))&&fs.statSync(path.join(ROOT,'assets/food-items.webp')).size>10000,'legacy food sprite missing');
assert(fs.existsSync(path.join(ROOT,'assets/food-items-v2.svg'))&&fs.statSync(path.join(ROOT,'assets/food-items-v2.svg')).size>4000,'regenerated food sprite missing');
assert(css.includes("assets/food-items-v2.svg"),'regenerated food sprite not wired into styles');
assert(src.includes('quick-actions quick-actions-v2'),'refined quick action menu not rendered');
assert(src.includes('data-shop-open="Игры"')&&src.includes('data-shop-open="Здоровье"'),'home actions still bypass category menus');
assert(!src.includes('<b>Поиграть</b><small>80 ●</small>')&&!src.includes('<b>Здоровье</b><small>60 ●</small>'),'home actions still show direct-spend pricing');
assert(src.includes('<b>Еда</b><small>выбрать еду</small>')&&src.includes('<b>Игры</b><small>выбрать игру</small>')&&src.includes('<b>Магазин</b><small>все товары</small>'),'action menu copy is inconsistent');
const homeStart=src.indexOf('function homeScreen()');
const homeEnd=src.indexOf('function petScreen()',homeStart);
const homeSrc=src.slice(homeStart,homeEnd);
const posActions=homeSrc.indexOf('quick-actions-title');
const posToday=homeSrc.indexOf('home-today-title');
const posEndDay=homeSrc.indexOf('home-end-day');
const posProgress=homeSrc.indexOf('home-progress-divider');
const posMoney=homeSrc.indexOf('home-money-title');
const posGoal=homeSrc.indexOf('${goalBlock}');
const posTask=homeSrc.indexOf('${taskBlock}');
const posSection=homeSrc.indexOf('${sectionHomeCard()}');
const posWorld=homeSrc.indexOf('${worldProgressCard()}');
assert(posActions>=0&&posToday>posActions&&posEndDay>posToday&&posProgress>posEndDay,'home daily flow order is broken');
assert(posMoney>posProgress&&posGoal>posMoney&&posTask>posGoal&&posSection>posTask&&posWorld>posSection,'home progress blocks order is broken');
assert(homeSrc.includes('home-finance-strip')&&!homeSrc.includes('money-strip home-money'),'home finance summary still duplicates the old dashboard');
assert(src.includes('event-resolved-compact')&&src.includes('Ситуация дня решена'),'resolved event is not compact');
assert(sw.includes('./assets/food-items.webp')&&sw.includes('./assets/food-items-v2.svg'),'food artwork missing from offline cache');
const generated=['item-haircut.webp','item-prevention.webp','item-cinema.webp','item-bike.webp','goal-bike.webp'];
for(const file of generated){
  const fp=path.join(ROOT,'assets',file);
  assert(fs.existsSync(fp)&&fs.statSync(fp).size>2500,'generated asset missing '+file);
  assert(sw.includes('./assets/'+file),'generated asset missing from offline cache '+file);
}
assert(src.includes("care_brush:'assets/item-haircut.webp'")&&src.includes("health_vaccine:'assets/item-prevention.webp'"),'health generated mapping missing');
assert(src.includes("game_cinema:'assets/item-cinema.webp'")&&src.includes("special_bike:'assets/item-bike.webp'"),'shop generated mapping missing');
assert(src.includes("'assets/goal-bike.webp'")&&src.includes('eventGeneratedIllustration')&&src.includes('goalIllustration'),'goal/event generated art helpers missing');
console.log('shop_presentation_smoke: OK');
