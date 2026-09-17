const fs=require('fs');
const p='app.js';
let s=fs.readFileSync(p,'utf8');
const from="    let u=null; for(const key of ageKeys){u=C.goalUnlocksByAge?.[key]?.[goalId]||u;} u=u||C.goalUnlocks?.[goalId]; if(!u)return[];";
const to="    let u=null; for(const key of ageKeys){if(!u)u=C.goalUnlocksByAge?.[key]?.[goalId]||null;} u=u||C.goalUnlocks?.[goalId]; if(!u)return[];";
if(!s.includes(from)) throw new Error('goal unlock adapter target not found');
s=s.replace(from,to);
fs.writeFileSync(p,s);
console.log('fix_v6_goal_unlock: OK');
