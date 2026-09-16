const fs=require('fs'), vm=require('vm'), crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function boot(seed){
  const app={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
  const storage={};
  const localStorage={getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v),removeItem:k=>delete storage[k]};
  if(seed) localStorage.setItem('finpet_mvp_state_v1',JSON.stringify(seed));
  const document={getElementById:id=>id==='app'?app:null,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild:()=>{}},createElement:()=>({className:'',textContent:'',remove:()=>{}})};
  const sandbox={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1;},clearTimeout:()=>{}};
  sandbox.window=sandbox; sandbox.window.scrollTo=()=>{};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sandbox,{filename:'content.js'});
  vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sandbox,{filename:'app.js'});
  return {sandbox,app,state:()=>sandbox.window.FINPET_DEV.getState()};
}
function base(age='12-14'){
  return {version:5,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:age,pet:{type:'cat',name:'Тест',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:70,care:70,development:10},wallet:{balance:1000,savings:0,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:'home',goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:2,startingBalance:1000,pet:{mood:70},worldStage:1,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},workState:{week:2,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}};
}
function assert(c,m){if(!c)throw new Error(m)}
// V2 migration
let old=base(); old.version=2; old.inventory=[{id:'interior_lamp',boughtAt:1}]; old.nextWeekObligations=[{amount:90,description:'Старая подписка',source:'legacy'}]; delete old.futureObligations; delete old.worldPlacements; delete old.worldProgress;
let r=boot(old); let s=r.state();
assert(s.version===5,'migration version');
assert(s.futureObligations.length===1 && s.futureObligations[0].amount===90,'legacy obligation migration');
assert(s.worldPlacements.interior_lamp?.zone==='wall-right','inventory placement migration');
assert(s.workState && s.workState.shiftsLimit===3,'v4 workState migration missing');
// 7-11 planner
r=boot({...base('7-11'),weekNeedsPlanning:true,weekPlan:null,weekSnapshot:null});
assert(r.app.innerHTML.includes('junior-jars'),'7-11 visual planner missing');
assert(r.app.innerHTML.includes('Нужно')&&r.app.innerHTML.includes('Оставлю'),'7-11 language missing');
// 15-17 presentation
r=boot(base('15-17'));
assert(r.app.innerHTML.includes('age-15-17'),'teen presentation class missing');
assert(r.app.innerHTML.includes('Жизнь'),'teen home title missing');
assert(r.app.innerHTML.includes('Развитие мира'),'macro progress missing');
// Future obligation payment
const teen=base('15-17'); teen.futureObligations=[{id:'o1',type:'credit',amount:360,dueWeek:2,dueDay:1,remainingPayments:1,description:'Платёж по кредиту',sourceId:'e27',category:'Необходимые расходы',recurring:false}];
r=boot(teen); r.sandbox.window.FINPET_DEV.processDueObligations({showModal:false}); s=r.state();
assert(s.wallet.balance===640,'future obligation not charged');
assert(s.futureObligations.length===0,'one-time obligation not cleared');
assert(s.transactions.some(t=>t.description==='Платёж по кредиту'&&t.amount===-360),'obligation transaction missing');
// Macro stage
const late=base('12-14'); late.weekHistory=Array.from({length:5},(_,i)=>({week:i+1})); late.worldProgress={stage:1,areas:['home'],unlocks:[],decor:[]};
r=boot(late); s=r.state();
assert(s.worldProgress.stage>=4,'macro stage did not unlock');
assert(s.worldProgress.areas.includes('park')&&s.worldProgress.areas.includes('city'),'world areas not unlocked');
console.log('runtime_smoke: OK');
