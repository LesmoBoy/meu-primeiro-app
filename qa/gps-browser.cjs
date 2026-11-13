/* Real Chromium integration for the GPS feature. Coordinates are synthetic;
 * no physical GPS or device battery measurements are claimed. OSM tile requests
 * are blocked deliberately: the local map engine and recorded vector are tested.
 */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const routePrefix = 'minha-rodagem-rota-v1:';
const journalKey = 'minha-rodagem-jornada-v2';
const recordKey = 'minha-rodagem-v1';
const report = {mode:'Real Chromium, synthetic GPS coordinates', passed:[], errors:[], browserErrors:[], nativeGeolocationChecked:false, physicalDevice:false, batteryMeasured:false};
let server, browser, page;
async function check(name, fn) { await fn(); report.passed.push(name); console.log('PASS', name); }
async function route(page, name) {
  const button = page.locator(`.main-nav [data-panel="${name}"]`);
  if (await button.count()) await button.click();
  else await page.evaluate(name => abrir(name), name);
  await page.locator(`#${name}`).waitFor({state:'visible'});
}
async function fill(page, form, fields) {
  for (const [name,value] of Object.entries(fields)) await page.locator(`#${form} [name="${name}"]`).fill(String(value));
}
async function accept(page) {
  await page.locator('#confirmacao').waitFor({state:'visible'});
  await page.locator('#confirmacao button[value="confirmar"]').click();
  await page.locator('#confirmacao').waitFor({state:'hidden'});
}
async function journeyControl(page, action) {
  const mapButton=page.locator(action==='end'?'#gps-encerrar':'#gps-pausar');
  const original=page.locator(action==='end'?'#jornada-encerrar':'#jornada-pausar');
  await (await mapButton.isVisible()?mapButton:original).click();
}
const journal = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), journalKey);
const records = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)||'{"registros":[]}').registros, recordKey);
const meters = (page,id) => page.evaluate(id => window.RodagemGPS.distanceMeters(id),id);
const callCount = page => page.evaluate(() => window.__gpsTest.calls.length);
async function setPosition(page, fields) { await page.evaluate(fields => Object.assign(window.__gpsTest.position,fields),fields); }
async function advance(page, ms = 16000) { await page.clock.fastForward(ms); await page.evaluate(() => Promise.resolve()); }
async function waitFix(page, count=1) { await page.waitForFunction(count => window.__gpsTest.calls.length >= count,count); }

async function newMockContext(base, initial={}) {
  const context = await browser.newContext({viewport:{width:390,height:844},locale:'pt-BR',timezoneId:'America/Sao_Paulo',acceptDownloads:true});
  await context.grantPermissions(['geolocation'],{origin:new URL(base).origin});
  let tiles = 0;
  await context.route('https://tile.openstreetmap.org/**',route=>{tiles++;return route.abort();});
  await context.addInitScript(initial => {
    const state = window.__gpsTest = {
      position:{latitude:-23.55052,longitude:-46.633308,accuracy:6,speed:8,age:0,...initial},
      calls:[],error:null
    };
    const geo = {
      getCurrentPosition(success,error,options={}) {
        state.calls.push({time:Date.now(),options:{...options}});
        queueMicrotask(()=>{
          if(state.error) { error?.({code:state.error,message:'Synthetic geolocation error'});return; }
          const p=state.position;
          success({coords:{latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,speed:p.speed,heading:null,altitude:null,altitudeAccuracy:null},timestamp:Date.now()-(p.age||0)});
        });
      },
      watchPosition(success,error,options) { this.getCurrentPosition(success,error,options);return 1; },
      clearWatch() {}
    };
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:geo});
  },initial);
  const p = await context.newPage();
  p.on('pageerror',error=>report.browserErrors.push(error.message));
  await p.clock.install({time:new Date('2026-11-13T12:00:00Z')});
  await p.goto(base);
  await p.waitForFunction(()=>Boolean(window.RodagemGPS));
  return {context,page:p,get tiles(){return tiles;}};
}

