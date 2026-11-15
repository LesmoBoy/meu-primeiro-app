/* Actual Chromium integration. Profiles and records are synthetic and local;
 * this suite does not create online accounts or touch a user's browser data. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname,'..');
const registryKey = 'minha-rodagem-perfis-v1';
const recordKey = 'minha-rodagem-v1';
const preferencesKey = 'minha-rodagem-perfil-v2';
const journeyKey = 'minha-rodagem-jornada-v2';
const gpsPrefsKey = 'minha-rodagem-gps-preferencias-v1';
const routeKey = 'minha-rodagem-rota-v1:legacy-route';
const report = {mode:'Real Chromium, isolated local multi-profile fixtures',passed:[],errors:[],browserErrors:[]};
let browser,server,page;
let idB,base,context;
const fixtureTime = Date.parse('2026-11-15T12:00:00Z');
const legacyRecords = {versao:1,registros:[
  {id:'legacy-ana-day',tipo:'dia',data:'2026-11-15',ganhos:18000,combustivel:2500,outros:500,entregas:20,horas:600,km:12000,jornadaId:'legacy-route'},
  {id:'legacy-pump-one',tipo:'posto',data:'2026-11-14',odometro:100000,litros:10000,valor:5000,tanque:'cheio'},
  {id:'legacy-pump-two',tipo:'posto',data:'2026-11-15',odometro:120000,litros:10000,valor:3500,tanque:'cheio'}
]};
const legacyPrefs = {versao:1,nome:'Ana',trabalho:'apps',jornada:6,meta:20000,moto:'110–160 cc',modelo:'Moto da Ana',combustivel:'Gasolina',configurado:true};
const p1={lat:-23.55,lng:-46.63,t:fixtureTime-59000,accuracy:6,break:true};
const p2={lat:-23.549,lng:-46.63,t:fixtureTime-43000,accuracy:6,break:false};
const legacyRoute={version:1,id:'legacy-route',mode:'eco',enabled:true,totalMeters:111.2,points:[p1,p2],gaps:0,lastFix:p2,lastSampleAt:p2.t,lastSeenAt:p2.t,createdAt:fixtureTime-60000,updatedAt:fixtureTime-42000};
const seed={
  [recordKey]:JSON.stringify(legacyRecords),
  [preferencesKey]:JSON.stringify(legacyPrefs),
  [gpsPrefsKey]:JSON.stringify({enabled:false,mode:'eco'}),
  [routeKey]:JSON.stringify(legacyRoute),
  'minha-rodagem-rotas-indice-v1':JSON.stringify([{id:'legacy-route',updatedAt:legacyRoute.updatedAt,finished:true}])
};
const check=async(name,fn)=>{await fn();report.passed.push(name);console.log('PASS',name);};
async function ready(p){await p.waitForFunction(()=>Boolean(window.RodagemProfiles&&window.RodagemGPS));}
async function active(p){return p.evaluate(()=>window.RodagemProfiles.current());}
async function stored(p,logical){return p.evaluate(logical=>localStorage.getItem(window.RodagemProfiles.key(logical)),logical);}
async function records(p){return JSON.parse(await stored(p,recordKey)||'{"registros":[]}').registros;}
async function navigate(p,panel){await p.locator(`.main-nav [data-panel="${panel}"]`).click();await p.locator('#'+panel).waitFor({state:'visible'});}
async function fill(p,id,fields){for(const[name,value]of Object.entries(fields))await p.locator(`#${id} [name="${name}"]`).fill(String(value));}
async function picker(p){if(!await p.locator('#perfis-dialogo').isVisible())await p.locator('#trocar-perfil').click();await p.locator('#perfis-dialogo').waitFor({state:'visible'});}
async function choose(p,id,{confirm=false}={}){
  await picker(p);
  const button=p.locator(`#perfis-lista [data-profile-id="${id}"]`).getByRole('button',{name:/usar perfil/i});
  if(confirm){
    await button.click();await p.locator('#confirmacao').waitFor({state:'visible'});
    await Promise.all([p.waitForNavigation({waitUntil:'domcontentloaded'}),p.locator('#confirmacao button[value="confirmar"]').click()]);
  }else await Promise.all([p.waitForNavigation({waitUntil:'domcontentloaded'}),button.click()]);
  await ready(p);assert.equal((await active(p)).id,id);
}
async function newContext(){
  const c=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
  c.on('page',p=>p.on('pageerror',error=>report.browserErrors.push(error.stack||error.message)));
  await c.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await c.addInitScript(({seed,origin})=>{
    // Playwright also runs init scripts in a new tab's about:blank document,
    // where storage has no origin. Seed only the app under test.
    if(location.origin!==origin)return;
    if(!localStorage.getItem('__profiles_test_seeded')){
      for(const[key,value]of Object.entries(seed))localStorage.setItem(key,value);
      localStorage.setItem('__profiles_test_seeded','1');
    }
  },{seed,origin:new URL(base).origin});
  return c;
}

(async()=>{
  await fs.access(path.join(root,'profiles-core.js'));await fs.access(path.join(root,'profiles-ui.js'));
  server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(!pathname.startsWith('/meu-primeiro-app/')){res.writeHead(404).end();return;}
      const relative=pathname.slice('/meu-primeiro-app/'.length)||'index.html';
      const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const data=await fs.readFile(target);const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  base=`http://127.0.0.1:${server.address().port}/meu-primeiro-app/`;report.appURL=base;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--disable-crashpad-for-testing','--disable-breakpad']});
  report.browserVersion=browser.version();context=await newContext();page=await context.newPage();await page.clock.install({time:new Date(fixtureTime)});await page.goto(base);await ready(page);

  await check('the principal profile reads legacy data without copying or rewriting it',async()=>{
    assert.equal((await active(page)).id,'principal');assert.ok((await page.locator('#perfil-atual-nome').innerText()).includes('Ana'));
    const storedValues=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(seed));
    assert.deepEqual(storedValues,seed);assert.equal((await records(page)).length,3);
    assert.equal(await page.evaluate(()=>RodagemGPS.hasTrack('legacy-route')),true);
    assert.ok((await page.locator('#saldo-hoje').innerText()).replace(/\s/g,'').includes('R$150,00'));
  });
  await check('profile creation switches to an empty, separately named local profile',async()=>{
    await picker(page);await page.locator('#novo-perfil [name="nome"]').fill('Bruno');
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#novo-perfil button[type="submit"]').click()]);
    await ready(page);idB=(await active(page)).id;assert.notEqual(idB,'principal');
    assert.equal((await records(page)).length,0);assert.equal(await page.evaluate(()=>RodagemGPS.hasTrack('legacy-route')),false);
    assert.equal(await stored(page,journeyKey),null);
    assert.ok((await page.locator('#perfil-atual-nome').innerText()).includes('Bruno'));
    await navigate(page,'ajustes');assert.equal(await page.locator('#perfil [name="nome"]').inputValue(),'Bruno');
    assert.equal(await page.locator('#perfil [name="modelo"]').inputValue(),'');
    assert.equal(await page.locator('#perfil [name="meta"]').inputValue(),'');
  });
  await check('new financial records and preferences remain inside the selected profile',async()=>{
    await navigate(page,'fechamento');await fill(page,'dia',{data:'2026-11-15',ganhos:'77',entregas:'7',combustivel:'7'});await page.locator('#dia button[value="salvar"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(RodagemProfiles.key('minha-rodagem-v1'))||'{"registros":[]}').registros.length===1);
    assert.equal((await records(page))[0].ganhos,7700);
    await navigate(page,'ajustes');await fill(page,'perfil',{nome:'Bruno Silva',meta:'120',modelo:'Moto do Bruno',jornada:'4'});await page.locator('#perfil button[type="submit"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(RodagemProfiles.key('minha-rodagem-perfil-v2'))||'{}').meta===12000);
    await page.waitForFunction(()=>RodagemProfiles.current().name==='Bruno Silva');
    assert.ok((await page.locator('#perfil-atual-nome').innerText()).includes('Bruno Silva'));
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),recordKey),seed[recordKey]);
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),preferencesKey),seed[preferencesKey]);
    const physical=await page.evaluate(k=>RodagemProfiles.key(k),recordKey);assert.ok(physical.startsWith(`minha-rodagem-usuario-v1:${idB}:`));
  });
  await check('backup and CSV export only the active profile',async()=>{
    await navigate(page,'historico');const downloadEvent=page.waitForEvent('download');await page.locator('#backup').click();const download=await downloadEvent;
    const file=path.join(__dirname,'profiles-backup-test.json');await download.saveAs(file);const data=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(data.registros.length,1);assert.equal(data.registros[0].ganhos,7700);assert.ok(!data.registros.some(r=>r.id==='legacy-ana-day'));
    const csvEvent=page.waitForEvent('download');await page.locator('#csv').click();const csv=await csvEvent;const csvPath=path.join(__dirname,'profiles-csv-test.csv');await csv.saveAs(csvPath);
    const text=await fs.readFile(csvPath,'utf8');assert.ok(text.includes(';77;'));assert.ok(!text.includes(';180;'));
  });
  await check('switching restores each profile without leaking fuel, route or motorcycle data',async()=>{
    await choose(page,'principal');assert.deepEqual(await records(page),legacyRecords.registros);
    assert.equal(await page.evaluate(()=>RodagemGPS.hasTrack('legacy-route')),true);
    await navigate(page,'consumo');assert.ok((await page.locator('#moto-nome').innerText()).includes('Ana'));
    await choose(page,idB);assert.equal((await records(page)).length,1);
    await navigate(page,'consumo');assert.ok((await page.locator('#moto-nome').innerText()).includes('Bruno'));
    assert.equal(await page.evaluate(()=>RodagemGPS.getSummary('legacy-route')),null);
  });
  await check('GPS preferences are scoped independently for each profile',async()=>{
    const physical=await page.evaluate(key=>{const k=RodagemProfiles.key(key);localStorage.setItem(k,JSON.stringify({enabled:true,mode:'precise'}));return k;},gpsPrefsKey);
    assert.notEqual(physical,gpsPrefsKey);assert.equal(await page.evaluate(k=>localStorage.getItem(k),gpsPrefsKey),seed[gpsPrefsKey]);
    await choose(page,'principal');assert.equal(await stored(page,gpsPrefsKey),seed[gpsPrefsKey]);
    assert.equal(await page.locator('#gps-usar').isChecked(),false);
  });
  await check('switching profiles pauses a running journey and preserves resumable time',async()=>{
    await navigate(page,'inicio');await page.locator('#gps-usar').uncheck();await page.locator('#jornada-iniciar').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(RodagemProfiles.key('minha-rodagem-jornada-v2'))||'null')?.estado==='running');
    await page.clock.fastForward(3600000);await choose(page,idB,{confirm:true});
    const paused=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),journeyKey);assert.equal(paused.estado,'paused');assert.ok(paused.acumulado>=3590000);
    assert.equal(await stored(page,journeyKey),null);await page.clock.fastForward(600000);
    assert.equal((await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),journeyKey)).acumulado,paused.acumulado);
    await choose(page,'principal');await navigate(page,'inicio');assert.ok((await page.locator('#jornada-status').innerText()).includes('pausa'));
    assert.ok((await page.locator('#jornada-pausar').innerText()).includes('Retomar'));
  });
  await check('a profile changed in another tab makes the old tab read-only and rejects stale writes',async()=>{
    const a=page;const beforeA=await stored(a,recordKey);const second=await context.newPage();await second.clock.install({time:new Date(fixtureTime)});await second.goto(base);await ready(second);
    await choose(second,idB);await a.waitForFunction(()=>document.body.innerText.includes('Perfil alterado em outra aba'));
    assert.equal(await a.locator('#conteudo').evaluate(e=>e.inert),true);
    const result=await a.evaluate(async()=>{try{await persistir([...registros,{id:'must-not-save',tipo:'dia',data:'2026-11-15',ganhos:1,combustivel:0,outros:0,entregas:1,horas:0,km:0}]);return 'saved';}catch(error){return error.message;}});
    assert.notEqual(result,'saved');assert.equal(await a.evaluate(k=>localStorage.getItem(k),recordKey),beforeA);
    assert.equal((await records(second)).length,1);assert.ok(!(await records(second)).some(r=>r.id==='must-not-save'));
    page=second;await a.close();
  });
  await check('empty and duplicate profile names cannot add unintended profiles',async()=>{
    await picker(page);const before=await page.evaluate(()=>RodagemProfiles.list().length);
    await page.locator('#novo-perfil [name="nome"]').fill('');await page.locator('#novo-perfil button[type="submit"]').click();
    assert.equal(await page.evaluate(()=>RodagemProfiles.list().length),before);
    const name=(await active(page)).name;await page.locator('#novo-perfil [name="nome"]').fill(name);await page.locator('#novo-perfil button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#perfis-erro').textContent.trim().length>0);
    assert.equal(await page.evaluate(()=>RodagemProfiles.list().length),before);
    await page.locator('#perfis-fechar').click();
  });
  await check('profile picker is usable at phone and desktop widths without horizontal overflow',async()=>{
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:width>500?960:844});await picker(page);
      const size=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(size.content<=size.viewport+1,JSON.stringify(size));
      assert.ok(await page.locator(`#perfis-lista [data-profile-id="${idB}"]`).count());
      if(width===390)await page.screenshot({path:path.join(__dirname,'profiles-mobile.png'),animations:'disabled'});
      if(width===1280)await page.screenshot({path:path.join(__dirname,'profiles-desktop.png'),animations:'disabled'});
      await page.locator('#perfis-fechar').click();
    }
  });
  await check('failed registry writes preserve the principal profile and its legacy records',async()=>{
    const c=await newContext();await c.addInitScript(registryKey=>{
      const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===registryKey)throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.call(this,key,value);};
    },registryKey);
    const p=await c.newPage();await p.goto(base);await ready(p);const old=await p.evaluate(k=>localStorage.getItem(k),registryKey);
    const result=await p.evaluate(async()=>{try{await RodagemProfiles.create('Should not persist');return false;}catch{return true;}});
    assert.equal(result,true);assert.equal(await p.evaluate(k=>localStorage.getItem(k),registryKey),old);assert.equal((await active(p)).id,'principal');assert.equal(await stored(p,recordKey),seed[recordKey]);await c.close();
  });
  await check('no JavaScript runtime errors are emitted by profile flows',async()=>assert.deepEqual(report.browserErrors,[]));
})().catch(async error=>{
  report.errors.push(error.stack||String(error));console.error(error.stack||error);process.exitCode=1;
  if(page&&!page.isClosed()){
    try{report.failureState=await page.evaluate(()=>({url:location.href,current:window.RodagemProfiles?.current(),profileError:document.querySelector('#perfis-erro')?.textContent,notice:document.querySelector('#mensagem')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id)}));await page.screenshot({path:path.join(__dirname,'profiles-failure.png'),animations:'disabled'});}catch{}
  }
}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(__dirname,'profiles-report.json'),JSON.stringify(report,null,2));console.log('PROFILES_BROWSER_REPORT',JSON.stringify(report));
});
