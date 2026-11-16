const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const path = require('node:path');
const code = fs.readFileSync(path.resolve(__dirname,'../profiles-core.js'),'utf8');
const registryKey = 'minha-rodagem-perfis-v1';
function boot(store = new Map(), locks) {
  const listeners = new Map(), events = [];
  const root = {
    localStorage:{getItem:k => store.has(k) ? store.get(k) : null,setItem:(k,v) => store.set(k,String(v)),removeItem:k => store.delete(k)},
    navigator:{locks},crypto:{randomUUID},
    addEventListener:(name,fn) => listeners.set(name,fn),
    document:{dispatchEvent:event => events.push(event)}
  };
  class CustomEvent {constructor(type,options){this.type=type;this.detail=options.detail;}}
  vm.runInNewContext(code,{window:root,CustomEvent,Date,Math,JSON,Set,Map,Object,Promise,Number,Error,String});
  return {api:root.RodagemProfiles,store,events,
    storage:() => listeners.get('storage')({key:registryKey}),
    registry:() => JSON.parse(store.get(registryKey))};
}
const passed=[];
async function check(name,fn){await fn();passed.push(name);console.log('PASS',name);}
(async()=>{
  await check('legacy first load is read-only and retains original data keys',async()=>{
    const store=new Map([
      ['minha-rodagem-v1','{"versao":1,"registros":["old"]}'],
      ['minha-rodagem-perfil-v2','{"nome":"Gustavo"}'],
      ['minha-rodagem-rota-v1:route-a','coordinates-local']
    ]);
    const original=[...store];const a=boot(store);
    assert.equal(a.api.current().id,'principal');assert.equal(a.api.current().name,'Gustavo');
    assert.equal(a.api.key('minha-rodagem-v1'),'minha-rodagem-v1');
    assert.equal(a.api.list().length,1);assert.deepEqual([...store],original);
  });
  await check('create and reload isolate all logical stores without copying financial records',async()=>{
    const store=new Map([['minha-rodagem-v1','legacy-records']]);const a=boot(store);
    const person=await a.api.create('Ana');assert.equal(a.api.current().id,'principal');
    assert.equal(store.get('minha-rodagem-v1'),'legacy-records');
    await a.api.switchTo(person.id);
    assert.throws(()=>a.api.assertCurrent(),/perfil/i);
    assert.equal(a.api.key('minha-rodagem-v1'),'minha-rodagem-v1','namespace never changes in a running tab');
    const b=boot(store);assert.equal(b.api.current().id,person.id);
    for(const logical of ['minha-rodagem-v1','minha-rodagem-perfil-v2','minha-rodagem-jornada-v2','minha-rodagem-rota-v1:route-a','minha-rodagem-gps-preferencias-v1']) {
      assert.equal(b.api.key(logical),'minha-rodagem-usuario-v1:'+person.id+':'+logical);
      assert.equal(store.has(b.api.key(logical)),false,'no prior data copied to new profile');
    }
    assert.equal(a.events.filter(e=>e.type==='rodagem:profile-will-change').length,1);
    assert.equal(a.events.filter(e=>e.type==='rodagem:profile-changed').length,1);
  });
  await check('names normalize and duplicates or invalid labels are rejected without a write',async()=>{
    const a=boot();await a.api.create('  Ana   Maria  ');assert.equal(a.api.list()[1].name,'Ana Maria');
    const before=a.store.get(registryKey);
    for(const name of ['ANA MARIA','Ａna Maria','',' '.repeat(3),'x'.repeat(33)]) await assert.rejects(a.api.create(name));
    assert.equal(a.store.get(registryKey),before);
  });
  await check('concurrent creation rebases under the shared registry lock without losing profiles',async()=>{
    const store=new Map();let tail=Promise.resolve();
    const locks={request(name,options,fn){const run=tail.then(()=>fn());tail=run.catch(()=>{});return run;}};
    const a=boot(store,locks),b=boot(store,locks);
    await Promise.all([a.api.create('Ana'),b.api.create('Bruno')]);
    assert.equal(a.api.list().length,3);assert.deepEqual(a.api.list().map(x=>x.name).sort(),['Ana','Bruno','Perfil principal']);
  });
  await check('switching another tab freezes writes but preserves the captured read namespace',async()=>{
    const store=new Map(),a=boot(store),b=boot(store);const p=await a.api.create('Outra pessoa');
    await b.api.switchTo(p.id);a.storage();a.storage();
    assert.equal(a.api.isCurrent(),false);assert.equal(a.api.key('minha-rodagem-v1'),'minha-rodagem-v1');
    await assert.rejects(a.api.create('Forbidden'));
    assert.equal(a.events.filter(e=>e.type==='rodagem:profile-stale').length,1);
  });
  await check('queued old-profile mutation cannot commit after the active selection changes',async()=>{
    const a=boot();const p=await a.api.create('Ana');let release;
    const gate=new Promise(resolve=>release=resolve);
    const locked=boot(a.store,{request(_name,_options,fn){return gate.then(fn);}});
    const create=locked.api.create('Queued');
    const replacement={...a.registry(),activeId:p.id};a.store.set(registryKey,JSON.stringify(replacement));release();
    await assert.rejects(create);assert.equal(a.registry().profiles.length,2);assert.equal(a.registry().activeId,p.id);
  });
  await check('corrupt registry fails closed and is not silently replaced',async()=>{
    const store=new Map([[registryKey,'{bad registry'],['minha-rodagem-v1','preserve-me']]);const a=boot(store);
    assert.ok(a.api.error);assert.equal(a.api.isCurrent(),false);await assert.rejects(a.api.create('New'));
    assert.equal(store.get(registryKey),'{bad registry');assert.equal(store.get('minha-rodagem-v1'),'preserve-me');
  });
  await check('storage quota failure preserves the prior registry and financial records',async()=>{
    class Limited extends Map {set(k,v){if(this.block&&k===registryKey)throw Error('Quota exceeded');return super.set(k,v);}}
    const store=new Limited([['minha-rodagem-v1','money']]);const a=boot(store);await a.api.create('Ana');const original=store.get(registryKey);store.block=true;
    await assert.rejects(a.api.create('Bruno'),/guardar/i);assert.equal(store.get(registryKey),original);assert.equal(store.get('minha-rodagem-v1'),'money');
  });
  await check('renaming updates only the profile metadata and emits its own event',async()=>{
    const a=boot(new Map([['minha-rodagem-v1','money']]));await a.api.renameCurrent('Principal novo');
    assert.equal(a.api.current().name,'Principal novo');assert.equal(a.store.get('minha-rodagem-v1'),'money');
    assert.equal(a.events.filter(e=>e.type==='rodagem:profile-renamed').length,1);
  });
  await check('twenty profiles is the explicit local limit',async()=>{
    const a=boot();for(let i=0;i<19;i++)await a.api.create('Pessoa '+i);
    assert.equal(a.api.list().length,20);await assert.rejects(a.api.create('Limite'),/20/);assert.equal(a.api.list().length,20);
  });
  await check('switch re-reads and pauses a journey resumed by another tab before selection commits',async()=>{
    const store=new Map(),calls=[];
    const locks={request(name,options,fn){calls.push(name);return Promise.resolve().then(fn);}};
    const a=boot(store,locks),person=await a.api.create('Ana');
    const now=Date.now();
    store.set('minha-rodagem-jornada-v2',JSON.stringify({versao:1,id:'resumed-elsewhere',estado:'running',data:new Date(now).toISOString().slice(0,10),iniciadaEm:now-10000,rodandoDesde:now-2000,acumulado:5000}));
    calls.length=0;await a.api.switchTo(person.id);
    const paused=JSON.parse(store.get('minha-rodagem-jornada-v2'));
    assert.equal(paused.estado,'paused');assert.equal(paused.rodandoDesde,null);
    assert.ok(paused.acumulado>=7000&&paused.acumulado<7500);
    assert.deepEqual(calls,[registryKey,'minha-rodagem-jornada-v2']);
    const saved=store.get('minha-rodagem-jornada-v2');const b=boot(store,locks);await b.api.switchTo('principal');
    assert.equal(store.get('minha-rodagem-jornada-v2'),saved,'time does not resume while a profile is inactive');
  });
  await check('corrupt journey or failed pause never switches the active profile or resets the marker',async()=>{
    const a=boot(),p=await a.api.create('Ana');
    a.store.set('minha-rodagem-jornada-v2','{broken');
    await assert.rejects(a.api.switchTo(p.id),/jornada/i);
    assert.equal(a.registry().activeId,'principal');assert.equal(a.store.get('minha-rodagem-jornada-v2'),'{broken');
  });
  console.log('PASS '+passed.length+' local-profile core suites');
})().catch(error=>{console.error(error);process.exitCode=1;});
