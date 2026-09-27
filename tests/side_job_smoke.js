const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function seed(energy=80){return {version:3,onboardingDone:true,onboardingStep:6,ageGroup:'15-17',pet:{type:'cat',name:'Тест',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy,care:70,development:10},wallet:{balance:250,savings:0,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:'home',goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:2,startingBalance:250,pet:{mood:70},worldStage:2,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},settings:{sound:true,motion:true}}}
function boot(st){const app={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};const store={'finpet_mvp_state_v1':JSON.stringify(st)};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};const document={getElementById:id=>id==='app'?app:null,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild:()=>{}},createElement:()=>({className:'',textContent:'',remove:()=>{}})};const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1;},clearTimeout:()=>{}};sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb);vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb);return {sb,app,dev:sb.window.FINPET_DEV};}
function assert(c,m){if(!c)throw new Error(m)}
function finishShift(dev,id='sort_orders'){const a=dev.getContent().workActivities.find(x=>x.id===id);dev.work.start(id);let s=dev.getState();assert(s.workSession?.activityId===id,'work session not started');for(const step of a.steps)dev.work.sort(step.bin);}
let r=boot(seed()),dev=r.dev;
assert(dev.version===6,'dev version must be 6');
assert(dev.getContent().workActivities.length===2,'work activities content missing');
finishShift(dev);let s=dev.getState();
assert(s.wallet.balance===370,'reward not added to wallet');
assert(s.pet.energy===60,'energy cost not applied');
assert(s.workState.shiftsUsed===1,'weekly shift counter not incremented');
const t=s.transactions.find(x=>x.source==='work_shift');
assert(t&&t.type==='income'&&t.category==='Подработка'&&t.amount===120,'work Transaction invalid');
assert(dev.actualsForWeek().sideJobIncome===120,'side-job income missing from weekly actuals');
['side_job_started','side_job_completed','side_job_income_received'].forEach(name=>assert(s.analytics.some(x=>x.name===name),`analytics missing ${name}`));
dev.actions.advanceDay();finishShift(dev);dev.actions.advanceDay();finishShift(dev);s=dev.getState();
assert(s.workState.shiftsUsed===3,'three-shift weekly limit not reached');
assert(s.wallet.balance===610,'three shifts must add exactly 360');
dev.work.start('sort_orders');s=dev.getState();
assert(!s.workSession,'fourth shift should be blocked');
assert(s.analytics.some(x=>x.name==='side_job_limit_reached'),'weekly-limit analytics missing');
dev.actions.completeWeek();s=dev.getState();
assert(s.weekSummary.actual.sideJobIncome===360,'week summary lost side-job income');
dev.actions.startNextWeek();s=dev.getState();
assert(s.workState.week===3&&s.workState.shiftsUsed===0,'weekly work counter did not reset');
assert(s.transactions.filter(x=>x.source==='work_shift').length===3,'work history was lost');
r=boot(seed(10));dev=r.dev;dev.work.start('sort_orders');s=dev.getState();
assert(!s.workSession,'low-energy shift should not start');
assert(s.wallet.balance===250,'low-energy block changed balance');
assert(s.analytics.some(x=>x.name==='side_job_energy_blocked'),'energy-block analytics missing');
r=boot(seed());dev=r.dev;dev.work.start('sort_orders');dev.work.cancel();s=dev.getState();
assert(!s.workSession&&s.wallet.balance===250&&s.pet.energy===80,'cancelled shift changed economy');
assert(s.analytics.some(x=>x.name==='side_job_cancelled'),'cancel analytics missing');
console.log('side_job_smoke: OK');
