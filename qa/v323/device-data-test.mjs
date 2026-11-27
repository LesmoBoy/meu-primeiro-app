// Synthetic data only. VM DOM/API simulations exercise the actual app and
// device-data modules. They do not certify physical Android, OAuth, or prod.
import {boot,flush,legacy} from '../harness.mjs';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = await fs.readFile(new URL('../../device-data.js',import.meta.url),'utf8');
const registryKey = 'minha-rodagem-perfis-v1';
const recordsKey = 'minha-rodagem-v1';
const journalKey = 'minha-rodagem-device-journal-v1';
const generationKey = 'minha-rodagem-device-generation-v1';
const syncKey = 'minha-rodagem-sync-journal-v1';
const authKey = 'minha-rodagem-supabase-auth-v1';
const bindingKey = 'minha-rodagem-cloud-v1';
const businessKey = 'minha-rodagem-business-v1';
const journeyKey = 'minha-rodagem-jornada-v2';
const otherPrefix = 'minha-rodagem-usuario-v1:other:';
const names = [recordsKey,'minha-rodagem-perfil-v2',journeyKey,'minha-rodagem-rotas-indice-v1','minha-rodagem-gps-preferencias-v1',businessKey,'minha-rodagem-gps-lease-v1'];
const registry = activeId => JSON.stringify({version:1,activeId,profiles:[{id:'principal',name:'Perfil sintético',createdAt:0},{id:'other',name:'Outro perfil sintético',createdAt:0}]});
const gen = id => JSON.stringify({version:1,id,at:Date.parse('2026-11-26T12:00:00Z')});
const recordRaw = JSON.stringify({versao:1,registros:[legacy]});
const report = {mode:'local DOM/API simulation with synthetic fixtures',passed:[],pending:['Android físico','OAuth/contas reais','produção'],productionOperations:0};
class Locks {
  constructor(){this.held=new Set();this.queued=new Map();this.calls=[];}
  request(name,options,action){
    if(typeof options==='function'){action=options;options={};}
    this.calls.push({name,ifAvailable:options.ifAvailable===true});
    if(options.ifAvailable&&(this.held.has(name)||(this.queued.get(name)||[]).length))return Promise.resolve().then(()=>action(null));
    return new Promise((resolve,reject)=>{
      const finish=()=>{this.held.delete(name);const next=this.queued.get(name)?.shift();next?.();};
      const execute=()=>{this.held.add(name);Promise.resolve().then(()=>action({name,mode:'exclusive'})).then(value=>{finish();resolve(value);},error=>{finish();reject(error);});};
      if(this.held.has(name)){const queue=this.queued.get(name)||[];queue.push(execute);this.queued.set(name,queue);}else execute();
    });
  }
}
async function setup({store=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw]]),locks=new Locks(),session=null,config=true,autoReady=true}={}){
  const a=boot(store),reads=[],writes=[],removes=[];let reloads=0,suspends=0,authCalls=0;
  const storage=a.window.localStorage;
  Object.defineProperty(storage,'length',{get:()=>store.size});storage.key=index=>[...store.keys()][index]??null;
  storage.getItem=key=>{reads.push(key);return store.has(key)?store.get(key):null;};
  const hooks={set:null,remove:null};
  storage.setItem=(key,value)=>{writes.push(key);if(hooks.set)hooks.set(key,String(value));else store.set(key,String(value));};
  storage.removeItem=key=>{removes.push(key);if(hooks.remove)hooks.remove(key);else store.delete(key);};
  storage.clear=()=>assert.fail('device manager must never clear the whole origin');
  a.window.navigator.locks=locks;a.window.crypto=a.context.crypto;
  a.window.location.reload=()=>{reloads++;};
  a.window.RodagemGPS={suspend(){suspends++;store.delete(a.window.RodagemProfiles.key('minha-rodagem-gps-lease-v1'));}};
  a.window.RodagemCloud={configured:()=>config,getSession:async()=>{authCalls++;if(session instanceof Error)throw session;return typeof session==='function'?session(authCalls):session;}};
  if(config)a.window.RodagemCloudConfig={url:'https://synthetic-project.supabase.co'};
  vm.runInContext(source,a.context,{filename:'device-data.js'});
  if(autoReady)await a.window.RodagemDeviceData.ready;
  await flush();
  return {...a,api:a.window.RodagemDeviceData,locks,hooks,reads,writes,removes,
    stats:()=>({reloads,suspends,authCalls}),setSession:value=>{session=value;}};
}
const options = a => ({name:a.window.RodagemProfiles.current().name,backupSaved:true});
const sorted = store => [...store].sort(([a],[b])=>a.localeCompare(b));
async function check(name,run){await run();report.passed.push(name);console.log('PASS',name);}

