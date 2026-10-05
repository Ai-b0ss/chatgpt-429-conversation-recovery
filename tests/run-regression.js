const fs=require('fs');
const path=require('path');
const os=require('os');
const {spawn}=require('child_process');
const {chromium}=require('playwright');

const repo=path.resolve(__dirname,'..');
const profile=path.join(os.tmpdir(),'chatgpt-429-guard-regression-profile');
const ext=path.join(os.tmpdir(),'chatgpt-429-guard-regression-extension');
const base='http://127.0.0.1:9342';
const out=path.join(__dirname,'regression-result.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

fs.rmSync(ext,{recursive:true,force:true});
fs.cpSync(path.join(repo,'extension'),ext,{recursive:true});
const manifestPath=path.join(ext,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
for(const script of manifest.content_scripts) script.matches=[base+'/*'];
manifest.host_permissions=[base+'/*'];
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
const backgroundPath=path.join(ext,'background.js');
let background=fs.readFileSync(backgroundPath,'utf8');
background=background.replaceAll(
  'https://chatgpt.com/backend-api/*',
  base+'/backend-api/*'
);
fs.writeFileSync(backgroundPath,background);

const python=process.platform==='win32'?'python':'python3';
const server=spawn(python,[path.join(__dirname,'server.py')],{stdio:'ignore'});
async function waitServer(){
  for(let i=0;i<50;i++){
    try{ if((await fetch(base+'/')).ok) return; }catch{}
    await sleep(100);
  }
  throw new Error('test_server_not_ready');
}
process.on('exit',()=>{try{server.kill();}catch{}});

async function reset(request){
  await request.get(base+'/reset');
}

async function state(request){
  return await (await request.get(base+'/state')).json();
}

async function clearGuardCooldowns(page){
  await page.evaluate(()=>{
    const prefixes=[
      'chatgpt-429-guard:cooldown:',
      'chatgpt-429-guard:hard-cooldown:'
    ];
    const remove=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key&&prefixes.some(prefix=>key.startsWith(prefix))) remove.push(key);
    }
    for(const key of remove) localStorage.removeItem(key);
  });
  await page.reload({waitUntil:'domcontentloaded',timeout:10000});
  await page.waitForFunction(()=>typeof __CGUARD_STATUS__==='function',{timeout:10000});
}

