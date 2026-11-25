// Simulated DOM integration; no browser rendering or real offline claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {boot,recordKey,legacy,flush} from './harness.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report={mode:'Simulated DOM integration; no visual/browser/offline claim',passed:[],failures:[]};
async function check(name,fn){await fn();report.passed.push(name);console.log('PASS',name);}

try {
  await check('empty app boots and all five routes are exclusive',async()=>{
    const a=boot();
    for(const route of ['inicio','fechamento','consumo','historico','ajustes']) {
      a.route(route);
      assert.equal(a.document.querySelectorAll('.view:not([hidden])').length,1);
      assert.equal(a.document.querySelector(`nav [data-panel="${route}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(a.get('titulo-inicio').textContent,'Bora fazer um bom dia.');
    }
    await a.click('.main-nav [data-panel="inicio"]');
    assert.equal(a.get('inicio').hidden,false);
    await a.click('.quick-link[data-go="consumo"]');
    assert.equal(a.get('consumo').hidden,false,'delegated shortcut opens the moto page');
    await a.click('.main-nav [data-panel="historico"]');
    assert.equal(a.get('historico').hidden,false,'main navigation button opens history');
    a.window.location.hash='#ajustes';
    a.window.dispatchEvent(new a.window.Event('hashchange'));
    assert.equal(a.get('ajustes').hidden,false,'hash/back route updates visible panel');
    assert.equal(a.records().length,0);
  });
  const store=new Map([[recordKey,JSON.stringify({versao:1,registros:[legacy]})]]);
  let a=boot(store);
  await check('version 1 records preserved and actual dashboard arithmetic',async()=>{
    assert.equal(a.get('saldo-hoje').textContent.replace(/\s/g,''),'R$150,00');
    assert.deepEqual(a.records(),[legacy]);
    assert.equal(a.get('entregas-hoje').textContent,'20');
  });
  await check('profile presets stay editable, save, persist and update goal',async()=>{
    a.route('ajustes');
    await a.click('[data-rotina="6"]');
    assert.equal(a.get('perfil').elements.jornada.value,'6');
    a.fill('perfil',{nome:'Gustavo',meta:'200',modelo:'Minha CG 160',jornada:'6,5'});
    await a.submit('perfil');
    assert.ok(a.get('titulo-inicio').textContent.includes('Gustavo'));
    assert.equal(a.get('meta-progresso').getAttribute('aria-valuenow'),'75');
    a=boot(store,a.now());
    assert.equal(a.get('perfil').elements.nome.value,'Gustavo');
    assert.equal(a.get('perfil').elements.jornada.value,'6,5');
  });
  await check('live daily balance, saving and editing preserve earlier records',async()=>{
    a.route('fechamento');
    a.fill('dia',{data:'2026-11-12',ganhos:'180,00',entregas:'20',combustivel:'20',outros:'10'});
    await a.click('[data-horas="6"]');
    assert.equal(a.get('dia').elements.horas.value,'6');
    assert.equal(a.get('previa-saldo').textContent.replace(/\s/g,''),'R$150,00');
    await a.submit('dia');
    assert.equal(a.records().length,2,a.get('mensagem').textContent);
    const id=a.records().find(r=>r.id!=='legacy').id;
    a.evaluate(`editar(registros.find(r=>r.id===${JSON.stringify(id)}))`);
    a.fill('dia',{ganhos:'200'});
    await a.submit('dia');
    assert.equal(a.records().length,2);
    assert.equal(a.records().find(r=>r.id===id).ganhos,20000);
    assert.deepEqual(a.records().find(r=>r.id==='legacy'),legacy);
  });
  await check('invalid numbers and canceled duplicate day preserve records',async()=>{
    a.fill('dia',{data:'2026-11-13',ganhos:'-10',entregas:'1'});
    assert.equal(a.get('previa-saldo').textContent,'—');
    await a.submit('dia');
    assert.equal(a.records().length,2);
    assert.equal(a.get('mensagem').dataset.error,'true');
    a.fill('dia',{ganhos:'100',entregas:'1,5'});
    await a.submit('dia');
    assert.equal(a.records().length,2);
    a.fill('dia',{entregas:'10'});
    await a.submit('dia');
    await a.confirm(false);
    assert.equal(a.records().length,2);
    a=boot(store,a.now());
  });
  await check('full-partial-full consumption, duplicate odometer and no double charge',async()=>{
    for(const fields of [
      {odometro:'65.000',litros:'5',valor:'30',tanque:'cheio'},
      {odometro:'65.150',litros:'4',valor:'24',tanque:'parcial'},
      {odometro:'65.300',litros:'6',valor:'36',tanque:'cheio'}
    ]) {a.fill('posto',{data:'2026-11-13',...fields});await a.submit('posto');}
    assert.equal(a.records().length,5);
    assert.equal(a.get('moto-consumo').textContent,'30 km/L');
    assert.equal(a.get('moto-custo').textContent.replace(/\s/g,''),'R$0,20');
    assert.equal(a.get('saldo-hoje').textContent.replace(/\s/g,''),'R$150,00');
    a.fill('posto',{data:'2026-11-13',odometro:'65.300',litros:'3',valor:'18',tanque:'cheio'});
    await a.submit('posto');
    assert.equal(a.records().length,5);
    assert.ok(a.get('mensagem').textContent.includes('hodômetro'));
  });
  await check('backup download, invalid import and confirmed compatible import',async()=>{
    await a.click('#backup');
    const backup=JSON.parse(await [...a.blobs.values()].at(-1).text());
    assert.equal(backup.registros.length,5);
    assert.equal(backup.versao,1);
    const input=a.get('arquivo');
    const importFile=async value=>{
      input.files=[{size:value.length,text:async()=>value}];
      await input.onchange({target:input});
    };
    await importFile('{"versao":9,"registros":[]}');
    assert.equal(a.records().length,5);
    const extra={...legacy,id:'restored-extra',data:'2026-11-11'};
    const value=JSON.stringify({...backup,registros:[...backup.registros,extra]});
    input.files=[{size:value.length,text:async()=>value}];
    const importing=input.onchange({target:input});
    await flush();
    await a.confirm();
    await importing;
    assert.equal(a.records().length,6);
    assert.ok(a.get('lista').textContent.includes('11/11/2026'));
  });
  await check('journey pauses, reload, pending recovery and associated save',async()=>{
    a.route('inicio');
    await a.click('#jornada-iniciar');
    await a.advance(2*3600000);
    await a.click('#jornada-pausar');
    const paused=a.get('jornada-tempo').textContent;
    await a.advance(30*60000);
    assert.equal(a.get('jornada-tempo').textContent,paused);
    a=boot(store,a.now());
    await a.click('#jornada-pausar');
    await a.advance(30*60000);
    await a.click('#jornada-encerrar');
    assert.equal(a.get('dia').elements.horas.value,'2,5');
    assert.equal(a.records().length,6);
    a=boot(store,a.now());
    assert.equal(a.get('jornada-status').textContent,'Pronta para fechar');
    await a.click('#jornada-iniciar');
    a.fill('dia',{ganhos:'100',entregas:'10'});
    await a.submit('dia');
    await a.confirm();
    assert.equal(a.records().length,7);
    assert.equal(store.has('minha-rodagem-jornada-v2'),false);
    assert.equal(a.get('jornada-status').textContent,'Não iniciada');
  });
  await check('stale tab cannot overwrite records saved in another tab',async()=>{
    const b=boot(store,a.now());
    b.fill('dia',{data:'2026-11-10',ganhos:'40',entregas:'4'});
    await b.submit('dia');
    assert.equal(b.records().length,8);
    a.fill('dia',{data:'2026-11-09',ganhos:'70',entregas:'7'});
    await a.submit('dia');
    assert.equal(a.records().length,8);
    assert.ok(a.get('mensagem').textContent.includes('outra aba'));
    assert.equal(a.records().some(r=>r.data==='2026-11-09'),false);
  });
  await check('offline status updates through connectivity events',async()=>{
    a.window.navigator.onLine=false;
    a.window.dispatchEvent(new a.window.Event('offline'));
    assert.ok(a.get('conexao').textContent.includes('Sem internet'));
    a.window.navigator.onLine=true;
    a.window.dispatchEvent(new a.window.Event('online'));
    assert.ok(a.get('conexao').textContent.includes('Online'));
  });
  await check('ending a shift protects existing drafts when confirmation is canceled',async()=>{
    const b=boot(new Map(),a.now());
    b.fill('dia',{data:'2026-11-12',ganhos:'250',entregas:'25',horas:'6'});
    await b.click('#jornada-iniciar');
    await b.advance(3600000);
    await b.click('#jornada-encerrar');
    await b.confirm(false);
    assert.equal(b.get('dia').elements.data.value,'2026-11-12');
    assert.equal(b.get('dia').elements.horas.value,'6');
    assert.equal(b.get('dia').elements.ganhos.value,'250');
    assert.equal(b.get('jornada-status').textContent,'Pronta para fechar');
    assert.equal(b.records().length,0);
    await b.click('#jornada-iniciar');
    await b.confirm();
    assert.equal(b.get('dia').elements.horas.value,'1');
    assert.equal(b.get('dia').elements.ganhos.value,'250','moving shift keeps already entered income');
  });
  await check('storage quota failure never discards existing records',async()=>{
    class FullStore extends Map { set(key,value) { if(this.full) throw Error('QuotaExceededError');return super.set(key,value); } }
    const quotaStore=new FullStore([[recordKey,JSON.stringify({versao:1,registros:[legacy]})]]);
    const b=boot(quotaStore,a.now());
    quotaStore.full=true;
    b.fill('dia',{data:'2026-11-10',ganhos:'100',entregas:'10'});
    await b.submit('dia');
    assert.deepEqual(b.records(),[legacy]);
    assert.equal(b.get('mensagem').dataset.error,'true');
  });
} catch(error) {
  report.failures.push(error.stack||String(error));
  console.error(error.stack||error);
  process.exitCode=1;
}
await fs.writeFile(path.join(root,'qa','dom-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed.length,failures:report.failures.length}));
