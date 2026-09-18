const fs=require('fs');

const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');

const req=(ok,msg)=>{if(!ok)throw new Error(msg)};

const names=[];
for(const m of app.matchAll(/^  function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.push(m[1]);
const duplicates=[...new Set(names.filter((name,i)=>names.indexOf(name)!==i))];
req(duplicates.length===0,'shadowed top-level function declarations remain: '+duplicates.join(', '));

for(const legacy of ['.age-7-11','.age-15-17','.difficulty-settings','.adult-hold','.adult-hold-progress','.parent-puzzle','.parent-puzzle-screen','.parent-puzzle-progress']){
  req(!css.includes(legacy),'legacy CSS selector remains: '+legacy);
}
req(!/@keyframes\s+adultHold\b/.test(css),'legacy adultHold keyframes remain');

req(app.includes("function ageModeClass(){ return `mode-${state.difficultyMode||'easy'}`; }"),'difficulty mode class contract changed');
req(app.includes('parent-quiz-screen')&&app.includes('parent-answer'),'current arithmetic parent gate missing');
req(app.includes("const STORAGE_KEY = 'finpet_mvp_state_v1'"),'storage key changed');
req((app.match(/function\s+petSVG\s*\(/g)||[]).length===1,'petSVG must have exactly one active declaration');

console.log('repo_hygiene_smoke: OK');
