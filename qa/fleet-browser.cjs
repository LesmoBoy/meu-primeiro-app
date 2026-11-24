/* Real Chromium, synthetic local records. OAuth remains unconfigured: these
 * checks never log into a personal account or send records to a live backend. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const recordKey='minha-rodagem-v1',settingsKey='minha-rodagem-perfil-v2';
const legacySettings={versao:1,nome:'Ana',trabalho:'apps',jornada:6,meta:20000,moto:'110–160 cc',modelo:'Moto antiga da Ana',combustivel:'Gasolina',configurado:true};
const legacyRecords={versao:1,registros:[
  {id:'legacy-day',tipo:'dia',data:'2026-11-15',ganhos:18000,combustivel:2500,outros:500,entregas:20,horas:600,km:12000},
  {id:'legacy-fuel-one',tipo:'posto',data:'2026-11-14',odometro:100000,litros:10000,valor:5000,tanque:'cheio'},
  {id:'legacy-fuel-two',tipo:'posto',data:'2026-11-15',odometro:120000,litros:10000,valor:3500,tanque:'cheio'}
]};
const seed={[recordKey]:JSON.stringify(legacyRecords),[settingsKey]:JSON.stringify(legacySettings),'minha-rodagem-gps-preferencias-v1':JSON.stringify({enabled:false,mode:'eco'})};
const report={mode:'Real Chromium, synthetic vehicle categories and unconfigured social login',passed:[],errors:[],browserErrors:[]};
let browser,server,page,context,base;
const externalAccountRequests=[];
const check=async(name,fn)=>{await fn();report.passed.push(name);console.log('PASS',name);};
async function navigate(panel){await page.locator(`.main-nav [data-panel="${panel}"]`).click();await page.locator('#'+panel).waitFor({state:'visible'});}
async function fill(values){for(const[name,value]of Object.entries(values)){const field=page.locator(`#perfil [name="${name}"]`);if(await field.evaluate(e=>e.tagName==='SELECT'))await field.selectOption(String(value));else await field.fill(String(value));}}
async function rawSettings(){return page.evaluate(key=>localStorage.getItem(RodagemProfiles.key(key)),settingsKey);}
async function save(values){
  await navigate('ajustes');await fill(values);await page.locator('#perfil button[type="submit"]').click();
  await page.waitForFunction(()=>!perfilSalvando&&!perfilAlterado);
  return JSON.parse(await rawSettings());
}
async function choose(id){
  await page.locator('#trocar-perfil').click();
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator(`#perfis-lista [data-profile-id="${id}"]`).getByRole('button',{name:/usar perfil/i}).click()]);
  await page.waitForFunction(()=>Boolean(window.RodagemVehicles&&window.RodagemProfiles));
}
(async()=>{
  server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(!pathname.startsWith('/meu-primeiro-app/')){res.writeHead(404).end();return;}
      const relative=pathname.slice('/meu-primeiro-app/'.length)||'index.html';
      const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const body=await fs.readFile(file);const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  base=`http://127.0.0.1:${server.address().port}/meu-primeiro-app/`;report.appURL=base;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--disable-crashpad-for-testing','--disable-breakpad']});
  report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:390,height:844},locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
  context.on('page',p=>p.on('pageerror',error=>report.browserErrors.push(error.stack||error.message)));
  context.on('request',request=>{if(/https:\/\/(?:[^/]*\.)?(?:supabase\.co|supabase\.com|google\.com|facebook\.com)(?:\/|$)/.test(request.url()))externalAccountRequests.push(request.url());});
  await context.route('https://tile.openstreetmap.org/**',request=>request.abort());
  await context.addInitScript(({seed,origin})=>{
    if(location.origin!==origin)return;
    if(!localStorage.getItem('__fleet_test_seeded')){for(const[key,value]of Object.entries(seed))localStorage.setItem(key,value);localStorage.setItem('__fleet_test_seeded','1');}
  },{seed,origin:new URL(base).origin});
  page=await context.newPage();await page.clock.install({time:new Date('2026-11-15T12:00:00Z')});await page.goto(base);
  await page.waitForFunction(()=>Boolean(window.RodagemVehicles&&window.RodagemProfiles));

  await check('legacy motorcycle preferences and financial bytes remain unchanged until an explicit save',async()=>{
    await navigate('ajustes');assert.equal(await rawSettings(),seed[settingsKey]);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
    assert.equal(await page.locator('#perfil [name="categoria"]').inputValue(),'moto');
    assert.equal(await page.locator('#perfil [name="modelo"]').inputValue(),'Moto antiga da Ana');
    assert.equal(await page.locator('#perfil [name="ano"]').inputValue(),'');
    await page.reload();await navigate('ajustes');assert.equal(await rawSettings(),seed[settingsKey]);
  });
  await check('vehicle categories are independent of activities and the model remains a free text field',async()=>{
    const categories=await page.locator('#perfil [name="categoria"] option').evaluateAll(items=>items.map(e=>e.value));
    assert.deepEqual(categories,['moto','bicicleta','bicicleta-eletrica','carro','utilitario','van','caminhao','onibus','trator','barco','outro']);
    const activities=await page.locator('#perfil [name="trabalho"] option').evaluateAll(items=>items.map(e=>e.value));
    for(const name of ['taxi','passageiros-app','frete','logistica','transporte-escolar','fretamento','coletivo','servicos-campo','mobilidade-corporativa'])assert.ok(activities.includes(name),name);
    assert.ok(!categories.includes('taxi'));const model=page.locator('#perfil [name="modelo"]');
    assert.equal(await model.evaluate(e=>e.tagName),'INPUT');assert.equal(await model.getAttribute('list'),null);assert.equal(await model.getAttribute('maxlength'),'60');
  });
  const freeModel='Meu carro <Azul> & família — frota 42';
  await check('taxi settings save a free model and year, then show trips as rides',async()=>{
    const settings=await save({trabalho:'taxi',categoria:'carro',modelo:freeModel,ano:'2020',combustivel:'Flex / alternado'});
    assert.equal(settings.versao,2);assert.equal(settings.categoria,'carro');assert.equal(settings.modelo,freeModel);assert.equal(settings.ano,2020);
    await navigate('consumo');assert.equal(await page.locator('#moto-nome').innerText(),freeModel);assert.ok((await page.locator('#moto-combustivel').innerText()).includes('2020'));
    assert.equal(await page.locator('#moto-nome img').count(),0);
    await navigate('fechamento');assert.ok((await page.locator('#veiculo-unidade-entregas').innerText()).includes('Corridas'));
  });
  await check('the chosen category, free name, energy and year survive a reload',async()=>{
    await page.reload();await navigate('ajustes');
    for(const[name,expected]of Object.entries({trabalho:'taxi',categoria:'carro',modelo:freeModel,ano:'2020',combustivel:'Flex / alternado'}))assert.equal(await page.locator(`#perfil [name="${name}"]`).inputValue(),expected);
  });
  await check('diesel trucks retain liquid consumption and freight uses the journey label',async()=>{
    const settings=await save({trabalho:'frete',categoria:'caminhao',modelo:'Caminhão do João / 3 eixos',ano:'2018',combustivel:'Diesel'});assert.equal(settings.combustivel,'Diesel');
    await navigate('consumo');assert.equal(await page.locator('#novo-abastecimento').isVisible(),true);assert.ok((await page.locator('#moto-consumo').innerText()).includes('20'));
    await navigate('fechamento');assert.equal(await page.locator('#estimar').isVisible(),true);assert.ok((await page.locator('#veiculo-unidade-entregas').innerText()).includes('Viagens'));
  });
  await check('school vans allow an omitted year and keep all old financial records intact',async()=>{
    const settings=await save({trabalho:'transporte-escolar',categoria:'van',modelo:'Van escolar 01',ano:'',combustivel:'Diesel'});
    assert.equal(settings.ano,null);assert.equal(settings.trabalho,'transporte-escolar');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
  });
  await check('invalid four-digit years never replace the saved vehicle or financial history',async()=>{
    const before=await rawSettings();
    for(const year of ['1899','0000','9999']){
      await fill({ano:year});await page.locator('#perfil button[type="submit"]').click();
      await page.waitForFunction(()=>!perfilSalvando);assert.equal(await rawSettings(),before,year);
      assert.equal(await page.locator('#perfil [name="ano"]').inputValue(),year);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
    }
    await fill({ano:''});await page.locator('#perfil button[type="submit"]').click();await page.waitForFunction(()=>!perfilSalvando&&!perfilAlterado);
  });
  await check('human-powered bicycles cannot acquire a fuel-in-litres calculation',async()=>{
    await navigate('ajustes');await fill({categoria:'bicicleta'});
    assert.equal(await page.locator('#perfil [name="combustivel"]').inputValue(),'Sem combustível');assert.equal(await page.locator('#perfil [name="combustivel"]').isDisabled(),true);
    await save({trabalho:'apps',modelo:'Minha bicicleta de carga',ano:'2023'});
    await navigate('consumo');assert.equal(await page.locator('#novo-abastecimento').isVisible(),false);assert.equal(await page.locator('#moto-consumo').innerText(),'Não se aplica');
    assert.ok((await page.locator('#veiculo-resumo-dica').innerText()).includes('não usa combustível'));
    await navigate('fechamento');assert.equal(await page.locator('#estimar').isVisible(),false);assert.equal(await page.locator('#estimar').isDisabled(),true);
  });
  await check('electric bicycles use energy and preserve fuel history without inventing km/L',async()=>{
    await navigate('ajustes');await fill({categoria:'bicicleta-eletrica'});
    assert.equal(await page.locator('#perfil [name="combustivel"]').inputValue(),'Elétrico');
    await save({modelo:'Elétrica da Ana',ano:'2024'});
    await navigate('consumo');assert.equal(await page.locator('#novo-abastecimento').isVisible(),false);assert.ok((await page.locator('#veiculo-resumo-dica').innerText()).includes('kWh'));
    await navigate('fechamento');assert.equal(await page.locator('#gasto-energia-label').innerText(),'Energia do turno (R$)');
    await navigate('historico');assert.equal(await page.locator('.history-item').count(),3);assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
  });
  await check('GNV is kept separate from litre calculations while ordinary vehicle fields stay editable',async()=>{
    const settings=await save({categoria:'carro',trabalho:'passageiros-app',modelo:'Carro com GNV',ano:'2021',combustivel:'GNV'});assert.equal(settings.combustivel,'GNV');
    await navigate('consumo');assert.equal(await page.locator('#novo-abastecimento').isVisible(),false);assert.ok((await page.locator('#veiculo-resumo-dica').innerText()).includes('m³'));
    await navigate('fechamento');assert.equal(await page.locator('#estimar').isDisabled(),true);
  });
  let secondId;
  await check('a second local profile keeps its category and year separate from the first vehicle',async()=>{
    const first=await rawSettings();await page.locator('#trocar-perfil').click();await page.locator('#novo-perfil [name="nome"]').fill('Empresa piloto');
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#novo-perfil button[type="submit"]').click()]);
    await page.waitForFunction(()=>Boolean(window.RodagemVehicles&&window.RodagemProfiles));secondId=await page.evaluate(()=>RodagemProfiles.current().id);assert.notEqual(secondId,'principal');
    assert.equal(await rawSettings(),null);const second=await save({trabalho:'mobilidade-corporativa',categoria:'onibus',modelo:'Ônibus da empresa',ano:'2022',combustivel:'Diesel'});assert.equal(second.categoria,'onibus');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),settingsKey),first);assert.equal(await page.evaluate(key=>localStorage.getItem(key),recordKey),seed[recordKey]);
    await choose('principal');assert.equal(await rawSettings(),first);await choose(secondId);assert.equal(JSON.parse(await rawSettings()).modelo,'Ônibus da empresa');
  });
  await check('unconfigured Google and Facebook login is explicit, disabled and makes no external account request',async()=>{
    await navigate('ajustes');await page.locator('#conta-cloud').waitFor({state:'visible'});
    assert.ok((await page.locator('#cloud-status').innerText()).includes('ainda não está disponível'));
    for(const provider of ['google','facebook']){
      const button=page.locator(`[data-cloud-provider="${provider}"]`);assert.equal(await button.isDisabled(),true);await button.evaluate(e=>e.click());
    }
    assert.deepEqual(externalAccountRequests,[]);assert.equal(await page.evaluate(()=>RodagemCloud.configured()),false);
  });
  await check('vehicle settings and cloud setup remain readable at 320, 390 and 1280 pixels',async()=>{
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:width>500?960:844});
      for(const panel of ['inicio','fechamento','consumo','historico','ajustes']){
        await navigate(panel);const sizes=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(sizes.content<=sizes.viewport+1,panel+' '+width+' '+JSON.stringify(sizes));
      }
      await page.locator('#perfil [name="categoria"]').scrollIntoViewIfNeeded();
      if(width===390)await page.screenshot({path:path.join(__dirname,'fleet-mobile.png'),animations:'disabled'});
      if(width===1280)await page.screenshot({path:path.join(__dirname,'fleet-desktop.png'),animations:'disabled'});
    }
  });
  await check('fleet profile flows emit no JavaScript runtime errors',async()=>assert.deepEqual(report.browserErrors,[]));
})().catch(async error=>{
  report.errors.push(error.stack||String(error));console.error(error.stack||error);process.exitCode=1;
  if(page&&!page.isClosed())try{report.failureState=await page.evaluate(()=>({url:location.href,message:document.querySelector('#mensagem')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id),profile:window.RodagemProfiles?.current()}));await page.screenshot({path:path.join(__dirname,'fleet-failure.png'),animations:'disabled'});}catch{}
}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(__dirname,'fleet-report.json'),JSON.stringify(report,null,2));console.log('FLEET_BROWSER_REPORT',JSON.stringify(report));
});
