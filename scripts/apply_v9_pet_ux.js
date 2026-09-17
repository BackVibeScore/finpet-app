const fs=require('fs');
function mustReplace(src,from,to,label){if(!src.includes(from))throw new Error('Missing '+label);return src.replace(from,to);}
let app=fs.readFileSync('app.js','utf8');

app=mustReplace(app,'Режим можно изменить позже в настройках.','Выбери режим, с которым начнёшь игру.','onboarding difficulty copy');

const settingsBlock=/<div class=\\"settings-group\\"><div class=\\"section-title\\"><h2>Режим игры<\/h2><\/div><div class=\\"difficulty-settings\\">[\s\S]*?<\/div><\/div><div class=\\"settings-group interface-settings\\">/g;
let settingsCount=0;
app=app.replace(settingsBlock,()=>{settingsCount++;return '<div class=\\"settings-group interface-settings\\">';});
if(!settingsCount)throw new Error('Difficulty settings block not found');

app=app.replace(/\s*const mode=e\.target\?\.closest\?\.\('\[data-difficulty-change\]'\);if\(mode\)\{[\s\S]*?return;\}/g,'');

const petStart='  function petSVG(type=state.pet.type,color=state.pet.color,accessory=state.pet.accessory) {';
const petEnd='\n\n  function learningArtwork(kind) {';
const ps=app.indexOf(petStart);if(ps<0)throw new Error('Latest petSVG not found');
const pe=app.indexOf(petEnd,ps);if(pe<0)throw new Error('petSVG end not found');
const newPet=`  function petSVG(type=state.pet.type,color=state.pet.color,accessory=state.pet.accessory) {
    const face=type==='dog'
      ? \`<g class="pet-ears pet-ears-dog"><path class="pet-ear pet-ear-left" d="M48 75 C32 52 31 31 48 28 C58 27 66 39 70 51" fill="#71564b"/><path class="pet-ear pet-ear-right" d="M152 75 C168 52 169 31 152 28 C142 27 134 39 130 51" fill="#71564b"/></g>\`
      : type==='cat'
        ? \`<g class="pet-ears pet-ears-cat"><path class="pet-ear pet-ear-left" d="M49 62 L53 25 L78 52 Z" fill="\${color}"/><path class="pet-ear pet-ear-right" d="M151 62 L147 25 L122 52 Z" fill="\${color}"/></g>\`
        : \`<g class="pet-ears pet-ears-mumo"><path class="pet-ear pet-ear-left" d="M58 54 C42 35 47 22 59 31 L76 52 Z" fill="\${color}"/><path class="pet-ear pet-ear-right" d="M142 54 C158 35 153 22 141 31 L124 52 Z" fill="\${color}"/></g>\`;
    const extra=type==='mumo'?\`<g class="pet-forehead"><circle cx="100" cy="52" r="10" fill="#fff" opacity=".85"/><circle cx="100" cy="52" r="4" fill="#26314c"/></g>\`:'';
    const y=type==='dog'?4:type==='mumo'?-1:0;
    const moodValues=['satiety','mood','energy','care'].map(k=>Number(state.pet?.[k]??0));
    const moodAverage=moodValues.reduce((sum,n)=>sum+n,0)/Math.max(1,moodValues.length);
    const moodWeakest=Math.min(...moodValues);
    const expression=(moodAverage>=70&&moodWeakest>=45)?'happy':((moodAverage<45||moodWeakest<25)?'sad':'neutral');
    const expressionMarkup=expression==='happy'
      ? '<g class="pet-expression pet-expression-happy"><path class="pet-mouth" d="M87 116 Q100 132 113 116" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/></g>'
      : expression==='sad'
        ? '<g class="pet-expression pet-expression-sad"><path class="pet-mouth" d="M88 126 Q100 112 112 126" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/><path class="pet-brows" d="M67 86 Q76 81 84 87M116 87 Q124 81 133 86" stroke="#26314c" stroke-width="3" fill="none" stroke-linecap="round"/></g>'
        : '<g class="pet-expression pet-expression-neutral"><path class="pet-mouth" d="M91 120 Q100 122 109 120" stroke="#26314c" stroke-width="4" fill="none" stroke-linecap="round"/></g>';
    const tail=type==='mumo'?'':(type==='dog'
      ? '<path class="pet-tail" d="M148 133 Q176 127 170 105 Q166 94 157 100" fill="none" stroke="'+color+'" stroke-width="15" stroke-linecap="round"/>'
      : '<path class="pet-tail" d="M149 137 Q181 137 178 109 Q176 91 160 91" fill="none" stroke="'+color+'" stroke-width="14" stroke-linecap="round"/>');
    const behind=accessory==='backpack'?\`<g transform="translate(0 \${y})"><path d="M40 89 Q24 94 28 143 Q30 163 51 160 L58 102Z" fill="#b45e3d"/><path d="M160 89 Q176 94 172 143 Q170 163 149 160 L142 102Z" fill="#b45e3d"/><path d="M39 101 Q52 80 67 83" fill="none" stroke="#6b3d2d" stroke-width="6"/></g>\`:'';
    const accessories={
      cap:\`<g transform="translate(0 \${y})"><path d="M62 50 Q100 28 138 50 L130 61 H67 Z" fill="#285441"/><path d="M127 56 Q153 56 158 66 Q139 67 124 64Z" fill="#285441"/></g>\`,
      scarf:'<path d="M57 137 Q100 151 143 137 L139 153 Q101 165 61 151Z" fill="#c86f48"/><path d="M119 149 L136 181 L119 184 L108 154Z" fill="#c86f48"/>',
      badge:'<circle cx="135" cy="139" r="10" fill="#e7c76b"/><path d="M135 133 l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z" fill="#765516"/>',
      glasses:\`<g transform="translate(0 \${y})" fill="none" stroke="#31473d" stroke-width="4"><rect x="60" y="88" width="34" height="23" rx="10"/><rect x="106" y="88" width="34" height="23" rx="10"/><path d="M94 97 Q100 93 106 97M60 95 L49 91M140 95 L151 91"/></g>\`,
      headphones:\`<g transform="translate(0 \${y})"><path d="M55 98 Q55 55 100 55 Q145 55 145 98" fill="none" stroke="#3f5c72" stroke-width="8"/><rect x="47" y="91" width="17" height="35" rx="8" fill="#d27a52"/><rect x="136" y="91" width="17" height="35" rx="8" fill="#d27a52"/></g>\`,
      bow:\`<g transform="translate(0 \${y})"><path d="M99 139 Q76 122 65 139 Q77 158 99 147Z" fill="#b45e6b"/><path d="M101 139 Q124 122 135 139 Q123 158 101 147Z" fill="#b45e6b"/><circle cx="100" cy="143" r="7" fill="#7d3948"/></g>\`,
      backpack:''
    };
    return \`<svg class="pet-svg expression-\${expression}\${petBubble?' is-reacting':''}" viewBox="0 0 200 200" aria-label="Питомец \${esc(state.pet.name)}" role="img"><ellipse class="pet-shadow" cx="100" cy="177" rx="61" ry="13" fill="#7c88aa" opacity=".16"/>\${tail}<g class="pet-body">\${face}\${behind}<path class="pet-core" d="M45 102 C45 65 67 48 100 48 C133 48 155 65 155 102 L151 135 C147 163 129 176 100 176 C71 176 53 163 49 135 Z" fill="\${color}"/>\${extra}<g class="pet-face"><g class="pet-gaze"><g class="pet-eyes"><ellipse cx="77" cy="98" rx="8" ry="10" fill="#26314c"/><ellipse cx="123" cy="98" rx="8" ry="10" fill="#26314c"/><circle cx="74" cy="94" r="2.5" fill="#fff"/><circle cx="120" cy="94" r="2.5" fill="#fff"/></g></g><path class="pet-nose" d="M96 108 Q100 111 104 108 Q100 115 96 108Z" fill="#26314c" opacity=".78"/>\${expressionMarkup}<g class="pet-cheeks"><ellipse cx="61" cy="116" rx="10" ry="5" fill="#fff" opacity=".16"/><ellipse cx="139" cy="116" rx="10" ry="5" fill="#fff" opacity=".16"/></g></g>\${accessories[accessory]||''}</g></svg>\`;
  }`;
