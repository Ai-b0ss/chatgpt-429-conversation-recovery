const fs=require('fs');
const path=require('path');
const os=require('os');
const {chromium}=require('playwright');

const repo=path.resolve(__dirname,'..');
const ext=path.join(os.tmpdir(),'cguard-long-recovery-extension');
const profile=path.join(os.tmpdir(),'cguard-long-recovery-profile');
const out=path.join(__dirname,'long-recovery-result.json');
const testPage='https://chatgpt.com/cguard-long-recovery-test';
const endpoint='https://chatgpt.com/backend-api/conversations/long-recovery-test?num_turns=10';
const failureWindowMs=45000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.rmSync(ext,{recursive:true,force:true});
  fs.rmSync(profile,{recursive:true,force:true});
  fs.cpSync(path.join(repo,'extension'),ext,{recursive:true});

  const context=await chromium.launchPersistentContext(profile,{
    headless:false,
    args:[
      '--disable-extensions-except='+ext,
      '--load-extension='+ext,
      '--window-position=-32000,-32000',
      '--window-size=800,600',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const page=context.pages()[0]||await context.newPage();
  const events=[];
  let endpointCalls=0;
  let firstEndpointAt=0;
  let first200At=0;

  await page.route('https://chatgpt.com/cguard-long-recovery-test',async route=>{
    await route.fulfill({
      status:200,
      contentType:'text/html',
      body:'<!doctype html><meta charset="utf-8"><title>CGUARD long recovery</title><body>test</body>'
    });
  });

  await page.route('**/backend-api/conversations/long-recovery-test**',async route=>{
    endpointCalls++;
    const now=Date.now();
    if(!firstEndpointAt) firstEndpointAt=now;
    if(now-firstEndpointAt < failureWindowMs){
      await route.fulfill({
        status:429,
        contentType:'application/json',
        body:JSON.stringify({detail:'Too many requests'})
      });
      return;
    }
    if(!first200At) first200At=now;
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({ok:true,recovered:true})
    });
  });

  await page.goto(testPage,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>typeof window.__CGUARD_STATUS__==='function',{timeout:10000});

  await page.evaluate(()=>{
    window.__LONG_RECOVERY_EVENTS__=[];
    window.addEventListener('__cguard_event__',e=>{
      try{ window.__LONG_RECOVERY_EVENTS__.push(JSON.parse(e.detail)); }catch{}
    });
  });

  const started=Date.now();
  const fetchPromise=page.evaluate(async url=>{
    window.__LONG_RECOVERY_SETTLED__=false;
    try{
      const response=await fetch(url);
      const body=await response.text();
      window.__LONG_RECOVERY_SETTLED__=true;
      return {resolved:true,status:response.status,body};
    }catch(error){
      window.__LONG_RECOVERY_SETTLED__=true;
      return {resolved:false,error:String(error)};
    }
  },endpoint);

  await sleep(20000);
  const mid=await page.evaluate(()=>({
    settled:window.__LONG_RECOVERY_SETTLED__===true,
    events:window.__LONG_RECOVERY_EVENTS__||[],
    status:window.__CGUARD_STATUS__()
  }));

  const result=await fetchPromise;
  const elapsedMs=Date.now()-started;
  const finalState=await page.evaluate(()=>({
    events:window.__LONG_RECOVERY_EVENTS__||[],
    status:window.__CGUARD_STATUS__()
  }));

  const finalEvents=finalState.events;
  const backoffs=finalEvents.filter(e=>e.type==='429-backoff');
  const finals=finalEvents.filter(e=>e.type==='429-final');
  const recovered=finalEvents.filter(e=>e.type==='429-recovered');

  const report={
    testPage,
    failureWindowMs,
    endpointCalls,
    firstTo200Ms:first200At&&firstEndpointAt?first200At-firstEndpointAt:null,
    elapsedMs,
    mid:{
      settled:mid.settled,
      final429Count:mid.events.filter(e=>e.type==='429-final').length,
      backoffCount:mid.events.filter(e=>e.type==='429-backoff').length
    },
    result,
    events:{
      backoffs:backoffs.map(e=>({attempt:e.attempt,waitMs:e.waitMs,status:e.status})),
      final429Count:finals.length,
      recovered:recovered.map(e=>({attempt:e.attempt,status:e.status,elapsedMs:e.elapsedMs}))
    },
    guardVersion:finalState.status?.version,
    pass:
      mid.settled===false &&
      mid.events.every(e=>e.type!=='429-final') &&
      result.resolved===true &&
      result.status===200 &&
      finals.length===0 &&
      recovered.length>=1 &&
      elapsedMs>=failureWindowMs &&
      elapsedMs<5*60*1000
  };

  fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await context.close();
  process.exit(report.pass?0:2);
})().catch(e=>{
  console.error(e.stack||String(e));
  process.exit(1);
});