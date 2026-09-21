const fs=require('fs'),vm=require('vm');
const sandbox={window:{}}; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(__dirname+'/../content.js','utf8'),sandbox);
const C=sandbox.window.FINPET_CONTENT;
function assert(c,m){if(!c)throw new Error(m)}
assert(C.items.length>=24,'items < 24'); assert(C.events.length===43,'events must stay at 43'); assert(C.tasks.length>=15,'tasks < 15'); assert(C.goals.length>=5,'goals < 5');
assert(C.world.stages.length>=5,'macro stages missing'); assert(C.world.areas.length>=3,'world areas missing'); assert(C.eventChains.length>=2,'event chains missing');
['7-11','12-14','15-17'].forEach(age=>assert(C.events.some(e=>e.age.includes(age)),`no events for ${age}`));
const validAges=['7-11','12-14','15-17']; C.events.concat(C.tasks).forEach(x=>(x.age||[]).forEach(age=>assert(validAges.includes(age),`legacy/invalid age ${age} in ${x.id}`)));
assert(C.accessories.length>=8,'accessories < 8');
assert(C.tasks.filter(t=>t.cyberSafety&&t.age.includes('7-11')).length>=6,'junior cyber-safety tasks < 6');
assert(C.helpTopics.filter(t=>t.ages.includes('7-11')).length>=10,'junior help topics incomplete');
const delayed=['e13','e24','e27','e28','e29','e33']; delayed.forEach(id=>assert(C.events.find(e=>e.id===id).choices.some(c=>c.future),`${id} has no delayed consequence`));
const fields=['type','amount','description','category']; C.events.flatMap(e=>e.choices).filter(c=>c.future).forEach((c,i)=>fields.forEach(k=>assert(c.future[k]!=null,`future ${i} missing ${k}`)));
assert(Object.keys(C.world.placements).length>=10,'world placements too sparse');
assert(C.goalPresentation['15-17'].home.name!=='Новый домик','teen goals not adapted');
assert(Array.isArray(C.workActivities)&&C.workActivities.length>=1,'workActivities missing');
C.workActivities.forEach(a=>{['id','title','ageGroup','reward','energyCost','weeklyLimit','mechanicType','difficulty','unlockCondition','description'].forEach(k=>assert(a[k]!=null,`work activity ${a.id} missing ${k}`));assert(a.ageGroup.includes('15-17'),`work activity ${a.id} must target 15-17`);assert(a.reward>=100&&a.reward<=150,`work reward out of range: ${a.id}`);assert(a.energyCost>0,`work energy cost missing: ${a.id}`);assert(a.steps?.length>=8,`work activity ${a.id} too short`);});
assert(Math.max(...C.workActivities.map(a=>a.reward))*3<=450,'weekly work income can exceed 450');
console.log('validate_content: OK');
