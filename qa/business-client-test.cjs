// Repository integration with real domain validation, isolated storage and a
// mocked cloud boundary. This does not claim real OAuth or payment activation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const core=require('../business-core.js'),source=fs.readFileSync(path.join(__dirname,'../business-client.js'),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const KEY='minha-rodagem-business-v1';
const clone=v=>JSON.parse(JSON.stringify(v));
function boot({store=new Map(),id='principal',configured=false}={}){
 let currentProfile=id,session={user:{id:A,email:'a@example.test'}},auth,quota=false,remote=null,calls=[],rpc;
 const events=new Map(),rootEvents=new Map(),locks=new Map();
 const add=(map,type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn);};
 const document={addEventListener:(t,f)=>add(events,t,f)};
 const profiles={key:key=>id==='principal'?key:'minha-rodagem-usuario-v1:'+id+':'+key,current:()=>({id,name:'Responsável'}),assertCurrent(){if(currentProfile!==id)throw Error('Perfil alterado');}};
 const storage={getItem:k=>store.get(k)??null,setItem(k,v){if(quota&&k===profiles.key(KEY))throw Error('Quota');store.set(k,String(v));},removeItem:k=>store.delete(k)};
 const cloud={configured:()=>configured,async verifySession(expected){if(!session)throw Error('Entre');if(expected&&session.user.id!==expected)throw Error('Conta alterada');return clone(session);},onAuth(fn){auth=fn;return()=>{};},async call(name,args,uid){calls.push({name,args,uid});if(rpc)return rpc(name,args,uid);return clone(remote);}};
 const window={document,localStorage:storage,RodagemProfiles:profiles,RodagemBusinessCore:core,RodagemCloud:cloud,crypto:{randomUUID},navigator:{locks:{request(name,_options,fn){const prev=locks.get(name)||Promise.resolve();const result=prev.catch(()=>{}).then(fn);locks.set(name,result);return result;}}},addEventListener:(t,f)=>add(rootEvents,t,f)};
 const context=vm.createContext({window,Blob,Date,Math,JSON,Promise,Error,Set,Array,Object,Number});vm.runInContext(source,context);
 return {api:window.RodagemBusiness,store,profiles,calls,key:profiles.key(KEY),setQuota:v=>quota=v,setRemote:v=>remote=v,setRPC:fn=>rpc=fn,
  changeSession(value){session=value;auth?.('SIGNED_IN',value);},changeProfile(value){currentProfile=value;for(const fn of events.get('rodagem:profile-stale')||[])fn();},
  storageEvent(){for(const fn of rootEvents.get('storage')||[])fn({key:profiles.key(KEY)});}};
}
const vehicle=(name='Veículo livre')=>({name,category:'carro',year:2020,fuel:'Gasolina',plate:'',odometer:100000,active:true});
const costs=()=>Object.fromEntries(core.costKeys.map(k=>[k,0]));
const trip=(vehicleId,driverId=null)=>({vehicleId,driverId,date:'2026-11-16',title:'Entrega',customer:'Cliente',status:'completed',revenue:12345,distance:1500,costs:{...costs(),fuel:2345}});
let passed=0;async function check(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
 await check('startup and empty local reads do not write any key or touch legacy records',async()=>{
  const store=new Map([['minha-rodagem-v1','legacy-value']]);const b=boot({store});assert.equal(b.api.getMode(),'local');assert.deepEqual(await b.api.listCompanies(),[]);assert.deepEqual([...store],[['minha-rodagem-v1','legacy-value']]);
 });
 await check('companies retain separate fleet, team and financial history',async()=>{
  const b=boot();const first=await b.api.createCompany('Empresa A');const va=await b.api.saveEntity('vehicle',vehicle('Van A'));const driver=await b.api.saveMember({name:'Pessoa A',email:'a@example.test',role:'driver'});const t=await b.api.saveEntity('trip',trip(va.id,driver.id));assert.equal(t.revenue,12345);
  const second=await b.api.createCompany('Empresa B');assert.notEqual(first.company.id,second.company.id);assert.equal(second.vehicles.length,0);assert.equal(second.trips.length,0);assert.equal(second.members.length,1);
  await assert.rejects(b.api.saveEntity('trip',trip(va.id)),/desta empresa/);
  const restored=await b.api.loadCompany(first.company.id);assert.equal(restored.vehicles.length,1);assert.equal(core.totals(restored).profit,10000);
 });
 await check('the local namespace is fixed to the boot profile and cannot mix another profile',async()=>{
  const store=new Map();const a=boot({store});await a.api.createCompany('A');const b=boot({store,id:'profile-b'});assert.deepEqual(await b.api.listCompanies(),[]);await b.api.createCompany('B');assert.notEqual(a.key,b.key);assert.equal((await a.api.listCompanies())[0].name,'A');
  const before=clone([...store]);a.changeProfile('profile-b');await assert.rejects(a.api.createCompany('Stale'),/Perfil alterado|perfil mudou/);assert.deepEqual([...store],before);
 });
 await check('an archived vehicle preserves its past trips and cannot be assigned to a new one',async()=>{
  const b=boot();await b.api.createCompany('A');const v=await b.api.saveEntity('vehicle',vehicle());const t=await b.api.saveEntity('trip',trip(v.id));await b.api.archiveEntity('vehicle',v.id,v.revision);const w=b.api.getCurrentWorkspace();assert.equal(w.trips[0].id,t.id);assert.equal(core.totals(w).profit,10000);assert.equal(w.vehicles[0].active,false);await assert.rejects(b.api.saveEntity('trip',trip(v.id)),/ativo/);
 });
 await check('stale revisions and simultaneous edits cannot silently overwrite the first commit',async()=>{
  const b=boot();await b.api.createCompany('A');const v=await b.api.saveEntity('vehicle',vehicle());const results=await Promise.allSettled([b.api.saveEntity('vehicle',{...v,name:'First'},1),b.api.saveEntity('vehicle',{...v,name:'Second'},1)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected')[0].reason.code,'CONFLICT');assert.equal(b.api.getCurrentWorkspace().vehicles[0].name,'First');
 });
 await check('local members can be archived without breaking history and the last owner remains active',async()=>{
  const b=boot();const w=await b.api.createCompany('A');const driver=await b.api.saveMember({name:'Motorista',email:'',role:'driver'});const v=await b.api.saveEntity('vehicle',vehicle());await b.api.saveEntity('trip',trip(v.id,driver.id));await b.api.archiveMember(driver.id,1);assert.equal(b.api.getCurrentWorkspace().trips[0].driverId,driver.id);await assert.rejects(b.api.archiveMember(w.members[0].id,1),/responsável ativo/);assert.equal(b.api.getCurrentWorkspace().members.find(x=>x.id===w.members[0].id).archivedAt,null);
 });
 await check('storage quota failures retain the exact prior bytes',async()=>{
  const b=boot();await b.api.createCompany('A');const old=b.store.get(b.key);b.setQuota(true);await assert.rejects(b.api.saveEntity('vehicle',vehicle()),e=>e.code==='STORAGE');assert.equal(b.store.get(b.key),old);assert.equal(b.api.getCurrentWorkspace().vehicles.length,0);
 });
 await check('a malformed store fails closed and can only be replaced by an explicit valid backup',async()=>{
  const b=boot({store:new Map([[KEY,'{corrupt']])});await assert.rejects(b.api.listCompanies(),e=>e.code==='UNREADABLE');assert.equal(b.store.get(KEY),'{corrupt');await b.api.importLocal(core.emptyState());assert.deepEqual(await b.api.listCompanies(),[]);
  const c=boot();await c.api.createCompany('Backup source');const backup=c.api.exportLocal();const d=boot();await d.api.importLocal(backup);assert.equal((await d.api.listCompanies())[0].name,'Backup source');const broken=clone(backup);broken.members=[];await assert.rejects(d.api.importLocal(broken));assert.equal((await d.api.listCompanies())[0].name,'Backup source');
 });
 await check('a backup confirmation snapshot cannot erase another edit made while confirmation was open',async()=>{
  const b=boot();await b.api.createCompany('Before');const expected=b.api.exportLocal();await b.api.createCompany('Added later');await assert.rejects(b.api.importLocal(core.emptyState(),expected),e=>e.code==='CONFLICT');assert.equal((await b.api.listCompanies()).length,2);
 });
 await check('raw version recovery accepts corrupt storage but rejects concurrent replacement before the commit',async()=>{
  const source=boot();await source.api.createCompany('Recovered');const backup=source.api.exportLocal();
  const b=boot({store:new Map([[KEY,'{corrupt']])});const captured=b.api.captureLocalVersion();assert.equal(captured,'{corrupt');
  await b.api.importLocal(backup,undefined,captured);assert.equal((await b.api.listCompanies())[0].name,'Recovered');
  const c=boot({store:new Map([[KEY,'{corrupt']])});const original=c.api.captureLocalVersion();
  const changed=JSON.stringify(backup);c.store.set(KEY,changed);
  await assert.rejects(c.api.importLocal(core.emptyState(),undefined,original),e=>e.code==='CONFLICT');assert.equal(c.store.get(KEY),changed);
  const empty=boot();const absent=empty.api.captureLocalVersion();assert.equal(absent,null);await empty.api.createCompany('Added while confirming');const before=empty.store.get(KEY);
  await assert.rejects(empty.api.importLocal(core.emptyState(),undefined,absent),e=>e.code==='CONFLICT');assert.equal(empty.store.get(KEY),before);
 });
 await check('unconfigured cloud mode sends nothing and never uploads local companies automatically',async()=>{
  const b=boot();await b.api.createCompany('Local');await assert.rejects(b.api.selectMode('cloud'),e=>e.code==='CONFIGURATION');assert.equal(b.api.getMode(),'local');assert.equal(b.calls.length,0);
  const c=boot({configured:true});await c.api.createCompany('Stays here');c.setRemote([]);await c.api.selectMode('cloud');assert.deepEqual(await c.api.listCompanies(),[]);assert.equal(c.calls.length,1);assert.equal(c.calls[0].name,'business_list_companies');assert.equal(c.calls[0].uid,A);await c.api.selectMode('local');assert.equal((await c.api.listCompanies())[0].name,'Stays here');
 });
 await check('a cloud account switch clears private workspace and rejects an outstanding response',async()=>{
  const local=boot();const w=await local.api.createCompany('Remote');w.members[0].userId=A;w.membership.userId=A;
  const b=boot({configured:true});await b.api.selectMode('cloud');b.setRemote(w);await b.api.loadCompany(w.company.id);assert.equal(b.api.getCurrentWorkspace().company.name,'Remote');let release;b.setRPC(()=>new Promise(resolve=>release=resolve));const pending=b.api.listCompanies();await new Promise(r=>setImmediate(r));b.changeSession({user:{id:B}});assert.equal(b.api.getCurrentWorkspace(),null);release([{...w.company,role:'owner'}]);await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');assert.equal(b.store.size,0);
 });
 await check('returned values are detached and external change notification never overwrites drafts',async()=>{
  const b=boot();await b.api.createCompany('A');let types=[];const off=b.api.subscribe(e=>types.push(e.type));const clone=b.api.getCurrentWorkspace();clone.company.name='Tampered';assert.equal(b.api.getCurrentWorkspace().company.name,'A');b.storageEvent();assert.deepEqual(types,['external']);off();b.storageEvent();assert.deepEqual(types,['external']);
 });
 await check('a late company response cannot replace a newer selected company',async()=>{
  const local=boot();const wa=await local.api.createCompany('A');const wb=await local.api.createCompany('B');
  for(const w of [wa,wb]){w.members[0].userId=A;w.membership.userId=A;}
  const b=boot({configured:true});await b.api.selectMode('cloud');let release;
  b.setRPC((_name,args)=>args.company_id===wa.company.id?new Promise(resolve=>release=resolve):wb);
  const previous=b.api.loadCompany(wa.company.id);await new Promise(r=>setImmediate(r));
  await b.api.loadCompany(wb.company.id);release(wa);await assert.rejects(previous,e=>e.code==='SESSION_CHANGED');
  assert.equal(b.api.getCurrentWorkspace().company.name,'B');
 });
 await check('changing the current member role reloads the server-filtered view and deactivation removes it',async()=>{
  const local=boot();let original=await local.api.createCompany('A');const owner=original.members[0];
  const other=await local.api.saveMember({name:'Outro responsável',email:'b@example.test',role:'owner'});original=local.api.getCurrentWorkspace();
  original.members.find(m=>m.id===owner.id).userId=A;original.members.find(m=>m.id===other.id).userId=B;original.membership.userId=A;
  const b=boot({configured:true});await b.api.selectMode('cloud');b.setRemote(original);await b.api.loadCompany(original.company.id);
  const changed={...original.members.find(m=>m.id===owner.id),role:'driver',revision:2};
  const restricted={...original,members:[changed],membership:{userId:A,memberId:owner.id,role:'driver'}};
  b.setRPC(name=>name==='business_save_member'?changed:restricted);
  await b.api.saveMember(changed,1);assert.equal(b.api.getCurrentWorkspace().membership.role,'driver');assert.equal(b.api.getCurrentWorkspace().members.length,1);
  const deactivated={...changed,archivedAt:'2026-11-16T12:00:00.000Z',revision:3};b.setRPC(()=>deactivated);
  await b.api.archiveMember(changed.id,2);assert.equal(b.api.getCurrentWorkspace(),null);
 });
 console.log('PASS '+passed+' business repository suites');
})().catch(e=>{console.error(e);process.exitCode=1;});
