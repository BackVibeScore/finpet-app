const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function element(){return {innerHTML:'',dataset:{},style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},remove:()=>{}}}
function base(){
  return {version:6,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:'7-11',difficultyMode:'easy',
    pet:{type:'cat',name:'Основной',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:70,care:70,development:8},
    wallet:{balance:777,savings:40,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:'home',goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,
    stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},
    currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:true,weekPlan:null,initialWeekPlan:null,weekSnapshot:null,weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],
    dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},workState:{week:2,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}};
}
function boot(seed){
  const app=element(),store={}; if(seed)store.finpet_mvp_state_v1=JSON.stringify(seed);
  const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};
  const document={documentElement:{dataset:{}},getElementById:id=>id==='app'?app:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:element,body:{appendChild:()=>{}}};
  const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,Math,matchMedia:()=>({matches:false}),setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1},clearTimeout:()=>{}};
  sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);
  vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb,{filename:'content.js'});vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb,{filename:'app.js'});
  return {sb,app,store,dev:sb.window.FINPET_DEV};
}
function assert(c,m){if(!c)throw new Error(m)}
let r=boot(base()),dev=r.dev,s=dev.getState();

// Confirmed plan becomes immutable.
let first=dev.planning.confirm({necessary:400,wants:100,savings:200,reserve:77});
assert(first.ok,'first plan confirmation failed');
const initial=JSON.stringify(dev.planning.initial());
let second=dev.planning.confirm({necessary:100,wants:500,savings:0,reserve:177});
assert(!second.ok&&second.reason==='locked','confirmed plan was editable');
dev.actions.buyItem('food_basic');
assert(JSON.stringify(dev.planning.initial())===initial,'purchase changed initial plan');

// Legacy current plan migrates into immutable initial plan without losing development.
const legacy=base();legacy.pet.development=37;legacy.weekNeedsPlanning=false;legacy.weekPlan={week:2,necessary:400,wants:150,savings:150,reserve:77};delete legacy.initialWeekPlan;
r=boot(legacy);dev=r.dev;s=dev.getState();
assert(s.pet.development===37,'legacy development was lost');
assert(s.initialWeekPlan&&s.initialWeekPlan.necessary===400,'legacy weekPlan was not migrated to initialWeekPlan');

// Period scoring rewards a balanced period more than a poor one.
const plan={necessary:400,wants:100,savings:200,reserve:300};
const good=dev.calculatePeriodDevelopment(plan,{necessary:380,wants:90,savings:200},330);
const bad=dev.calculatePeriodDevelopment(plan,{necessary:0,wants:500,savings:0},0);
assert(good.score>bad.score&&good.score>=6,'development scoring does not reward balanced periods');
assert(bad.score>=0,'bad period must not erase progress');

// Demo uses isolated state, supports five fast periods, and period results drive development.
r=boot(base());dev=r.dev;const mainBefore=dev.getState();
assert(dev.demo.start()&&dev.demo.isActive(),'demo did not start');
let guide=dev.demo.guide();
assert(guide.current.id==='plan'&&guide.completed===0,'demo guide must begin with budget planning');
for(let week=1;week<=5;week++){
  const confirmed=dev.planning.confirm({necessary:400,wants:100,savings:200,reserve:300});
  assert(confirmed.ok,'demo plan confirmation failed on week '+week);
  if(week===1){guide=dev.demo.guide();assert(guide.current.id==='goal','demo guide did not advance after planning');dev.actions.selectGoal('home');}
  for(let i=0;i<8;i++)dev.actions.buyItem('food_basic');
  dev.actions.buyItem('care_wash');
  dev.actions.buyItem('food_treat');
  dev.actions.saveAmount(200);
  assert(dev.demo.completePeriod(),'demo period did not complete');
  s=dev.getState();
  assert(s.weekSummary&&s.weekSummary.development&&s.weekSummary.development.delta>=0,'period development summary missing');
  if(week<5)dev.actions.startNextWeek();
}
s=dev.getState();
assert(s.weekHistory.length===5,'demo did not reproduce five periods');
assert(s.pet.development>=20,'series of balanced periods did not change pet stage range');
assert(dev.demo.reset(),'demo reset failed');
s=dev.getState();assert(s.wallet.week===1&&s.weekHistory.length===0&&s.wallet.balance===1000,'demo reset is not deterministic');
assert(dev.demo.exit()&&!dev.demo.isActive(),'demo did not exit');
s=dev.getState();
assert(s.wallet.balance===mainBefore.wallet.balance&&s.wallet.week===mainBefore.wallet.week&&s.pet.name===mainBefore.pet.name,'demo damaged the normal profile');

// Unified feedback exists for purchases, savings and shortages.
r=boot(base());dev=r.dev;dev.planning.confirm({necessary:400,wants:100,savings:100,reserve:177});
dev.actions.buyItem('food_basic');let modal=dev.getModal();
assert(modal?.type==='financialFeedback'&&modal.changes?.some(x=>x.label==='Баланс')&&modal.reason,'purchase feedback is incomplete');
dev.actions.saveAmount(50);modal=dev.getModal();
assert(modal?.type==='financialFeedback'&&modal.changes?.some(x=>x.label==='Копилка'),'savings feedback is incomplete');
const low=base();low.wallet.balance=50;r=boot(low);dev=r.dev;dev.confirmations.openPurchase('special_console');
assert(r.app.innerHTML.includes('Покупка не выполнена')&&r.app.innerHTML.includes('Не хватает'),'shortage feedback is incomplete');

// Direct clicks no longer grow development outside period settlement.
const source=fs.readFileSync(ROOT+'/app.js','utf8');
const css=fs.readFileSync(ROOT+'/styles.css','utf8');
assert(source.includes("['demo','Демо'")&&source.includes('Для знакомства'),'demo is missing from the mode-selection screen');
assert(!source.includes('demoAdultControls'),'demo entry must not live in the adult section');
assert(source.includes('Что уже показано')&&source.includes('demoGuideState'),'explicit demo guidance is missing');
assert(css.includes('--primary:#b76138')&&css.includes('V12 ORANGE PRODUCT ACCENT'),'orange/terracotta product accent is missing');
assert(!source.includes('adjustPet({ development: 4'),'task still directly grows development');
assert(!source.includes('adjustPet({development:10'),'goal still directly grows development');
assert(source.includes('delete itemEffect.development')&&source.includes('delete petEff.development'),'purchase/event development bypass remains');

console.log('web_competition_requirements_smoke: OK');