app=app.slice(0,ps)+newPet+app.slice(pe);

const gateStart='  function createParentPuzzle(){';
const gs=app.indexOf(gateStart);if(gs<0)throw new Error('Parent gate start not found');
const ge=app.indexOf('  function adultScreen(){',gs);if(ge<0)throw new Error('Parent gate end not found');
const gate=`  function createParentPuzzle(){
    const a=6+Math.floor(Math.random()*7),b=3+Math.floor(Math.random()*7),correct=a+b;
    const values=new Set([correct]);
    for(const delta of [1,-1,2,-2,3,-3]){if(values.size>=4)break;const value=correct+delta;if(value>0)values.add(value);}
    const options=[...values].slice(0,4);for(let i=options.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[options[i],options[j]]=[options[j],options[i]];}
    parentPuzzleState={a,b,correct,options,attempted:false};return parentPuzzleState;
  }
  function parentPuzzle(){return parentPuzzleState||createParentPuzzle();}
  function chooseParentPuzzle(answer){
    const p=parentPuzzle();if(!p.attempted){p.attempted=true;track('parent_gate_attempted',{difficultyMode:state.difficultyMode});}
    if(Number(answer)!==p.correct){track('parent_gate_failed',{type:'quick_sum'});parentGateMessage='Не получилось — попробуйте другой пример.';createParentPuzzle();render();return false;}
    adultUnlocked=true;track('parent_gate_completed',{type:'quick_sum'});track('adult_section_opened',{difficultyMode:state.difficultyMode});save();route='adult';parentPuzzleState=null;parentGateMessage='';render();return true;
  }
  function lockAdultGate(){adultUnlocked=false;parentPuzzleState=null;parentGateMessage='';}
  function completeAdultHold(){return false;}
  function adultGateScreen(){
    const p=parentPuzzle();return \`<section class="screen adult-screen parent-quiz-screen">\${topbar('Для взрослых',true)}<div class="adult-illustration">\${learningArtwork('adult')}</div><h2>Небольшая проверка</h2><p>Чтобы открыть раздел, выберите ответ: <b>\${p.a} + \${p.b} = ?</b></p><div class="parent-quiz" aria-label="Проверка для взрослого">\${p.options.map(x=>\`<button class="parent-answer" data-parent-puzzle="\${x}">\${x}</button>\`).join('')}</div>\${parentGateMessage?\`<p class="parent-gate-message" role="status">\${parentGateMessage}</p>\`:''}<p class="subtle">Это защита от случайного входа, а не пароль.</p></section>\`;
  }
`;
app=app.slice(0,gs)+gate+app.slice(ge);

