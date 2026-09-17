const fs=require('fs');
function assert(c,m){if(!c)throw new Error(m)}
const runtime=['app.js','welcome.js','index.html','manifest.json'];
const old=[/ФинПитомец/iu,/Фин\s+Питомец/iu,/финпитомец/iu,/FINПитомец/u,/FinPet/u,/Fin\s+Pet/u];
for(const file of runtime){const s=fs.readFileSync(file,'utf8');for(const re of old)assert(!re.test(s),`old brand remains in ${file}: ${re}`);}
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));assert(manifest.name==='КопиХвост'&&manifest.short_name==='КопиХвост','manifest brand mismatch');
const index=fs.readFileSync('index.html','utf8');assert(index.includes('<title>КопиХвост</title>'),'document title mismatch');
const app=fs.readFileSync('app.js','utf8');const welcome=fs.readFileSync('welcome.js','utf8');assert(app.includes('КопиХвост')&&welcome.includes('КопиХвост'),'runtime brand missing');
assert(app.includes("finpet_mvp_state_v1")&&welcome.includes("finpet_mvp_state_v1"),'storage compatibility key changed');
console.log('brand_smoke: OK');