(async()=>{
  for(const file of ['index.html','gps-core.js','tracking.js']) await fs.access(path.join(root,file));
  server = http.createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(!pathname.startsWith('/meu-primeiro-app/')) {res.writeHead(404).end();return;}
      const rel=pathname.slice('/meu-primeiro-app/'.length)||'index.html';
      const target=path.resolve(root,rel);
      if(!target.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
      const data=await fs.readFile(target);
      const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:data);
    } catch {res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}/meu-primeiro-app/`;
  report.appURL=base;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--disable-crashpad-for-testing','--disable-breakpad']});
  report.browserVersion=browser.version();

  await check('native browser permission and geolocation API produce the first synthetic fix',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:-23.55052,longitude:-46.633308,accuracy:8},locale:'pt-BR'});
    await context.grantPermissions(['geolocation'],{origin:new URL(base).origin});
    await context.route('https://tile.openstreetmap.org/**',r=>r.abort());
    const native=await context.newPage();native.on('pageerror',e=>report.browserErrors.push(e.message));
    await native.goto(base);await native.locator('#gps-usar').check();await native.locator('#jornada-iniciar').click();
    await native.waitForFunction(({journalKey,routePrefix})=>{
      const j=JSON.parse(localStorage.getItem(journalKey)||'null');return Boolean(j&&localStorage.getItem(routePrefix+j.id));
    },{journalKey,routePrefix});
    await context.setGeolocation({latitude:-23.55052,longitude:-46.633308,accuracy:8});
    await native.waitForFunction(({journalKey,routePrefix})=>{
      const j=JSON.parse(localStorage.getItem(journalKey)||'null');
      const track=j&&JSON.parse(localStorage.getItem(routePrefix+j.id)||'null');
      return Boolean(track?.points?.length);
    },{journalKey,routePrefix},{timeout:20000});
    const id=(await journal(native)).id;
    assert.equal(await meters(native,id),0);
    report.nativeGeolocationChecked=true;
    await context.close();
  });

  await check('opting out starts the timer without requesting or sampling location',async()=>{
    const app=await newMockContext(base);const p=app.page;
    await p.locator('#gps-usar').uncheck();await p.locator('#jornada-iniciar').click();
    await p.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.estado==='running',journalKey);
    await advance(p,60000);assert.equal(await callCount(p),0);
    assert.equal((await journal(p)).estado,'running');
    await app.context.close();
  });

  const app=await newMockContext(base);page=app.page;
  let id, distanceBeforePause;
  await check('economic GPS starts with the journey and map tiles are loaded only when the map is needed',async()=>{
    assert.equal(await callCount(page),0);
    assert.equal(app.tiles,0,'opening the app alone must not request map tiles');
    await page.locator('#gps-usar').check();await page.locator('#jornada-iniciar').click();
    await waitFix(page);id=(await journal(page)).id;
    assert.equal(await meters(page,id),0);
    const calls=await page.evaluate(()=>window.__gpsTest.calls);
    assert.equal(calls[0].options.enableHighAccuracy,false);
    assert.ok(calls[0].options.maximumAge>=0&&calls[0].options.maximumAge<=10000);
  });
  await check('accepted movement accumulates plausible GPS distance and ignores stationary jitter',async()=>{
    await setPosition(page,{latitude:-23.54952});await advance(page);await waitFix(page,2);
    await setPosition(page,{longitude:-46.632308});await advance(page);await waitFix(page,3);
    assert.ok(await page.evaluate(()=>window.__gpsTest.calls.slice(1).some(call=>call.options.maximumAge>=5000)),'steady-state economic collection may reuse a recent fix');
    const measured=await meters(page,id);assert.ok(measured>160&&measured<270,`Expected approximately 213m, got ${measured}`);
    await setPosition(page,{latitude:-23.549517,longitude:-46.632305,speed:0});await advance(page);await waitFix(page,4);
    assert.ok(Math.abs(await meters(page,id)-measured)<2,'sub-metre stationary jitter should not count as riding');
    assert.ok((await callCount(page))<=5,'economic collection should not run continuously');
    distanceBeforePause=await meters(page,id);
  });
  await check('pausing stops sampling and resuming does not add the movement made during the pause',async()=>{
    await journeyControl(page,'pause');
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).estado==='paused',journalKey);
    const count=await callCount(page);
    await setPosition(page,{latitude:-23.52952,longitude:-46.632308,speed:8});await advance(page,35000);
    assert.equal(await callCount(page),count);assert.equal(await meters(page,id),distanceBeforePause);
    await journeyControl(page,'pause');await waitFix(page,count+1);
    assert.ok(Math.abs(await meters(page,id)-distanceBeforePause)<2,'pause must split the route');
    await setPosition(page,{latitude:-23.52852});await advance(page);await waitFix(page,count+2);
    assert.ok(await meters(page,id)>distanceBeforePause+80);
  });
  await check('the map engine and route vector work when map tiles are unavailable',async()=>{
    if(!await page.locator('#percurso').isVisible()) {
      await route(page,'inicio');await page.locator('#jornada-mapa').click();
    }
    await page.locator('#percurso').waitFor({state:'visible'});
    await page.locator('#mapa.leaflet-container').waitFor({state:'visible'});
    assert.ok(await page.locator('#mapa .leaflet-overlay-pane path, #mapa .leaflet-overlay-pane canvas').count()>0,'recorded route should draw as a vector');
    assert.ok(await page.evaluate(id=>RodagemGPS.getSummary(id)?.points>=4,id));
    assert.ok((await page.locator('#gps-distancia').innerText()).trim().length);
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:width>500?960:844});
      const size=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(size.content<=size.viewport+1,`Map layout overflows at ${width}: ${JSON.stringify(size)}`);
    }
    await page.setViewportSize({width:390,height:844});
  });
  await check('ending the journey prefills distance and saved history can reopen its route',async()=>{
    await route(page,'inicio');await page.locator('#jornada-encerrar').click();await page.locator('#fechamento').waitFor({state:'visible'});
    const km=Number((await page.locator('#dia [name="km"]').inputValue()).replace(',','.'));
    assert.ok(km>.25&&km<.5,`Expected tracked km in closing, got ${km}`);
    await fill(page,'dia',{ganhos:'120',entregas:'12'});await page.locator('#dia button[value="salvar"]').click();
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'{"registros":[]}').registros.length===1,recordKey);
    const saved=(await records(page))[0];assert.equal(saved.jornadaId,id);assert.equal(saved.km,Math.round(km*100));
    await route(page,'historico');await page.locator('#lista button').filter({hasText:/percurso|trajeto/i}).click();
    await page.locator('#percurso').waitFor({state:'visible'});
    assert.ok(await meters(page,id)>250);
  });
  await check('GPX exports contain the recorded segments and routes survive a page reload',async()=>{
    const pending=page.waitForEvent('download');await page.locator('#gps-exportar').click();
    const download=await pending;const target=path.join(__dirname,'gps-test.gpx');await download.saveAs(target);
    const gpx=await fs.readFile(target,'utf8');assert.ok(gpx.includes('<gpx'));assert.ok(gpx.includes('<trkpt'));assert.ok(gpx.includes('-23.'));
    assert.ok((gpx.match(/<trkseg>/g)||[]).length>=2,'the exported route must retain the pause boundary');
    const distance=await meters(page,id);await page.reload();
    await page.evaluate(id=>RodagemGPS.openRoute(id),id);await page.locator('#percurso').waitFor({state:'visible'});
    assert.equal(await meters(page,id),distance);assert.equal((await records(page)).length,1);
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(__dirname,'gps-mobile.png'),animations:'disabled'});
    await page.setViewportSize({width:1280,height:960});await page.screenshot({path:path.join(__dirname,'gps-desktop.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
  });
  await check('discarding a stored route preserves the saved financial kilometres',async()=>{
    const before=(await records(page))[0].km;await page.locator('#gps-apagar').click();await accept(page);
    await page.waitForFunction(({routePrefix,id})=>{
      const value=localStorage.getItem(routePrefix+id);
      return !value || !JSON.parse(value).points.length;
    },{routePrefix,id});
    assert.equal((await records(page))[0].km,before);
  });

  await check('denied location keeps the timer and manual closing usable',async()=>{
    const denied=await newMockContext(base);const p=denied.page;
    await p.evaluate(()=>window.__gpsTest.error=1);await p.locator('#jornada-iniciar').click();await waitFix(p);
    assert.equal((await journal(p)).estado,'running');assert.equal(await meters(p,(await journal(p)).id),0);
    await advance(p,20000);await journeyControl(p,'end');await p.locator('#fechamento').waitFor({state:'visible'});
    await fill(p,'dia',{km:'1,23',ganhos:'20',entregas:'2'});await p.locator('#dia button[value="salvar"]').click();
    await p.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'{"registros":[]}').registros.length===1,recordKey);
    assert.equal((await records(p))[0].km,123);await denied.context.close();
  });
  await check('weak and stale fixes never manufacture travelled kilometres',async()=>{
    const weak=await newMockContext(base,{accuracy:250});const p=weak.page;
    await p.locator('#jornada-iniciar').click();await waitFix(p);const key=(await journal(p)).id;
    await setPosition(p,{latitude:-23.54});await advance(p);await waitFix(p,2);assert.equal(await meters(p,key),0);
    await setPosition(p,{accuracy:6,age:120000});await advance(p);await waitFix(p,3);assert.equal(await meters(p,key),0);
    await weak.context.close();
  });
  await check('map screenshots are captured with no JavaScript runtime errors',async()=>{
    await fs.access(path.join(__dirname,'gps-mobile.png'));await fs.access(path.join(__dirname,'gps-desktop.png'));
    assert.deepEqual(report.browserErrors,[]);
  });
  await app.context.close();
})().catch(async error=>{
  report.errors.push(error.stack||String(error));console.error(error.stack||error);
  if(page&&!page.isClosed())try{
    report.failureState=await page.evaluate(()=>({panel:document.querySelector('.view:not([hidden])')?.id,notice:document.querySelector('#mensagem')?.textContent,gpsStatus:document.querySelector('#mapa-status')?.textContent}));
    console.log('GPS_FAILURE_STATE',JSON.stringify(report.failureState));
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(__dirname,'gps-failure.png'),animations:'disabled'});
  }catch{}
  process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(__dirname,'gps-report.json'),JSON.stringify(report,null,2));
  console.log('GPS_BROWSER_REPORT',JSON.stringify(report));
});
