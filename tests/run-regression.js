const fs=require('fs');
const path=require('path');
const os=require('os');
const {spawn}=require('child_process');
const {chromium}=require('playwright');

const repo=path.resolve(__dirname,'..');
const profile=path.join(os.tmpdir(),'chatgpt-429-guard-regression-profile');
const ext=path.join(os.tmpdir(),'chatgpt-429-guard-regression-extension');
const port=9400+(process.pid%400);
const base='http://127.0.0.1:'+port;
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
const server=spawn(python,[path.join(__dirname,'server.py')],{
  stdio:'ignore',
  env:{...process.env,PORT:String(port)}
});
async function waitServer(){
  for(let i=0;i<120;i++){
    try{
      const response=await fetch(base+'/',{
        signal:AbortSignal.timeout(500)
      });
      if(response.ok) return;
    }catch{}
    await sleep(100);
  }
  throw new Error('test_server_not_ready');
}
process.on('exit',()=>{try{server.kill();}catch{}});
let context=null;

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
  context=await chromium.launchPersistentContext(profile,{
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

  await reset(context.request);
  t0=Date.now();
  const abort=await page.evaluate(async base=>{
    const c=new AbortController();
    const p=fetch(base+'/backend-api/conversations/always-429',{signal:c.signal})
      .then(r=>({resolved:true,status:r.status}))
      .catch(e=>({resolved:false,name:e.name,message:String(e)}));
    setTimeout(()=>c.abort('integration-abort'),500);
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
  const reqObj=await page.evaluate(async base=>{
    const req=new Request(base+'/backend-api/conversations/request-object?num_turns=10');
    return (await fetch(req)).status;
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'request_object',status:reqObj,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/request-object']||0
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
    const deadline=Date.now()+3000;
    while(Date.now()<deadline){
      let active=false;
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!key||!key.startsWith('chatgpt-429-guard:cooldown:')) continue;
        const until=Number(localStorage.getItem(key));
        if(Number.isFinite(until)&&until>Date.now()){
          active=true;
          break;
        }
      }
      if(active) break;
      await new Promise(r=>setTimeout(r,20));
    }
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

  const recoveryDefaultActive=await page.evaluate(
    ()=>__CGUARD_STREAM_STATUS__().recoveryActive
  );
  await page.evaluate(()=>__CGUARD_RESUME_RECOVERY_DISABLE__());
  await reset(context.request);
  t0=Date.now();
  const streamResume=await page.evaluate(async base=>{
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-404/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const resume404=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-404',offset:0})
    });
    await resume404.text();
    const wsObserved=await new Promise(resolve=>{
      const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws');
      const timer=setTimeout(()=>{
        try{ws.close();}catch{}
        resolve(false);
      },1500);
      ws.addEventListener('message',()=>{
        clearTimeout(timer);
        try{ws.close();}catch{}
        resolve(true);
      },{once:true});
      ws.addEventListener('error',()=>{
        clearTimeout(timer);
        resolve(false);
      },{once:true});
    });
    await new Promise(r=>setTimeout(r,100));
    const resumeSuccess=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-success',offset:0})
    });
    await resumeSuccess.text();
    await new Promise(r=>setTimeout(r,200));
    return {
      streamStatus,
      resume404:resume404.status,
      wsObserved,
      resumeSuccess:resumeSuccess.status,
      observer:typeof __CGUARD_STREAM_STATUS__==='function'
        ? __CGUARD_STREAM_STATUS__()
        : null
    };
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'passive_stream_resume_observer',
    recoveryDefaultActive,
    ...streamResume,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-404/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });

  await reset(context.request);
  t0=Date.now();
  const activeRecovery=await page.evaluate(async base=>{
    __CGUARD_RESUME_RECOVERY_ENABLE__();
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-recover/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const started=performance.now();
    const recovered=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-resume-context':'preserve-me'
      },
      body:JSON.stringify({
        conversation_id:'resume-recover',
        offset:0,
        probe:'keep-me'
      })
    });
    const body=await recovered.text();
    await new Promise(r=>setTimeout(r,150));
    return {
      streamStatus,
      status:recovered.status,
      elapsedMs:Math.round(performance.now()-started),
      hasDone:body.includes('[DONE]'),
      observer:__CGUARD_STREAM_STATUS__()
    };
  },base);
  st=await state(context.request);
  const recoveryCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_offset_recovery',
    ...activeRecovery,
    totalElapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-recover/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:recoveryCalls.map(c=>c.offset),
    probes:recoveryCalls.map(c=>c.probe),
    contexts:recoveryCalls.map(c=>c.resume_context)
  });

  await reset(context.request);
  t0=Date.now();
  const absoluteOffsetRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-absolute/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        conversation_id:'resume-absolute',
        offset:1
      })
    });
    const body=await response.text();
    await new Promise(r=>setTimeout(r,100));
    const after=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      hasDone:body.includes('[DONE]'),
      successDelta:
        (after.metrics.recoverySuccess||0)-
        (before.recoverySuccess||0),
      observer:after
    };
  },base);
  st=await state(context.request);
  const absoluteCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_absolute_offsets',
    ...absoluteOffsetRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts[
      'GET /backend-api/conversation/resume-absolute/stream_status'
    ]||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:absoluteCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const handoffRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-handoff/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-handoff',offset:0})
    });
    const body=await response.text();
    await new Promise(r=>setTimeout(r,150));
    const observer=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      hasHandoff:body.includes('stream_handoff'),
      handoffDelta:
        (observer.metrics.resumeHandoffObserved||0)-
        (before.resumeHandoffObserved||0),
      terminalDelta:
        (observer.metrics.resumeTerminalSuccess||0)-
        (before.resumeTerminalSuccess||0),
      observerContainsSyntheticToken:
        JSON.stringify(observer).includes('lab-token'),
      observer
    };
  },base);
  st=await state(context.request);
  const handoffCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_accepts_handoff_sse',
    ...handoffRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-handoff/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:handoffCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const websocketSuppression=await page.evaluate(async base=>{
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-ws/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const ws=new WebSocket(
      base.replace(/^http/,'ws')+
      '/ws?conversation_id=resume-ws&delay_ms=250'
    );
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('ws-open-timeout')),1000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('ws-open-error'));},{once:true});
    });
    const started=performance.now();
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-ws',offset:0})
    });
    await response.text();
    await new Promise(r=>setTimeout(r,100));
    try{ws.close();}catch{}
    return {
      streamStatus,
      status:response.status,
      elapsedMs:Math.round(performance.now()-started),
      observer:__CGUARD_STREAM_STATUS__()
    };
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'active_resume_ws_suppression',
    ...websocketSuppression,
    totalElapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-ws/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });
  await reset(context.request);
  t0=Date.now();
  const staleDetailRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const detailPromise=fetch(
      base+'/backend-api/conversations/resume-detail-hydrate'
    ).then(r=>r.status);
    await new Promise(r=>setTimeout(r,50));
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-detail-hydrate/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const started=performance.now();
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        conversation_id:'resume-detail-hydrate',
        offset:0
      })
    });
    const body=await response.text();
    const detailStatus=await detailPromise;
    await new Promise(r=>setTimeout(r,100));
    const after=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      detailStatus,
      elapsedMs:Math.round(performance.now()-started),
      hasDone:body.includes('[DONE]'),
      successDelta:
        (after.metrics.recoverySuccess||0)-
        (before.recoverySuccess||0),
      detailSuccessObservedDelta:
        (after.metrics.recoveryDetailSuccessObserved||0)-
        (before.recoveryDetailSuccessObserved||0),
      detailWaitDelta:
        (after.metrics.recoveryDetailWaits||0)-
        (before.recoveryDetailWaits||0),
      observer:after
    };
  },base);
  st=await state(context.request);
  const staleDetailResumeCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_stale_detail_still_recovers',
    ...staleDetailRecovery,
    totalElapsedMs:Date.now()-t0,
    detailCalls:st.counts[
      'GET /backend-api/conversations/resume-detail-hydrate'
    ]||0,
    streamStatusCalls:st.counts[
      'GET /backend-api/conversation/resume-detail-hydrate/stream_status'
    ]||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:staleDetailResumeCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const detailFailureRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const detailPromise=fetch(
      base+'/backend-api/conversations/resume-detail-fail'
    ).then(r=>r.status);
    await new Promise(r=>setTimeout(r,50));
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-detail-fail/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const started=performance.now();
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        conversation_id:'resume-detail-fail',
        offset:0
      })
    });
    const body=await response.text();
    const detailStatus=await detailPromise;
    await new Promise(r=>setTimeout(r,100));
    const after=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      detailStatus,
      elapsedMs:Math.round(performance.now()-started),
      hasDone:body.includes('[DONE]'),
      successDelta:
        (after.metrics.recoverySuccess||0)-
        (before.recoverySuccess||0),
      detailFailureObservedDelta:
        (after.metrics.recoveryDetailFailureObserved||0)-
        (before.recoveryDetailFailureObserved||0),
      observer:after
    };
  },base);
  st=await state(context.request);
  const detailFailureResumeCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_detail_failure_falls_back_to_retry',
    ...detailFailureRecovery,
    totalElapsedMs:Date.now()-t0,
    detailCalls:st.counts[
      'GET /backend-api/conversations/resume-detail-fail'
    ]||0,
    streamStatusCalls:st.counts[
      'GET /backend-api/conversation/resume-detail-fail/stream_status'
    ]||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:detailFailureResumeCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const completionBefore404=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-race/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const ws=new WebSocket(
      base.replace(/^http/,'ws')+
      '/ws?conversation_id=resume-race&delay_ms=150'
    );
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('ws-open-timeout')),1000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('ws-open-error'));},{once:true});
    });
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-race',offset:0})
    });
    await response.text();
    await new Promise(r=>setTimeout(r,150));
    try{ws.close();}catch{}
    const after=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      completed404Delta:
        (after.metrics.resume404AfterCompletion||0)-
        (before.resume404AfterCompletion||0),
      suppressedDelta:
        (after.metrics.recoverySuppressedByWebsocket||0)-
        (before.recoverySuppressedByWebsocket||0),
      observer:after
    };
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'active_resume_completion_before_404',
    ...completionBefore404,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-race/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });

  await reset(context.request);
  t0=Date.now();
  const oldCompletionDoesNotSuppress=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const ws=new WebSocket(
      base.replace(/^http/,'ws')+
      '/ws?conversation_id=resume-oldcomplete&delay_ms=0'
    );
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('old-ws-timeout')),1000);
      ws.addEventListener('message',()=>{
        clearTimeout(timer);
        resolve();
      },{once:true});
      ws.addEventListener('error',()=>{
        clearTimeout(timer);
        reject(new Error('old-ws-error'));
      },{once:true});
    });
    try{ws.close();}catch{}
    await new Promise(r=>setTimeout(r,50));
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-oldcomplete/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-oldcomplete',offset:0})
    });
    const body=await response.text();
    await new Promise(r=>setTimeout(r,100));
    const after=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      hasDone:body.includes('[DONE]'),
      suppressedDelta:
        (after.metrics.recoverySuppressedByWebsocket||0)-
        (before.recoverySuppressedByWebsocket||0),
      successDelta:
        (after.metrics.recoverySuccess||0)-
        (before.recoverySuccess||0),
      observer:after
    };
  },base);
  st=await state(context.request);
  const oldCompletionCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_old_completion_does_not_suppress',
    ...oldCompletionDoesNotSuppress,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-oldcomplete/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:oldCompletionCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const concurrentRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics;
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-concurrent/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,50));
    const makeResume=()=>fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-concurrent',offset:0})
    }).then(async response=>({
      status:response.status,
      body:await response.text()
    }));
    const responses=await Promise.all([makeResume(),makeResume()]);
    await new Promise(r=>setTimeout(r,100));
    const after=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      statuses:responses.map(r=>r.status),
      skippedConcurrentDelta:
        (after.metrics.recoverySkippedConcurrent||0)-
        (before.recoverySkippedConcurrent||0),
      exhaustedDelta:
        (after.metrics.recoveryExhausted||0)-
        (before.recoveryExhausted||0),
      observer:after
    };
  },base);
  st=await state(context.request);
  const concurrentCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_same_page_concurrency',
    ...concurrentRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-concurrent/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:concurrentCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const recoveryPage2=await context.newPage();
  await recoveryPage2.goto(base+'/',{
    waitUntil:'domcontentloaded',
    timeout:30000
  });
  await recoveryPage2.waitForFunction(
    ()=>typeof __CGUARD_STREAM_STATUS__==='function',
    {timeout:10000}
  );
  const crossTabRecovery=await Promise.all([
    page.evaluate(async base=>{
      __CGUARD_RESUME_RECOVERY_ENABLE__();
      const before=__CGUARD_STREAM_STATUS__().metrics;
      await fetch(
        base+'/backend-api/conversation/resume-cross-tab/stream_status'
      );
      await new Promise(r=>setTimeout(r,50));
      const response=await fetch(
        base+'/backend-api/f/conversation/resume',
        {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            conversation_id:'resume-cross-tab',
            offset:0
          })
        }
      );
      await response.text();
      const after=__CGUARD_STREAM_STATUS__();
      return {
        status:response.status,
        skippedCrossTabDelta:
          (after.metrics.recoverySkippedCrossTab||0)-
          (before.recoverySkippedCrossTab||0),
        exhaustedDelta:
          (after.metrics.recoveryExhausted||0)-
          (before.recoveryExhausted||0)
      };
    },base),
    recoveryPage2.evaluate(async base=>{
      __CGUARD_RESUME_RECOVERY_ENABLE__();
      const before=__CGUARD_STREAM_STATUS__().metrics;
      await fetch(
        base+'/backend-api/conversation/resume-cross-tab/stream_status'
      );
      await new Promise(r=>setTimeout(r,50));
      const response=await fetch(
        base+'/backend-api/f/conversation/resume',
        {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            conversation_id:'resume-cross-tab',
            offset:0
          })
        }
      );
      await response.text();
      const after=__CGUARD_STREAM_STATUS__();
      return {
        status:response.status,
        skippedCrossTabDelta:
          (after.metrics.recoverySkippedCrossTab||0)-
          (before.recoverySkippedCrossTab||0),
        exhaustedDelta:
          (after.metrics.recoveryExhausted||0)-
          (before.recoveryExhausted||0)
      };
    },base)
  ]);
  await recoveryPage2.close();
  st=await state(context.request);
  const crossTabCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_cross_tab_lock',
    statuses:crossTabRecovery.map(x=>x.status),
    skippedCrossTabDelta:crossTabRecovery.reduce(
      (sum,x)=>sum+x.skippedCrossTabDelta,0
    ),
    exhaustedDelta:crossTabRecovery.reduce(
      (sum,x)=>sum+x.exhaustedDelta,0
    ),
    elapsedMs:Date.now()-t0,
    streamStatusCalls:
      st.counts[
        'GET /backend-api/conversation/resume-cross-tab/stream_status'
      ]||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:crossTabCalls.map(c=>c.offset)
  });

  await reset(context.request);
  t0=Date.now();
  const noStreamingRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics.recoverySkippedNoStreaming||0;
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-exhaust',offset:0})
    });
    await response.text();
    await new Promise(r=>setTimeout(r,100));
    const observer=__CGUARD_STREAM_STATUS__();
    return {
      status:response.status,
      skippedDelta:(observer.metrics.recoverySkippedNoStreaming||0)-before,
      observer
    };
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'active_resume_requires_streaming_evidence',
    ...noStreamingRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-exhaust/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });

  await reset(context.request);
  t0=Date.now();
  const staleStreamingRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics
      .recoverySkippedStaleStreaming||0;
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-stale-status/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,150));
    const nativeNow=Date.now;
    const observedAt=nativeNow();
    Date.now=()=>observedAt+31_000;
    try{
      const response=await fetch(base+'/backend-api/f/conversation/resume',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          conversation_id:'resume-stale-status',
          offset:0
        })
      });
      await response.text();
      const observer=__CGUARD_STREAM_STATUS__();
      return {
        streamStatus,
        status:response.status,
        skippedStaleDelta:
          (observer.metrics.recoverySkippedStaleStreaming||0)-before,
        observer
      };
    }finally{
      Date.now=nativeNow;
    }
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'active_resume_rejects_stale_streaming_evidence',
    ...staleStreamingRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts[
      'GET /backend-api/conversation/resume-stale-status/stream_status'
    ]||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });

  await reset(context.request);
  t0=Date.now();
  const exhaustedRecovery=await page.evaluate(async base=>{
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-exhaust/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-resume-context':'exhaust-context'
      },
      body:JSON.stringify({
        conversation_id:'resume-exhaust',
        offset:0,
        probe:'exhaust-probe'
      })
    });
    await response.text();
    await new Promise(r=>setTimeout(r,100));
    return {
      streamStatus,
      status:response.status,
      observer:__CGUARD_STREAM_STATUS__()
    };
  },base);
  st=await state(context.request);
  const exhaustedCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_bounded_exhaustion',
    ...exhaustedRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-exhaust/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:exhaustedCalls.map(c=>c.offset),
    probes:exhaustedCalls.map(c=>c.probe),
    contexts:exhaustedCalls.map(c=>c.resume_context)
  });

  await reset(context.request);
  t0=Date.now();
  const nonStreamRecovery=await page.evaluate(async base=>{
    const before=__CGUARD_STREAM_STATUS__().metrics.recoveryRejectedNonStream||0;
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-nonstream/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-nonstream',offset:0})
    });
    const body=await response.text();
    await new Promise(r=>setTimeout(r,100));
    const observer=__CGUARD_STREAM_STATUS__();
    return {
      streamStatus,
      status:response.status,
      original404Body:body.includes('resume target missing'),
      rejectedDelta:(observer.metrics.recoveryRejectedNonStream||0)-before,
      observer
    };
  },base);
  st=await state(context.request);
  const nonStreamCalls=st.calls.filter(
    c=>c.path==='/backend-api/f/conversation/resume'
  );
  results.tests.push({
    name:'active_resume_rejects_nonstream_200',
    ...nonStreamRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-nonstream/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
    offsets:nonStreamCalls.map(c=>c.offset)
  });


  for (const invalidCase of [
    ['error_only','resume-error-sse','error-only-stream'],
    ['empty','resume-empty-sse','empty-stream']
  ]) {
    await reset(context.request);
    t0=Date.now();
    const invalidRecovery=await page.evaluate(async ({base,ident})=>{
      const before=__CGUARD_STREAM_STATUS__().metrics
        .recoveryRejectedInvalidStream||0;
      const statusResponse=await fetch(
        base+'/backend-api/conversation/'+ident+'/stream_status'
      );
      const streamStatus=(await statusResponse.json()).status;
      await new Promise(r=>setTimeout(r,100));
      const response=await fetch(base+'/backend-api/f/conversation/resume',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({conversation_id:ident,offset:0})
      });
      const body=await response.text();
      await new Promise(r=>setTimeout(r,100));
      const observer=__CGUARD_STREAM_STATUS__();
      return {
        streamStatus,
        status:response.status,
        original404Body:body.includes('resume target missing'),
        rejectedDelta:
          (observer.metrics.recoveryRejectedInvalidStream||0)-before,
        observer
      };
    },{base,ident:invalidCase[1]});
    st=await state(context.request);
    const invalidCalls=st.calls.filter(
      c=>c.path==='/backend-api/f/conversation/resume'
    );
    results.tests.push({
      name:'active_resume_rejects_'+invalidCase[0]+'_sse',
      expectedReason:invalidCase[2],
      ...invalidRecovery,
      elapsedMs:Date.now()-t0,
      streamStatusCalls:st.counts[
        'GET /backend-api/conversation/'+invalidCase[1]+'/stream_status'
      ]||0,
      resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0,
      offsets:invalidCalls.map(c=>c.offset)
    });
  }

  await reset(context.request);
  t0=Date.now();
  const abortedRecovery=await page.evaluate(async base=>{
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-abort/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const controller=new AbortController();
    const promise=fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({conversation_id:'resume-abort',offset:0}),
      signal:controller.signal
    }).then(async response=>({
      resolved:true,
      status:response.status,
      body:await response.text()
    })).catch(error=>({
      resolved:false,
      name:error?.name||'',
      message:error?.message||String(error)
    }));
    setTimeout(
      ()=>controller.abort(new DOMException('lab-abort','AbortError')),
      150
    );
    const outcome=await promise;
    await new Promise(r=>setTimeout(r,100));
    return {
      streamStatus,
      outcome,
      observer:__CGUARD_STREAM_STATUS__()
    };
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'active_resume_abort_propagation',
    ...abortedRecovery,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts['GET /backend-api/conversation/resume-abort/stream_status']||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });


  await reset(context.request);
  await page.evaluate(()=>__CGUARD_DISABLE__());
  t0=Date.now();
  const resumeKillSwitch=await page.evaluate(async base=>{
    const statusResponse=await fetch(
      base+'/backend-api/conversation/resume-kill-switch/stream_status'
    );
    const streamStatus=(await statusResponse.json()).status;
    await new Promise(r=>setTimeout(r,100));
    const response=await fetch(base+'/backend-api/f/conversation/resume',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        conversation_id:'resume-kill-switch',
        offset:0
      })
    });
    const body=await response.text();
    return {
      streamStatus,
      status:response.status,
      original404Body:body.includes('resume target missing'),
      observer:__CGUARD_STREAM_STATUS__()
    };
  },base);
  st=await state(context.request);
  results.tests.push({
    name:'resume_recovery_honors_guard_kill_switch',
    ...resumeKillSwitch,
    elapsedMs:Date.now()-t0,
    streamStatusCalls:st.counts[
      'GET /backend-api/conversation/resume-kill-switch/stream_status'
    ]||0,
    resumeCalls:st.counts['POST /backend-api/f/conversation/resume']||0
  });

  await reset(context.request);
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
  const byName=Object.fromEntries(results.tests.map(t=>[t.name,t]));
  const checks={
    fiveConcurrent:byName.five_concurrent.networkCalls===2 && byName.five_concurrent.statuses.every(x=>x===200),
    nonTarget:byName.non_target_passthrough.networkCalls===1 && byName.non_target_passthrough.status===429,
    post:byName.post_passthrough.networkCalls===1 && byName.post_passthrough.status===429,
    abort:byName.abort_during_backoff.networkCalls===1 && byName.abort_during_backoff.outcome.resolved===false,
    requestObject:byName.request_object.networkCalls===2 && byName.request_object.status===200,
    retryAfter:byName.retry_after_honored.networkCalls===2 && byName.retry_after_honored.status===200 && byName.retry_after_honored.elapsedMs>=14500,
    uiBudget:byName.ui_budget_transient_recovery.networkCalls===3 &&
      byName.ui_budget_transient_recovery.status===200 &&
      byName.ui_budget_transient_recovery.elapsedMs<9000,
    globalCooldown:byName.different_conversations_share_cooldown.aCalls===2 &&
      byName.different_conversations_share_cooldown.bCalls===1 &&
      byName.different_conversations_share_cooldown.statuses.every(x=>x===200) &&
      byName.different_conversations_share_cooldown.firstToSecondMs>=900 &&
      byName.different_conversations_share_cooldown.firstToSecondMs<2500,
    streamObserver:byName.passive_stream_resume_observer.recoveryDefaultActive===true &&
      byName.passive_stream_resume_observer.streamStatus==='IS_STREAMING' &&
      byName.passive_stream_resume_observer.resume404===404 &&
      byName.passive_stream_resume_observer.wsObserved===true &&
      byName.passive_stream_resume_observer.resumeSuccess===200 &&
      byName.passive_stream_resume_observer.streamStatusCalls===1 &&
      byName.passive_stream_resume_observer.resumeCalls===2 &&
      (byName.passive_stream_resume_observer.observer?.metrics?.streamStatusObserved||0)>=1 &&
      (byName.passive_stream_resume_observer.observer?.metrics?.resume404WhileStreaming||0)>=1 &&
      (byName.passive_stream_resume_observer.observer?.metrics?.resumeTerminalSuccess||0)>=1 &&
      (byName.passive_stream_resume_observer.observer?.metrics?.websocketTurnComplete||0)>=1 &&
      (byName.passive_stream_resume_observer.observer?.metrics?.websocketAfterResume404||0)>=1,
    activeResumeRecovery:
      byName.active_resume_offset_recovery.streamStatus==='IS_STREAMING' &&
      byName.active_resume_offset_recovery.status===200 &&
      byName.active_resume_offset_recovery.hasDone===true &&
      byName.active_resume_offset_recovery.streamStatusCalls===1 &&
      byName.active_resume_offset_recovery.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_offset_recovery.offsets)==='[0,1]' &&
      JSON.stringify(byName.active_resume_offset_recovery.probes)==='["keep-me","keep-me"]' &&
      JSON.stringify(byName.active_resume_offset_recovery.contexts)==='["preserve-me","preserve-me"]' &&
      (byName.active_resume_offset_recovery.observer?.metrics?.recoverySuccess||0)>=1 &&
      (byName.active_resume_offset_recovery.observer?.metrics?.recoveryAttempts||0)>=1,
    activeResumeAbsoluteOffsets:
      byName.active_resume_absolute_offsets.streamStatus==='IS_STREAMING' &&
      byName.active_resume_absolute_offsets.status===200 &&
      byName.active_resume_absolute_offsets.hasDone===true &&
      byName.active_resume_absolute_offsets.successDelta===1 &&
      byName.active_resume_absolute_offsets.streamStatusCalls===1 &&
      byName.active_resume_absolute_offsets.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_absolute_offsets.offsets)==='[1,0]' &&
      (byName.active_resume_absolute_offsets.observer?.metrics?.stockResumeOffsets?.['1']||0)>=1,
    activeResumeHandoff:
      byName.active_resume_accepts_handoff_sse.streamStatus==='IS_STREAMING' &&
      byName.active_resume_accepts_handoff_sse.status===200 &&
      byName.active_resume_accepts_handoff_sse.hasHandoff===true &&
      byName.active_resume_accepts_handoff_sse.handoffDelta===1 &&
      byName.active_resume_accepts_handoff_sse.terminalDelta===0 &&
      byName.active_resume_accepts_handoff_sse.observerContainsSyntheticToken===false &&
      byName.active_resume_accepts_handoff_sse.streamStatusCalls===1 &&
      byName.active_resume_accepts_handoff_sse.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_accepts_handoff_sse.offsets)==='[0,1]',
    activeResumeWebsocketSuppression:
      byName.active_resume_ws_suppression.streamStatus==='IS_STREAMING' &&
      byName.active_resume_ws_suppression.status===404 &&
      byName.active_resume_ws_suppression.streamStatusCalls===1 &&
      byName.active_resume_ws_suppression.resumeCalls===1 &&
      (byName.active_resume_ws_suppression.observer?.metrics?.recoverySuppressedByWebsocket||0)>=1 &&
      (byName.active_resume_ws_suppression.observer?.metrics?.websocketTurnComplete||0)>=2,
    activeResumeStaleDetailStillRecovers:
      byName.active_resume_stale_detail_still_recovers.streamStatus==='IS_STREAMING' &&
      byName.active_resume_stale_detail_still_recovers.status===200 &&
      byName.active_resume_stale_detail_still_recovers.detailStatus===200 &&
      byName.active_resume_stale_detail_still_recovers.hasDone===true &&
      byName.active_resume_stale_detail_still_recovers.successDelta===1 &&
      byName.active_resume_stale_detail_still_recovers.detailSuccessObservedDelta===1 &&
      byName.active_resume_stale_detail_still_recovers.detailWaitDelta===1 &&
      byName.active_resume_stale_detail_still_recovers.detailCalls===1 &&
      byName.active_resume_stale_detail_still_recovers.streamStatusCalls===1 &&
      byName.active_resume_stale_detail_still_recovers.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_stale_detail_still_recovers.offsets)==='[0,1]',
    activeResumeDetailFailureRetries:
      byName.active_resume_detail_failure_falls_back_to_retry.streamStatus==='IS_STREAMING' &&
      byName.active_resume_detail_failure_falls_back_to_retry.status===200 &&
      byName.active_resume_detail_failure_falls_back_to_retry.detailStatus===500 &&
      byName.active_resume_detail_failure_falls_back_to_retry.hasDone===true &&
      byName.active_resume_detail_failure_falls_back_to_retry.successDelta===1 &&
      byName.active_resume_detail_failure_falls_back_to_retry.detailFailureObservedDelta===1 &&
      byName.active_resume_detail_failure_falls_back_to_retry.detailCalls===1 &&
      byName.active_resume_detail_failure_falls_back_to_retry.streamStatusCalls===1 &&
      byName.active_resume_detail_failure_falls_back_to_retry.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_detail_failure_falls_back_to_retry.offsets)==='[0,1]',
    activeResumeCompletionBefore404:
      byName.active_resume_completion_before_404.streamStatus==='IS_STREAMING' &&
      byName.active_resume_completion_before_404.status===404 &&
      byName.active_resume_completion_before_404.completed404Delta===1 &&
      byName.active_resume_completion_before_404.suppressedDelta===1 &&
      byName.active_resume_completion_before_404.streamStatusCalls===1 &&
      byName.active_resume_completion_before_404.resumeCalls===1,
    activeResumeOldCompletionDoesNotSuppress:
      byName.active_resume_old_completion_does_not_suppress.streamStatus==='IS_STREAMING' &&
      byName.active_resume_old_completion_does_not_suppress.status===200 &&
      byName.active_resume_old_completion_does_not_suppress.hasDone===true &&
      byName.active_resume_old_completion_does_not_suppress.suppressedDelta===0 &&
      byName.active_resume_old_completion_does_not_suppress.successDelta===1 &&
      byName.active_resume_old_completion_does_not_suppress.streamStatusCalls===1 &&
      byName.active_resume_old_completion_does_not_suppress.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_old_completion_does_not_suppress.offsets)==='[0,1]',
    activeResumeSamePageConcurrency:
      byName.active_resume_same_page_concurrency.streamStatus==='IS_STREAMING' &&
      byName.active_resume_same_page_concurrency.statuses.length===2 &&
      byName.active_resume_same_page_concurrency.statuses.every(x=>x===404) &&
      byName.active_resume_same_page_concurrency.skippedConcurrentDelta===1 &&
      byName.active_resume_same_page_concurrency.exhaustedDelta===1 &&
      byName.active_resume_same_page_concurrency.streamStatusCalls===1 &&
      byName.active_resume_same_page_concurrency.resumeCalls===4 &&
      JSON.stringify([...byName.active_resume_same_page_concurrency.offsets].sort((a,b)=>a-b))==='[0,0,1,2]',
    activeResumeCrossTabLock:
      byName.active_resume_cross_tab_lock.statuses.length===2 &&
      byName.active_resume_cross_tab_lock.statuses.every(x=>x===404) &&
      byName.active_resume_cross_tab_lock.skippedCrossTabDelta===1 &&
      byName.active_resume_cross_tab_lock.exhaustedDelta===1 &&
      byName.active_resume_cross_tab_lock.streamStatusCalls===2 &&
      byName.active_resume_cross_tab_lock.resumeCalls===4 &&
      JSON.stringify([...byName.active_resume_cross_tab_lock.offsets].sort((a,b)=>a-b))==='[0,0,1,2]',
    activeResumeRequiresStreaming:
      byName.active_resume_requires_streaming_evidence.status===404 &&
      byName.active_resume_requires_streaming_evidence.streamStatusCalls===0 &&
      byName.active_resume_requires_streaming_evidence.resumeCalls===1 &&
      byName.active_resume_requires_streaming_evidence.skippedDelta===1,
    activeResumeRejectsStaleStreaming:
      byName.active_resume_rejects_stale_streaming_evidence.streamStatus==='IS_STREAMING' &&
      byName.active_resume_rejects_stale_streaming_evidence.status===404 &&
      byName.active_resume_rejects_stale_streaming_evidence.skippedStaleDelta===1 &&
      byName.active_resume_rejects_stale_streaming_evidence.streamStatusCalls===1 &&
      byName.active_resume_rejects_stale_streaming_evidence.resumeCalls===1,
    activeResumeBoundedExhaustion:
      byName.active_resume_bounded_exhaustion.streamStatus==='IS_STREAMING' &&
      byName.active_resume_bounded_exhaustion.status===404 &&
      byName.active_resume_bounded_exhaustion.streamStatusCalls===1 &&
      byName.active_resume_bounded_exhaustion.resumeCalls===3 &&
      JSON.stringify(byName.active_resume_bounded_exhaustion.offsets)==='[0,1,2]' &&
      JSON.stringify(byName.active_resume_bounded_exhaustion.probes)==='["exhaust-probe","exhaust-probe","exhaust-probe"]' &&
      JSON.stringify(byName.active_resume_bounded_exhaustion.contexts)==='["exhaust-context","exhaust-context","exhaust-context"]' &&
      (byName.active_resume_bounded_exhaustion.observer?.metrics?.recoveryExhausted||0)>=1,
    activeResumeRejectsNonStream:
      byName.active_resume_rejects_nonstream_200.streamStatus==='IS_STREAMING' &&
      byName.active_resume_rejects_nonstream_200.status===404 &&
      byName.active_resume_rejects_nonstream_200.original404Body===true &&
      byName.active_resume_rejects_nonstream_200.rejectedDelta===1 &&
      byName.active_resume_rejects_nonstream_200.streamStatusCalls===1 &&
      byName.active_resume_rejects_nonstream_200.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_rejects_nonstream_200.offsets)==='[0,1]',
    activeResumeRejectsErrorOnlySse:
      byName.active_resume_rejects_error_only_sse.streamStatus==='IS_STREAMING' &&
      byName.active_resume_rejects_error_only_sse.status===404 &&
      byName.active_resume_rejects_error_only_sse.original404Body===true &&
      byName.active_resume_rejects_error_only_sse.rejectedDelta===1 &&
      byName.active_resume_rejects_error_only_sse.streamStatusCalls===1 &&
      byName.active_resume_rejects_error_only_sse.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_rejects_error_only_sse.offsets)==='[0,1]',
    activeResumeRejectsEmptySse:
      byName.active_resume_rejects_empty_sse.streamStatus==='IS_STREAMING' &&
      byName.active_resume_rejects_empty_sse.status===404 &&
      byName.active_resume_rejects_empty_sse.original404Body===true &&
      byName.active_resume_rejects_empty_sse.rejectedDelta===1 &&
      byName.active_resume_rejects_empty_sse.streamStatusCalls===1 &&
      byName.active_resume_rejects_empty_sse.resumeCalls===2 &&
      JSON.stringify(byName.active_resume_rejects_empty_sse.offsets)==='[0,1]',
    activeResumeAbort:
      byName.active_resume_abort_propagation.streamStatus==='IS_STREAMING' &&
      byName.active_resume_abort_propagation.outcome?.resolved===false &&
      byName.active_resume_abort_propagation.outcome?.name==='AbortError' &&
      byName.active_resume_abort_propagation.streamStatusCalls===1 &&
      byName.active_resume_abort_propagation.resumeCalls===1 &&
      (byName.active_resume_abort_propagation.observer?.metrics?.recoveryAborted||0)>=1,
    resumeRecoveryKillSwitch:
      byName.resume_recovery_honors_guard_kill_switch.streamStatus==='IS_STREAMING' &&
      byName.resume_recovery_honors_guard_kill_switch.status===404 &&
      byName.resume_recovery_honors_guard_kill_switch.original404Body===true &&
      byName.resume_recovery_honors_guard_kill_switch.resumeCalls===1 &&
      byName.resume_recovery_honors_guard_kill_switch.streamStatusCalls===1 &&
      byName.resume_recovery_honors_guard_kill_switch.observer?.recoveryEnabled===true &&
      byName.resume_recovery_honors_guard_kill_switch.observer?.recoveryActive===false,
    killSwitch:byName.kill_switch.networkCalls===1 && byName.kill_switch.status===429,
    twoTabs:byName.two_tabs_same_conversation.networkCalls<=3 && byName.two_tabs_same_conversation.statuses.every(x=>x===200),
    networkTelemetry:(results.storage?.cguard_counts?.['network-429']||0)>=6,
    rateHashTelemetry:(()=>{
      const events=results.storage?.cguard_events||[];
      const network=events.filter(e=>e.type==='network-429'&&e.rateHash);
      const backoffs=events.filter(e=>e.type==='429-backoff'&&e.rateHash);
      return network.some(n=>backoffs.some(b=>b.rateHash===n.rateHash));
    })(),
    globalCooldownMetric:(results.guardStatus?.metrics?.globalCooldownHits||0)>=1,
    softCooldownCapMetric:(results.guardStatus?.metrics?.softCooldownCaps||0)>=1
  };
  results.checks=checks;
  results.pass=Object.values(checks).every(Boolean);
  fs.writeFileSync(out,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
  await context.close();
  context=null;
  try{server.kill();}catch{}
  if(!results.pass) process.exit(2);
})().catch(async e=>{
  if(context){
    try{await context.close();}catch{}
    context=null;
  }
  try{server.kill();}catch{}
  console.error(e.stack||String(e));
  process.exit(1);
});
