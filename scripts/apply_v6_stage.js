const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const write = (p,s) => fs.writeFileSync(path.join(root,p),s);
function mustReplace(s, from, to, label){
  if(!s.includes(from)) throw new Error(`Missing replacement target: ${label}`);
  return s.replace(from,to);
}
function replaceLast(s, from, to, label){
  const i=s.lastIndexOf(from); if(i<0) throw new Error(`Missing last target: ${label}`);
  return s.slice(0,i)+to+s.slice(i+from.length);
}
function insertBeforeLast(s, marker, block, label){
  const i=s.lastIndexOf(marker); if(i<0) throw new Error(`Missing insert marker: ${label}`);
  return s.slice(0,i)+block+s.slice(i);
}

let app = read('app.js');

// State v6: difficultyMode is the public/product mode. ageGroup remains a compatibility adapter only.
app = replaceLast(app,
`      version:5,\n      onboardingDone:false,`,
`      version:6,\n      onboardingDone:false,`, 'fresh state version');
app = replaceLast(app,
`      legacyAgeGroup:null,\n      ageGroup:null,`,
`      legacyAgeGroup:null,\n      ageGroup:null,\n      difficultyMode:null,`, 'difficulty field');
app = replaceLast(app,
`      ...base,...raw,version:5,`,
`      ...base,...raw,version:6,`, 'migrated version');

const migrationMarker = `    if(!C.accessories.some(a=>a.id===migrated.pet.accessory)) migrated.pet.accessory='none';`;
const migrationBlock = `    // v6: remove age from the product UI and migrate to two difficulty modes without losing progress.\n    if(rawVersion<6 || !['easy','medium'].includes(migrated.difficultyMode)){\n      const source=raw.difficultyMode || raw.ageGroup || migrated.ageGroup || null;\n      if(['easy','7-11','8-10'].includes(source)) migrated.difficultyMode='easy';\n      else if(['medium','12-14','15-17','11-13','14-17'].includes(source)) migrated.difficultyMode='medium';\n      else migrated.difficultyMode=raw.onboardingDone?'easy':null;\n    }\n    // Compatibility adapter for historical content metadata only. UI and new analytics use difficultyMode.\n    migrated.ageGroup=migrated.difficultyMode==='easy'?'7-11':migrated.difficultyMode==='medium'?'12-14':null;\n    migrated.ageMigrationPending=false;\n`;
app = mustReplace(app, migrationMarker, migrationBlock+migrationMarker, 'v6 migration block');

