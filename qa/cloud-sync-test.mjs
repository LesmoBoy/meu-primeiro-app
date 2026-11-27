// Integração da sincronização com armazenamento e conta simulados. Nenhuma
// credencial ou servidor externo é usado; OAuth real depende da ativação.
import {boot,flush,legacy} from './harness.mjs';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = await fs.readFile(new URL('../cloud-sync.js',import.meta.url),'utf8');
const gps = await fs.readFile(new URL('../gps-core.js',import.meta.url),'utf8');
const budget = await fs.readFile(new URL('../backup-budget.js',import.meta.url),'utf8');
const userA = {user:{id:'b697b572-f3d3-4b7c-a0e8-4de95799c837',email:'ana@example.test'}};
const userB = {user:{id:'7e1d2fca-e66f-4cac-bd17-345836de8a14',email:'bruno@example.test'}};
const recordKey='minha-rodagem-v1',bindingKey='minha-rodagem-cloud-v1',journalKey='minha-rodagem-sync-journal-v1';
const json = value => JSON.parse(JSON.stringify(value));
const records = rows => JSON.stringify({versao:1,registros:rows});
const bound = (revision=0,user=userA) => JSON.stringify({userId:user.user.id,revision,lastSyncedAt:null});
const snapshot = () => ({version:1,settings:null,records:{versao:1,registros:[{...legacy,id:'cloud-day'}]},routes:[],gpsPreferences:{enabled:false,mode:'eco'},journey:null});
const response = (revision=1) => ({revision,payload:snapshot(),updated_at:'2026-11-15T12:00:00.000Z'});
async function setup({store = new Map(),configured = true,remote = null,providers}={}) {
  const a = boot(store); let current=userA,listener,loads=0,saves=0,reloads=0,confirms=[],signins=[];
  const driver = {configured:()=>configured,getSession:async()=>current,verifySession:async()=>current,
    onAuth:callback=>{listener=callback;return()=>{};},
    async load(expectedUserId){assert.equal(expectedUserId,current.user.id);loads++;return remote;},async save(revision,payload,expectedUserId){assert.equal(expectedUserId,current.user.id);saves++;return {...response(revision+1),payload};},
    signIn:async provider=>{signins.push(provider);},signOut:async()=>{current=null;listener?.('SIGNED_OUT',null);}};
  a.window.RodagemCloud=driver;
  if (providers) a.window.RodagemCloudConfig={providers};
  a.context.confirmar=async message=>{confirms.push(message);return true;};
  a.context.location.reload=()=>{reloads++;};
  vm.runInContext(gps,a.context,{filename:'gps-core.js'});
  a.window.RodagemGeo = a.context.RodagemGeo;
  vm.runInContext(budget,a.context,{filename:'backup-budget.js'});
  vm.runInContext(source,a.context,{filename:'cloud-sync.js'});
  await flush();
  return {...a,api:a.window.RodagemSync,driver,stats:()=>({loads,saves,reloads,confirms,signins}),
    setSession(value){current=value;listener?.('SIGNED_IN',value);},setRemote(value){remote=value;}};
}
let passed=0;
async function check(label,run){await run();passed++;console.log('PASS',label);}

