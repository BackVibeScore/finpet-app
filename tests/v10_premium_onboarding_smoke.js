const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
function assert(value,message){if(!value)throw new Error(message);}
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const welcome=read('welcome.js'),css=read('welcome.css'),html=read('index.html'),sw=read('sw.js');
const assets=['assets/kopihvost-splash.webp','assets/onboarding-1.webp','assets/onboarding-2.webp','assets/onboarding-3.webp','assets/onboarding-4.webp'];
for(const asset of assets){const full=path.join(ROOT,asset);assert(fs.existsSync(full),`missing ${asset}`);assert(fs.statSync(full).size>180000,`${asset} is still low-resolution/compressed`);assert(sw.includes(`./${asset}`),`${asset} missing from offline cache`);}
assert(fs.statSync(path.join(ROOT,'assets/kopihvost-splash.webp')).size>200000,'splash asset is unexpectedly small');
['Это твой новый друг','Монеты помогают заботиться','Копи на большие цели','Каждое решение меняет мир'].forEach(text=>assert(welcome.includes(text),`missing onboarding copy: ${text}`));
assert(welcome.includes('welcome-tap-surface'),'start screen tap surface missing');
assert(welcome.includes('premium-hotspot-skip')&&welcome.includes('premium-next-slot'),'onboarding interactive hotspots missing');
assert(!welcome.includes('premium-intro-card'),'duplicate HTML onboarding card must not be rendered over baked artwork');
assert(welcome.includes("if (!document.querySelector('.splash')) mountWelcome()"),'welcome must wait until splash is gone');
assert(css.includes('.premium-art-backdrop')&&css.includes('.premium-art-frame')&&css.includes('object-fit:contain'),'crop-safe artwork CSS missing');
assert(css.includes('object-fit:cover')&&css.includes('blur(24px)'),'blurred bleed backdrop missing');
assert(html.includes('welcome.css?v=20260918b')&&html.includes('welcome.js?v=20260918b'),'high-res onboarding is not cache-busted');
assert(sw.includes('finpet-v11-highres-onboarding-20260918b'),'service worker cache was not bumped');
assert(html.includes('112756217'),'Yandex Metrika was lost');
console.log('v10_premium_onboarding_smoke: OK');
