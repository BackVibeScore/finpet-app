const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function seed(age='12-14') { return {version:3,onboardingDone:true,onboardingStep:6,ageGroup:age,pet:{type:'cat',name:'Финни',color:'#7C8CF8',accessory:'none',satiety:72,mood:74,energy:78,care:76,development:8},wallet:{balance:1500,savings:1100,weeklyIncome:1000,week:4,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:'home',goalContributions:3,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:4,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:4,startingBalance:1500,pet:{mood:74},worldStage:3,inventoryIds:[],areas:['home','park']},weekSummary:null,weekHistory:[{week:1},{week:2},{week:3}],weekOpeningCharges:[],dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:3,areas:['home','park'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:4,sideJobs:0},settings:{sound:true,motion:true}}; }
function boot(st){const app={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};const store={'finpet_mvp_state_v1':JSON.stringify(st)};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};const document={getElementById:id=>id==='app'?app:null,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild:()=>{}},createElement:()=>({remove:()=>{}})};const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1;},clearTimeout:()=>{}};sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb);vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb);return sb;}
function assert(c,m){if(!c)throw new Error(m)}
let sb=boot(seed()); let dev=sb.window.FINPET_DEV;
dev.actions.buyItem('interior_lamp'); let s=dev.getState();
assert(s.worldPlacements.interior_lamp?.zone==='wall-right','bought world item not placed');
assert(s.analytics.some(x=>x.name==='world_item_unlocked'),'world item analytics missing');
// Complete long-term goal using the existing savings system; target 1200, 1100 already saved.
dev.actions.saveAmount(100); s=dev.getState();
assert(s.completedGoals.includes('home'),'goal not completed');
assert(s.wallet.savings===0,'goal funds were not consumed');
assert(s.worldProgress.decor.includes('comfort'),'goal did not change world');
assert(s.activeGoal===null,'completed goal remained active');
assert(s.analytics.some(x=>x.name==='long_term_goal_completed'),'goal completion analytics missing');
// Recurring obligation schedules the next payment instead of disappearing.
let st=seed('15-17'); st.futureObligations=[{id:'sub',type:'subscription',amount:120,dueWeek:4,dueDay:1,remainingPayments:3,description:'Автопродление',sourceId:'e24',category:'Желания',recurring:true}];
sb=boot(st);dev=sb.window.FINPET_DEV;dev.processDueObligations({showModal:false});s=dev.getState();
assert(s.wallet.balance===1380,'recurring charge not applied');
assert(s.futureObligations.length===1&&s.futureObligations[0].dueWeek===5&&s.futureObligations[0].remainingPayments===2,'recurring payment not rescheduled');
// Story chain reuses existing events after macro unlock.
st=seed('12-14'); st.currentEventId='e12'; st.worldProgress={stage:3,areas:['home','park'],unlocks:[],decor:[]};
sb=boot(st);dev=sb.window.FINPET_DEV;dev.actions.advanceDay();s=dev.getState();
assert(s.storyChains.festival_chain,'festival chain not started');
assert(s.currentChainId==='festival_chain'&&s.currentEventId==='e18','chain did not select existing event e18');
console.log('gameplay_smoke: OK');

