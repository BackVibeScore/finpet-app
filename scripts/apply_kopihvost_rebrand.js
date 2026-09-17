const fs=require('fs');
const path=require('path');
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s);
const must=(s,from,to,label)=>{if(!s.includes(from))throw new Error('Missing '+label);return s.replace(from,to)};

const replaceBrandFiles=['app.js','welcome.js','index.html','manifest.json','scripts/build-standalone.js','README.md','TEST_REPORT.md'];
for(const p of replaceBrandFiles){
  let s=read(p);
  s=s.replaceAll('ФинПитомец','КопиХвост');
  write(p,s);
}

let welcome=read('welcome.js');
welcome=must(welcome,'<span class="welcome-kicker">Игра про деньги, выбор и живой мир</span>','<span class="welcome-kicker">Игра про деньги и своего питомца</span>','welcome kicker');
welcome=must(welcome,'<h1 class="welcome-title">Твой питомец.<br><strong>Твои решения.</strong></h1>','<h1 class="welcome-title">Твой питомец.<br><strong>Твои деньги.</strong><br>Твои решения.</h1>','welcome headline');
welcome=must(welcome,'<p>Копи на мечты, меняй пространство и смотри, как каждое решение отражается на мире вокруг.</p>','<p>Зарабатывай, трать, копи на цели и заботься о своём питомце.</p>','welcome body');
welcome=welcome.replaceAll("p.textContent = 'Игра. Выбор. Свой мир.';","p.textContent = 'Твои деньги. Твои решения.';");
write('welcome.js',welcome);

let app=read('app.js');
for(const old of ['Деньги. Решения. Забота.','Деньги. Решения. Жизнь.','Игра. Выбор. Свой мир.']) app=app.replaceAll(old,'Твои деньги. Твои решения.');
write('app.js',app);

let index=read('index.html');
index=index.replace(/<meta name="description" content="[^"]*" \/>/,'<meta name="description" content="КопиХвост — игра про деньги, решения и своего виртуального питомца" />');
write('index.html',index);

let manifest=JSON.parse(read('manifest.json'));
manifest.name='КопиХвост';
manifest.short_name='КопиХвост';
manifest.description='Игра про деньги, решения и своего виртуального питомца';
write('manifest.json',JSON.stringify(manifest,null,2)+'\n');

let sw=read('sw.js');
sw=sw.replace(/const CACHE = '[^']+';/,"const CACHE = 'finpet-v6-kopihvost-20260917a';");
write('sw.js',sw);

let changelog=read('CHANGELOG.md');
const section=`## V6.1 — бренд «КопиХвост»\n\n- Пользовательское название «ФинПитомец» заменено на «КопиХвост» в splash, onboarding, PWA metadata и пользовательских текстах.\n- Первый экран использует игровое позиционирование: «Твой питомец. Твои деньги. Твои решения.».\n- Технические идентификаторы, включая \`finpet_mvp_state_v1\`, сохранены без изменений ради совместимости сохранений.\n- Добавлены store metadata и автоматическая проверка отсутствия старого бренда в runtime-слое.\n\n`;
if(!changelog.startsWith('## V6.1 — бренд «КопиХвост»')) changelog=section+changelog;
write('CHANGELOG.md',changelog);

const store=`# Store metadata — КопиХвост\n\n## Название\n\n**КопиХвост: игра про деньги**\n\n## Короткое описание\n\n**Зарабатывай, трать, копи на цели и заботься о своём виртуальном питомце.**\n\n## Расширенное описание\n\n**КопиХвост** — финансовая игра для детей, в которой деньги становятся частью жизни виртуального питомца. Игрок получает монеты, планирует бюджет, выбирает между текущими покупками и накоплениями, заботится о питомце и видит последствия своих решений в игровом мире.\n\nВ игре можно распределять карманные деньги, копить на цели, пользоваться копилкой, выполнять задания, зарабатывать дополнительные монеты и проходить жизненные ситуации, связанные с покупками, бюджетом и безопасным обращением с деньгами.\n\nКопиХвост помогает знакомиться с финансовой грамотностью через игру и собственные решения — без реальных платежей, банковских счетов и рекламы.\n\n## Позиционирование\n\n**Финансовая игра для детей. Твой питомец. Твои деньги. Твои решения.**\n\nПоисковые формулировки естественно покрываются текстом: финансовая грамотность, финансовая грамотность для детей, деньги, дети, бюджет, накопления, копилка, карманные деньги, финансовая игра, обучение детей, игра про деньги, планирование бюджета.\n`;
write('STORE_METADATA.md',store);

const brandTest=`const fs=require('fs');\nfunction assert(c,m){if(!c)throw new Error(m)}\nconst runtime=['app.js','welcome.js','index.html','manifest.json'];\nconst old=[/ФинПитомец/iu,/Фин\\s+Питомец/iu,/финпитомец/iu,/FINПитомец/u,/FinPet/u,/Fin\\s+Pet/u];\nfor(const file of runtime){const s=fs.readFileSync(file,'utf8');for(const re of old)assert(!re.test(s),\`old brand remains in \${file}: \${re}\`);}\nconst manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));assert(manifest.name==='КопиХвост'&&manifest.short_name==='КопиХвост','manifest brand mismatch');\nconst index=fs.readFileSync('index.html','utf8');assert(index.includes('<title>КопиХвост</title>'),'document title mismatch');\nconst app=fs.readFileSync('app.js','utf8');const welcome=fs.readFileSync('welcome.js','utf8');assert(app.includes('КопиХвост')&&welcome.includes('КопиХвост'),'runtime brand missing');\nassert(app.includes("finpet_mvp_state_v1")&&welcome.includes("finpet_mvp_state_v1"),'storage compatibility key changed');\nconsole.log('brand_smoke: OK');\n`;
write('tests/brand_smoke.js',brandTest);

console.log('apply_kopihvost_rebrand: OK');
