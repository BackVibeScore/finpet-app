const fs=require('fs');
const p='app.js';
let s=fs.readFileSync(p,'utf8');
const from="    if(!migrated.currentEventId&&migrated.ageGroup)migrated.currentEventId=selectEventId(migrated,true);";
const to="    if(!migrated.currentEventId&&migrated.difficultyMode){const pool=eventPoolFor(migrated);migrated.currentEventId=pool.length?pool[(migrated.wallet.week*17+migrated.wallet.day*7)%pool.length].id:(C.events[0]?.id||null);}";
if(!s.includes(from)) throw new Error('migration event target not found');
s=s.replace(from,to);
fs.writeFileSync(p,s);
console.log('fix_v6_migration_event: OK');