fs.writeFileSync('app.js',app);

let css=fs.readFileSync('styles.css','utf8');
const v9=`\n\n/* ===== V9 PET MICRO-MOTION + UX POLISH ===== */
@keyframes petEarLeftV9{0%,68%,100%{transform:rotate(0)}72%{transform:rotate(-10deg)}76%{transform:rotate(5deg)}80%{transform:rotate(0)}}
@keyframes petEarRightV9{0%,54%,100%{transform:rotate(0)}58%{transform:rotate(9deg)}62%{transform:rotate(-4deg)}66%{transform:rotate(0)}}
@keyframes petGazeV9{0%,24%,48%,72%,100%{transform:translateX(0)}32%,40%{transform:translateX(2.3px)}56%,64%{transform:translateX(-2.3px)}}
@keyframes petNoseV9{0%,100%{transform:translateY(0)}50%{transform:translateY(1.1px)}}
@keyframes petCheeksV9{0%,100%{opacity:.74;transform:scale(1)}50%{opacity:1;transform:scale(1.07)}}
@keyframes petMouthHappyV9{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.08)}}
@keyframes petShadowV9{0%,100%{transform:scaleX(1);opacity:.16}45%,55%{transform:scaleX(.88);opacity:.11}}
.pet-svg .pet-ear{transform-box:fill-box}.pet-svg .pet-ear-left{transform-origin:right bottom;animation:petEarLeftV9 5.6s ease-in-out infinite}.pet-svg .pet-ear-right{transform-origin:left bottom;animation:petEarRightV9 6.1s ease-in-out infinite}.pet-svg .pet-gaze{transform-box:fill-box;transform-origin:center;animation:petGazeV9 7.4s ease-in-out infinite}.pet-svg .pet-nose{transform-box:fill-box;transform-origin:center;animation:petNoseV9 2.7s ease-in-out infinite}.pet-svg .pet-cheeks{transform-box:fill-box;transform-origin:center;animation:petCheeksV9 3.4s ease-in-out infinite}.pet-svg .pet-shadow{transform-box:fill-box;transform-origin:center;animation:petShadowV9 3.6s ease-in-out infinite}.pet-svg.expression-happy .pet-mouth{transform-box:fill-box;transform-origin:center;animation:petMouthHappyV9 2.4s ease-in-out infinite}.pet-svg.expression-sad .pet-ear-left{animation-duration:7.4s}.pet-svg.expression-sad .pet-ear-right{animation-duration:7.9s}.pet-svg.expression-sad .pet-gaze{animation-duration:9s}
.nav button[data-route="profile"]>.art{margin-top:2px;margin-bottom:0}
.parent-quiz{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0 12px}.parent-answer{min-height:62px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--text);font-size:22px;font-weight:600}.parent-answer:active{transform:scale(.96)}.parent-gate-message{margin:8px 0;color:var(--muted)!important}
html[data-motion="off"] .pet-ear,html[data-motion="off"] .pet-gaze,html[data-motion="off"] .pet-nose,html[data-motion="off"] .pet-cheeks,html[data-motion="off"] .pet-shadow,html[data-motion="off"] .pet-mouth{animation:none!important;transition:none!important;transform:none!important}
/* ===== END V9 ===== */\n`;
if(!css.includes('V9 PET MICRO-MOTION'))css+=v9;
fs.writeFileSync('styles.css',css);