await check('initialization is read-only and logout data remains present',async()=>{
  const a=await setup();assert.equal(a.writes.length,0);assert.equal(a.removes.length,0);assert.equal(a.stats().suspends,0);
  assert.equal(a.store.get(recordsKey),recordRaw);a.api.assertWritable();
  assert.ok(a.get('dados-aparelho'));assert.match(a.get('dados-aparelho').textContent,/Sair da conta mantém/);
});
await check('technical export preserves exact raw strings including unreadable legacy data and excludes all Auth/other profiles/binding',async()=>{
  const store=new Map([[registryKey,registry('principal')],[recordsKey,'{unreadable original raw'],
    [businessKey,'{"version":1,"legacy":"exact raw"}'],['minha-rodagem-rota-v1:route-a','{"raw":"synthetic coordinates"}'],
    [otherPrefix+recordsKey,'other records'],[otherPrefix+journeyKey,'other journey'],[otherPrefix+'minha-rodagem-rota-v1:route-b','other route'],
    [authKey,'PRIVATE_AUTH_SENTINEL'],['sb-other-auth-token','PRIVATE_SDK_SENTINEL'],[bindingKey,'PRIVATE_BINDING_SENTINEL']]);
  const a=await setup({store});const before=sorted(store);const result=await a.api.download();
  assert.match(result.filename,/copia-tecnica-principal/);assert.equal(a.blobs.size,1);
  const text=await [...a.blobs.values()][0].text(),backup=JSON.parse(text);
  assert.equal(backup.format,'minha-rodagem-device-profile');assert.equal(backup.profile.id,'principal');
  assert.equal(new Map(backup.entries).get(recordsKey),'{unreadable original raw');
  assert.equal(new Map(backup.entries).get(businessKey),'{"version":1,"legacy":"exact raw"}');
  assert.equal(new Map(backup.entries).get('minha-rodagem-rota-v1:route-a'),'{"raw":"synthetic coordinates"}');
  for(const sentinel of ['PRIVATE_AUTH_SENTINEL','PRIVATE_SDK_SENTINEL','PRIVATE_BINDING_SENTINEL','other records','other journey','other route'])assert.equal(text.includes(sentinel),false);
  assert.equal(a.reads.includes(authKey),false);assert.equal(a.reads.includes('sb-other-auth-token'),false);
  assert.equal(a.reads.includes(bindingKey),false);assert.equal(a.reads.includes(otherPrefix+recordsKey),false);
  assert.deepEqual(sorted(store),before);assert.equal(a.stats().suspends,0);
});
await check('export is available without Web Locks but removal is refused',async()=>{
  const a=await setup({locks:null});const before=sorted(a.store);await a.api.download();
  await assert.rejects(a.api.remove(options(a)),{code:'LOCKS_UNAVAILABLE'});assert.deepEqual(sorted(a.store),before);
});
await check('removal requires an export, saved-copy acknowledgement and exact current name',async()=>{
  const a=await setup();const before=sorted(a.store);
  await assert.rejects(a.api.remove(options(a)),{code:'BACKUP_REQUIRED'});await a.api.download();
  await assert.rejects(a.api.remove({name:options(a).name,backupSaved:false}),{code:'BACKUP_REQUIRED'});
  await assert.rejects(a.api.remove({...options(a),name:options(a).name+' '}),{code:'NAME_REQUIRED'});
  assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
});
await check('signed-in account and failed Auth lookup cannot remove local data',async()=>{
  for(const session of [{user:{id:'synthetic-account'}},new Error('network failure')]){
    const a=await setup({session});await a.api.download();const before=sorted(a.store);
    await assert.rejects(a.api.remove(options(a)));assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
  }
});
await check('configured but unavailable Auth module fails closed',async()=>{
  const a=await setup();await a.api.download();const before=sorted(a.store);a.window.RodagemCloud=null;
  await assert.rejects(a.api.remove(options(a)),{code:'AUTH_UNAVAILABLE'});assert.deepEqual(sorted(a.store),before);
});
await check('an account appearing during lock acquisition cancels removal',async()=>{
  const a=await setup({session:count=>count===1?null:{user:{id:'new-synthetic-account'}}});await a.api.download();const before=sorted(a.store);
  await assert.rejects(a.api.remove(options(a)),{code:'AUTH_REQUIRED'});assert.equal(a.stats().authCalls,2);
  assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
});
await check('an exclusively local installation can remove only after explicit confirmation',async()=>{
  const a=await setup({config:false});a.window.RodagemCloud=null;await a.api.download();
  assert.equal((await a.api.remove(options(a))).removed,true);assert.equal(a.store.has(recordsKey),false);assert.equal(a.stats().reloads,1);
});
await check('CAS detects record edits and newly created routes after export',async()=>{
  for(const mutation of [a=>a.store.set(recordsKey,recordRaw+' '),a=>a.store.set('minha-rodagem-rota-v1:new-route','synthetic route')]){
    const a=await setup();await a.api.download();mutation(a);const before=sorted(a.store);
    await assert.rejects(a.api.remove(options(a)),{code:'CONFLICT'});assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
  }
});
await check('renaming or switching the profile after export cancels removal',async()=>{
  for(const mutation of [a=>a.window.RodagemProfiles.renameCurrent('Perfil renomeado'),a=>a.store.set(registryKey,registry('other'))]){
    const a=await setup();await a.api.download();await mutation(a);const before=sorted(a.store);
    await assert.rejects(a.api.remove(options(a)));assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
  }
});
await check('all pending journeys, including unreadable state, prevent removal',async()=>{
  for(const value of ['{"estado":"running"}','{"estado":"paused"}','{"estado":"pending"}','unreadable']){
    const a=await setup();await a.api.download();a.store.set(journeyKey,value);const before=sorted(a.store);
    await assert.rejects(a.api.remove(options(a)),{code:'JOURNEY_ACTIVE'});assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
  }
});
await check('drafts and busy cloud or business UI prevent removal',async()=>{
  for(const prepare of [a=>a.get('dia').querySelector('input:not([type="date"])').value='42',
    a=>{const node=a.document.createElement('section');node.id='conta-cloud';node.setAttribute('aria-busy','true');a.get('ajustes').append(node);},
    a=>{a.window.RodagemBusinessUI={isDirty:()=>true};}]){
    const a=await setup();await a.api.download();prepare(a);const before=sorted(a.store);
    await assert.rejects(a.api.remove(options(a)),{code:'DIRTY'});assert.deepEqual(sorted(a.store),before);
  }
});
await check('pending cloud recovery prevents removal without deleting its journal',async()=>{
  const a=await setup();await a.api.download();a.store.set(syncKey,'pending synthetic recovery');const before=sorted(a.store);
  await assert.rejects(a.api.remove(options(a)),{code:'RECOVERY_PENDING'});assert.deepEqual(sorted(a.store),before);
});
await check('contended storage locks cancel without waiting or removing data',async()=>{
  const a=await setup();await a.api.download();a.locks.held.add(recordsKey);const before=sorted(a.store);
  await assert.rejects(a.api.remove(options(a)),{code:'BUSY'});assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
});
await check('confirmed removal preserves registry, Auth state, account binding and every other profile',async()=>{
  const store=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw],[businessKey,'synthetic local business'],
    ['minha-rodagem-rota-v1:route-a','synthetic route'],['minha-rodagem-gps-lease-v1','synthetic lease'],
    [otherPrefix+recordsKey,'other record bytes'],[otherPrefix+'minha-rodagem-rota-v1:r','other route bytes'],
    [authKey,'PRIVATE_AUTH_SENTINEL'],[bindingKey,'PRIVATE_BINDING_SENTINEL'],['unrelated-app-key','preserve unrelated']]);
  const a=await setup({store});await a.api.download();const preserve=new Map([...store].filter(([key])=>!names.includes(key)&&!key.startsWith('minha-rodagem-rota-v1:')));
  assert.equal((await a.api.remove(options(a))).removed,true);
  for(const [key,value]of preserve)assert.equal(store.get(key),value,key);
  for(const key of names)assert.equal(store.has(key),false,key);
  assert.equal(store.has('minha-rodagem-rota-v1:route-a'),false);assert.equal(store.has(journalKey),false);
  assert.equal(JSON.parse(store.get(generationKey)).version,1);assert.equal(a.stats().suspends,1);assert.equal(a.stats().reloads,1);
  assert.throws(()=>a.api.assertWritable(),{code:'RECOVERY_PENDING'});
});
await check('secondary profile export and removal never touches principal or another namespace',async()=>{
  const own=otherPrefix, third='minha-rodagem-usuario-v1:third:';
  const store=new Map([[registryKey,registry('other')],[recordsKey,recordRaw],[own+recordsKey,'exact secondary legacy bytes'],
    [own+'minha-rodagem-rota-v1:route-a','secondary route'],[third+recordsKey,'third bytes'],[authKey,'PRIVATE_AUTH_SENTINEL']]);
  const a=await setup({store});await a.api.download();const backup=JSON.parse(await [...a.blobs.values()][0].text());
  assert.equal(backup.profile.id,'other');assert.equal(new Map(backup.entries).get(recordsKey),'exact secondary legacy bytes');
  assert.equal(JSON.stringify(backup).includes('PRIVATE_AUTH_SENTINEL'),false);
  await a.api.remove(options(a));assert.equal(store.get(recordsKey),recordRaw);assert.equal(store.get(third+recordsKey),'third bytes');
  assert.equal(store.has(own+recordsKey),false);assert.equal(store.has(own+'minha-rodagem-rota-v1:route-a'),false);
  assert.equal(store.has(generationKey),false);assert.equal(store.has(own+generationKey),true);
});
await check('generation blocks queued stale writers even when both tabs initially had no records',async()=>{
  const store=new Map([[registryKey,registry('principal')]]),locks=new Locks();
  const a=await setup({store,locks}),old=await setup({store,locks});await a.api.download();await a.api.remove(options(a));
  const before=sorted(store);await assert.rejects(old.evaluate('persistir([])'),{code:'DEVICE_CHANGED'});
  assert.deepEqual(sorted(store),before);assert.equal(store.has(recordsKey),false);
});
await check('journal preparation quota failure leaves original bytes writable and GPS untouched',async()=>{
  const a=await setup();await a.api.download();const before=sorted(a.store);
  a.hooks.set=(key,value)=>{if(key===journalKey)throw Error('synthetic quota');a.store.set(key,value);};
  await assert.rejects(a.api.remove(options(a)),{code:'STORAGE'});assert.deepEqual(sorted(a.store),before);
  a.api.assertWritable();assert.equal(a.stats().suspends,0);assert.equal(a.stats().reloads,0);
});
await check('failure after partial deletion rolls back exact bytes and freezes old writers',async()=>{
  const store=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw],[businessKey,'exact raw business'],['minha-rodagem-rota-v1:r','exact raw route']]);
  const a=await setup({store});await a.api.download();const before=sorted(store);let failed=false;
  a.hooks.remove=key=>{if(key===recordsKey&&!failed){failed=true;throw Error('synthetic removal failure');}store.delete(key);};
  await assert.rejects(a.api.remove(options(a)),{code:'STORAGE'});assert.deepEqual(sorted(store),before);
  assert.equal(a.stats().reloads,1);assert.throws(()=>a.api.assertWritable(),{code:'RECOVERY_PENDING'});
});
await check('failed rollback preserves journal and a fresh load can recover the exact original data',async()=>{
  const a=await setup();await a.api.download();const before=sorted(a.store);let first=true;
  a.hooks.remove=key=>{if(key===recordsKey&&first){first=false;a.store.delete(key);throw Error('synthetic interruption');}a.store.delete(key);};
  a.hooks.set=(key,value)=>{if(key===recordsKey)throw Error('synthetic recovery quota');a.store.set(key,value);};
  await assert.rejects(a.api.remove(options(a)),{code:'RECOVERY_PENDING'});assert.equal(a.store.has(journalKey),true);
  assert.throws(()=>a.api.assertWritable(),{code:'RECOVERY_PENDING'});
  const recovered=await setup({store:a.store});assert.deepEqual(sorted(a.store),before);assert.equal(recovered.stats().reloads,1);
  assert.throws(()=>recovered.api.assertWritable(),{code:'RECOVERY_PENDING'});
});
const makeJournal=(before,extra={})=>JSON.stringify({version:1,kind:'device-removal',profileId:'principal',createdAt:Date.parse('2026-11-26T12:00:00Z'),
 generationBefore:null,generationAfter:gen('after'),before:names.map(key=>[key,before.get(key)??null]),...extra});
