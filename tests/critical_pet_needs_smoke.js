const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function element(){return {innerHTML:'',dataset:{},textContent:'',style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},remove:()=>{},scrollIntoView:()=>{}}}
function base(pet={},wallet={}){return {version:6,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:'7-11',difficultyMode:'easy',pet:{type:'cat',name:'Финни',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:80,health:70,care:70,development:10,...pet},wallet:{balance:0,savings:500,weeklyIncome:1000,week:2,day:2,nextIncomeIn:6,needsSpent:0,...wallet},activeGoal:null,goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:true,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},initialWeekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:2,startingBalance:1000,startingSavings:500,pet:{satiety:70,mood:70,energy:80,health:70,care:70,development:10},worldStage:2,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],weekOpeningBalance:1000,clubs:{unlocked:false,unlockedWeek:null,activeId:null,joinedWeek:null,currentWeekDecision:null,choiceSkippedWeek:null,pendingId:null,pendingStop:false,skippedWeeks:[],history:[],progress:{}},dayActions:{count:1,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},workState:{week:2,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}}}
function boot(seed){const app=element(),store={finpet_mvp_state_v1:JSON.stringify(seed)};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};const document={documentElement:{dataset:{}},getElementById:id=>id==='app'?app:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:element,body:{appendChild:()=>{}},addEventListener:()=>{}};const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,Math,matchMedia:()=>({matches:false}),setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1},clearTimeout:()=>{}};sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb,{filename:'content.js'});vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb,{filename:'app.js'});return {dev:sb.window.FINPET_DEV,app}}
function assert(v,m){if(!v)throw new Error(m)}

let r=boot(base({satiety:0})),d=r.dev,s=d.getState(),tx0=s.transactions.length;
assert(d.critical.needs().map(x=>x.id).join(',')==='food','satiety zero not critical');
assert(d.actions.advanceDay()===false,'critical satiety allowed day advance');
assert(d.getState().wallet.day===2,'blocked day changed day');
assert(d.getModal()?.type==='criticalPetNeeds','critical modal missing');
const html=r.app.innerHTML;assert(html.includes('Сначала помоги питомцу')&&html.includes('Найти еду дома'),'critical UI missing child copy');
assert(d.critical.emergency('food')===true,'free food failed');
s=d.getState();assert(s.pet.satiety===20,'free food must restore 20');assert(s.wallet.balance===0&&s.wallet.savings===500,'free food changed balance/savings');assert(s.transactions.length===tx0,'free food created financial transaction');
assert(d.critical.emergency('food')===false,'free food can be repeated above zero');
assert(d.actions.advanceDay()===true&&d.getState().wallet.day===3,'day did not advance after care');

r=boot(base({mood:0}));d=r.dev;assert(d.actions.advanceDay()===false,'mood zero allowed day advance');assert(d.critical.emergency('mood')===true&&d.getState().pet.mood===15,'free mood care failed');
r=boot(base({health:0,care:0}));d=r.dev;assert(d.actions.advanceDay()===false,'health zero allowed day advance');assert(d.critical.emergency('health')===true&&d.getState().pet.health===15,'free health care failed');
r=boot(base({energy:0}));d=r.dev;assert(d.actions.advanceDay()===true,'energy zero must not block day');

r=boot(base({satiety:0,mood:0,health:20,care:20}));d=r.dev;assert(d.actions.advanceDay()===false,'multiple critical needs not blocked');assert(d.critical.emergency('food')===true,'first multi care failed');assert(d.actions.advanceDay()===false,'remaining mood zero did not keep block');assert(d.critical.emergency('mood')===true,'second multi care failed');assert(d.critical.canAdvance()===true,'all critical needs repaired but still blocked');

r=boot(base({satiety:0},{balance:15,savings:900}));d=r.dev;assert(d.critical.emergency('food')===true,'free care should work with partial balance');s=d.getState();assert(s.wallet.balance===15&&s.wallet.savings===900,'partial balance/savings changed');

const old=base({satiety:0});delete old.emergencyCare;r=boot(old);d=r.dev;s=d.getState();assert(s.emergencyCare&&Array.isArray(s.emergencyCare.history),'old save did not migrate emergencyCare');

const source=fs.readFileSync(ROOT+'/app.js','utf8'),css=fs.readFileSync(ROOT+'/styles.css','utf8');
for(const phrase of ['Сначала помоги питомцу','Найти еду дома','Обнять питомца','Позаботиться дома'])assert(source.includes(phrase),'missing UI phrase '+phrase);
assert(source.includes("if(!canAdvanceDay())return blockDayForCriticalNeeds('advance_day')"),'advanceDay lacks internal guard');
console.log('critical_pet_needs_smoke: OK');
