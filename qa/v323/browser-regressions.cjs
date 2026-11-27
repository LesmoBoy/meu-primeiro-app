/* Real Chromium rendering/interactions with synthetic local data and an explicit
 * fake RodagemCloud adapter. No live Google/Auth/backend, GPS or financial data.
 * Run on CI where local browser navigation is permitted; never against production.
 */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'../..');
const recordKey='minha-rodagem-v1',settingsKey='minha-rodagem-perfil-v2';
const registryKey='minha-rodagem-perfis-v1',bindingKey='minha-rodagem-cloud-v1';
const authStorageKey='minha-rodagem-supabase-auth-v1';
const A='8c743f43-a265-4a36-8279-4d91cbda9990';
const otherKey='minha-rodagem-usuario-v1:second:'+recordKey;
const day={id:'synthetic-legacy-day',tipo:'dia',data:'2026-11-15',ganhos:18000,combustivel:2500,outros:500,entregas:20,horas:2501,km:12000};
const seed={
 [recordKey]:JSON.stringify({versao:1,registros:[day]}),
 [settingsKey]:JSON.stringify({versao:1,nome:'Perfil sintético',trabalho:'apps',jornada:6,meta:20000,moto:'110–160 cc',modelo:'Veículo de homologação',combustivel:'Gasolina',configurado:true}),
 [registryKey]:JSON.stringify({version:1,activeId:'principal',profiles:[{id:'principal',name:'Perfil sintético',createdAt:0},{id:'second',name:'Outro sintético',createdAt:0}]}),
 [bindingKey]:JSON.stringify({userId:A,revision:1,lastSyncedAt:null}),
 [otherKey]:JSON.stringify({versao:1,registros:[{...day,id:'synthetic-other-profile',horas:600}]}),
 [authStorageKey]:'synthetic-auth-storage-only',
 'minha-rodagem-gps-preferencias-v1':JSON.stringify({enabled:false,mode:'eco'})
};
// Inject only the public cloud-adapter boundary before app scripts. Its setter
// keeps this explicit UI fixture across a Service Worker controlled reload.
// Production auth code is covered separately, never authenticated by this fake.
const fakeCloud=`(() => {
 const listeners=new Set();
 const state={session:null,verifyMode:'ok',verifyCalls:0,dataCalls:0,signOutCalls:0,lastExpectedUID:null,release:null};
 const account={user:{id:${JSON.stringify(A)},email:'synthetic@example.test'},expires_at:2000000000};
 state.setSession=value=>{state.session=value?account:null;for(const fn of listeners)fn(value?'SIGNED_IN':'SIGNED_OUT',state.session);};
 window.__v323CloudFixture=state;
 const adapter=Object.freeze({
   configured:()=>true,configurationIssue:()=>'',ready:async()=>state.session,getSession:async()=>state.session,
   onAuth(callback){listeners.add(callback);queueMicrotask(()=>callback('INITIAL_SESSION',state.session));return()=>listeners.delete(callback);},
   async verifySession(expected){state.verifyCalls++;state.lastExpectedUID=expected;
     if(state.verifyMode==='hold')return new Promise(resolve=>{state.release=()=>resolve(account);});
     if(!state.session){const error=new Error('Synthetic missing session');error.code='AUTH_REQUIRED';throw error;}
     return state.session;},
   async signOut(){state.signOutCalls++;state.setSession(false);},
   async signIn(){throw Error('Live sign-in is outside this UI fixture');},
   async load(){state.dataCalls++;throw Error('Unexpected data RPC');},
   async save(){state.dataCalls++;throw Error('Unexpected data RPC');},
   async call(){state.dataCalls++;throw Error('Unexpected data RPC');},
   async invoke(){state.dataCalls++;throw Error('Unexpected data RPC');}
 });
 Object.defineProperty(window,'RodagemCloud',{enumerable:true,configurable:false,get:()=>adapter,set(){}});
})();`;
const report={version:'3.2.3',classification:'real-Chromium-with-synthetic-data-and-mocked-cloud-adapter',
 liveAuthentication:false,physicalGPS:false,productionOperations:0,passed:[],errors:[],browserErrors:[],externalRequests:0};
