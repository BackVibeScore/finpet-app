const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function element(){return {innerHTML:'',dataset:{},style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},remove:()=>{},scrollIntoView:()=>{}}}
function seed(overrides={}){return Object.assign({version:6,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:'7-11',difficultyMode:'easy',pet:{type:'cat',name:'Финни',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:80,care:70,development:10},wallet:{balance:1000,savings:0,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:null,goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},initialWeekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:2,startingBalance:1000,startingSavings:0,pet:{mood:70,development:10},worldStage:2,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],weekOpeningBalance:1000,dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},workState:{week:2,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}},overrides)}
function boot(s=seed()){const app=element(),store={finpet_mvp_state_v1:JSON.stringify(s)};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};const document={documentElement:{dataset:{}},getElementById:id=>id==='app'?app:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:element,body:{appendChild:()=>{}},addEventListener:()=>{}};const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,Math,matchMedia:()=>({matches:false}),setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1},clearTimeout:()=>{}};sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb,{filename:'content.js'});vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb,{filename:'app.js'});return {dev:sb.window.FINPET_DEV,app}}
function assert(v,m){if(!v)throw new Error(m)}
let r=boot(),d=r.dev;
assert(d.sections.list().length===4,'must expose 4 sections');
assert(!d.sections.state().unlocked,'sections unlocked too early');
d.actions.startNextWeek();
let s=d.getState();assert(s.wallet.week===3&&d.sections.state().unlocked,'sections must unlock on week 3');
let gate=d.setRoute('weekStart');assert(gate.includes('хочет новое занятие')&&gate.includes('Футбол')&&gate.includes('Рисование')&&gate.includes('Робототехника')&&gate.includes('Музыка'),'section picker missing');
assert(d.sections.select('football')===true,'football select failed');
s=d.getState();assert(s.clubs.activeId==='football','only active section not set');
const before=s.wallet.balance;assert(d.sections.pay()===true,'section payment failed');
s=d.getState();assert(s.wallet.balance===before-120,'football must cost 120');assert(d.actualsForWeek().activity===120&&d.actualsForWeek().wants===0,'activity leaked into wants');
assert(d.sections.pay()===false&&d.getState().wallet.balance===before-120,'double charge allowed');
assert(d.sections.progress('football').paidWeeks===1,'paid progress missing');
const planBudget=d.getState().wallet.balance;assert(d.planning.confirm({necessary:400,wants:200,savings:200,reserve:planBudget-800}).ok,'plan must use balance after section payment');
d.actions.completeWeek();d.actions.startNextWeek();
const beforeSkip=d.getState().wallet.balance;assert(d.sections.skip()===true,'skip failed');assert(d.getState().wallet.balance===beforeSkip,'skip charged money');assert(d.sections.progress('football').streak===0,'skip did not reset streak');
assert(d.sections.switchTo('drawing')===true,'switch schedule failed');
d.actions.completeWeek();d.actions.startNextWeek();assert(d.sections.active().id==='drawing','switch not applied next week');
const beforeDrawing=d.getState().wallet.balance;assert(d.sections.pay()===true&&d.getState().wallet.balance===beforeDrawing-90,'drawing price incorrect');

const poorClubs={unlocked:true,unlockedWeek:3,activeId:'football',joinedWeek:3,currentWeekDecision:null,choiceSkippedWeek:null,pendingId:null,pendingStop:false,skippedWeeks:[],history:[],progress:{}};
r=boot(seed({wallet:{balance:50,savings:500,weeklyIncome:1000,week:3,day:1,nextIncomeIn:7,needsSpent:0},weekNeedsPlanning:true,weekPlan:null,initialWeekPlan:null,weekSnapshot:null,clubs:poorClubs}));
d=r.dev;assert(d.sections.pay()===false,'insufficient section payment should fail');assert(d.getState().wallet.balance===50&&d.getState().wallet.savings===500,'insufficient payment touched money/savings');assert(d.getModal()?.type==='sectionShortage','shortage feedback missing');

r=boot(seed({wallet:{balance:700,savings:0,weeklyIncome:1000,week:4,day:1,nextIncomeIn:7,needsSpent:0}}));d=r.dev;s=d.getState();assert(s.clubs&&s.clubs.unlocked,'legacy save did not migrate clubs');
const src=fs.readFileSync(ROOT+'/app.js','utf8'),content=fs.readFileSync(ROOT+'/content.js','utf8'),css=fs.readFileSync(ROOT+'/styles.css','utf8');
assert(src.includes("category === 'Занятие'")&&src.includes("source === 'activity'"),'activity transaction separation missing');
assert(content.includes("id:'football'")&&content.includes("id:'robotics'"),'section content missing');
assert(css.includes('V17 SECTIONS MECHANIC'),'section styles missing');
console.log('sections_smoke: OK');
