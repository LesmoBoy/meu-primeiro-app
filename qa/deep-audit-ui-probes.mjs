// Focused audit probes: simulated DOM and the existing SW simulator, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {boot,recordKey,legacy} from './harness.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(directory,'..');
const report={mode:'Read-only source audit plus isolated DOM and Cache Storage simulation',passed:[],confirmedFindings:[],limitations:['No physical Android, screen reader, real rendering, battery or network test performed by this probe.']};
async function check(name,run){await run();report.passed.push(name);console.log('PASS',name);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

await check('HTML IDs and ARIA references are unique and resolve',()=>{
  const a=boot();const ids=[...a.document.querySelectorAll('[id]')].map(el=>el.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const el of a.document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]')){
    for(const attr of ['aria-controls','aria-labelledby','aria-describedby']){
      for(const id of (el.getAttribute(attr)||'').split(/\s+/).filter(Boolean)) assert.ok(a.get(id),attr+': '+id);
    }
  }
});
await check('invalid and HTML-like routes cannot create markup or alter the ledger',()=>{
  const raw=JSON.stringify({versao:1,registros:[legacy]});const a=boot(new Map([[recordKey,raw]]));
  for(const route of ['<img src=x onerror=1>','constructor','__proto__','ajustes?x=1','//evil.test']){
    a.evaluate(`abrir(${JSON.stringify(route)})`);assert.equal(a.get('inicio').hidden,false);
    assert.equal(a.store.get(recordKey),raw);assert.equal(a.document.title,'Início · Minha Rodagem');
  }
});
await check('profile and free vehicle HTML payloads render as literal text',async()=>{
  const a=boot();const name='<svg/onload=1>',model='<img src=x onerror=alert(1)>';
  a.fill('perfil',{nome:name,modelo:model});await a.submit('perfil');
  assert.equal(a.get('titulo-inicio').textContent,'Bora rodar, '+name+'.');
  assert.equal(a.get('moto-nome').textContent,model);
  assert.equal(a.get('titulo-inicio').querySelector('svg'),null);assert.equal(a.get('moto-nome').querySelector('img'),null);
});
await check('profile picker treats a hostile name as text and preserves accessible names',async()=>{
  const a=boot();await a.window.RodagemProfiles.create('<svg/onload=1>');
  const dialog=a.get('perfis-dialogo');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  vm.runInContext(fs.readFileSync(path.join(root,'profiles-ui.js'),'utf8'),a.context,{filename:'profiles-ui.js'});
  const row=[...a.get('perfis-lista').querySelectorAll('.profile-choice')].find(el=>el.querySelector('strong').textContent==='<svg/onload=1>');
  assert.ok(row);assert.equal(row.querySelector('svg'),null);
  assert.equal(row.querySelector('button').getAttribute('aria-label'),'Usar perfil <svg/onload=1>');
});
await check('a non-BMP initial stays whole in avatar and the saved profile name',async()=>{
  const a=boot();a.fill('perfil',{nome:'🛵 Ana'});await a.submit('perfil');
  const avatar=a.document.querySelector('.avatar').textContent;
  assert.equal(avatar,'🛵A');
  assert.ok([...avatar].every(char=>char.codePointAt(0)<0xd800||char.codePointAt(0)>0xdfff));
  assert.equal(JSON.parse(a.store.get('minha-rodagem-perfil-v2')).nome,'🛵 Ana');
  report.confirmedFindings.push({id:'UI-001',severity:'low',status:'fixed_and_verified',file:'experience.js',line:199,beforeAvatarCodePoints:['d83d','41'],afterAvatarCodePoints:[...avatar].map(char=>char.codePointAt(0).toString(16)),expectedAvatar:'🛵A',impact:'Before the one-line fix, a valid name starting with a non-BMP character displayed a replacement character in dashboard avatar initials. Names, ARIA and data remained intact.'});
});
await check('primary panel navigation updates one selected control and heading title',()=>{
  const a=boot();for(const [panel,label]of [['inicio','Início'],['fechamento','Fechamento'],['consumo','Meu veículo'],['historico','Histórico'],['ajustes','Meu perfil'],['empresa','Minha empresa'],['percurso','Meu percurso']]){
    a.route(panel);assert.equal(a.document.querySelectorAll('.main-nav [aria-pressed="true"]').length,1);assert.equal(a.document.title,label+' · Minha Rodagem');
    const views=[...a.document.querySelectorAll('.view')];assert.equal(views.filter(el=>!el.hidden).length,1);
  }
});
await check('static new-tab links prevent opener access and asset scripts stay local',()=>{
  const a=boot();for(const link of a.document.querySelectorAll('a[target="_blank"]')) assert.ok((link.getAttribute('rel')||'').split(/\s+/).includes('noopener'));
  for(const script of a.document.querySelectorAll('script[src]')) assert.ok(!/^(?:https?:)?\/\//i.test(script.getAttribute('src')));
  assert.ok(a.document.querySelector('.skip-link[href="#conteudo"]'));
});
await check('original SVG illustrations have no script, embedded HTML, event handlers or external href',()=>{
  for(const name of fs.readdirSync(path.join(root,'assets')).filter(name=>name.endsWith('.svg'))){
    const value=fs.readFileSync(path.join(root,'assets',name),'utf8');
    assert.ok(!/<(?:script|foreignObject|iframe|image)\b/i.test(value),name);
    assert.ok(!/\son[a-z]+\s*=/i.test(value),name);
    assert.ok(!/(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:)/i.test(value),name);
  }
});
await check('public policy pages have no JavaScript or remote assets and include the declared contact',()=>{
  for(const name of ['privacidade.html','exclusao-dados.html']){
    const value=fs.readFileSync(path.join(root,name),'utf8');assert.ok(!/<script\b|<iframe\b/i.test(value),name);
    assert.ok(!/<(?:img|link)\b[^>]*(?:src|href)=["']https?:/i.test(value),name);
    assert.ok(value.includes('mailto:rodadiaempresas@gmail.com'),name);
  }
});
await check('manifest relative start/scope/icon paths remain inside the application',()=>{
  const value=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));const base='https://example.test/meu-primeiro-app/';
  for(const relative of [value.id,value.start_url,value.scope,...value.icons.map(icon=>icon.src)]){
    const url=new URL(relative,base);assert.equal(url.origin,'https://example.test');assert.ok(url.pathname.startsWith('/meu-primeiro-app/'));
  }
});

const helper=fs.readFileSync(path.join(directory,'sw-test.cjs'),'utf8').split('let passed=0;')[0]+'\nmodule.exports={boot};';
const sandbox={require:createRequire(import.meta.url),__dirname:directory,module:{exports:{}},console,URL,Request,Response,AbortController,Promise,Map,Set,setTimeout,clearTimeout};
vm.runInNewContext(helper,sandbox,{filename:'sw-simulation-audit.cjs'});
const worker=sandbox.module.exports.boot();await worker.lifecycle('install');worker.network('offline');
await check('navigation queries do not create cache entries containing fake authentication material',async()=>{
  const before=[...worker.stores.values()].flatMap(store=>[...store.keys()]);
  const result=await worker.request('https://example.test/meu-primeiro-app/?access_token=audit-only-fake&code=audit-only-fake',{mode:'navigate'});
  assert.equal(result.status,200);assert.ok((await result.text()).includes('Minha Rodagem'));
  const after=[...worker.stores.values()].flatMap(store=>[...store.keys()]);assert.deepEqual(after,before);
  assert.ok(after.every(key=>!key.includes('audit-only-fake')));
});
await check('lookalike sibling, foreign origin, API and Google SDK requests remain outside the SW',async()=>{
  for(const url of ['https://example.test/meu-primeiro-app-evil/app.js','https://evil.test/meu-primeiro-app/app.js','https://example.test/meu-primeiro-app/rest/v1/private','https://accounts.google.com/gsi/client']) assert.equal(await worker.request(url),null,url);
});
await check('successful network responses do not write personalized query variants into offline cache',async()=>{
  const before=[...worker.stores.values()].flatMap(store=>[...store.keys()]);worker.network('success');
  const result=await worker.request('https://example.test/meu-primeiro-app/index.html?user=audit-fake',{mode:'navigate'});assert.equal(result.status,200);
  assert.deepEqual([...worker.stores.values()].flatMap(store=>[...store.keys()]),before);
});

report.checked=report.passed.length;
fs.writeFileSync(path.join(directory,'deep-audit-ui-probes-result.json'),JSON.stringify(report,null,2)+'\n');
console.log('DEEP_AUDIT_UI_PROBES '+JSON.stringify({checked:report.checked,findings:report.confirmedFindings.length}));