let server,browser,context,page,base;
async function check(name,run){await run();report.passed.push(name);console.log('PASS',name);}
async function navigate(panel){await page.locator(`.main-nav [data-panel="${panel}"]`).click();await page.locator('#'+panel).waitFor({state:'visible'});}
const stored=key=>page.evaluate(key=>localStorage.getItem(key),key);
async function confirm(value){const dialog=page.locator('#confirmacao');await dialog.waitFor({state:'visible'});await dialog.locator(`button[value="${value}"]`).click();await dialog.waitFor({state:'hidden'});}
async function technicalDownload(){
 const event=page.waitForEvent('download');await page.locator('#dados-aparelho-exportar').click();const download=await event;
 const stream=await download.createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString('utf8');
 await page.waitForFunction(()=>document.querySelector('#dados-aparelho').getAttribute('aria-busy')==='false');
 return {data:JSON.parse(text),text,filename:download.suggestedFilename()};
}
(async()=>{
 if(process.env.APP_URL)throw Error('This isolated regression suite requires its own checkout server; APP_URL must be empty.');
 server=http.createServer(async(req,res)=>{
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(!pathname.startsWith('/meu-primeiro-app/')){res.writeHead(404).end();return;}
   const relative=pathname.slice('/meu-primeiro-app/'.length)||'index.html';
   const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
   const body=await fs.readFile(file);const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404).end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 base=`http://127.0.0.1:${server.address().port}/meu-primeiro-app/`;const origin=new URL(base).origin;
 report.appURL=base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--disable-crashpad-for-testing','--disable-breakpad']});
 report.browserVersion=browser.version();
 context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(!['http:','https:'].includes(url.protocol))return route.continue();
  if(url.origin!==origin){report.externalRequests++;return route.abort();}
  return route.continue();
 });
 await context.addInitScript({content:fakeCloud});
 await context.addInitScript(({seed,origin})=>{
  if(location.origin!==origin)return;
  if(localStorage.getItem('__v323_browser_seeded')!=='1'){
   for(const[key,value]of Object.entries(seed))localStorage.setItem(key,value);
   localStorage.setItem('__v323_browser_seeded','1');
  }
 },{seed,origin});
 page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.stack||error.message));
 await page.clock.install({time:new Date('2026-11-15T12:00:00Z')});await page.goto(base);
 await page.waitForFunction(()=>Boolean(window.RodagemDeviceData&&window.RodagemSessionDiagnostics&&window.__v323CloudFixture));

 await check('legacy hours are visibly marked without rewriting stored historical values',async()=>{
  assert.match(await page.locator('.version-pill').innerText(),/3\.2\.3/);
  assert.match(await page.locator('.app-footer').innerText(),/v3\.2\.3/);
  await page.locator('#legados-aviso').waitFor({state:'visible'});assert.match(await page.locator('#legados-aviso').innerText(),/24 horas/);
  await navigate('historico');assert.match(await page.locator('[data-legacy-hours]').innerText(),/25,01 h/);
  assert.equal(await stored(recordKey),seed[recordKey]);
  await page.reload();await navigate('historico');assert.equal(await stored(recordKey),seed[recordKey]);
 });
 await check('legacy correction requires a valid daily duration and explicit confirmation',async()=>{
  await page.locator('.history-item').getByRole('button',{name:'Editar',exact:true}).click();await page.locator('#fechamento').waitFor({state:'visible'});
  assert.equal(await page.locator('#dia [name="horas"]').inputValue(),'25,01');
  await page.locator('#dia button[value="salvar"]').click();assert.equal(await stored(recordKey),seed[recordKey]);assert.equal(await page.locator('#confirmacao').isVisible(),false);
  await page.locator('#dia [name="horas"]').fill('8');await page.locator('#dia button[value="salvar"]').click();
  await page.locator('#confirmacao').waitFor({state:'visible'});assert.match(await page.locator('#confirmacao-texto').innerText(),/correção explícita/);
  await confirm('cancelar');assert.equal(await stored(recordKey),seed[recordKey]);
  await page.locator('#dia button[value="salvar"]').click();await confirm('confirmar');
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).registros[0].horas===800,recordKey);
  const after=JSON.parse(await stored(recordKey)).registros[0];assert.deepEqual(after,{...day,horas:800});
  assert.equal(await page.locator('#legados-aviso').isVisible(),false);
 });
 await check('device removal stays unavailable without a technical export and cancel preserves data',async()=>{
  await navigate('ajustes');await page.locator('#dados-aparelho-abrir').click();
  assert.equal(await page.locator('#dados-aparelho-confirmar').isDisabled(),true);
  const before=await stored(recordKey);await page.locator('#dados-aparelho-cancelar').click();
  assert.equal(await page.locator('#dados-aparelho-remocao').isVisible(),false);assert.equal(await stored(recordKey),before);
 });
 await check('technical download includes only the active profile allowlist and changes no records',async()=>{
  const before=await stored(recordKey);const copy=await technicalDownload();
  assert.equal(copy.data.format,'minha-rodagem-device-profile');assert.equal(copy.data.version,1);assert.equal(copy.data.profile.id,'principal');
  assert.ok(copy.filename.startsWith('minha-rodagem-copia-tecnica-principal-'));
  const entries=new Map(copy.data.entries);assert.equal(entries.get(recordKey),before);assert.equal(entries.get(settingsKey),seed[settingsKey]);
  assert.ok(!entries.has(bindingKey));assert.ok(!entries.has(authStorageKey));assert.ok(!entries.has(otherKey));
  assert.ok(!copy.text.includes('synthetic-auth-storage-only'));assert.ok(!copy.text.includes('synthetic-other-profile'));
  assert.equal(await stored(recordKey),before);assert.equal(await stored(otherKey),seed[otherKey]);
 });
 await check('manual session diagnostics render a busy state and never call a financial RPC',async()=>{
  await page.evaluate(()=>{__v323CloudFixture.setSession(true);__v323CloudFixture.verifyMode='hold';});
  const before=await stored(recordKey);await page.locator('#sessao-verificar').click();
  await page.waitForFunction(()=>typeof __v323CloudFixture.release==='function');
  assert.equal(await page.locator('#sessao-verificar').isDisabled(),true);assert.equal(await page.locator('#sessao-verificar').getAttribute('aria-busy'),'true');
  await page.evaluate(()=>__v323CloudFixture.release());
  await page.waitForFunction(()=>document.querySelector('#sessao-diagnostico-status').textContent.startsWith('Sessão confirmada pelo servidor em '));
  assert.equal(await page.locator('#sessao-verificar').isDisabled(),false);
  const stats=await page.evaluate(()=>({verify:__v323CloudFixture.verifyCalls,uid:__v323CloudFixture.lastExpectedUID,data:__v323CloudFixture.dataCalls}));
  assert.deepEqual(stats,{verify:1,uid:A,data:0});assert.equal(await stored(recordKey),before);
 });
 await check('logout discards a late diagnostic result and preserves the local history',async()=>{
  await page.evaluate(()=>{__v323CloudFixture.release=null;});const before=await stored(recordKey);
  await page.locator('#sessao-verificar').click();await page.waitForFunction(()=>typeof __v323CloudFixture.release==='function');
  await page.locator('#cloud-signout').click();await page.waitForFunction(()=>__v323CloudFixture.signOutCalls===1);
  await page.evaluate(()=>__v323CloudFixture.release());
  await page.waitForFunction(()=>document.querySelector('#sessao-verificar').getAttribute('aria-busy')==='false');
  assert.match(await page.locator('#sessao-diagnostico-status').innerText(),/conta ou o perfil mudou/);
  assert.equal(await stored(recordKey),before);assert.equal(await page.evaluate(()=>__v323CloudFixture.dataCalls),0);
 });
 await check('device deletion requires name, saved-copy acknowledgement and signed-out account',async()=>{
  await page.locator('#dados-aparelho-abrir').click();const before=await stored(recordKey);
  await page.locator('#dados-aparelho-confirmar').click();await page.waitForFunction(()=>document.querySelector('#dados-aparelho-status').textContent.includes('Confirme que guardou'));
  await page.locator('#dados-aparelho-copia').check();await page.locator('#dados-aparelho-nome').fill('Nome incorreto');await page.locator('#dados-aparelho-confirmar').click();
  await page.waitForFunction(()=>document.querySelector('#dados-aparelho-status').textContent.includes('Digite exatamente'));
  await page.locator('#dados-aparelho-nome').fill('Perfil sintético');await page.evaluate(()=>__v323CloudFixture.setSession(true));await page.locator('#dados-aparelho-confirmar').click();
  await page.waitForFunction(()=>document.querySelector('#dados-aparelho-status').textContent.includes('Saia da conta'));assert.equal(await stored(recordKey),before);
  await page.locator('#cloud-signout').click();await page.waitForFunction(()=>__v323CloudFixture.session===null&&document.querySelector('#conta-cloud').getAttribute('aria-busy')==='false');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#dados-aparelho-confirmar').click()]);
  await page.waitForFunction(()=>Boolean(window.RodagemDeviceData));
  assert.equal(await stored(recordKey),null);assert.equal(await stored(settingsKey),null);assert.equal(await stored(otherKey),seed[otherKey]);
  assert.equal(await stored(registryKey),seed[registryKey]);assert.equal(await stored(bindingKey),seed[bindingKey]);assert.equal(await stored(authStorageKey),seed[authStorageKey]);
  assert.ok(await stored('minha-rodagem-device-generation-v1'));assert.equal(await stored('minha-rodagem-device-journal-v1'),null);
 });
 await check('the real service worker caches all three new runtime modules',async()=>{
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(async()=>Boolean((await caches.keys()).find(key=>key.endsWith(':3.2.3'))));
  const cached=await page.evaluate(async()=>{
   const key=(await caches.keys()).find(key=>key.endsWith(':3.2.3'));const cache=await caches.open(key);const result={};
   for(const name of ['device-data.js','backup-budget.js','session-diagnostics.js']){
    const response=await cache.match(new URL(name,location.href).href);result[name]=Boolean(response?.ok&&(await response.text()).length>0);
   }return result;
  });
  assert.deepEqual(cached,{'device-data.js':true,'backup-budget.js':true,'session-diagnostics.js':true});
 });
 await check('new cards remain readable on mobile and desktop without runtime errors or external requests',async()=>{
  await navigate('ajustes');
  for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:width>500?960:844});
   const size=await page.evaluate(()=>({actual:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(size.actual<=size.viewport+1,JSON.stringify(size));
   await page.locator('#sessao-diagnostico').scrollIntoViewIfNeeded();
   if(width===390)await page.screenshot({path:path.join(__dirname,'browser-mobile.png'),animations:'disabled'});
   if(width===1280)await page.screenshot({path:path.join(__dirname,'browser-desktop.png'),animations:'disabled'});
  }
  assert.deepEqual(report.browserErrors,[]);assert.equal(report.externalRequests,0);
 });
})().catch(async error=>{
 report.errors.push(error.stack||String(error));console.error(error.stack||error);process.exitCode=1;
 if(page&&!page.isClosed())try{report.failureState=await page.evaluate(()=>({panel:location.hash,message:document.querySelector('#mensagem')?.textContent,deviceStatus:document.querySelector('#dados-aparelho-status')?.textContent,diagnosticStatus:document.querySelector('#sessao-diagnostico-status')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id)}));await page.screenshot({path:path.join(__dirname,'browser-failure.png'),animations:'disabled'});}catch{}
}).finally(async()=>{
 if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(__dirname,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log('V323_BROWSER_REPORT',JSON.stringify(report));
});
