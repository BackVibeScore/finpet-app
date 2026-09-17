const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function base(age='7-11'){
  return {version:6,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:age,difficultyMode:age==='7-11'?'easy':'medium',pet:{type:'cat',name:'Тест',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:80,care:70,development:10},wallet:{balance:1000,savings:500,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:'home',goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:2,startingBalance:1000,pet:{mood:70},worldStage:2,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},workState:{week:2,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}};
}
function fakeElement(){return {innerHTML:'',className:'',textContent:'',value:'',dataset:{},classList:{add:()=>{},remove:()=>{}},addEventListener:()=>{},remove:()=>{}};}
function boot(seed){
  const app=fakeElement();app.querySelector=()=>fakeElement();app.querySelectorAll=()=>[];
  const store={};if(seed!==undefined&&seed!==null)store.finpet_mvp_state_v1=JSON.stringify(seed);
  const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};
  const document={getElementById:id=>id==='app'?app:fakeElement(),querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild:()=>{}},createElement:fakeElement};
  const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1;},clearTimeout:()=>{}};sb.window=sb;sb.window.scrollTo=()=>{};
  vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb,{filename:'content.js'});vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb,{filename:'app.js'});return {sb,app,dev:sb.window.FINPET_DEV};
}
function assert(c,m){if(!c)throw new Error(m)}

// Old age modes migrate without losing economic or progress data.
let legacy={...base(),version:4,ageGroup:'8-10',wallet:{...base().wallet,balance:777,savings:333},pet:{...base().pet,accessory:'cap'},completedTasks:['t1'],weekHistory:[{week:1},{week:2}]};
let r=boot(legacy),s=r.dev.getState();
assert(s.difficultyMode==='easy'&&s.ageGroup==='7-11'&&!s.ageMigrationPending,'8-10 must migrate to easy');
assert(s.wallet.balance===777&&s.wallet.savings===333&&s.completedTasks[0]==='t1'&&s.weekHistory.length===2,'migration lost progress');
for(const oldAge of ['11-13','14-17','12-14','15-17']){r=boot({...legacy,version:5,ageGroup:oldAge,difficultyMode:null});s=r.dev.getState();assert(s.difficultyMode==='medium'&&!s.ageMigrationPending,`${oldAge} must migrate to medium`);}

// Initial intro can be completed or skipped without touching the economy.
r=boot(null);for(let i=0;i<4;i++)r.dev.intro.initialAdvance();s=r.dev.getState();
assert(s.onboardingIntroCompleted&&s.onboardingStep===4,'intro completion state invalid');
assert(s.wallet.balance===1000&&s.wallet.savings===0&&s.transactions.length===0,'intro changed game money');
assert(s.analytics.some(x=>x.name==='intro_completed'),'intro_completed analytics missing');
r=boot(null);r.dev.intro.initialSkip();s=r.dev.getState();assert(s.onboardingIntroCompleted&&s.onboardingStep===4,'intro skip state invalid');assert(s.analytics.some(x=>x.name==='intro_skipped'),'intro_skipped analytics missing');

// Help is available on core screens and can replay the intro.
r=boot(base());for(const route of ['home','tasks','budget','goals','profile']){const html=r.dev.setRoute(route);assert(html.includes('data-help'),`help missing on ${route}`);}
r.dev.intro.startReplay();r.dev.intro.finishReplay(false);s=r.dev.getState();assert(s.analytics.some(x=>x.name==='intro_started'&&x.replay),'replayed intro start missing');assert(s.analytics.some(x=>x.name==='intro_completed'&&x.replay),'replayed intro completion missing');

// Home shows savings and the first unfinished age-appropriate task.
const home=r.dev.renderHome();assert(home.includes('В копилке')&&home.includes('Активное задание'),'home summary is incomplete');assert(home.includes('data-open-task'),'home active-task action missing');

// Adult section uses an interactive randomized puzzle; the old hold no longer unlocks it.
assert(!r.dev.adult.completeHold(3000)&&!r.dev.adult.isUnlocked(),'legacy hold must not unlock adult section');const puzzle=r.dev.adult.getPuzzle();for(const id of puzzle.correct){assert(r.dev.adult.choosePuzzle(id),'correct parent puzzle step failed');}assert(r.dev.adult.isUnlocked(),'parent puzzle did not unlock adult section');s=r.dev.getState();assert(s.analytics.some(x=>x.name==='parent_gate_completed'),'parent gate analytics missing');

