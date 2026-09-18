const fs=require('fs'), vm=require('vm'), crypto=require('crypto').webcrypto;
const ROOT=__dirname+'/..';
function boot(seed){
  const app={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
  const storage={};
  const localStorage={getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v),removeItem:k=>delete storage[k]};
  if(seed) localStorage.setItem('finpet_mvp_state_v1',JSON.stringify(seed));
  const document={documentElement:{dataset:{}},getElementById:id=>id==='app'?app:null,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild:()=>{}},createElement:()=>({className:'',textContent:'',style:{setProperty:()=>{}},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},addEventListener:()=>{},remove:()=>{}})};
  const sandbox={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,matchMedia:()=>({matches:false}),setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1;},clearTimeout:()=>{}};
  sandbox.window=sandbox; sandbox.window.scrollTo=()=>{};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sandbox,{filename:'content.js'});
  vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sandbox,{filename:'app.js'});
  return {sandbox,app,state:()=>sandbox.window.FINPET_DEV.getState()};
}
function base(mode='medium'){
  const age=mode==='easy'?'7-11':'12-14';
  return {version:6,onboardingDone:true,onboardingIntroCompleted:true,onboardingStep:6,ageMigrationPending:false,helpLastTopic:null,ageGroup:age,difficultyMode:mode,pet:{type:'cat',name:'Тест',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:70,care:70,development:10},wallet:{balance:1000,savings:0,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},activeGoal:'home',goalContributions:0,goalAdjustments:{},completedGoals:[],inventory:[],completedTasks:[],achievements:[],transactions:[],financialHealth:68,xp:0,streak:1,stats:{needsFirst:0,positiveDecisions:0,budgetViews:0,tasksDone:0,impulsePurchases:0,reserveUsed:0,petNeedsIgnored:0,weeksBalanced:0},currentEventId:'e12',currentChainId:null,eventResolved:false,recentEventIds:[],weekNeedsPlanning:false,weekPlan:{week:2,necessary:400,wants:200,savings:200,reserve:200},weekSnapshot:{week:2,startingBalance:1000,pet:{mood:70},worldStage:1,inventoryIds:[],areas:['home']},weekSummary:null,weekHistory:[{week:1}],weekOpeningCharges:[],dayActions:{count:0,necessary:0,optional:0,income:0,sideJob:false},petWish:null,analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},currentWorldArea:'home',storyChains:{},activityLimits:{week:2,sideJobs:0},workState:{week:2,shiftsUsed:0,shiftsLimit:3,activityUsage:{}},workSession:null,settings:{sound:true,motion:true}};
}
function assert(c,m){if(!c)throw new Error(m)}

// Exercise the actual renderer with old saves and every accessory, not source substrings.
const ids=new Set();
for(const type of ['cat','dog','mumo']) for(const value of [20,55,80]) {
  const seed=base(); Object.assign(seed.pet,{type,satiety:value,mood:value,energy:value,care:value});
  const r=boot(seed),dev=r.sandbox.FINPET_DEV;
  const before=JSON.stringify(dev.getState());
  const expected=value===20?'sad':value===55?'neutral':'happy';
  for(const accessory of ['none','cap','scarf','badge','glasses','headphones','bow','backpack']) {
    const svg=dev.renderPet(type,seed.pet.color,accessory);
    assert((svg.match(/<image /g)||[]).length===1,type+': duplicate raster layers');
    assert((svg.match(/<clipPath /g)||[]).length===1,type+': fragmented silhouette');
    assert(!/class="pet-(eyes|mouth|face|ear|tail|color-wash)/.test(svg),type+': synthetic face or detached crop');
    assert(svg.includes('expression-'+expected),'mood classification lost');
    assert(svg.includes('assets/pets/'+type+'.webp'),'incorrect artwork');
    assert(svg.includes('class="pet-response"><g class="pet-composite">'),'coherent motion hierarchy missing');
    const id=svg.match(/<clipPath id="([^"]+)"/)[1];
    assert(svg.includes('clip-path="url(#'+id+')"'),'unresolved clip');
    if(value===80&&accessory==='none'){assert(!ids.has(id+type),'duplicate fixture id');ids.add(id+type);}
    if(accessory!=='none'){
      assert(svg.includes('data-accessory="'+accessory+'"'),'accessory missing');
      assert(svg.indexOf('pet-composite')<svg.indexOf('data-accessory'),'accessory detached from motion');
      if(accessory==='backpack')assert(svg.indexOf('data-accessory')<svg.indexOf('<image '),'backpack must stay behind pet');
    }
    const next=dev.renderPet(type,seed.pet.color,accessory);
    assert(!next.includes('id="'+id+'"'),'clip ids collide across pets');
  }
  assert(JSON.stringify(dev.getState())===before,'render changed saved state');
}
const index=fs.readFileSync(ROOT+'/index.html','utf8'),sw=fs.readFileSync(ROOT+'/sw.js','utf8');
assert(index.includes('app.js?v=20260918f')&&index.includes('styles.css?v=20260918f'),'cache bust missing');
assert(sw.includes('pets-v11-20260918f'),'service worker version stale');
console.log('v11_layered_pet_smoke: OK — 72 type/mood/accessory combinations');
