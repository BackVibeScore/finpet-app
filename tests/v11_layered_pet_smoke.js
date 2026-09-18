const fs=require('fs');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const content=fs.readFileSync('content.js','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const req=(ok,msg)=>{if(!ok)throw new Error(msg)};
req(app.includes('V11 layered character renderer'),'V11 renderer missing');
req(app.includes('pet-art-layer')&&app.includes('pet-layered'),'detailed layered art missing');
req(app.includes('petRenderSeq')&&app.includes('clipPath id="${rid}-body"'),'unique per-render clip ids missing');
req(app.includes('pet-accessory-slot')&&app.includes('data-slot="${slot}"'),'accessory slot renderer missing');
for(const slot of ['slot-head','slot-face','slot-neck','slot-chest','slot-back']) req(css.includes(slot),'missing accessory slot '+slot);
for(const type of ['cat','dog','mumo']){
  const asset='assets/pets/'+type+'.webp';
  req(content.includes(asset),'missing '+type+' art mapping');
  req(fs.existsSync(asset),'missing '+asset);
  req(fs.statSync(asset).size>20000,asset+' is unexpectedly small');
}
for(const id of ['none','cap','scarf','badge','glasses','headphones','bow','backpack']) req(content.includes("id:'"+id+"'"),'accessory '+id+' lost');
req(app.includes("const expression=(moodAverage>=70&&moodWeakest>=45)?'happy'"),'expression thresholds changed');
req(css.includes('V11 LAYERED PREMIUM PETS'),'V11 CSS missing');
req(css.includes('@keyframes petBlinkLayered'),'layered blink missing');
req(css.includes('html[data-motion="off"] .pet-svg.pet-layered'),'motion-off coverage missing');
req(css.includes('html[data-motion="on"] .pet-svg.pet-layered .pet-eyes'),'motion-on override missing');
req(sw.includes('finpet-v12-onboarding-render-fix-20260918c-pets-v11-20260918d'),'pet cache version missing');
req(sw.includes('petArt=/'),'pet asset network-first handling missing');
req(index.includes('app.js?v=20260918d')&&index.includes('styles.css?v=20260918d'),'V11 cache bust missing');
console.log('v11_layered_pet_smoke: OK');