// Purchase preview and cancellation do not mutate money; confirmation uses the existing transaction path.
r=boot(base());let before=r.dev.getState();r.dev.confirmations.openPurchase('interior_lamp');s=r.dev.getState();assert(s.wallet.balance===before.wallet.balance&&s.inventory.length===0,'purchase happened before confirmation');assert(r.dev.getModal()?.type==='purchaseConfirm','purchase confirmation did not open');r.dev.confirmations.cancel();s=r.dev.getState();assert(s.wallet.balance===before.wallet.balance&&s.transactions.length===0,'purchase cancellation changed economy');assert(s.analytics.some(x=>x.name==='purchase_confirmation_cancelled'),'purchase cancellation analytics missing');
r.dev.confirmations.openPurchase('interior_lamp');assert(r.dev.confirmations.confirmPurchase('interior_lamp'),'purchase confirmation failed');s=r.dev.getState();assert(s.wallet.balance===820&&s.inventory.some(x=>x.id==='interior_lamp'),'confirmed purchase not applied');assert(s.transactions.some(x=>x.source==='shop'&&x.amount===-180),'confirmed purchase did not use Transaction');

// Savings preview includes the future estimate and changes nothing until confirmation.
r=boot(base());const preview=r.dev.confirmations.withdrawalPreview(400);assert(preview.before===500&&preview.after===100&&preview.afterWeeks>preview.beforeWeeks,'withdrawal forecast invalid');r.dev.confirmations.openWithdrawal(400);s=r.dev.getState();assert(s.wallet.savings===500&&s.wallet.balance===1000,'withdrawal happened before confirmation');r.dev.confirmations.cancel();s=r.dev.getState();assert(s.wallet.savings===500&&s.wallet.balance===1000,'withdrawal cancellation changed economy');r.dev.confirmations.openWithdrawal(400);assert(r.dev.confirmations.confirmWithdrawal(400),'withdrawal confirmation failed');s=r.dev.getState();assert(s.wallet.savings===100&&s.wallet.balance===1400,'confirmed withdrawal totals invalid');assert(s.transactions.some(x=>x.type==='saving_withdrawal'&&x.amount===400),'withdrawal Transaction missing');

// Cyber-safety content and age gates.
const C=r.dev.getContent(),juniorSafety=C.tasks.filter(t=>t.cyberSafety&&t.age.includes('7-11'));assert(juniorSafety.length>=6,'fewer than six junior cyber-safety tasks');assert(C.tasks.some(t=>t.cyberSafety&&t.age.includes('12-14')),'12-14 cyber safety missing');assert(C.tasks.some(t=>t.cyberSafety&&t.age.length===1&&t.age[0]==='15-17'),'15-17 advanced cyber safety missing');assert(C.workActivities.every(a=>a.ageGroup.length===1&&a.ageGroup[0]==='15-17'),'side jobs must be 15-17 only');

// Eight accessories render immediately for all pets and colors; legacy IDs remain valid.
assert(C.accessories.length>=8,'accessory set is smaller than eight');for(const pet of C.pets){for(const color of C.petColors){const variants=C.accessories.map(a=>r.dev.renderPet(pet.id,color,a.id));assert(new Set(variants).size===C.accessories.length,`accessory variants are not distinct for ${pet.id}/${color}`);variants.forEach(svg=>assert(svg.includes('<svg')&&!svg.includes('undefined'),'invalid accessory SVG'));}}
r=boot({...base(),pet:{...base().pet,name:'Имя сохранено',accessory:'none'}});assert(r.dev.setAccessory('headphones'),'accessory selection failed');s=r.dev.getState();assert(s.pet.accessory==='headphones'&&s.pet.name==='Имя сохранено','accessory update was delayed or reset the name');for(const id of ['none','cap','scarf','badge']){r=boot({...legacy,pet:{...legacy.pet,accessory:id}});assert(r.dev.getState().pet.accessory===id,`legacy accessory ${id} did not migrate`);}

console.log('v5_requirements_smoke: OK');
