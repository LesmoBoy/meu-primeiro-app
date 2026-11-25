/* Real Chromium UI tests with a FAKE GIS SDK delivered by Playwright routing.
 * No Google account, Supabase, real ID token, provider popup or live auth is used.
 */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const SDK_URL='https://accounts.google.com/gsi/client';
const CLIENT_ID='421909197196-td982abtadcdh70hesfc3ucp2fe0qqii.apps.googleusercontent.com';
const report={mode:'Real Chromium, isolated local fixture and intercepted fake Google Identity SDK; no live authentication',passed:[],errors:[],browserErrors:[],unexpectedExternalRequests:0};
let server,browser,context,page;
let sdkRequests=0,nextSDK='ok';
const heldRoutes=[];
const fakeSDK=`(() => {
  const state=window.__fakeGoogle||{configs:[],renders:[],throwInitialize:false,throwRender:false};
  window.__fakeGoogle=state;
  state.scriptExecutions=(state.scriptExecutions||0)+1;
  const enc=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
  state.response=(sourceIndex,overrides={})=>{
    const cfg=state.configs[sourceIndex];
    const claims={aud:cfg.client_id,nonce:cfg.nonce};
    if(overrides.audience!==undefined)claims.aud=overrides.audience;
    if(overrides.tokenNonce!==undefined)claims.nonce=overrides.tokenNonce;
    const credential=enc({alg:'FAKE_FOR_UI_TEST_ONLY'})+'.'+enc(claims)+'.fake_signature_for_ui_test';
    return {...{credential,clientId:cfg.client_id},...overrides.response};
  };
  state.emit=(callbackIndex,sourceIndex=callbackIndex,overrides={})=>state.configs[callbackIndex].callback(state.response(sourceIndex,overrides));
  window.google={accounts:{id:{
    initialize(config){if(state.throwInitialize)throw Error('Synthetic SDK initialization failure');state.configs.push(config);},
    renderButton(host,options){
      if(state.throwRender)throw Error('Synthetic SDK render failure');
      state.renders.push(options);
      const index=state.configs.length-1;
      const button=document.createElement('button');button.type='button';button.dataset.fakeOfficialGoogle='true';
      button.textContent='Continuar com o Google';button.style.cssText='box-sizing:border-box;height:44px;max-width:100%;width:'+options.width+'px;border:1px solid #dadce0;border-radius:4px;background:white;color:#3c4043;font:500 14px system-ui;cursor:pointer';
      button.addEventListener('click',()=>{state.officialClicks=(state.officialClicks||0)+1;state.emit(index);});
      host.append(button);
    }
  }}};
})();`;
const fixture=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/cloud.css"><script src="/google-identity.js" defer></script><style>body{box-sizing:border-box;margin:0;padding:24px;font:16px/1.6 system-ui;background:#f3f0f8;color:#302b40}button{font:inherit;padding:10px;max-width:100%}h1{font-size:24px}#parent{max-width:calc(100vw - 30px)}[hidden]{display:none!important}</style><title>Google Identity isolated test fixture</title></head><body><h1>Entrada de teste</h1><p>Este teste usa apenas um SDK simulado.</p><button id="start">Entrar com Google</button><button id="outside">Outro controle</button><dialog id="parent"><h2>Diálogo do app</h2><button id="nested-start">Entrar com Google neste diálogo</button></dialog><script>
  window.__outcomes=[];
  window.__beginAttempt=overrides=>{
    const number=__outcomes.length;
    const nonce=(number+1).toString(16).padStart(64,'0');
    __outcomes.push({status:'pending',settlements:0});
    RodagemGoogleIdentity.requestCredential({clientId:${JSON.stringify(CLIENT_ID)},nonce,...overrides}).then(
      credential=>{__outcomes[number]={status:'resolved',settlements:__outcomes[number].settlements+1,credentialReceived:typeof credential==='string'&&credential.split('.').length===3};},
      failure=>{__outcomes[number]={status:'rejected',settlements:__outcomes[number].settlements+1,code:failure.code||'UNKNOWN'};}
    );
    return number;
  };
  addEventListener('DOMContentLoaded',()=>{
    document.getElementById('start').addEventListener('click',()=>__beginAttempt());
    document.getElementById('nested-start').addEventListener('click',()=>__beginAttempt());
  });
