// Synthetic records only. Pure/local DOM simulation, without cloud or physical tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {boot,recordKey,legacy,flush} from '../harness.mjs';

const report={version:'3.2.3',mode:'local-pure-and-simulated-DOM',syntheticDataOnly:true,productionOperations:0,physicalTests:false,passed:[],failures:[]};
const old={...legacy,id:'synthetic-long-shift',horas:2501,ganhos:18001,combustivel:2503,outros:507,jornadaId:'synthetic-old-journey'};
const boundary={...legacy,id:'synthetic-24h',data:'2026-11-12',horas:2400};
const backup=registros=>JSON.stringify({versao:1,registros});
const original='\n'+JSON.stringify({versao:1,registros:[old,boundary]},null,3)+'\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
const serialized=value=>JSON.parse(JSON.stringify(value));
async function check(name,run){await run();report.passed.push(name);console.log('PASS',name);}
function importFile(app,text,read=async()=>text){
  const input=app.get('arquivo');
  input.files=[{size:Buffer.byteLength(text),text:read}];
  return input.onchange({target:input});
}
function startEdit(app){app.evaluate(`editar(registros.find(r=>r.id===${JSON.stringify(old.id)}))`);}

try {
  await check('pure diagnosis preserves frozen inputs and distinguishes the 24h boundary',async()=>{
    const a=boot(),rows=Object.freeze([old,boundary,{...old,id:'maximum',horas:1e10},{...old,id:'zero',horas:0},{...old,id:'fraction',horas:2400.5},{tipo:'posto',id:'fuel',horas:9999}].map(Object.freeze));
    const before=JSON.stringify(rows),api=a.window.RodagemLegacyHours;
    const result=api.inspect(rows);
    assert.equal(result.count,2);
    assert.deepEqual(serialized(result.recordIds),[old.id,'maximum']);
    assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.recordIds));
    assert.equal(JSON.stringify(rows),before);
    assert.deepEqual(serialized(api.inspect({versao:1,registros:rows})),serialized(result));
    assert.equal(api.inspect(null).count,0);
    assert.equal(api.message(api.inspect([])),'');
    assert.match(api.message(result),/valores financeiros foram preservados/);
  });
  await check('opening legacy storage preserves exact stored bytes and financial totals',async()=>{
    const local=new Map([[recordKey,original]]),a=boot(local);
    assert.equal(local.get(recordKey),original);
    assert.deepEqual(a.records(),[old,boundary]);
    assert.equal(a.get('saldo-hoje').textContent.replace(/\s/g,''),'R$149,91');
    assert.match(a.get('legados-aviso').textContent,/1 fechamento tem duração acima de 24 horas/);
    a.route('historico');
    assert.match(a.get('periodo').textContent.replace(/\s/g,''),/R\$299,91/);
    assert.equal(local.get(recordKey),original);
    report.preservedStorageSha256=hash(original);
  });
  await check('history exposes original hours without changing filters or money',async()=>{
    const a=boot(new Map([[recordKey,original]]));
    a.route('historico');
    assert.equal(a.document.querySelectorAll('[data-legacy-hours]').length,1);
    assert.match(a.document.querySelector('[data-legacy-hours]').textContent,/25,01 h/);
    assert.match(a.document.querySelector('[data-legacy-hours]').textContent,/saldo por hora indisponível/);
    a.get('tipo-filtro').value='posto';a.get('tipo-filtro').onchange();
    assert.equal(a.document.querySelectorAll('[data-legacy-hours]').length,0);
    assert.equal(a.get('legados-aviso').hidden,false,'global warning survives history filtering');
    assert.deepEqual(a.records(),[old,boundary]);
  });
  await check('hourly rate is withheld only for oversized legacy durations',async()=>{
    const a=boot(new Map([[recordKey,original]]));
    a.evaluate('calcular(registros[0],registros)');
    assert.match(a.get('resultado-dia').textContent,/Indisponível: duração acima de 24 h/);
    assert.match(a.get('resultado-dia').textContent.replace(/\s/g,''),/R\$149,91/);
    a.evaluate('calcular(registros[1],registros)');
    assert.doesNotMatch(a.get('resultado-dia').textContent,/Indisponível/);
    assert.match(a.get('resultado-dia').textContent.replace(/\s/g,''),/R\$6,25/);
  });
  await check('new daily forms still reject above 24h and accept exactly 24h',async()=>{
    const a=boot();
    a.fill('dia',{data:'2026-11-11',ganhos:'0,01',entregas:'1',horas:'24,01'});
    await a.submit('dia');assert.equal(a.records().length,0);
    assert.match(a.get('mensagem').textContent,/até 24 horas/);
    a.fill('dia',{horas:'24'});await a.submit('dia');
    assert.equal(a.records()[0].horas,2400);assert.equal(a.records()[0].ganhos,1);
  });
  await check('canceling a legacy import preserves valid or damaged storage byte for byte',async()=>{
    for(const prior of [original,'{damaged-synthetic-json']) {
      const local=new Map([[recordKey,prior]]),a=boot(local);
      const pending=importFile(a,backup([old]));await flush();
      assert.match(a.get('confirmacao-texto').textContent,/Atenção: 1 fechamento tem duração acima de 24 horas/);
      await a.confirm(false);await pending;
      assert.equal(local.get(recordKey),prior);
    }
  });
  await check('confirmed legacy import and JSON/CSV exports preserve original values',async()=>{
    const a=boot(),pending=importFile(a,backup([old,boundary]));await flush();await a.confirm();await pending;
    assert.deepEqual(a.records(),[old,boundary]);
    assert.match(a.get('mensagem').textContent,/Backup restaurado.*duração acima de 24 horas/);
    assert.equal(a.get('legados-aviso').hidden,false);
    const stored=a.store.get(recordKey);
    await a.click('#backup');
    const jsonText=await [...a.blobs.values()].at(-1).text();
    assert.deepEqual(JSON.parse(jsonText).registros,[old,boundary]);
    await a.click('#csv');
    const csv=await [...a.blobs.values()].at(-1).text();
    assert.match(csv,/180,01;25,03;5,07;20;25,01;120;149,91/);
    assert.equal(a.store.get(recordKey),stored,'exports do not rewrite source storage');
    report.exportedValues={legacyHours:JSON.parse(jsonText).registros[0].horas,legacyGainCents:JSON.parse(jsonText).registros[0].ganhos,jsonSha256:hash(jsonText),csvSha256:hash(csv)};
  });
  await check('saving during legacy import reading or confirmation preserves the newer snapshot',async()=>{
    for(const phase of ['reading','confirmation']) {
      const a=boot(new Map([[recordKey,backup([boundary])]]));let finishReading;
      const pending=importFile(a,backup([old]),phase==='reading'?()=>new Promise(resolve=>{finishReading=resolve;}):undefined);
      await flush();
      a.fill('dia',{data:'2026-11-11',ganhos:'12,34',entregas:'1',horas:'2'});await a.submit('dia');
      const saved=a.store.get(recordKey);assert.equal(a.records().length,2);
      if(phase==='reading') {finishReading(backup([old]));await flush();assert.equal(a.get('confirmacao').open,false);}
      else await a.confirm();
      await pending;
      assert.equal(a.store.get(recordKey),saved);
      assert.equal(a.get('mensagem').dataset.error,'true');
      assert.equal(a.records().some(r=>r.id===old.id),false);
    }
  });
  await check('an older file read cannot replace a newer confirmed import',async()=>{
    const a=boot();let finishReading;
    const first=importFile(a,backup([old]),()=>new Promise(resolve=>{finishReading=resolve;}));await flush();
    const second=importFile(a,backup([boundary]));await flush();await a.confirm();await second;
    const saved=a.store.get(recordKey);
    finishReading(backup([old]));await first;
    assert.equal(a.store.get(recordKey),saved);assert.deepEqual(a.records(),[boundary]);
  });
  await check('editing legacy hours requires an explicit valid correction and confirmation',async()=>{
    const a=boot(new Map([[recordKey,backup([old])]])),before=a.store.get(recordKey);
    startEdit(a);assert.equal(a.get('dia').elements.horas.value,'25,01');
    assert.match(a.get('mensagem').textContent,/horas originais estão preservadas/);
    await a.submit('dia');assert.equal(a.get('confirmacao').open,false);assert.equal(a.store.get(recordKey),before);
    a.fill('dia',{horas:'24'});await a.submit('dia');
    assert.match(a.get('confirmacao-texto').textContent,/Confirmar a correção explícita/);
    await a.confirm(false);assert.equal(a.store.get(recordKey),before);
    await a.submit('dia');await a.confirm();
    assert.deepEqual(a.records(),[{...old,horas:2400}]);
    assert.equal(a.get('legados-aviso').hidden,true);
    assert.equal(a.records()[0].jornadaId,old.jornadaId);
  });
  await check('canceling the edit form preserves legacy data and unrelated saves survive correction confirmation',async()=>{
    const a=boot(new Map([[recordKey,backup([old])]])),before=a.store.get(recordKey);
    startEdit(a);a.fill('dia',{horas:'8'});await a.click('#dia [data-cancelar]');
    assert.equal(a.store.get(recordKey),before);
    startEdit(a);a.fill('dia',{horas:'8'});await a.submit('dia');
    a.fill('posto',{data:'2026-11-12',odometro:'1000',litros:'10',valor:'50',tanque:'cheio'});await a.submit('posto');
    const saved=a.store.get(recordKey);await a.confirm();
    assert.equal(a.store.get(recordKey),saved);assert.equal(a.records().length,2);
    assert.deepEqual(a.records()[0],old);assert.equal(a.get('mensagem').dataset.error,'true');
  });
  await check('running, paused and pending journey markers above 24h survive loading without truncation',async()=>{
    for(const estado of ['running','paused','pending']) {
      const now=Date.parse('2026-11-13T12:00:00Z'),j={versao:1,id:'synthetic-long-marker',estado,data:'2026-11-12',iniciadaEm:now-25*3600000,acumulado:25*3600000,rodandoDesde:estado==='running'?now:null};
      const raw='\n'+JSON.stringify(j,null,2)+'\n',key='minha-rodagem-jornada-v2',local=new Map([[key,raw]]),a=boot(local,now);
      assert.equal(local.get(key),raw);assert.equal(a.get('jornada-tempo').textContent,'25:00:00');
      assert.match(a.get('jornada-dica').textContent,/ultrapassa 24 horas e foi preservado integralmente/);
      if(estado==='pending') {
        await a.click('#jornada-iniciar');assert.equal(a.get('dia').elements.horas.value,'25');
        a.fill('dia',{ganhos:'10',entregas:'1'});await a.submit('dia');
        assert.equal(a.records().length,0);assert.equal(local.get(key),raw);
        assert.match(a.get('mensagem').textContent,/até 24 horas/);
      }
    }
  });
} catch(error) {
  report.failures.push(error.stack||String(error));console.error(error);process.exitCode=1;
}
report.finishedAt=new Date().toISOString();
await fs.writeFile(new URL('./legacy-hours-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed.length,failures:report.failures.length}));