// Side job is a medium-mode mechanic even though legacy content metadata originally used 15-17.
app = app.replace(/if \(state\.ageGroup !== '15-17'\) return \[\];/g, `if (state.difficultyMode !== 'medium') return [];`);
app = app.replace(/if \(state\.ageGroup !== '15-17'\) \{ route='home'; return homeScreen\(\); \}/g, `if (state.difficultyMode !== 'medium') { route='home'; return homeScreen(); }`);
app = app.replace(/if\(state\.ageGroup!==\'15-17\'\) return;/g, `if(state.difficultyMode!=='medium') return;`);
app = app.replace(/if\(state\.ageGroup!==\'15-17\'\)return;/g, `if(state.difficultyMode!=='medium')return;`);

const v6Block = read('scripts/v6_override.inc');
app = insertBeforeLast(app, `  window.FINPET_DEV = {`, v6Block, 'v6 override block');

// Make the existing motion toggle operational and observable.
app = replaceLast(app,
`    document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.toggle;state.settings[k]=!state.settings[k];save();render();});`,
`    document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.toggle;state.settings[k]=!state.settings[k];if(k==='motion'){track(state.settings.motion?'motion_enabled':'motion_disabled',{difficultyMode:state.difficultyMode});syncMotionPreference();}save();render();});`, 'motion toggle analytics');

// Expose v6 helpers to smoke tests and future maintenance.
app = replaceLast(app, `    freshState, migrateState, actualsForWeek, weeksToGoal, healthText, version:5,`, `    freshState, migrateState, actualsForWeek, weeksToGoal, healthText, version:6,`, 'dev version');
app = replaceLast(app, `    adult:{isUnlocked:()=>adultUnlocked,completeHold:completeAdultHold},`, `    adult:{isUnlocked:()=>adultUnlocked,completeHold:completeAdultHold,createPuzzle:createParentPuzzle,choosePuzzle:chooseParentPuzzle,lock:lockAdultGate,getPuzzle:()=>JSON.parse(JSON.stringify(parentPuzzle()))},\n    difficulty:{label:difficultyLabel,ages:modeAges,set:setDifficulty},\n    motion:{enabled:motionEnabled,sync:syncMotionPreference},`, 'dev interfaces');

write('app.js', app);

// Welcome copy: no age language and explicit need/want/save framing.
let welcome = read('welcome.js');
welcome = mustReplace(welcome, `title: 'Сейчас или потом?',\n      text: 'На всё сразу монет не хватит. Выбирай, что взять сегодня, а ради чего стоит немного подождать.',`, `title: 'Монет на всё не хватит',\n      text: 'Сначала реши, что нужно питомцу. Потом — что хочется сейчас и на что копить.',`, 'welcome finance copy');
welcome = mustReplace(welcome, `labelA: 'Сейчас',\n      labelB: 'Большая цель',`, `labelA: 'Нужно',\n      labelB: 'Хочу / Коплю',`, 'welcome labels');
welcome = welcome.replace(/button: 'Выбрать возраст'/g, `button: 'Выбрать режим'`);
write('welcome.js',welcome);

// Child-first typography, touch targets, motion layer and parent puzzle styling.
let css = read('styles.css');
const cssAppend = String.raw`

/* ===== V6 CHILD UX + MOTION ===== */
.screen{animation:screenEnter .24s ease-out both}.btn,.action,.select-card,.choice,.menu button,.nav button,.chip,.work-entry,.help-list button{transition:transform .14s ease,box-shadow .18s ease,background-color .18s ease,border-color .18s ease}.btn:active,.action:active,.select-card:active,.choice:active,.menu button:active,.nav button:active,.chip:active,.work-entry:active,.help-list button:active{transform:scale(.97)}
@keyframes screenEnter{from{opacity:.2;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}
@keyframes petBlink{0%,42%,46%,100%{transform:scaleY(1)}44%{transform:scaleY(.08)}}
@keyframes petIdle{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-3px) rotate(.35deg)}}
@keyframes petReact{0%{transform:translateY(0) scale(1)}45%{transform:translateY(-10px) scale(1.035)}100%{transform:translateY(0) scale(1)}}
@keyframes worldSway{0%,100%{transform:rotate(-.8deg) translateY(0)}50%{transform:rotate(.8deg) translateY(-2px)}}
@keyframes motionPop{0%{opacity:0;transform:translate(-50%,10px) scale(.92)}20%{opacity:1;transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-18px) scale(.98)}}
.pet-svg{animation:petIdle 4.8s ease-in-out infinite!important}.pet-svg ellipse[cx="77"],.pet-svg ellipse[cx="123"]{transform-box:fill-box;transform-origin:center;animation:petBlink 5.8s var(--blink-delay,3s) ease-in-out infinite}.pet-bubble~.pet-svg{animation:petReact .55s ease-out,petIdle 4.8s .55s ease-in-out infinite!important}.world-decor,.artwork-object{transform-origin:center bottom;animation:worldSway 6.8s ease-in-out infinite}.motion-feedback{position:fixed;left:50%;top:18%;z-index:180;transform:translateX(-50%);padding:10px 15px;border-radius:999px;background:#172033;color:#fff;font-weight:800;font-size:15px;box-shadow:0 14px 30px rgba(23,32,51,.18);pointer-events:none;animation:motionPop .85s ease-out both}.motion-feedback.income,.motion-feedback.saving,.motion-feedback.goal{background:#20795e}.motion-feedback.expense{background:#9c4c55}
.screen p,.card p,.week-lead,.help-article p,.adult-screen p{font-size:16px;line-height:1.45}.task-card p,.task-teaser p,.goal-card p,.goal-select p,.shop-item p,.tx p,.subtle{font-size:14px}.app-shell small{font-size:13px;line-height:1.35}.metric .label,.metric .hint,.field label,.tag,.reward,.mini-stat span{font-size:12px}.nav button{min-height:54px;font-size:11px}.menu button,.help-list button,.action,.choice,.select-card,.chip,.linkbtn,.color-dot,.save-controls button,.jar-controls button,.help-button,[data-back]{min-height:48px}.color-dot{min-width:48px}.action b{font-size:13px}.topbar h1{font-size:30px}.section-title h2{font-size:21px}.select-card h3{font-size:18px}.difficulty-grid{grid-template-columns:1fr 1fr}.difficulty-grid .select-card{min-height:128px}.difficulty-settings{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}.difficulty-settings .select-card{min-height:116px}.settings-group{margin-bottom:16px}
.parent-puzzle-screen>p{max-width:34ch}.parent-puzzle{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.parent-puzzle button{height:132px;border:1px solid var(--line);border-radius:24px;background:var(--surface);display:grid;place-items:center;color:var(--primary);box-shadow:var(--shadow);overflow:hidden}.parent-puzzle button:active{transform:scale(.97)}.parent-puzzle-progress{display:flex;gap:8px;justify-content:center;margin:8px 0 14px}.parent-puzzle-progress i{width:11px;height:11px;border-radius:50%;background:#d9deea}.parent-puzzle-progress i.done{background:var(--green)}.parent-gate-message{padding:10px 14px;border-radius:14px;background:#fff4df;color:#805b22;text-align:center;font-weight:700}.adult-hold{display:none!important}
[data-motion="off"] *{animation:none!important;transition:none!important;scroll-behavior:auto!important}[data-motion="off"] .pet-svg,[data-motion="off"] .world-decor,[data-motion="off"] .artwork-object{transform:none!important}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media(max-width:380px){.difficulty-grid,.difficulty-settings{grid-template-columns:1fr}.parent-puzzle button{height:112px}.screen{padding-left:15px;padding-right:15px}}
/* ===== END V6 ===== */
`;
if(!css.includes('/* ===== V6 CHILD UX + MOTION ===== */')) css += cssAppend;
write('styles.css',css);

let wcss=read('welcome.css');
if(!wcss.includes('/* v6 motion preference */')) wcss += `\n/* v6 motion preference */\n[data-motion="off"] .welcome-gate,[data-motion="off"] .welcome-gate *,[data-motion="off"] .splash,[data-motion="off"] .splash *{animation:none!important;transition:none!important}\n`;
write('welcome.css',wcss);

let sw=read('sw.js');
sw=sw.replace(/const CACHE = '[^']+';/,`const CACHE = 'finpet-v6-difficulty-motion-20260917a';`);
write('sw.js',sw);

// Update regression tests for v6 semantics while retaining all previous checks.
let v5=read('tests/v5_requirements_smoke.js');
v5=v5.replace(/version:5,onboardingDone:true/g,`version:6,onboardingDone:true`);
v5=v5.replace(/ageGroup:age,/g,`ageGroup:age,difficultyMode:age==='7-11'?'easy':'medium',`);
v5=v5.replace(`assert(s.ageGroup==='7-11'&&!s.ageMigrationPending,'8-10 must auto-migrate to 7-11');`,`assert(s.difficultyMode==='easy'&&s.ageGroup==='7-11'&&!s.ageMigrationPending,'8-10 must migrate to easy');`);
v5=v5.replace(`for(const [oldAge,mapped] of [['11-13','12-14'],['14-17','15-17']]){r=boot({...legacy,ageGroup:oldAge});s=r.dev.getState();assert(s.ageGroup===mapped&&s.ageMigrationPending,\`${oldAge} must request one-time age clarification\`);}`,`for(const oldAge of ['11-13','14-17','12-14','15-17']){r=boot({...legacy,version:5,ageGroup:oldAge,difficultyMode:null});s=r.dev.getState();assert(s.difficultyMode==='medium'&&!s.ageMigrationPending,\`${oldAge} must migrate to medium\`);}`);
v5=v5.replace(`// Adult section only unlocks after a full three-second hold.\nassert(!r.dev.adult.completeHold(2999)&&!r.dev.adult.isUnlocked(),'adult barrier opened too early');assert(r.dev.adult.completeHold(3000)&&r.dev.adult.isUnlocked(),'adult barrier did not open at 3 seconds');s=r.dev.getState();assert(s.analytics.some(x=>x.name==='adult_section_opened'),'adult analytics missing');`,`// Adult section uses an interactive randomized puzzle; the old hold no longer unlocks it.\nassert(!r.dev.adult.completeHold(3000)&&!r.dev.adult.isUnlocked(),'legacy hold must not unlock adult section');const puzzle=r.dev.adult.getPuzzle();for(const id of puzzle.correct){assert(r.dev.adult.choosePuzzle(id),'correct parent puzzle step failed');}assert(r.dev.adult.isUnlocked(),'parent puzzle did not unlock adult section');s=r.dev.getState();assert(s.analytics.some(x=>x.name==='parent_gate_completed'),'parent gate analytics missing');`);
write('tests/v5_requirements_smoke.js',v5);

let side=read('tests/side_job_smoke.js');
side=side.replace(`assert(dev.version===5,'dev version must be 5');`,`assert(dev.version===6,'dev version must be 6');`);
write('tests/side_job_smoke.js',side);

// New v6-specific smoke coverage.
const v6test=`const fs=require('fs'),vm=require('vm'),crypto=require('crypto').webcrypto;\nconst ROOT=__dirname+'/..';\nfunction element(){return {innerHTML:'',dataset:{},style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelector:()=>element(),querySelectorAll:()=>[],addEventListener:()=>{},remove:()=>{}}}\nfunction boot(seed){const app=element(),store={};if(seed)store.finpet_mvp_state_v1=JSON.stringify(seed);const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]};const document={documentElement:{dataset:{}},getElementById:id=>id==='app'?app:element(),querySelector:()=>null,querySelectorAll:()=>[],createElement:element,body:{appendChild:()=>{}},addEventListener:()=>{}};const sb={window:null,document,localStorage,location:{protocol:'file:'},navigator:{},crypto,Intl,console,confirm:()=>true,Math,setTimeout:(fn,ms)=>{if(ms<=1000)fn();return 1},clearTimeout:()=>{},matchMedia:()=>({matches:false})};sb.window=sb;sb.window.scrollTo=()=>{};vm.createContext(sb);vm.runInContext(fs.readFileSync(ROOT+'/content.js','utf8'),sb);vm.runInContext(fs.readFileSync(ROOT+'/app.js','utf8'),sb);return sb.window.FINPET_DEV;}\nfunction assert(c,m){if(!c)throw new Error(m)}\nconst base={version:5,onboardingDone:true,onboardingStep:6,ageGroup:'15-17',pet:{type:'cat',name:'Тест',color:'#7C8CF8',accessory:'none',satiety:70,mood:70,energy:80,care:70,development:10},wallet:{balance:777,savings:333,weeklyIncome:1000,week:2,day:1,nextIncomeIn:7,needsSpent:0},completedGoals:[],inventory:[],completedTasks:['t1'],achievements:[],transactions:[],stats:{},recentEventIds:[],weekHistory:[{week:1}],analytics:[],futureObligations:[],worldProgress:{stage:2,areas:['home'],unlocks:[],decor:[]},worldPlacements:{},storyChains:{},settings:{sound:true,motion:true},dayActions:{}};\nlet dev=boot(base),s=dev.getState();assert(dev.version===6,'v6 dev version');assert(s.difficultyMode==='medium','15-17 must migrate to medium');assert(s.wallet.balance===777&&s.wallet.savings===333&&s.completedTasks[0]==='t1','migration lost progress');assert(dev.difficulty.ages().includes('12-14')&&dev.difficulty.ages().includes('15-17'),'medium adapter must union both legacy groups');assert(dev.work.available().length>0,'side job must remain in medium mode');dev.difficulty.set('easy');s=dev.getState();assert(s.difficultyMode==='easy'&&s.ageGroup==='7-11','easy compatibility mapping failed');assert(dev.work.available().length===0,'side job must be hidden in easy mode');dev.difficulty.set('medium');const p=dev.adult.getPuzzle();dev.adult.choosePuzzle('wrong');assert(!dev.adult.isUnlocked(),'wrong puzzle answer unlocked adult');const q=dev.adult.getPuzzle();for(const id of q.correct){dev.adult.choosePuzzle(id);}assert(dev.adult.isUnlocked(),'correct puzzle sequence failed');dev.adult.lock();assert(!dev.adult.isUnlocked(),'adult gate did not relock');assert(s.settings.motion!==false,'motion default changed');console.log('v6_requirements_smoke: OK');\n`;
write('tests/v6_requirements_smoke.js',v6test);

// Keep documentation honest and current.
let changelog=read('CHANGELOG.md');
if(!changelog.includes('## V6 — режимы сложности')) changelog=`## V6 — режимы сложности, motion и родительский gate\n\n- Возрастные режимы в интерфейсе заменены на «Лёгкий» и «Средний».\n- Старые сохранения мигрируют без потери прогресса; ageGroup остаётся только как внутренний адаптер старого контента.\n- Средний режим объединяет контент 12–14 и 15–17, включая подработку и более сложные финансовые сценарии.\n- Добавлен системный motion-layer, живой idle питомца, моргание, реакции кнопок и финансовый feedback.\n- Переключатель «Анимация» теперь реально отключает motion и учитывает prefers-reduced-motion.\n- Родительский вход заменён на случайную визуальную головоломку и повторно блокируется после выхода.\n- Детский UX получил более крупный текст, крупные touch targets и упрощённые формулировки.\n\n`+changelog;
write('CHANGELOG.md',changelog);

console.log('apply_v6_stage: OK');