let index=fs.readFileSync('index.html','utf8').replaceAll('20260917d','20260917e');fs.writeFileSync('index.html',index);
let sw=fs.readFileSync('sw.js','utf8');sw=sw.replace(/const CACHE = '[^']+';/,"const CACHE = 'finpet-v9-pet-ux-20260917e';");fs.writeFileSync('sw.js',sw);

let v6=fs.readFileSync('tests/v6_requirements_smoke.js','utf8');
v6=mustReplace(v6,"dev.difficulty.set('medium');const p=dev.adult.getPuzzle();dev.adult.choosePuzzle('wrong');assert(!dev.adult.isUnlocked(),'wrong puzzle answer unlocked adult');const q=dev.adult.getPuzzle();for(const id of q.correct){dev.adult.choosePuzzle(id);}assert(dev.adult.isUnlocked(),'correct puzzle sequence failed');","dev.difficulty.set('medium');const p=dev.adult.getPuzzle();dev.adult.choosePuzzle(String(p.correct+99));assert(!dev.adult.isUnlocked(),'wrong puzzle answer unlocked adult');const q=dev.adult.getPuzzle();dev.adult.choosePuzzle(String(q.correct));assert(dev.adult.isUnlocked(),'correct parent check failed');",'v6 parent gate test');
fs.writeFileSync('tests/v6_requirements_smoke.js',v6);

const v9test=`const fs=require('fs');\nconst app=fs.readFileSync('app.js','utf8'),css=fs.readFileSync('styles.css','utf8');\nconst req=(ok,msg)=>{if(!ok)throw new Error(msg)};\nreq(app.includes('pet-ear-left')&&app.includes('pet-ear-right'),'pet ears are not independently addressable');\nreq(app.includes('pet-gaze')&&app.includes('pet-nose')&&app.includes('pet-cheeks'),'pet face micro-motion elements missing');\nreq(css.includes('@keyframes petEarLeftV9')&&css.includes('@keyframes petGazeV9')&&css.includes('@keyframes petShadowV9'),'V9 pet micro-motion keyframes missing');\nreq(css.includes('.nav button[data-route="profile"]>.art{margin-top:2px'),'profile nav icon alignment fix missing');\nreq(!app.includes('data-difficulty-change'),'difficulty switch must not exist in settings');\nreq(!app.includes('Режим можно изменить позже в настройках.'),'onboarding still promises settings difficulty switch');\nreq(app.includes('class="parent-quiz"')&&app.includes(' + ${p.b} = ?'),'simplified parent check missing');\nreq(css.includes('html[data-motion="off"] .pet-ear'),'motion off does not stop V9 pet micro-motion');\nconsole.log('v9_pet_ux_smoke: OK');\n`;
fs.writeFileSync('tests/v9_pet_ux_smoke.js',v9test);