(async()=>{
  await waitServer();
  fs.rmSync(profile,{recursive:true,force:true});
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
  await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:30000});
  const installed=await page.evaluate(()=>typeof __CGUARD_STATUS__==='function');
  if(!installed) throw new Error('guard_not_installed');

  const results={installed,tests:[]};

  await reset(context.request);
  let t0=Date.now();
  const concurrent=await page.evaluate(async base=>{
    const url=base+'/backend-api/conversations/concurrent?num_turns=10';
    const rs=await Promise.all(Array.from({length:5},()=>fetch(url)));
    return rs.map(r=>r.status);
  },base);
  let st=await state(context.request);
  results.tests.push({
    name:'five_concurrent',
    statuses:concurrent,
    elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/concurrent']||0
  });

  await reset(context.request);
  t0=Date.now();
  const nonTarget=await page.evaluate(async base=>(await fetch(base+'/backend-api/models')).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'non_target_passthrough',status:nonTarget,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/models']||0
  });
  await reset(context.request);
  t0=Date.now();
  const post=await page.evaluate(async base=>(await fetch(base+'/backend-api/conversations/post-id',{
    method:'POST',headers:{'content-type':'application/json'},body:'{}'
  })).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'post_passthrough',status:post,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['POST /backend-api/conversations/post-id']||0
  });

  for(const [name,path] of [
    ['resume_passthrough','/backend-api/f/conversation/resume'],
    ['batch_passthrough','/backend-api/conversations/batch'],
    ['init_passthrough','/backend-api/conversation/init']
  ]){
    await reset(context.request);
    t0=Date.now();
    const status=await page.evaluate(async ({base,path})=>(await fetch(base+path,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    })).status,{base,path});
    st=await state(context.request);
    results.tests.push({
      name,status,elapsedMs:Date.now()-t0,
      networkCalls:st.counts['POST '+path]||0
    });
  }

  await reset(context.request);
  t0=Date.now();
  const abort=await page.evaluate(async base=>{
    const c=new AbortController();
    const p=fetch(base+'/backend-api/conversations/always-429',{signal:c.signal})
      .then(r=>({resolved:true,status:r.status}))
      .catch(e=>({resolved:false,name:e.name,message:String(e)}));
    setTimeout(()=>c.abort('integration-abort'),100);
    return await p;
  },base);
  await sleep(800);
  st=await state(context.request);
  results.tests.push({
    name:'abort_during_backoff',outcome:abort,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/always-429']||0
  });
  await clearGuardCooldowns(page);
  await reset(context.request);
  t0=Date.now();
  const terminal429=await page.evaluate(async base=>(await fetch(
    base+'/backend-api/conversations/always-429'
  )).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'terminal_429_escape',
    status:terminal429,
    elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/always-429']||0
  });

  await clearGuardCooldowns(page);
  await reset(context.request);
  t0=Date.now();
  const reqObj=await page.evaluate(async base=>{
    const req=new Request(base+'/backend-api/conversations/request-object?num_turns=10');
    return (await fetch(req)).status;
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'request_object',status:reqObj,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/request-object']||0
  });

  await clearGuardCooldowns(page);
  await reset(context.request);
  t0=Date.now();
  const streamStatus=await page.evaluate(async base=>(await fetch(
    base+'/backend-api/conversation/stream-status-test/stream_status'
  )).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'stream_status_transient_recovery',
    status:streamStatus,
    elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversation/stream-status-test/stream_status']||0
  });

  const streamNoise=await page.evaluate(async base=>{
    const before={...__CGUARD_STREAM_STATUS__().metrics};
    const events=[];
    const onEvent=e=>{ try{events.push(JSON.parse(e.detail));}catch{} };
    window.addEventListener('__cguard_event__',onEvent);
    const paths=[
      '/backend-api/conversation/empty-204/stream_status',
      '/backend-api/conversation/empty-200/stream_status',
      '/backend-api/conversation/malformed-status/stream_status',
      '/backend-api/conversation/malformed-status/stream_status',
      '/backend-api/conversation/malformed-status/stream_status',
      '/backend-api/conversation/repeat-status/stream_status',
      '/backend-api/conversation/repeat-status/stream_status',
      '/backend-api/conversation/repeat-status/stream_status'
    ];
    const statuses=[];
    for(const path of paths) statuses.push((await fetch(base+path)).status);
    await new Promise(r=>setTimeout(r,150));
    window.removeEventListener('__cguard_event__',onEvent);
    const after={...__CGUARD_STREAM_STATUS__().metrics};
    return {
      statuses,
      emptyDelta:(after.streamStatusEmpty||0)-(before.streamStatusEmpty||0),
      parseDelta:(after.parseErrors||0)-(before.parseErrors||0),
      observedDelta:(after.streamStatusObserved||0)-(before.streamStatusObserved||0),
      transitionDelta:(after.streamStatusTransitions||0)-(before.streamStatusTransitions||0),
      parseEvents:events.filter(e=>e.type==='stream-status-parse-error').length,
      observedEvents:events.filter(e=>e.type==='stream-status-observed').length
    };
  },base);
  results.tests.push({name:'stream_status_noise_control',...streamNoise});

  await clearGuardCooldowns(page);
  await reset(context.request);
  await page.evaluate(async base=>{
    const response=await fetch(base+'/backend-api/conversation/recovery-test/stream_status');
    await response.json();
  },base);
  await page.waitForFunction(
    ()=>typeof __CGUARD_STREAM_STATUS__==='function' &&
      (__CGUARD_STREAM_STATUS__().metrics?.streamingObserved||0)>=1,
    {timeout:2000}
  );
  t0=Date.now();
  const resumeRecovery=await page.evaluate(async base=>{
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'recovery-test',offset:0})
    });
    return {status:response.status,body:await response.text()};
  },base);
  st=await state(context.request);
  const recoveryObserverStatus=await page.evaluate(()=>__CGUARD_STREAM_STATUS__());
  results.tests.push({
    name:'resume_404_recovery',
    status:resumeRecovery.status,
    body:resumeRecovery.body,
    elapsedMs:Date.now()-t0,
    networkCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/recovery-test/stream_status']||0,
    recoverySuccess:recoveryObserverStatus.metrics?.recoverySuccess||0
  });

  await reset(context.request);
  t0=Date.now();
  const retryAfter=await page.evaluate(async base=>(await fetch(
    base+'/backend-api/conversations/retry-after'
  )).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'retry_after_honored',status:retryAfter,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/retry-after']||0
  });

  await clearGuardCooldowns(page);
  await reset(context.request);
  t0=Date.now();
  const uiBudget=await page.evaluate(async base=>(await fetch(
    base+'/backend-api/conversations/ui-budget'
  )).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'ui_budget_transient_recovery',
    status:uiBudget,
    elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/ui-budget']||0
  });

  await clearGuardCooldowns(page);
  await reset(context.request);
  t0=Date.now();
  const family=await page.evaluate(async base=>{
    const first=fetch(base+'/backend-api/conversations/global-a').then(r=>r.status);
    await new Promise(r=>setTimeout(r,250));
    const second=fetch(base+'/backend-api/conversations/global-b').then(r=>r.status);
    return await Promise.all([first,second]);
  },base);
  st=await state(context.request);
  const aCall=st.calls.find(c=>c.path==='/backend-api/conversations/global-a'&&c.n===1);
  const bCall=st.calls.find(c=>c.path==='/backend-api/conversations/global-b'&&c.n===1);
  results.tests.push({
    name:'different_conversations_share_cooldown',
    statuses:family,
    elapsedMs:Date.now()-t0,
    firstToSecondMs:aCall&&bCall?Math.round((bCall.t-aCall.t)*1000):null,
    aCalls:st.counts['GET /backend-api/conversations/global-a']||0,
    bCalls:st.counts['GET /backend-api/conversations/global-b']||0
  });

  await reset(context.request);
  await page.evaluate(()=>__CGUARD_DISABLE__());
  t0=Date.now();
  const disabled=await page.evaluate(async base=>(await fetch(
    base+'/backend-api/conversations/concurrent'
  )).status,base);
  st=await state(context.request);
  results.tests.push({
    name:'kill_switch',status:disabled,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/concurrent']||0
  });
  await page.evaluate(()=>__CGUARD_ENABLE__());
  await reset(context.request);
  const page2=await context.newPage();
  await page2.goto(base+'/',{waitUntil:'domcontentloaded',timeout:10000});
  t0=Date.now();
  const both=await Promise.all([
    page.evaluate(async base=>(await fetch(base+'/backend-api/conversations/two-tabs')).status,base),
    page2.evaluate(async base=>(await fetch(base+'/backend-api/conversations/two-tabs')).status,base)
  ]);
  st=await state(context.request);
  results.tests.push({
    name:'two_tabs_same_conversation',statuses:both,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/two-tabs']||0
  });

  let worker=null;
  for(let i=0;i<30&&!worker;i++){
    worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||null;
    if(!worker) await page.waitForTimeout(100);
  }
  results.storage=worker
    ? await worker.evaluate(async()=>await chrome.storage.local.get([
        'cguard_counts','cguard_last_event','cguard_events'
      ]))
    : null;
  results.guardStatus=await page.evaluate(()=>__CGUARD_STATUS__());
  results.streamObserverStatus=await page.evaluate(()=>
    typeof __CGUARD_STREAM_STATUS__==='function' ? __CGUARD_STREAM_STATUS__() : null
  );
  const byName=Object.fromEntries(results.tests.map(t=>[t.name,t]));
  const checks={
    fiveConcurrent:byName.five_concurrent.networkCalls===2 && byName.five_concurrent.statuses.every(x=>x===200),
    nonTarget:byName.non_target_passthrough.networkCalls===1 && byName.non_target_passthrough.status===429,
    post:byName.post_passthrough.networkCalls===1 && byName.post_passthrough.status===429,
    resumePassive:byName.resume_passthrough.networkCalls===1 && byName.resume_passthrough.status===429,
    batchPassive:byName.batch_passthrough.networkCalls===1 && byName.batch_passthrough.status===429,
    initPassive:byName.init_passthrough.networkCalls===1 && byName.init_passthrough.status===429,
    abort:byName.abort_during_backoff.networkCalls===1 && byName.abort_during_backoff.outcome.resolved===false,
    terminal429:byName.terminal_429_escape.networkCalls===3 &&
      byName.terminal_429_escape.status===429,
    requestObject:byName.request_object.networkCalls===2 && byName.request_object.status===200,
    streamStatus:byName.stream_status_transient_recovery.networkCalls===2 &&
      byName.stream_status_transient_recovery.status===200 &&
      byName.stream_status_transient_recovery.elapsedMs<9000,
    streamStatusNoiseControl:byName.stream_status_noise_control.statuses.join(',')==='204,200,200,200,200,200,200,200' &&
      byName.stream_status_noise_control.emptyDelta===2 &&
      byName.stream_status_noise_control.parseDelta===3 &&
      byName.stream_status_noise_control.observedDelta===3 &&
      byName.stream_status_noise_control.transitionDelta===1 &&
      byName.stream_status_noise_control.parseEvents===1 &&
      byName.stream_status_noise_control.observedEvents===1,
    resume404Recovery:byName.resume_404_recovery.networkCalls===2 &&
      byName.resume_404_recovery.streamStatusCalls===1 &&
      byName.resume_404_recovery.status===200 &&
      byName.resume_404_recovery.body.includes('resume_conversation_token') &&
      byName.resume_404_recovery.elapsedMs<8000,
    retryAfter:byName.retry_after_honored.networkCalls===2 && byName.retry_after_honored.status===200 && byName.retry_after_honored.elapsedMs>=14500,
    uiBudget:byName.ui_budget_transient_recovery.networkCalls===3 &&
      byName.ui_budget_transient_recovery.status===200 &&
      byName.ui_budget_transient_recovery.elapsedMs<9000,
    globalCooldown:byName.different_conversations_share_cooldown.aCalls===2 &&
      byName.different_conversations_share_cooldown.bCalls===1 &&
      byName.different_conversations_share_cooldown.statuses.every(x=>x===200) &&
      byName.different_conversations_share_cooldown.firstToSecondMs>=900 &&
      byName.different_conversations_share_cooldown.firstToSecondMs<2500,
    killSwitch:byName.kill_switch.networkCalls===1 && byName.kill_switch.status===429,
    twoTabs:byName.two_tabs_same_conversation.networkCalls<=3 && byName.two_tabs_same_conversation.statuses.every(x=>x===200),
    networkTelemetry:(results.storage?.cguard_counts?.['network-429']||0)>=6,
    terminal429Telemetry:(()=>{
      const events=results.storage?.cguard_events||[];
      return events.some(e=>e.type==='429-final'&&e.surface==='conversation-detail'&&
        e.status===429&&e.protection==='active');
    })(),
    streamStatusTelemetry:(()=>{
      const events=results.storage?.cguard_events||[];
      return events.some(e=>e.type==='429-backoff'&&e.surface==='stream-status'&&e.protection==='active');
    })(),
    resumeRecoveryMetric:(byName.resume_404_recovery.recoverySuccess||0)>=1,
    resumeRecoveryTelemetry:(()=>{
      const events=results.storage?.cguard_events||[];
      return events.some(e=>e.type==='resume-recovery-success'&&
        e.attempt===1&&e.offset===1&&e.status===200);
    })(),
    passiveSurfaceTelemetry:(()=>{
      const events=results.storage?.cguard_events||[];
      return ['conversation-resume','conversation-batch','conversation-init'].every(surface=>
        events.some(e=>e.type==='network-429'&&e.surface===surface&&e.protection==='passive-only')
      );
    })(),
    diagnosticPrivacy:(()=>{
      const events=results.storage?.cguard_events||[];
      const forbiddenKeys=['rateHash','tabId','url','conversationId','requestBody','responseBody'];
      return events.every(e=>
        forbiddenKeys.every(key=>!(key in e)) &&
        !JSON.stringify(e).includes('/backend-api/') &&
        !JSON.stringify(e).includes('stream-status-test') &&
        !JSON.stringify(e).includes('recovery-test')
      );
    })(),
    globalCooldownMetric:(results.guardStatus?.metrics?.globalCooldownHits||0)>=1,
    softCooldownCapMetric:(results.guardStatus?.metrics?.softCooldownCaps||0)>=1
  };
  results.checks=checks;
  results.pass=Object.values(checks).every(Boolean);
  fs.writeFileSync(out,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
  await context.close();
  try{server.kill();}catch{}
  if(!results.pass) process.exit(2);
})().catch(e=>{
  try{server.kill();}catch{}
  console.error(e.stack||String(e));
  process.exit(1);
});