</script></body></html>`;

async function check(name,fn){await fn();report.passed.push(name);console.log('PASS',name);}
async function openFixture(){await page.goto(report.fixtureURL);await page.waitForFunction(()=>typeof window.RodagemGoogleIdentity?.requestCredential==='function');}
async function begin(selector='#start'){
  const index=await page.evaluate(()=>__outcomes.length);await page.locator(selector).click();return index;
}
async function uiDiagnostic(){
  const ui=await page.evaluate(()=>{
    const dialog=document.querySelector('.google-identity-dialog'),button=document.querySelector('[data-fake-official-google]');
    const result=window.__outcomes?.at(-1);
    return{
      outcome:result?{status:result.status,code:result.code||null,settlements:result.settlements}:null,
      dialogCount:document.querySelectorAll('.google-identity-dialog').length,dialogOpen:Boolean(dialog?.open),
      status:dialog?.querySelector('[role="status"]')?.textContent||null,
      sdkScriptCount:document.querySelectorAll('script[data-rodagem-google-sdk]').length,
      fakeScriptExecutions:window.__fakeGoogle?.scriptExecutions||0,
      hasInitialize:typeof window.google?.accounts?.id?.initialize==='function',
      fakeConfigCount:window.__fakeGoogle?.configs?.length||0,fakeRenderCount:window.__fakeGoogle?.renders?.length||0,
      fakeButtonCount:document.querySelectorAll('[data-fake-official-google]').length,
      buttonDisplay:button?getComputedStyle(button).display:null,buttonVisibility:button?getComputedStyle(button).visibility:null,
      buttonHostHidden:button?.parentElement?.hidden??null
    };
  });
  return{...ui,interceptedFakeSDKRequests:sdkRequests};
}
async function readyDialog(){
  const dialog=page.locator('.google-identity-dialog');
  try{
    await dialog.waitFor({state:'visible'});
    // A URL-like glob such as 'https://**' is normalized by Playwright and
    // misses /gsi/client. Require the intercepted fake before any button wait.
    await page.waitForFunction(()=>Boolean(window.__fakeGoogle?.scriptExecutions)||window.__outcomes?.at(-1)?.status==='rejected');
    const sdk=await uiDiagnostic();
    assert.ok(sdk.interceptedFakeSDKRequests>0,'Google SDK request must be intercepted: '+JSON.stringify(sdk));
    assert.ok(sdk.fakeScriptExecutions>0,'Only the fake Google SDK may render in this fixture: '+JSON.stringify(sdk));
    // A rejected helper promise is a useful failure, not a reason to wait for
    // a button that can no longer appear. Preserve the visible-button check.
    await page.waitForFunction(()=>Boolean(document.querySelector('[data-fake-official-google]'))||window.__outcomes?.at(-1)?.status==='rejected');
    const state=await uiDiagnostic();
    assert.notEqual(state.outcome?.status,'rejected','GIS helper rejected before rendering: '+JSON.stringify(state));
    await page.locator('[data-fake-official-google]').waitFor({state:'visible'});
    return dialog;
  }catch(failure){
    const state=await uiDiagnostic().catch(()=>({diagnosticUnavailable:true}));
    throw new Error('Google button readiness failed: '+failure.message+'; safe UI diagnostic: '+JSON.stringify(state));
  }
}
async function outcome(index,status){await page.waitForFunction(({index,status})=>__outcomes[index]?.status===status,{index,status});return page.evaluate(index=>({...__outcomes[index]}),index);}
async function latestConfig(){return page.evaluate(()=>__fakeGoogle.configs.length-1);}
async function cancel(){await page.locator('.google-identity-cancel').click();await page.locator('.google-identity-dialog').waitFor({state:'detached'});}
async function emit(index,sourceIndex=index,overrides={}){await page.evaluate(({index,sourceIndex,overrides})=>__fakeGoogle.emit(index,sourceIndex,overrides),{index,sourceIndex,overrides});}
async function noModal(){assert.equal(await page.locator('.google-identity-dialog').count(),0);assert.equal(await page.locator('script[data-rodagem-google-sdk]').count(),0);}

(async()=>{
  server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fixture);return;}
      const file=pathname==='/google-identity.js'?'google-identity.js':pathname==='/cloud.css'?'cloud.css':null;
      if(!file){res.writeHead(404).end();return;}
      const content=await fs.readFile(path.join(root,file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/css','Cache-Control':'no-store'});res.end(content);
    }catch{res.writeHead(500).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  report.fixtureURL=`http://127.0.0.1:${server.address().port}/fixture.html`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--disable-crashpad-for-testing','--disable-breakpad']});
  report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:390,height:844},locale:'pt-BR',reducedMotion:'reduce'});
  await context.route(/^https:\/\//,async route=>{
    if(route.request().url()!==SDK_URL){report.unexpectedExternalRequests++;await route.abort();return;}
    sdkRequests++;
    const mode=nextSDK;nextSDK='ok';
    if(mode==='fail'){await route.abort();return;}
    if(mode==='hold'){heldRoutes.push(route);return;}
    await route.fulfill({status:200,contentType:'application/javascript',body:fakeSDK});
  });
  page=await context.newPage();page.on('pageerror',failure=>report.browserErrors.push(failure.message));
  await openFixture();
  await check('bootstrap creates no auth DOM, network request or storage',async()=>{
    assert.equal(sdkRequests,0);await noModal();
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.equal(await page.evaluate(()=>typeof window.google),'undefined');
  });
  await check('invalid public client and nonce fail before SDK or DOM',async()=>{
    for(const [overrides,expected]of [[{clientId:'other.apps.googleusercontent.com'},'CONFIGURATION'],[{nonce:''},'INVALID_ARGUMENT'],[{nonce:'not-a-hash'},'INVALID_ARGUMENT'],[{nonce:'Z'.repeat(64)},'INVALID_ARGUMENT']]){
      const index=await page.evaluate(overrides=>__beginAttempt(overrides),overrides);
      assert.equal((await outcome(index,'rejected')).code,expected);
    }
    assert.equal(sdkRequests,0);await noModal();
  });
  await check('explicit official button resolves once with PKCE-independent GIS configuration',async()=>{
    const index=await begin();const dialog=await readyDialog();
    assert.equal(sdkRequests,1);
    assert.equal(await dialog.getAttribute('aria-modal'),'true');
    assert.equal(await dialog.getAttribute('aria-busy'),'false');
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('google-identity-cancel')),true);
    assert.equal(await page.evaluate(()=>__outcomes.at(-1).status),'pending','SDK readiness must not auto-sign-in');
    const config=await page.evaluate(expected=>{const c=__fakeGoogle.configs.at(-1),r=__fakeGoogle.renders.at(-1);return{correctClient:c.client_id===expected,hashedNonce:/^[a-f0-9]{64}$/.test(c.nonce),autoSelect:c.auto_select,locale:r.locale,uxMode:c.ux_mode};},CLIENT_ID);
    assert.deepEqual(config,{correctClient:true,hashedNonce:true,autoSelect:false,locale:'pt-BR',uxMode:'popup'});
    const cfg=await latestConfig();await page.locator('[data-fake-official-google]').click();
    assert.equal((await outcome(index,'resolved')).credentialReceived,true);
    await emit(cfg);assert.equal((await outcome(index,'resolved')).settlements,1);await noModal();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'start');
  });
  await check('one pending request rejects a concurrent request without replacing the dialog',async()=>{
    const first=await begin();await readyDialog();
    const concurrent=await page.evaluate(()=>__beginAttempt());
    assert.equal((await outcome(concurrent,'rejected')).code,'BUSY');
    assert.equal(await page.locator('.google-identity-dialog').count(),1);
    await page.locator('[data-fake-official-google]').click();await outcome(first,'resolved');await noModal();
  });
  await check('cancel and late callbacks cannot resolve a later attempt',async()=>{
    const first=await begin();await readyDialog();const oldCfg=await latestConfig();await cancel();
    assert.equal((await outcome(first,'rejected')).code,'CANCELLED');
    const second=await begin();await readyDialog();const newCfg=await latestConfig();
    await emit(oldCfg);assert.equal(await page.evaluate(index=>__outcomes[index].status,second),'pending');
    await emit(newCfg,oldCfg);assert.equal(await page.evaluate(index=>__outcomes[index].status,second),'pending','mismatched nonce from an earlier SDK popup stays isolated');
    await emit(newCfg);await outcome(second,'resolved');await noModal();
  });
  await check('Escape cancels accessibly, cleans the dialog and restores initiating focus',async()=>{
    const index=await begin();const dialog=await readyDialog();
    const labelled=await dialog.getAttribute('aria-labelledby'),described=await dialog.getAttribute('aria-describedby');
    assert.equal(await page.locator('#'+labelled).innerText(),'Entrar com Google');
    assert.ok((await page.locator('#'+described).innerText()).length>20);
    await page.keyboard.press('Escape');assert.equal((await outcome(index,'rejected')).code,'CANCELLED');await noModal();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'start');
  });
  await check('external dialog close cancels and a parent app dialog is preserved',async()=>{
    await page.locator('#parent').evaluate(dialog=>dialog.showModal());
    const index=await begin('#nested-start');await readyDialog();
    assert.equal(await page.locator('#parent').evaluate(dialog=>dialog.open),true);
    await page.locator('.google-identity-dialog').evaluate(dialog=>dialog.close());
    assert.equal((await outcome(index,'rejected')).code,'CANCELLED');
    assert.equal(await page.locator('#parent').evaluate(dialog=>dialog.open),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'nested-start');
    await page.locator('#parent').evaluate(dialog=>dialog.close());
  });
  await check('invalid credential and mismatched response client are rejected without retaining auth DOM',async()=>{
    for(const override of [{response:{credential:''}},{response:{credential:'not-a-jwt'}},{response:{clientId:'other.apps.googleusercontent.com'}},{response:{client_id:'other.apps.googleusercontent.com'}},{audience:'other.apps.googleusercontent.com'}]){
      const index=await begin();await readyDialog();const cfg=await latestConfig();await emit(cfg,cfg,override);
      const result=await outcome(index,'rejected');assert.ok(['INVALID_RESPONSE','CLIENT_MISMATCH'].includes(result.code));await noModal();
    }
  });
  await check('SDK network failure is bounded and the next explicit request can retry',async()=>{
    await page.evaluate(()=>{delete window.google;});nextSDK='fail';
    const failed=await begin();assert.equal((await outcome(failed,'rejected')).code,'SDK_LOAD');await noModal();
    const index=await begin();await readyDialog();await page.locator('[data-fake-official-google]').click();await outcome(index,'resolved');await noModal();
  });
  await check('SDK initialization/render failure releases busy state for retry',async()=>{
    for(const flag of ['throwInitialize','throwRender']){
      await page.evaluate(flag=>{__fakeGoogle[flag]=true;},flag);
      const failed=await begin();assert.equal((await outcome(failed,'rejected')).code,'SDK_LOAD');await noModal();
      await page.evaluate(flag=>{__fakeGoogle[flag]=false;},flag);
      const retry=await begin();await readyDialog();await cancel();assert.equal((await outcome(retry,'rejected')).code,'CANCELLED');
    }
  });
  await check('cancel while SDK is loading prevents a late script load from opening auth UI',async()=>{
    await page.evaluate(()=>{delete window.google;});nextSDK='hold';
    const index=await begin();await page.locator('.google-identity-dialog').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('script[data-rodagem-google-sdk]'));
    await cancel();assert.equal((await outcome(index,'rejected')).code,'CANCELLED');
    while(heldRoutes.length){const route=heldRoutes.shift();try{await route.fulfill({status:200,contentType:'application/javascript',body:fakeSDK});}catch{}}
    await noModal();
    const retry=await begin();await readyDialog();await page.locator('[data-fake-official-google]').click();await outcome(retry,'resolved');
  });
  await check('offline before a request and connectivity loss cancel without live Google requests',async()=>{
    const before=sdkRequests;await context.setOffline(true);
    const offline=await page.evaluate(()=>__beginAttempt());assert.equal((await outcome(offline,'rejected')).code,'OFFLINE');assert.equal(sdkRequests,before);await noModal();
    await context.setOffline(false);const index=await begin();await readyDialog();
    await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.equal((await outcome(index,'rejected')).code,'OFFLINE');await noModal();
  });
  await check('320/390/1280 layouts fit the viewport, remain modal and return focus',async()=>{
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:width<500?844:960});
      const index=await begin();const dialog=await readyDialog();
      const bounds=await dialog.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,'dialog must fit viewport');
      const sizes=await page.evaluate(()=>{const dialog=document.querySelector('.google-identity-dialog');return{document:document.documentElement.scrollWidth,viewport:innerWidth,dialog:dialog.scrollWidth,client:dialog.clientWidth};});
      assert.ok(sizes.document<=sizes.viewport+1,'page must not overflow');assert.ok(sizes.dialog<=sizes.client+1,'official button must not overflow dialog');
      await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('.google-identity-dialog'))),true);
      if(width===390)await page.screenshot({path:path.join(__dirname,'google-identity-mobile.png'),fullPage:true});
      if(width===1280)await page.screenshot({path:path.join(__dirname,'google-identity-desktop.png'),fullPage:true});
      await cancel();assert.equal((await outcome(index,'rejected')).code,'CANCELLED');assert.equal(await page.evaluate(()=>document.activeElement.id),'start');
    }
  });
  await check('load and request timeouts clean old timers and allow a fresh attempt',async()=>{
    await page.clock.install();
    await page.evaluate(()=>{delete window.google;});nextSDK='hold';
    const failed=await begin();await page.locator('.google-identity-dialog').waitFor({state:'visible'});
    await page.clock.fastForward(12001);assert.equal((await outcome(failed,'rejected')).code,'SDK_TIMEOUT');await noModal();
    while(heldRoutes.length){try{await heldRoutes.shift().abort();}catch{}}
    const index=await begin();await readyDialog();await page.clock.fastForward(180001);assert.equal((await outcome(index,'rejected')).code,'TIMEOUT');await noModal();
    const retry=await begin();await readyDialog();await page.clock.fastForward(12001);
    assert.equal(await page.evaluate(index=>__outcomes[index].status,retry),'pending','an old load timeout must not affect a new request');
    await page.locator('[data-fake-official-google]').click();await outcome(retry,'resolved');await noModal();
  });
  await check('no tokens are stored and no unexpected external request or runtime error occurs',async()=>{
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.equal(report.unexpectedExternalRequests,0);assert.deepEqual(report.browserErrors,[]);
    report.interceptedFakeSDKRequests=sdkRequests;
  });
})().catch(async failure=>{
  report.errors.push(failure.stack||failure.message);console.error(failure.stack||failure);process.exitCode=1;
  if(page&&!page.isClosed()){
    report.failureDiagnostic=await uiDiagnostic().catch(()=>({diagnosticUnavailable:true}));
    try{await page.screenshot({path:path.join(__dirname,'google-identity-failure.png'),fullPage:true});report.failureScreenshot='qa/google-identity-failure.png';}catch{}
  }
}).finally(async()=>{
  for(const route of heldRoutes){try{await route.abort();}catch{}}
  if(context)await context.close();if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  report.interceptedFakeSDKRequests=sdkRequests;
  await fs.writeFile(path.join(__dirname,'google-identity-report.json'),JSON.stringify(report,null,2));
  console.log('GOOGLE_IDENTITY_BROWSER_REPORT '+JSON.stringify(report));
});
