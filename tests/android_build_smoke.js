const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'dist','android');
function assert(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync(path.join(OUT,'index.html'),'utf8');
assert(!/mc\.yandex\.ru|\bym\s*\(/.test(html),'Yandex Metrika present in Android index');
assert(html.includes('android-native.js')&&html.includes('android-boot.js'),'Android boot scripts missing');
assert(html.includes('storage.js'),'persistence adapter missing');
for(const f of ['app.js','content.js','styles.css','welcome.js','welcome.css','android-native.js','android-boot.js','assets/kopihvost-splash.webp','assets/onboarding-1.webp','assets/onboarding-2.webp','assets/onboarding-3.webp','assets/onboarding-4.webp','assets/objects.webp','assets/extras.webp','assets/worlds.webp']) assert(fs.existsSync(path.join(OUT,f)),'missing offline asset '+f);
const app=fs.readFileSync(path.join(OUT,'app.js'),'utf8');
assert(app.includes('finpet_mvp_state_v1'),'storage compatibility key missing');
assert(app.includes('__FINPET_ANDROID__'),'Android service worker guard missing');
console.log('android_build_smoke: OK');
