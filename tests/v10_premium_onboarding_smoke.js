const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
function assert(value,message){if(!value)throw new Error(message);}
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const welcome=read('welcome.js'),css=read('welcome.css'),html=read('index.html'),sw=read('sw.js');
const assets=['assets/kopihvost-splash.webp','assets/onboarding-1.webp','assets/onboarding-2.webp','assets/onboarding-3.webp','assets/onboarding-4.webp'];
for(const asset of assets){const full=path.join(ROOT,asset);assert(fs.existsSync(full),`missing ${asset}`);assert(fs.statSync(full).size>8000,`${asset} is unexpectedly small`);assert(sw.includes(`./${asset}`),`${asset} missing from offline cache`);}
['Это твой новый друг','Монеты помогают заботиться','Копи на большие цели','Каждое решение меняет мир'].forEach(text=>assert(welcome.includes(text),`missing onboarding copy: ${text}`));
assert(welcome.includes('premium-intro-card')&&welcome.includes('premium-next-slot')&&welcome.includes('premium-progress'),'premium onboarding markup missing');
assert(welcome.includes("if (!document.querySelector('.splash')) mountWelcome()"),'welcome must wait until splash is gone');
assert(css.includes("url('assets/kopihvost-splash.webp')")&&css.includes('.premium-intro-hero')&&css.includes('.premium-intro-card'),'premium visual CSS missing');
assert(html.includes('welcome.css?v=20260917f')&&html.includes('welcome.js?v=20260917f'),'premium assets are not cache-busted');
assert(html.includes('112756217'),'Yandex Metrika was lost');
console.log('v10_premium_onboarding_smoke: OK');
