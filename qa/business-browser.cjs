/* Real Chromium business workflows with isolated synthetic local data.
 * No real company account, invitation, email or payment is used. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const businessKey='minha-rodagem-business-v1',recordKey='minha-rodagem-v1';
const personal={versao:1,registros:[{id:'personal-only',tipo:'dia',data:'2026-11-16',ganhos:11111,combustivel:111,outros:0,entregas:1,horas:100,km:100}]};
const seed={[recordKey]:JSON.stringify(personal),'minha-rodagem-gps-preferencias-v1':JSON.stringify({enabled:false,mode:'eco'})};
const report={mode:'Real Chromium, synthetic local business data, cloud and billing unconfigured',passed:[],errors:[],browserErrors:[]};
let browser,server,context,page,base,companyA,companyB,vehicleA,vehicleB,memberA,completedTrip,reminderA,backupData;
const external=[];
const check=async(name,fn)=>{await fn();report.passed.push(name);console.log('PASS',name);};
const textMoney=value=>value.replace(/\s/g,'');
async function ready(){await page.waitForFunction(()=>Boolean(window.RodagemBusiness&&window.RodagemBusinessUI));await settled();}
async function settled(){await page.waitForFunction(()=>document.querySelector('#business-app')?.getAttribute('aria-busy')!=='true');}
async function workspace(){return page.evaluate(()=>RodagemBusiness.getCurrentWorkspace());}
async function rawBusiness(){return page.evaluate(key=>localStorage.getItem(RodagemProfiles.key(key)),businessKey);}
async function fill(formId,values){for(const[name,value]of Object.entries(values)){const field=page.locator(`#${formId} [name="${name}"]`);if(await field.evaluate(e=>e.type==='checkbox'))await field.setChecked(Boolean(value));else if(await field.evaluate(e=>e.tagName==='SELECT'))await field.selectOption(String(value));else await field.fill(String(value));}}
async function submit(formId){await page.locator(`#${formId} button[type="submit"]`).click();await settled();}
async function confirm(){const dialog=page.locator('#confirmacao');await dialog.waitFor({state:'visible'});await dialog.locator('[value="confirmar"]').click();await dialog.waitFor({state:'hidden'});await settled();}
async function tab(name){await page.locator(`[data-business-tab="${name}"]`).click();if(await page.locator('#confirmacao').isVisible())await confirm();await settled();}
async function selectCompany(id){await page.locator('#business-company').selectOption(id);if(await page.locator('#confirmacao').isVisible())await confirm();await page.waitForFunction(id=>RodagemBusiness.getCurrentWorkspace()?.company.id===id,id);await settled();}
async function createCompany(name){await fill('business-company-form',{name});await submit('business-company-form');await page.waitForFunction(name=>RodagemBusiness.getCurrentWorkspace()?.company.name===name,name);return (await workspace()).company.id;}
function row(list,id){return page.locator(`#business-${list} [data-business-id="${id}"]`);}
async function newVehicle(values){await tab('vehicles');await fill('business-vehicle-form',values);await submit('business-vehicle-form');await page.waitForFunction(name=>RodagemBusiness.getCurrentWorkspace().vehicles.some(v=>v.name===name),values.name);return (await workspace()).vehicles.find(v=>v.name===values.name).id;}
async function newTrip(values){await tab('trips');await fill('business-trip-form',values);await submit('business-trip-form');await page.waitForFunction(title=>RodagemBusiness.getCurrentWorkspace().trips.some(t=>t.title===title),values.title);return (await workspace()).trips.find(t=>t.title===values.title).id;}

(async()=>{
  server=http.createServer(async(req,res)=>{try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!pathname.startsWith('/meu-primeiro-app/')){res.writeHead(404).end();return;}
    const relative=pathname.slice('/meu-primeiro-app/'.length)||'index.html',target=path.resolve(root,relative);
    if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const body=await fs.readFile(target),types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404).end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}/meu-primeiro-app/`;report.appURL=base;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--disable-crashpad-for-testing','--disable-breakpad']});report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:390,height:844},locale:'pt-BR',timezoneId:'America/Sao_Paulo',acceptDownloads:true});
  context.on('page',p=>p.on('pageerror',error=>report.browserErrors.push(error.stack||error.message)));
  context.on('request',request=>{if(/https:\/\/(?:[^/]*\.)?(?:supabase\.co|stripe\.com|google\.com|facebook\.com)(?:\/|$)/.test(request.url()))external.push(request.url());});
  await context.route('https://tile.openstreetmap.org/**',request=>request.abort());
  await context.addInitScript(({seed,origin})=>{if(location.origin!==origin)return;if(!localStorage.getItem('__business_test_seeded')){for(const[key,value]of Object.entries(seed))localStorage.setItem(key,value);localStorage.setItem('__business_test_seeded','1');}},{seed,origin:new URL(base).origin});
  page=await context.newPage();await page.clock.install({time:new Date('2026-11-16T12:00:00Z')});await page.goto(base);await ready();await page.locator('.main-nav [data-panel="empresa"]').click();await page.locator('#empresa').waitFor({state:'visible'});

  await check('business opens as an empty local workspace without rewriting personal history',async()=>{
    assert.equal(await rawBusiness(),null);assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
    assert.equal(await page.locator('.main-nav [data-panel]').count(),6);assert.equal(await page.evaluate(()=>RodagemBusiness.getMode()),'local');
    assert.match(await page.locator('#business-app').innerText(),/neste aparelho/i);assert.equal(await page.locator('#business-mode option[value="cloud"]').evaluate(option=>option.disabled),true);
  });
  await check('two companies are created through the interface with independent empty ledgers',async()=>{
    companyA=await createCompany('Entregas Aurora');assert.equal((await workspace()).trips.length,0);
    companyB=await createCompany('Transportes Horizonte');assert.notEqual(companyA,companyB);assert.equal((await workspace()).vehicles.length,0);
    await selectCompany(companyA);assert.equal((await workspace()).company.name,'Entregas Aurora');
  });
  await check('local team roles are saved as organization metadata without claiming authenticated access',async()=>{
    await tab('members');await fill('business-member-form',{name:'Ana Motorista',email:'ana@example.test',role:'driver'});await submit('business-member-form');
    await page.waitForFunction(()=>RodagemBusiness.getCurrentWorkspace().members.some(m=>m.name==='Ana Motorista'));
    memberA=(await workspace()).members.find(m=>m.name==='Ana Motorista').id;
    assert.equal((await workspace()).members.find(m=>m.id===memberA).role,'driver');assert.match(await page.locator('#business-app').innerText(),/acesso autenticado|função.*online/i);
  });
  await check('multiple vehicles retain a free model, year, energy and individual odometers',async()=>{
    vehicleA=await newVehicle({name:'Caminhão <Azul> & família 42',category:'caminhao',year:'2021',fuel:'Diesel',plate:'ABC1D23',odometer:'1000,50'});
    vehicleB=await newVehicle({name:'Van escolar da Ana',category:'van',year:'2018',fuel:'Diesel',odometer:'2000'});
    const ws=await workspace();assert.equal(ws.vehicles.length,2);assert.equal(ws.vehicles.find(v=>v.id===vehicleA).odometer,100050);assert.equal(ws.vehicles.find(v=>v.id===vehicleA).year,2021);
    assert.equal(await row('vehicles',vehicleA).locator('img').count(),0);
  });
  await check('invalid vehicle years preserve the saved fleet and the editable draft',async()=>{
    const before=await rawBusiness();await fill('business-vehicle-form',{name:'Ano inválido',year:'1899'});await submit('business-vehicle-form');
    assert.equal(await rawBusiness(),before);assert.equal(await page.locator('#business-vehicle-form [name="year"]').inputValue(),'1899');assert.match(await page.locator('#business-notice').innerText(),/ano|dados/i);
    await tab('trips');
  });
  await check('all seven trip costs are counted once and only completed services enter profit',async()=>{
    completedTrip=await newTrip({title:'Frete completo Aurora',customer:'Cliente A',date:'2026-11-16',vehicleId:vehicleA,driverId:memberA,status:'completed',revenue:'850',distance:'120,50','cost-fuel':'200','cost-tolls':'50','cost-parking':'15','cost-commission':'10','cost-helper':'25','cost-maintenance':'30','cost-other':'20'});
    await newTrip({title:'Viagem apenas agendada',date:'2026-11-17',vehicleId:vehicleB,driverId:memberA,status:'planned',revenue:'900',distance:'500'});
    await tab('dashboard');assert.equal(textMoney(await page.locator('#business-revenue').innerText()),'R$850,00');assert.equal(textMoney(await page.locator('#business-costs').innerText()),'R$350,00');assert.equal(textMoney(await page.locator('#business-profit').innerText()),'R$500,00');
    assert.match(await page.locator('#business-distance').innerText(),/120,5/);assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
  });
  await check('losses remain negative and reports filter by vehicle, driver and calendar dates',async()=>{
    await newTrip({title:'Serviço com prejuízo',date:'2026-11-15',vehicleId:vehicleB,driverId:memberA,status:'completed',revenue:'10','cost-fuel':'20',distance:'5'});
    await tab('dashboard');assert.equal(textMoney(await page.locator('#business-profit').innerText()),'R$490,00');
    await fill('business-filters',{vehicleId:vehicleB});assert.equal(textMoney(await page.locator('#business-profit').innerText()),'-R$10,00');
    await fill('business-filters',{vehicleId:'',from:'2026-11-16',to:'2026-11-16',driverId:memberA});assert.equal(textMoney(await page.locator('#business-profit').innerText()),'R$500,00');
    const download=page.waitForEvent('download');await page.locator('#business-csv').click();const file=await download;const target=path.join(__dirname,'business-report-test.csv');await file.saveAs(target);const csv=await fs.readFile(target,'utf8');
    assert.ok(csv.includes('Frete completo Aurora'));assert.ok(!csv.includes('Viagem apenas agendada'));assert.ok(!csv.includes('Serviço com prejuízo'));
    await fill('business-filters',{from:'',to:'',driverId:''});
  });
  await check('date and odometer reminders can be completed and reactivated',async()=>{
    await tab('reminders');await fill('business-reminder-form',{title:'Revisão do caminhão',kind:'maintenance',vehicleId:vehicleA,dueDate:'2026-11-15',dueOdometer:'1000,50'});await submit('business-reminder-form');
    reminderA=(await workspace()).reminders.find(r=>r.title==='Revisão do caminhão').id;
    assert.match(await row('reminders',reminderA).innerText(),/Vencido/);await row('reminders',reminderA).getByRole('button',{name:'Concluir',exact:true}).click();await settled();
    assert.match(await row('reminders',reminderA).innerText(),/Concluído/);assert.ok((await workspace()).reminders.find(r=>r.id===reminderA).completedAt);
    await row('reminders',reminderA).getByRole('button',{name:'Reativar',exact:true}).click();await settled();assert.equal((await workspace()).reminders.find(r=>r.id===reminderA).completedAt,null);
  });
  await check('driver documents use a person and due date without requiring a vehicle',async()=>{
    await fill('business-reminder-form',{title:'Habilitação da Ana',kind:'document',vehicleId:'',memberId:memberA,dueDate:'2026-12-01',dueOdometer:''});await submit('business-reminder-form');
    const item=(await workspace()).reminders.find(r=>r.title==='Habilitação da Ana');assert.equal(item.vehicleId,null);assert.equal(item.memberId,memberA);assert.match(await row('reminders',item.id).innerText(),/Próximo do vencimento/);
  });
  await check('archiving a vehicle preserves its completed trip and removes new-assignment choices',async()=>{
    await tab('vehicles');await row('vehicles',vehicleA).getByRole('button',{name:'Arquivar',exact:true}).click();await confirm();
    const ws=await workspace();assert.ok(ws.vehicles.find(v=>v.id===vehicleA).archivedAt);assert.equal(ws.trips.find(t=>t.id===completedTrip).vehicleId,vehicleA);
    await tab('trips');assert.equal(await page.locator(`#business-trip-form [name="vehicleId"] option[value="${vehicleA}"]`).count(),0);
    await tab('dashboard');assert.equal(textMoney(await page.locator('#business-revenue').innerText()),'R$860,00');
  });
  await check('company selection isolates fleet, team, trips and alerts without erasing the first company',async()=>{
    await selectCompany(companyB);for(const kind of ['vehicles','trips','reminders'])assert.equal((await workspace())[kind].length,0);
    assert.equal((await workspace()).members.some(m=>m.name==='Ana Motorista'),false);assert.equal(textMoney(await page.locator('#business-profit').innerText()),'R$0,00');
    await selectCompany(companyA);assert.equal((await workspace()).trips.length,3);assert.equal((await workspace()).vehicles.length,2);
  });
  await check('unsaved company form fields require confirmation before changing companies',async()=>{
    await tab('trips');await fill('business-trip-form',{title:'Rascunho que deve continuar'});await page.locator('#business-company').selectOption(companyB);
    await page.locator('#confirmacao').waitFor({state:'visible'});await page.locator('#confirmacao [value="cancelar"]').click();await settled();
    assert.equal((await workspace()).company.id,companyA);assert.equal(await page.locator('#business-trip-form [name="title"]').inputValue(),'Rascunho que deve continuar');
    await tab('dashboard');
  });
  await check('a storage quota failure cannot replace existing companies or personal records',async()=>{
    const before=await rawBusiness();await page.evaluate(key=>{window.__businessOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===RodagemProfiles.key(key))throw new DOMException('Synthetic quota failure','QuotaExceededError');return window.__businessOriginalSetItem.call(this,k,v);};},businessKey);
    await fill('business-company-form',{name:'Não deve salvar'});await submit('business-company-form');assert.equal(await rawBusiness(),before);assert.match(await page.locator('#business-notice').innerText(),/espaço|mantidos/i);
    await page.evaluate(()=>{Storage.prototype.setItem=window.__businessOriginalSetItem;delete window.__businessOriginalSetItem;});await tab('vehicles');await tab('dashboard');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
  });
  await check('business backup contains fleet history and malformed imports preserve all stored bytes',async()=>{
    const event=page.waitForEvent('download');await page.locator('#business-backup').click();const download=await event;const target=path.join(__dirname,'business-backup-test.json');await download.saveAs(target);backupData=JSON.parse(await fs.readFile(target,'utf8'));
    assert.equal(backupData.companies.length,2);assert.equal(backupData.trips.length,3);assert.ok(backupData.vehicles.find(v=>v.id===vehicleA).archivedAt);
    assert.equal(backupData.trips.some(t=>t.id==='personal-only'),false);
    const before=await rawBusiness();await page.locator('#business-import-file').setInputFiles({name:'invalid-business.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,companies:[]}))});
    if(await page.locator('#confirmacao').isVisible())await confirm();await settled();assert.equal(await rawBusiness(),before);
  });
  await check('an edit in another tab while restore confirmation waits cancels a stale import',async()=>{
    const restored=JSON.stringify(backupData);await page.locator('#business-import-file').setInputFiles({name:'business.json',mimeType:'application/json',buffer:Buffer.from(restored)});await page.locator('#confirmacao').waitFor({state:'visible'});
    await page.evaluate(({key,companyA})=>{const physical=RodagemProfiles.key(key),state=JSON.parse(localStorage.getItem(physical));state.companies.find(c=>c.id===companyA).name='Aurora atualizada em outra aba';localStorage.setItem(physical,JSON.stringify(state));},{key:businessKey,companyA});
    const newer=await rawBusiness();await confirm();assert.equal(await rawBusiness(),newer);assert.match(await page.locator('#business-notice').innerText(),/mudaram|atualize/i);
    await page.reload();await ready();await page.locator('.main-nav [data-panel="empresa"]').click();await selectCompany(companyA);
  });
  await check('subscription setup stays honest and cannot start an unconfigured checkout',async()=>{
    await tab('plan');assert.match(await page.locator('#business-plan-status').innerText(),/Sem assinatura ativa/);
    assert.equal(await page.locator('[data-business-plan]').count(),2);for(const plan of ['company','vehicle']){const button=page.locator(`[data-business-plan="${plan}"]`);assert.equal(await button.isDisabled(),true);await button.evaluate(el=>el.click());}
    assert.match(await page.locator('#business-content').innerText(),/Preço a configurar/);assert.deepEqual(external,[]);
  });
  await check('the business area and every main route fit phone and desktop widths',async()=>{
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:width>500?960:844});
      for(const route of ['inicio','fechamento','consumo','historico','ajustes','empresa']){await page.locator(`.main-nav [data-panel="${route}"]`).click();const size=await page.evaluate(()=>({document:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(size.document<=size.width+1,route+' at '+width+': '+JSON.stringify(size));}
      for(const businessTab of ['dashboard','members','vehicles','trips','reminders','plan']){await tab(businessTab);const size=await page.evaluate(()=>({document:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(size.document<=size.width+1,businessTab+' at '+width+': '+JSON.stringify(size));}
      await tab('dashboard');await page.locator('#business-profit').scrollIntoViewIfNeeded();if(width===390)await page.screenshot({path:path.join(__dirname,'business-mobile.png'),animations:'disabled'});if(width===1280)await page.screenshot({path:path.join(__dirname,'business-desktop.png'),animations:'disabled'});
    }
  });
  await check('business data survive reload and personal financial records remain unchanged',async()=>{
    const before=await rawBusiness();await page.reload();await ready();await page.locator('.main-nav [data-panel="empresa"]').click();await selectCompany(companyA);assert.equal(await rawBusiness(),before);
    assert.equal((await workspace()).trips.length,3);assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
  });
  await check('switching local profiles never copies companies or financial history to another person',async()=>{
    const principalBytes=await rawBusiness();
    await page.locator('#trocar-perfil').click();await page.locator('#novo-perfil [name="nome"]').fill('Empresa em outro perfil');
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#novo-perfil button[type="submit"]').click()]);
    await ready();assert.notEqual(await page.evaluate(()=>RodagemProfiles.current().id),'principal');assert.equal(await rawBusiness(),null);
    await page.locator('.main-nav [data-panel="empresa"]').click();await createCompany('Somente perfil novo');
    assert.equal((await page.evaluate(()=>RodagemBusiness.exportLocal())).companies.length,1);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),businessKey),principalBytes);
    await page.locator('#trocar-perfil').click();
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#perfis-lista [data-profile-id="principal"]').getByRole('button',{name:/usar perfil/i}).click()]);
    await ready();assert.equal(await rawBusiness(),principalBytes);await page.locator('.main-nav [data-panel="empresa"]').click();await selectCompany(companyA);
    assert.equal((await workspace()).trips.length,3);assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
  });
  await check('business workflows emit no JavaScript runtime errors',async()=>assert.deepEqual(report.browserErrors,[]));
})().catch(async error=>{
  report.errors.push(error.stack||String(error));console.error(error.stack||error);process.exitCode=1;
  if(page&&!page.isClosed())try{report.failureState=await page.evaluate(()=>({url:location.href,notice:document.querySelector('#business-notice')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),workspace:window.RodagemBusiness?.getCurrentWorkspace(),body:document.querySelector('#empresa')?.innerText.slice(0,4000)}));await page.screenshot({path:path.join(__dirname,'business-failure.png'),animations:'disabled',timeout:15000});}catch{}
}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(__dirname,'business-report.json'),JSON.stringify(report,null,2));console.log('BUSINESS_BROWSER_REPORT',JSON.stringify(report));});