await check('interrupted deletion recovers before any subsequent save and forces reload',async()=>{
  const original=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw],[businessKey,'original business raw']]);
  const store=new Map([[registryKey,registry('principal')],[journalKey,makeJournal(original)],[generationKey,gen('after')]]);
  const a=await setup({store});assert.deepEqual(sorted(store),sorted(original));assert.equal(a.stats().reloads,1);
  assert.throws(()=>a.window.RodagemProfiles.assertCurrent(),{code:'RECOVERY_PENDING'});
});
await check('recovery never overwrites data created after an interrupted deletion',async()=>{
  const original=new Map([[recordsKey,recordRaw]]);
  const store=new Map([[registryKey,registry('principal')],[journalKey,makeJournal(original)],[generationKey,gen('after')],[recordsKey,'later synthetic changes']]);
  const before=sorted(store),a=await setup({store});assert.deepEqual(sorted(store),before);assert.equal(a.stats().reloads,0);
  assert.throws(()=>a.api.assertWritable(),{code:'RECOVERY_PENDING'});
});
await check('malformed journals cannot target Auth keys or another profile',async()=>{
  const original=new Map([[recordsKey,recordRaw]]);
  for(const text of ['invalid JSON',makeJournal(original,{profileId:'other'}),makeJournal(original,{before:[...names.map(key=>[key,null]),[authKey,'injected auth']]}),
    makeJournal(original,{before:[...names.map(key=>[key,null]),[otherPrefix+recordsKey,'injected other profile']]})]){
    const store=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw],[journalKey,text],[authKey,'PRIVATE_AUTH_SENTINEL']]);
    const before=sorted(store),a=await setup({store});assert.deepEqual(sorted(store),before);assert.equal(a.stats().reloads,0);
    assert.throws(()=>a.api.assertWritable(),{code:'RECOVERY_PENDING'});
  }
});
await check('invalid generation fails closed without rewriting historical bytes',async()=>{
  const store=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw],[generationKey,'broken-generation']]);
  const before=sorted(store),a=await setup({store});await assert.rejects(a.api.download(),{code:'RECOVERY_PENDING'});
  assert.deepEqual(sorted(store),before);assert.equal(a.stats().suspends,0);
});
await check('simultaneous explicit removals do not interleave or recreate deleted records',async()=>{
  const store=new Map([[registryKey,registry('principal')],[recordsKey,recordRaw]]),locks=new Locks();
  const a=await setup({store,locks}),b=await setup({store,locks});await a.api.download();await b.api.download();
  const results=await Promise.allSettled([a.api.remove(options(a)),b.api.remove(options(b))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(store.has(recordsKey),false);assert.equal(store.has(journalKey),false);
  assert.equal(a.stats().suspends+b.stats().suspends,1);
});
await check('canceling the removal UI clears acknowledgement without changing storage',async()=>{
  const a=await setup();const before=sorted(a.store);await a.click('#dados-aparelho-abrir');
  a.get('dados-aparelho-nome').value=options(a).name;a.get('dados-aparelho-copia').checked=true;
  await a.click('#dados-aparelho-cancelar');assert.equal(a.get('dados-aparelho-remocao').hidden,true);
  assert.equal(a.get('dados-aparelho-copia').checked,false);assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
});
await check('download failure cannot count as a saved export or permit removal',async()=>{
  const a=await setup();const before=sorted(a.store);a.context.URL.createObjectURL=()=>{throw Error('synthetic download failure');};
  await assert.rejects(a.api.download());await assert.rejects(a.api.remove(options(a)),{code:'BACKUP_REQUIRED'});
  assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
});
await check('bounded export rejects excessively large local data without deleting it',async()=>{
  const a=await setup();a.store.set(businessKey,'x'.repeat(16*1024*1024+1));const before=sorted(a.store);
  await assert.rejects(a.api.download(),{code:'TOO_LARGE'});assert.deepEqual(sorted(a.store),before);assert.equal(a.stats().suspends,0);
});
report.suites=report.passed.length;report.errors=[];report.technicalImportImplemented=false;
await fs.writeFile(new URL('./device-data-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('DEVICE_DATA_REPORT '+JSON.stringify(report));
