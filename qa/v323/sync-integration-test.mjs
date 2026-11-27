// Local integration with real application modules and a synthetic cloud driver.
// No credentials, network, real financial data or authenticated-cloud claims.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {boot,flush,legacy} from '../harness.mjs';

const [syncSource,gpsSource,budgetSource]=await Promise.all([
  fs.readFile(new URL('../../cloud-sync.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../../gps-core.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../../backup-budget.js',import.meta.url),'utf8')
]);
const userA={user:{id:'b697b572-f3d3-4b7c-a0e8-4de95799c837',email:'synthetic-a@example.test'}};
const userB={user:{id:'7e1d2fca-e66f-4cac-bd17-345836de8a14',email:'synthetic-b@example.test'}};
const keys={records:'minha-rodagem-v1',binding:'minha-rodagem-cloud-v1',journal:'minha-rodagem-sync-journal-v1',registry:'minha-rodagem-perfis-v1'};
const json=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>JSON.stringify(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const records=rows=>bytes({versao:1,registros:rows});
const bound=(revision=1,user=userA)=>bytes({userId:user.user.id,revision,lastSyncedAt:'2026-11-26T10:00:00.000Z'});
const snapshot=(rows=[{...legacy,id:'synthetic-cloud-day'}])=>({version:1,settings:null,records:{versao:1,registros:rows},routes:[],gpsPreferences:{enabled:false,mode:'eco'},journey:null});
const response=(revision=1,payload=snapshot())=>({revision,payload,updated_at:'2026-11-26T12:00:00.000Z'});
const initialStore=(rows=[legacy])=>new Map([[keys.records,records(rows)],[keys.binding,bound()]]);
const stored=app=>[...app.store].sort(([a],[b])=>a.localeCompare(b));
const foreignPrefix='minha-rodagem-usuario-v1:synthetic-other:';
const registry=()=>({version:1,activeId:'principal',profiles:[{id:'principal',name:'Sintético A',createdAt:0},{id:'synthetic-other',name:'Sintético B',createdAt:0}]});
const report={version:'3.2.3',classification:'local-simulated-integration',syntheticDataOnly:true,productionOperations:0,networkRequests:0,authenticatedCloudTests:false,physicalTests:false,passed:[],failures:[]};

async function setup({store=initialStore(),remote=response(),budget=true}={}) {
  const a=boot(store);
  let cached=userA,verified=userA,listener,confirmation=async()=>true,verifyHook,loadHook,saveHook;
  const copies=new Map(remote===null?[]:[[userA.user.id,json(remote)]]);
  const calls={verifies:0,loads:0,saves:0,reloads:0,confirmations:[]};
  const driver={
    configured:()=>true,getSession:async()=>cached,
    async verifySession(){calls.verifies++;return verifyHook?verifyHook(calls.verifies):verified;},
    onAuth(callback){listener=callback;return()=>{};},
    async load(expectedUserId){
      calls.loads++;assert.equal(expectedUserId,verified?.user?.id,'load must use the server-verified identity');
      if(loadHook)await loadHook(expectedUserId);
      const value=copies.get(expectedUserId);return value?json(value):null;
    },
    async save(expectedRevision,payload,expectedUserId){
      calls.saves++;assert.equal(expectedUserId,verified?.user?.id,'save must use the server-verified identity');
      if(saveHook)await saveHook(expectedRevision,payload,expectedUserId);
      const prior=copies.get(expectedUserId);
      if((prior?.revision||0)!==expectedRevision){const failure=Error('Conflito de revisão sintético: nenhuma cópia foi sobrescrita.');failure.code='40001';throw failure;}
      const value=response(expectedRevision+1,json(payload));copies.set(expectedUserId,value);return json(value);
    },
    signIn:async()=>null,
    async signOut(){cached=null;verified=null;listener?.('SIGNED_OUT',null);}
  };
  a.window.RodagemCloud=driver;
  a.window.RodagemCloudConfig={providers:['google']};
  a.context.confirmar=async message=>{calls.confirmations.push(message);return confirmation(message);};
  a.context.location.reload=()=>{calls.reloads++;};
  vm.runInContext(gpsSource,a.context,{filename:'gps-core.js'});
  a.window.RodagemGeo=a.context.RodagemGeo;
  if(budget)vm.runInContext(budgetSource,a.context,{filename:'backup-budget.js'});
  vm.runInContext(syncSource,a.context,{filename:'cloud-sync.js'});
  await flush();
  return {...a,api:a.window.RodagemSync,driver,calls,
    setSession(value){cached=value;verified=value;listener?.(value?'SIGNED_IN':'SIGNED_OUT',value);},
    setVerified(value){verified=value;},
    verifyWith(fn){verifyHook=fn;},
    onLoad(fn){loadHook=fn;},onSave(fn){saveHook=fn;},
    confirmWith(fn){confirmation=fn;},
    setRemote(value,user=userA){if(value===null)copies.delete(user.user.id);else copies.set(user.user.id,json(value));},
    remoteBytes(user=userA){return bytes(copies.get(user.user.id)??null);}
  };
}
async function check(name,run){await run();report.passed.push(name);console.log('PASS',name);}
function assertNoDataRpc(a){assert.equal(a.calls.loads,0);assert.equal(a.calls.saves,0);}
function largeSnapshot(){return snapshot(Array.from({length:36000},(_,i)=>({...legacy,id:'fixture-'+i,data:'2026-11-26'})));}

try {
  await check('authentication events alone never bind, load, upload or replace a profile',async()=>{
    const store=new Map([[keys.records,records([legacy])]]),before=stored({store}),a=await setup({store});
    a.setSession(userB);a.setSession(userA);
    assert.deepEqual(stored(a),before);assertNoDataRpc(a);assert.equal(a.calls.verifies,0);
  });
  await check('binding is explicit, cancelable and uses the verified account plus remote revision',async()=>{
    const a=await setup({store:new Map([[keys.records,records([legacy])]]),remote:response(3)}),before=stored(a),prior=a.remoteBytes();
    a.confirmWith(async()=>false);assert.equal(await a.api.bind(),null);assert.deepEqual(stored(a),before);
    assert.equal(a.remoteBytes(),prior);assert.equal(a.calls.saves,0);
    a.confirmWith(async()=>true);const result=await a.api.bind();
    assert.equal(result.userId,userA.user.id);assert.equal(result.revision,3);
    assert.equal(a.store.get(keys.records),records([legacy]));assert.equal(a.calls.saves,0);
    assert.ok(a.calls.verifies>=3,'binding revalidates after confirmation');
  });
  await check('an account already owned by another local profile cannot be linked again',async()=>{
    const store=new Map([[keys.registry,bytes(registry())],[keys.records,records([legacy])],[foreignPrefix+keys.binding,bound()],[foreignPrefix+keys.records,'synthetic-other-private-bytes']]);
    const a=await setup({store}),before=stored(a);
    await assert.rejects(()=>a.api.bind(),/Trocar perfil/);assert.deepEqual(stored(a),before);assertNoDataRpc(a);
  });
  await check('binding, upload and restore fail before a data RPC when server verification rejects',async()=>{
    for(const method of ['bind','upload','restore']) {
      const store=method==='bind'?new Map([[keys.records,records([legacy])]]):initialStore(),a=await setup({store}),before=stored(a),prior=a.remoteBytes();
      a.verifyWith(async()=>{const failure=Error('Sessão recusada pelo servidor sintético.');failure.code='SESSION_UNVERIFIED';throw failure;});
      await assert.rejects(()=>a.api[method](),failure=>failure.code==='SESSION_UNVERIFIED');
      assert.equal(a.calls.verifies,1);assertNoDataRpc(a);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('a missing server-verification module never falls back to the cached Google session',async()=>{
    const a=await setup(),before=stored(a);delete a.driver.verifySession;
    await assert.rejects(()=>a.api.upload(),/não foi carregada por completo/);
    assertNoDataRpc(a);assert.deepEqual(stored(a),before);
  });
  await check('an expired or different server identity cannot use a cached account binding',async()=>{
    for(const verified of [null,userB]) {
      const a=await setup(),before=stored(a),prior=a.remoteBytes();a.setVerified(verified);
      await assert.rejects(()=>a.api.upload(),verified?/outra conta/:/Entre na sua conta/);
      assertNoDataRpc(a);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('legacy duration blocks upload before load or save and preserves the last valid copies',async()=>{
    const old={...legacy,id:'synthetic-legacy-over-24h',horas:2501,ganhos:18001,jornadaId:'synthetic-legacy-journey'};
    const a=await setup({store:initialStore([old])}),before=stored(a),prior=a.remoteBytes();
    await assert.rejects(()=>a.api.upload(),failure=>failure.code==='BACKUP_LEGACY_HOURS'&&/backup local/.test(failure.message)&&/última cópia válida/.test(failure.message));
    assertNoDataRpc(a);assert.equal(a.calls.confirmations.length,0);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    assert.equal(a.records()[0].horas,2501);assert.equal(a.records()[0].ganhos,18001);
  });
  await check('JSONB budget rejects a real canonical ledger below the compact-JSON limit without RPCs',async()=>{
    const payload=largeSnapshot(),a=await setup({store:initialStore(payload.records.registros)}),before=stored(a),prior=a.remoteBytes();
    const budget=a.window.RodagemBackupBudget.inspect(a.api.capture());
    assert.ok(budget.wireBytes<budget.limitBytes);assert.ok(budget.serverBytesUpperBound>budget.limitBytes);
    await assert.rejects(()=>a.api.upload(),failure=>failure.code==='BACKUP_TOO_LARGE'&&/JSONB/.test(failure.message)&&/última cópia válida/.test(failure.message));
    assertNoDataRpc(a);assert.equal(a.calls.confirmations.length,0);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    report.rejectedBudget={records:payload.records.registros.length,...budget};
  });
  await check('missing budget protection fails closed without replacing any copy or binding',async()=>{
    const a=await setup({budget:false}),before=stored(a),prior=a.remoteBytes();
    await assert.rejects(()=>a.api.upload(),/verificação de tamanho não foi carregada/);
    assertNoDataRpc(a);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
  });
  await check('a valid 24-hour daily record uploads only after confirmation and retains exact cents',async()=>{
    const row={...legacy,horas:2400,ganhos:18001,combustivel:2503,outros:507};
    const a=await setup({store:initialStore([row])}),recordsBefore=a.store.get(keys.records);
    const result=await a.api.upload();
    assert.equal(result.revision,2);assert.equal(a.api.readBinding().revision,2);assert.equal(a.calls.loads,1);assert.equal(a.calls.saves,1);
    assert.match(a.calls.confirmations[0],/posições.*enviadas/);assert.deepEqual(json(result.payload.records.registros),[row]);
    assert.equal(a.store.get(keys.records),recordsBefore);
  });
  await check('canceling a valid upload preserves local bytes, binding and the remote revision',async()=>{
    const a=await setup(),before=stored(a),prior=a.remoteBytes();a.confirmWith(async()=>false);
    assert.equal(await a.api.upload(),null);assert.equal(a.calls.loads,1);assert.equal(a.calls.saves,0);
    assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
  });
  await check('a newer remote revision cannot be overwritten by an older local binding',async()=>{
    const a=await setup({remote:response(2)}),before=stored(a),prior=a.remoteBytes();
    await assert.rejects(()=>a.api.upload(),/mais recente/);assert.equal(a.calls.saves,0);assert.equal(a.calls.confirmations.length,0);
    assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
  });
  await check('a server-side revision conflict during save preserves the winner and the old binding',async()=>{
    const a=await setup(),before=stored(a),winner=response(2,snapshot([{...legacy,id:'synthetic-concurrent-winner',ganhos:27001}]));
    a.confirmWith(async()=>{a.setRemote(winner);return true;});
    await assert.rejects(()=>a.api.upload(),failure=>failure.code==='40001');
    assert.equal(a.calls.saves,1);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),bytes(winner));
  });
  await check('server refusal of a validated save never advances the local binding or last valid copy',async()=>{
    const a=await setup(),before=stored(a),prior=a.remoteBytes();
    a.onSave(async()=>{const failure=Error('Envio recusado pela autorização sintética do servidor.');failure.code='42501';throw failure;});
    await assert.rejects(()=>a.api.upload(),failure=>failure.code==='42501');
    assert.equal(a.calls.saves,1);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
  });
  await check('account changes during cloud reads prevent binding, upload and restoration',async()=>{
    for(const method of ['bind','upload','restore']) {
      const store=method==='bind'?new Map([[keys.records,records([legacy])]]):initialStore(),a=await setup({store}),before=stored(a),prior=a.remoteBytes();
      a.onLoad(async()=>a.setSession(userB));
      await assert.rejects(()=>a.api[method](),/conta mudou/);
      assert.equal(a.calls.loads,1);assert.equal(a.calls.saves,0);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('account changes during confirmation cancel all personal synchronization writes',async()=>{
    for(const method of ['bind','upload','restore']) {
      const store=method==='bind'?new Map([[keys.records,records([legacy])]]):initialStore(),a=await setup({store}),before=stored(a),prior=a.remoteBytes();
      a.confirmWith(async()=>{a.setSession(userB);return true;});
      await assert.rejects(()=>a.api[method](),/conta mudou/);
      assert.equal(a.calls.saves,0);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('server rejection after confirmation prevents upload and restoration mutations',async()=>{
    for(const method of ['upload','restore']) {
      const a=await setup(),before=stored(a),prior=a.remoteBytes();
      a.confirmWith(async()=>{a.verifyWith(async()=>{const failure=Error('Sessão expirada após confirmação.');failure.code='SESSION_EXPIRED';throw failure;});return true;});
      await assert.rejects(()=>a.api[method](),failure=>failure.code==='SESSION_EXPIRED');
      assert.equal(a.calls.loads,1);assert.equal(a.calls.saves,0);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('a real local profile switch during cloud reads cannot write either namespace',async()=>{
    for(const method of ['upload','restore']) {
      const store=initialStore();store.set(keys.registry,bytes(registry()));store.set(foreignPrefix+keys.records,'synthetic-foreign-private-bytes');store.set(foreignPrefix+keys.binding,bound(7,userB));
      const a=await setup({store}),protectedEntries=[keys.records,keys.binding,foreignPrefix+keys.records,foreignPrefix+keys.binding].map(key=>[key,store.get(key)]),prior=a.remoteBytes();
      a.onLoad(async()=>{await a.window.RodagemProfiles.switchTo('synthetic-other');});
      await assert.rejects(()=>a.api[method](),/perfil.*alterado|perfil mudou/i);
      for(const [key,value]of protectedEntries)assert.equal(a.store.get(key),value);
      assert.equal(JSON.parse(a.store.get(keys.registry)).activeId,'synthetic-other');assert.equal(a.calls.saves,0);assert.equal(a.store.has(keys.journal),false);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('binding changes during confirmation preserve the changed binding and prevent stale writes',async()=>{
    for(const method of ['upload','restore']) {
      const a=await setup(),localRecords=a.store.get(keys.records),prior=a.remoteBytes(),changed=bound(9);
      a.confirmWith(async()=>{a.store.set(keys.binding,changed);return true;});
      await assert.rejects(()=>a.api[method](),/vínculo mudou|dados mudaram/);
      assert.equal(a.store.get(keys.binding),changed);assert.equal(a.store.get(keys.records),localRecords);assert.equal(a.calls.saves,0);assert.equal(a.store.has(keys.journal),false);assert.equal(a.remoteBytes(),prior);
    }
  });
  await check('legacy remote records restore exactly without applying the upload gate or changing other profiles',async()=>{
    const old={...legacy,id:'synthetic-remote-legacy',horas:2501,ganhos:18001,combustivel:2503,outros:507,jornadaId:'synthetic-remote-long-journey'};
    const payload=snapshot([old]);payload.journey={versao:1,id:old.jornadaId,estado:'pending',data:old.data,iniciadaEm:0,rodandoDesde:null,acumulado:25.01*3600000};
    const store=initialStore();store.set(foreignPrefix+keys.records,'synthetic-other-exact-bytes');
    const a=await setup({store,remote:response(4,payload)}),prior=a.remoteBytes();let budgetChecks=0;
    a.window.RodagemBackupBudget={assertFits(){budgetChecks++;throw Error('Upload-only budget must not run during restore.');}};
    assert.deepEqual(json(a.api.validateSnapshot(payload)),payload);
    await a.api.restore();
    assert.equal(budgetChecks,0);assert.equal(a.store.get(keys.records),records([old]));
    assert.deepEqual(JSON.parse(a.store.get('minha-rodagem-jornada-v2')),payload.journey,'journey canonicalization may order keys; all historical fields must remain exact');
    assert.equal(a.api.readBinding().revision,4);assert.equal(a.store.get(foreignPrefix+keys.records),'synthetic-other-exact-bytes');
    assert.equal(a.store.has(keys.journal),false);assert.equal(a.calls.saves,0);assert.equal(a.calls.reloads,1);assert.equal(a.remoteBytes(),prior);
    report.legacyRestore={hours:old.horas,gainCents:old.ganhos,recordsSha256:hash(a.store.get(keys.records))};
  });
  await check('validation and restoration accept a compatible compact snapshot above the new JSONB upload bound',async()=>{
    const payload=largeSnapshot(),a=await setup({remote:response(3,payload)}),budget=a.window.RodagemBackupBudget.inspect(payload),prior=a.remoteBytes();
    assert.equal(budget.fits,false);assert.ok(budget.wireBytes<budget.limitBytes);
    assert.equal(a.api.validateSnapshot(payload).records.registros.length,36000);
    await a.api.restore();
    assert.equal(a.store.get(keys.records),bytes(payload.records));assert.equal(a.api.readBinding().revision,3);assert.equal(a.calls.reloads,1);assert.equal(a.calls.saves,0);assert.equal(a.remoteBytes(),prior);
  });
  await check('a restore canceled after inspection preserves every local byte and the last remote copy',async()=>{
    const a=await setup({remote:response(4)}),before=stored(a),prior=a.remoteBytes();a.confirmWith(async()=>false);
    assert.equal(await a.api.restore(),null);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);assert.equal(a.calls.reloads,0);assert.equal(a.store.has(keys.journal),false);
  });
  await check('rejection at the final authenticated restore check leaves no partial data or journal',async()=>{
    const a=await setup(),before=stored(a),prior=a.remoteBytes();
    a.verifyWith(async call=>{if(call===3){const failure=Error('Autorização revogada antes da escrita.');failure.code='SESSION_REVOKED';throw failure;}return userA;});
    await assert.rejects(()=>a.api.restore(),failure=>failure.code==='SESSION_REVOKED');
    assert.equal(a.calls.verifies,3);assert.deepEqual(stored(a),before);assert.equal(a.remoteBytes(),prior);assert.equal(a.calls.reloads,0);assert.equal(a.store.has(keys.journal),false);
  });
} catch(error) {
  report.failures.push(error.stack||String(error));console.error(error);process.exitCode=1;
}
report.finishedAt=new Date().toISOString();
report.executedSourceSha256={cloudSync:hash(syncSource),backupBudget:hash(budgetSource),test:hash(await fs.readFile(new URL('./sync-integration-test.mjs',import.meta.url),'utf8'))};
await fs.writeFile(new URL('./sync-integration-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed.length,failures:report.failures.length}));
