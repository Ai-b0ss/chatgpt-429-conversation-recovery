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
  await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:10000});
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
    setTimeout(()=>c.abort('integration-abort'),100);
    return await p;
  },base);
  await sleep(800);
  st=await state(context.request);
  results.tests.push({
    name:'abort_during_backoff',outcome:abort,elapsedMs:Date.now()-t0,
    networkCalls:st.counts['GET /backend-api/conversations/always-429']||0
  });
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

  results.guardStatus=await page.evaluate(()=>__CGUARD_STATUS__());
  const checks={
    fiveConcurrent:results.tests[0].networkCalls===2 && results.tests[0].statuses.every(x=>x===200),
    nonTarget:results.tests[1].networkCalls===1 && results.tests[1].status===429,
    post:results.tests[2].networkCalls===1 && results.tests[2].status===429,
    abort:results.tests[3].networkCalls===1 && results.tests[3].outcome.resolved===false,
    requestObject:results.tests[4].networkCalls===2 && results.tests[4].status===200,
    retryAfter:results.tests[5].networkCalls===2 && results.tests[5].status===200 && results.tests[5].elapsedMs>=900,
    killSwitch:results.tests[6].networkCalls===1 && results.tests[6].status===429,
    twoTabs:results.tests[7].networkCalls<=3 && results.tests[7].statuses.every(x=>x===200)
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
