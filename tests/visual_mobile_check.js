const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const OUT=path.join(__dirname,'screenshots');
fs.mkdirSync(OUT,{recursive:true});
const sizes=[[320,568],[360,740],[390,844],[430,932]];
function assert(c,m){if(!c)throw new Error(m)}
async function metrics(page,label,width){
  const data=await page.evaluate(()=>{
    const visible=el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const small=[...document.querySelectorAll('button,input,select')].filter(visible).map(el=>{const r=el.getBoundingClientRect();return {text:(el.textContent||el.getAttribute('aria-label')||el.id||el.tagName).trim().slice(0,60),w:Math.round(r.width),h:Math.round(r.height)};}).filter(x=>x.w<44||x.h<44);
    return {scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyScrollWidth:document.body.scrollWidth,small};
  });
  assert(data.scrollWidth<=data.clientWidth+1&&data.bodyScrollWidth<=data.clientWidth+1,`${label} ${width}px has horizontal overflow: ${JSON.stringify(data)}`);
  assert(data.small.length===0,`${label} ${width}px has controls smaller than 44px: ${JSON.stringify(data.small)}`);
  return {label,width,...data};
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  const report=[];
  for(const [width,height] of sizes){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});
    await page.locator('[data-intro-skip]').waitFor();
    report.push(await metrics(page,'intro',width));
    if(width===320)await page.screenshot({path:path.join(OUT,'intro-320.png'),fullPage:true});
    await page.locator('[data-intro-skip]').click();
    await page.locator('[data-age="7-11"]').click();
    await page.locator('[data-age-next]').click();
    await page.locator('#petName').fill('Искорка');
    await page.locator('#accessory').selectOption('headphones');
    assert(await page.locator('#petName').inputValue()==='Искорка','accessory rerender reset pet name');
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('finpet_mvp_state_v1')));
    assert(stored.pet.accessory==='headphones','accessory was not saved immediately');
    await page.locator('[data-start]').click();
    await page.locator('[data-save-plan]').click();
    if(await page.locator('[data-close-modal]').count())await page.locator('[data-close-modal]').click();
    await page.locator('.home-screen').waitFor();
    assert(await page.getByText('В копилке',{exact:true}).count()>0,'home savings missing');
    assert(await page.getByText('Активное задание',{exact:true}).count()>0,'home active task missing');
    report.push(await metrics(page,'home',width));
    await page.screenshot({path:path.join(OUT,`home-${width}.png`),fullPage:true});
    if(width===390){
      const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('finpet_mvp_state_v1')).wallet.balance);
      await page.locator('[data-route="shop"]').first().click();
      await page.locator('[data-buy]').first().click();
      assert(await page.getByText('Не сейчас',{exact:true}).count()>0,'purchase confirmation missing');
      const balanceBeforeConfirmation=await page.evaluate(()=>JSON.parse(localStorage.getItem('finpet_mvp_state_v1')).wallet.balance);
      assert(balanceBeforeConfirmation===before,'purchase changed balance before confirmation');
      report.push(await metrics(page,'purchase-confirmation',width));
      await page.screenshot({path:path.join(OUT,'purchase-confirmation-390.png'),fullPage:true});
      await page.locator('[data-purchase-cancel]').click();
      await page.locator('[data-help]').click();
      await page.getByText('Повторить вводное знакомство',{exact:true}).waitFor();
      report.push(await metrics(page,'help',width));
      await page.screenshot({path:path.join(OUT,'help-390.png'),fullPage:true});
      await page.locator('[data-back]').click();
      await page.locator('[data-savings]').first().click();
      await page.locator('[data-save="200"]').click();
      await page.locator('[data-withdraw="100"]').click();
      assert(await page.getByText('До операции',{exact:true}).count()>0,'withdrawal preview missing');
      report.push(await metrics(page,'withdrawal-preview',width));
      await page.screenshot({path:path.join(OUT,'withdrawal-preview-390.png'),fullPage:true});
      await page.locator('[data-withdraw-cancel]').click();
      await page.locator('[data-back]').click();
      await page.locator('[data-route="profile"]').last().click();
      await page.locator('[data-route="adultGate"]').click();
      await page.locator('[data-adult-hold]').dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true});
      await page.waitForTimeout(3150);
      await page.getByText('Чему учат механики',{exact:true}).waitFor();
      report.push(await metrics(page,'adult',width));
      await page.screenshot({path:path.join(OUT,'adult-390.png'),fullPage:true});
    }
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname,'visual_report.json'),JSON.stringify(report,null,2));
  console.log('visual_mobile_check: OK');
  for(const row of report)console.log(`${row.label}@${row.width}: overflow=${row.scrollWidth-row.clientWidth}, smallTargets=${row.small.length}`);
})().catch(err=>{console.error(err);process.exit(1);});
