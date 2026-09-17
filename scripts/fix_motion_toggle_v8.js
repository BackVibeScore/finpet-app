const fs = require('fs');

const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

let app = read('app.js');
const motionFn = /  function motionEnabled\(\)\{\n    const systemReduce=typeof window\.matchMedia==='function'&&window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;\n    return state\.settings\?\.motion!==false&&!systemReduce;\n  \}/;
if (!motionFn.test(app)) throw new Error('motionEnabled system override pattern not found');
app = app.replace(motionFn, "  function motionEnabled(){\n    return state.settings?.motion!==false;\n  }");
write('app.js', app);

let styles = read('styles.css');
const stylesMarker = '/* ===== V8 MOTION TOGGLE AUTHORITY ===== */';
if (!styles.includes(stylesMarker)) {
  styles += `\n\n${stylesMarker}\n/* The in-app switch is authoritative. If the OS requests reduced motion but the user explicitly keeps Animation on, restore the product motion layer. */\n@media(prefers-reduced-motion:reduce){\nhtml[data-motion="on"] .screen,html[data-motion="on"] .onboarding{animation:screenEnterAlive .34s cubic-bezier(.2,.75,.2,1) both!important}\nhtml[data-motion="on"] .sheet{animation:sheetEnterAlive .28s cubic-bezier(.2,.75,.2,1) both!important}\nhtml[data-motion="on"] .pet-svg{animation:petFloatAlive 3.6s ease-in-out infinite!important}\nhtml[data-motion="on"] .pet-svg.is-reacting{animation:petReactAlive .68s cubic-bezier(.2,.85,.25,1),petFloatAlive 3.6s .68s ease-in-out infinite!important}\nhtml[data-motion="on"] .pet-svg .pet-body{animation:petBreatheAlive 2.7s ease-in-out infinite!important}\nhtml[data-motion="on"] .pet-svg.expression-sad .pet-body{animation:petBreatheSad 3.8s ease-in-out infinite!important}\nhtml[data-motion="on"] .pet-svg .pet-eyes{animation:petBlinkAlive 5.2s var(--blink-delay,1.2s) ease-in-out infinite!important}\nhtml[data-motion="on"] .pet-svg .pet-tail{animation:petTailAlive 3.2s ease-in-out infinite!important}\nhtml[data-motion="on"] .pet-svg.expression-happy .pet-tail{animation:petTailHappy 1.8s ease-in-out infinite!important}\nhtml[data-motion="on"] .btn,html[data-motion="on"] .action,html[data-motion="on"] .select-card,html[data-motion="on"] .choice,html[data-motion="on"] .menu button,html[data-motion="on"] .nav button,html[data-motion="on"] .chip,html[data-motion="on"] .work-entry,html[data-motion="on"] .help-list button,html[data-motion="on"] .save-controls button,html[data-motion="on"] .withdraw-options button,html[data-motion="on"] .parent-puzzle button{transition:transform .13s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease,background-color .18s ease,filter .18s ease!important}\n}\n/* ===== END V8 ===== */\n`;
}
write('styles.css', styles);

let welcome = read('welcome.css');
const welcomeMarker = '/* v8 explicit in-app motion override */';
if (!welcome.includes(welcomeMarker)) {
  welcome += `\n${welcomeMarker}\n@media (prefers-reduced-motion:reduce){\nhtml[data-motion="on"] .welcome-gate{animation:welcomeFade .38s ease-out both!important}\nhtml[data-motion="on"] .welcome-gate.is-leaving{animation:welcomeFadeOut .33s ease forwards!important}\nhtml[data-motion="on"] .welcome-art-card img,html[data-motion="on"] .intro-art-frame img,html[data-motion="on"] .splash-mark{animation:heroFloat 5.8s ease-in-out infinite!important}\nhtml[data-motion="on"] .welcome-spark{animation:sparkPulse 3.2s ease-in-out infinite!important}\n}\n`;
}
write('welcome.css', welcome);

let index = read('index.html');
index = index.replace(/20260917c/g, '20260917d');
write('index.html', index);

let sw = read('sw.js');
sw = sw.replace(/const CACHE = '[^']+';/, "const CACHE = 'finpet-v8-motion-toggle-20260917d';");
write('sw.js', sw);

const test = `const fs=require('fs');\nconst app=fs.readFileSync('app.js','utf8');\nconst css=fs.readFileSync('styles.css','utf8');\nconst welcome=fs.readFileSync('welcome.css','utf8');\nconst index=fs.readFileSync('index.html','utf8');\nconst sw=fs.readFileSync('sw.js','utf8');\nconst req=(ok,msg)=>{if(!ok)throw new Error(msg)};\nconst motion=app.match(/function motionEnabled\\(\\)\\{([\\s\\S]*?)\\n  \\}/)?.[1]||'';\nreq(motion.includes('return state.settings?.motion!==false;'),'in-app motion toggle is not authoritative');\nreq(!motion.includes('matchMedia'),'motionEnabled still depends on system reduced-motion');\nreq(css.includes('V8 MOTION TOGGLE AUTHORITY'),'missing V8 motion override');\nreq(css.includes('html[data-motion="on"] .pet-svg .pet-eyes'),'blink not restored when app motion is on');\nreq(css.includes('html[data-motion="on"] .screen'),'screen transition not restored when app motion is on');\nreq(welcome.includes('v8 explicit in-app motion override'),'welcome motion override missing');\nreq(index.includes('app.js?v=20260917d')&&index.includes('styles.css?v=20260917d'),'runtime cache-bust missing');\nreq(sw.includes("finpet-v8-motion-toggle-20260917d"),'service worker cache not bumped');\nconsole.log('v8_motion_toggle_runtime_smoke: OK');\n`;
write('tests/v8_motion_toggle_runtime_smoke.js', test);
console.log('fix_motion_toggle_v8: OK');