await check('unconfigured installation stays local and disables both OAuth providers without loading cloud data',async()=>{
  const a=await setup({configured:false});
  assert.equal(a.stats().loads,0);assert.equal(a.stats().saves,0);
  assert.equal(a.get('conta-cloud').querySelectorAll('[data-cloud-provider]').length,2);
  for(const node of a.get('conta-cloud').querySelectorAll('[data-cloud-provider]'))assert.equal(node.disabled,true);
  assert.match(a.get('cloud-status').textContent,/ainda não está disponível/);
  await assert.rejects(()=>a.api.bind(),/ainda não está disponível/);
});
await check('an installation configured only for Google leaves Facebook disabled and never starts its login',async()=>{
  const a=await setup({providers:['google']});a.setSession(null);
  const google=a.get('conta-cloud').querySelector('[data-cloud-provider="google"]');
  const facebook=a.get('conta-cloud').querySelector('[data-cloud-provider="facebook"]');
  assert.equal(google.disabled,false);assert.equal(facebook.disabled,true);
  facebook.dispatchEvent(a.event('click'));await flush();assert.deepEqual(a.stats().signins,[]);
  google.dispatchEvent(a.event('click'));await flush();assert.deepEqual(a.stats().signins,['google']);
});
await check('authentication alone never binds, uploads or replaces local records',async()=>{
  const store=new Map([[recordKey,records([legacy])]]);const before=[...store];const a=await setup({store});
  assert.deepEqual([...store],before);assert.equal(a.stats().loads,0);assert.equal(a.stats().saves,0);
  a.setSession(userB);assert.deepEqual([...store],before);
});
await check('binding is confirmed explicitly and never relinks the profile to another user',async()=>{
  const a=await setup();await a.api.bind();
  assert.equal(a.api.readBinding().userId,userA.user.id);assert.equal(a.stats().confirms.length,1);
  a.setSession(userB);await assert.rejects(()=>a.api.bind(),/outra conta/);
  assert.equal(a.api.readBinding().userId,userA.user.id);
});
await check('one account cannot silently bind a second local profile',async()=>{
  const a=await setup();const profile=await a.window.RodagemProfiles.create('Outra pessoa');
  a.store.set(`minha-rodagem-usuario-v1:${profile.id}:${bindingKey}`,bound());
  await assert.rejects(()=>a.api.bind(),/Trocar perfil/);assert.equal(a.store.has(bindingKey),false);
});
await check('upload requires matching binding and announces transfer of GPS coordinates',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()],[recordKey,records([legacy])]])});
  const saved=await a.api.upload();assert.equal(saved.revision,1);assert.equal(a.api.readBinding().revision,1);
  assert.match(a.stats().confirms[0],/posições.*enviadas/);assert.equal(a.stats().saves,1);
  assert.deepEqual(json(a.records()),[legacy]);
});
await check('newer remote revision is never overwritten automatically',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()]]),remote:response(2)});
  await assert.rejects(()=>a.api.upload(),/mais recente/);assert.equal(a.stats().saves,0);
  assert.equal(a.api.readBinding().revision,0);
});
await check('malformed remote snapshots and repeated route identifiers never mutate local storage',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()],[recordKey,records([legacy])]])});
  const before=[...a.store];const broken=response();broken.payload.records.registros[0].ganhos=.1;a.setRemote(broken);
  await assert.rejects(()=>a.api.restore(),/Backup inválido/);assert.deepEqual([...a.store],before);
  const duplicate=snapshot();const track=a.window.RodagemGeo.create('route-a','eco',Date.now());
  duplicate.routes=[{id:track.id,track,updatedAt:track.updatedAt,finished:true},{id:track.id,track,updatedAt:track.updatedAt,finished:true}];
  assert.throws(()=>a.api.validateSnapshot(duplicate),/repetidos/);
});
await check('restoration replaces only the confirmed profile and preserves data belonging to other profiles',async()=>{
  const other='minha-rodagem-usuario-v1:other:'+recordKey;
  const a=await setup({store:new Map([[bindingKey,bound()],[recordKey,records([legacy])],[other,'untouched']]),remote:response()});
  await a.api.restore();assert.equal(JSON.parse(a.store.get(recordKey)).registros[0].id,'cloud-day');
  assert.equal(a.store.get(other),'untouched');assert.equal(a.store.has(journalKey),false);assert.equal(a.stats().reloads,1);
});
await check('storage quota failure rolls every local value back and removes the recovery journal',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()],[recordKey,records([legacy])]]),remote:response()});
  const before=[...a.store].sort();const original=a.context.localStorage.setItem;let failed=false;
  a.context.localStorage.setItem=(key,value)=>{if(!failed&&key==='minha-rodagem-rotas-indice-v1'){failed=true;throw Error('quota');}return original(key,value);};
  await assert.rejects(()=>a.api.restore(),/anteriores foram restaurados/);
  assert.deepEqual([...a.store].sort(),before);assert.equal(a.stats().reloads,0);
});
await check('a local record change made during confirmation cancels recovery without overwriting it',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()],[recordKey,records([legacy])]]),remote:response()});
  const fresh=records([{...legacy,id:'other-tab'}]);a.context.confirmar=async()=>{a.store.set(recordKey,fresh);return true;};
  await assert.rejects(()=>a.api.restore(),/mudaram/);assert.equal(a.store.get(recordKey),fresh);assert.equal(a.store.has(journalKey),false);
});
await check('account or profile changes while a cloud request waits prevent local mutation',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()],[recordKey,records([legacy])]]),remote:response()});
  const before=[...a.store];a.driver.load=async()=>{a.setSession(userB);return response();};
  await assert.rejects(()=>a.api.restore(),/conta mudou/);assert.deepEqual([...a.store],before);
});
await check('unsaved fields and any local shift require completion before restoration',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()]]),remote:response()});
  a.fill('dia',{ganhos:'50'});await assert.rejects(()=>a.api.restore(),/campos/);assert.equal(a.stats().loads,0);
  a.get('dia').reset();
  a.store.set('minha-rodagem-jornada-v2',JSON.stringify({versao:1,id:'paused',estado:'paused',data:'2026-11-13',iniciadaEm:0,rodandoDesde:null,acumulado:0}));
  a.evaluate('jornadaRaw=localStorage.getItem(jornadaStorageKey)');
  await assert.rejects(()=>a.api.restore(),/jornada/);assert.equal(a.stats().loads,0);
});
await check('interrupted recovery restores the old values on next boot even when cloud is disabled',async()=>{
  const before=[[recordKey,records([legacy])],[bindingKey,bound()]];
  const journal={version:1,profileId:'principal',before};
  const store=new Map([[recordKey,records(snapshot().records.registros)],[bindingKey,bound(1)],[journalKey,JSON.stringify(journal)]]);
  const a=await setup({store,configured:false});assert.equal(a.store.get(recordKey),before[0][1]);assert.equal(a.store.get(bindingKey),before[1][1]);
  assert.equal(a.store.has(journalKey),false);assert.equal(a.stats().reloads,1);
});
await check('recovery journal cannot mutate another namespace or the authentication storage',async()=>{
  const bad={version:1,profileId:'principal',before:[['minha-rodagem-supabase-auth-v1','token']]};
  const a=await setup({store:new Map([[journalKey,JSON.stringify(bad)]]),configured:false});
  assert.equal(a.store.has('minha-rodagem-supabase-auth-v1'),false);assert.equal(a.store.has(journalKey),true);
  assert.match(a.get('cloud-status').textContent,/inválida/);
});
await check('starting OAuth protects an unsaved business draft when navigation is canceled',async()=>{
  const a=await setup();let logins=0;
  a.window.RodagemBusinessUI={isDirty:()=>true};
  a.driver.signIn=async()=>{logins++;};a.context.confirmar=async()=>false;
  a.get('conta-cloud').querySelector('[data-cloud-provider="google"]').dispatchEvent(a.event('click'));
  await flush();assert.equal(logins,0);
});
await check('recovering personal cloud data cannot discard an unsaved business draft',async()=>{
  const a=await setup({store:new Map([[bindingKey,bound()]]),remote:response()});
  a.window.RodagemBusinessUI={isDirty:()=>true};
  await assert.rejects(()=>a.api.restore(),/campos preenchidos/);
  assert.equal(a.stats().reloads,0);
});
await check('Google ID-token entry still protects an unsaved business draft without claiming a page reload',async()=>{
  const a=await setup({providers:['google']});let logins=0,prompt='';
  a.window.RodagemCloudConfig={providers:['google'],googleAuthMode:'id_token'};
  a.window.RodagemBusinessUI={isDirty:()=>true};
  a.driver.signIn=async()=>{logins++;return null;};a.context.confirmar=async text=>{prompt=text;return false;};
  a.get('conta-cloud').querySelector('[data-cloud-provider="google"]').dispatchEvent(a.event('click'));
  await flush();assert.equal(logins,0);assert.equal(a.stats().reloads,0);assert.match(prompt,/campos ainda não salvos/);assert.doesNotMatch(prompt,/reabrir o app/);
});
console.log(`PASS ${passed} cloud synchronization integration suites`);
