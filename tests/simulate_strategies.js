const fs=require('fs');
const strategies={
  economical:{necessary:400,wants:60,savings:340,worldBuyEvery:5,moodDelta:-3},
  impulsive:{necessary:400,wants:430,savings:40,worldBuyEvery:1,moodDelta:8},
  balanced:{necessary:400,wants:190,savings:240,worldBuyEvery:3,moodDelta:0}
};
function sim(cfg,weeks=6){
  let balance=0,savings=0,mood=72,worldItems=0,reserve=0,goals=0;
  for(let w=1;w<=weeks;w++){
    balance+=1000;
    balance-=cfg.necessary;
    balance-=cfg.wants;
    const save=Math.min(cfg.savings,Math.max(0,balance)); balance-=save; savings+=save;
    if(w%cfg.worldBuyEvery===0){const price=140;if(balance>=price){balance-=price;worldItems++;mood+=4;}}
    if(savings>=1200){savings-=1200;goals++;worldItems+=2;mood+=5;}
    mood=Math.max(35,Math.min(95,mood+cfg.moodDelta)); reserve=balance;
  }
  return {balance,savings,reserve,mood,worldItems,goals};
}
const out=Object.fromEntries(Object.entries(strategies).map(([k,v])=>[k,sim(v)]));
if(!(out.economical.savings>out.impulsive.savings))throw new Error('economical should save more');
if(!(out.impulsive.worldItems>out.economical.worldItems))throw new Error('impulsive should develop visible world faster');
if(!(out.impulsive.mood>out.economical.mood))throw new Error('impulsive should have stronger short-term mood');
if(!(out.balanced.reserve>out.impulsive.reserve&&out.balanced.worldItems>out.economical.worldItems&&out.balanced.worldItems<out.impulsive.worldItems))throw new Error('balanced should preserve reserve and moderate world progress');
if(!(out.balanced.mood>out.economical.mood&&out.balanced.mood<out.impulsive.mood))throw new Error('balanced mood should stay between extremes');
fs.writeFileSync(__dirname+'/strategy_results.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
