// Integrates the real GPS module and engine with simulated browser APIs.
import {parseHTML} from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root = new URL('../',import.meta.url);
const html = await fs.readFile(new URL('index.html',root),'utf8');
const core = await fs.readFile(new URL('gps-core.js',root),'utf8');
const source = await fs.readFile(new URL('tracking.js',root),'utf8');
const flush = async () => { for(let i=0;i<6;i++) await new Promise(r=>setImmediate(r)); };
function boot(store = new Map()) {
  const {document,window:dom} = parseHTML(html);
  const requests = [], timers = new Map(), warnings = [];
  let now = Date.parse('2026-11-13T16:00:00Z'), counter = 0;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  for(const select of document.querySelectorAll('select')) {
    let value=select.querySelector('option')?.getAttribute('value')||'';
    Object.defineProperty(select,'value',{configurable:true,get:()=>value,set:v=>value=String(v)});
  }
  const navigator = {permissions:{query:async()=>({state:'granted'})},geolocation:{getCurrentPosition(success,error,options){requests.push({success,error,options});}}};
  const window = {navigator,addEventListener:dom.addEventListener.bind(dom),dispatchEvent:dom.dispatchEvent.bind(dom)};
  const storage = {getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const context=vm.createContext({window,document,navigator,localStorage:storage,Date:Clock,Intl,console,crypto:{randomUUID},
    setTimeout(fn){const id=++counter;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    aviso:text=>warnings.push(text),confirmar:async()=>true,baixar(){},abrir(id){for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==id;document.dispatchEvent(new dom.CustomEvent('rodagem:route',{detail:{panel:id}}));}});
  vm.runInContext(core,context);vm.runInContext(source,context);
  return {api:window.RodagemGPS,requests,timers,warnings,store,document,navigator,
    journey:{id:randomUUID(),estado:'running'},
    advance(ms){now+=ms;},
    next(){const first=timers.entries().next().value;if(first){timers.delete(first[0]);first[1]();}},
    fix(lat=-23.55,lng=-46.63){const request=requests.shift();assert.ok(request,'GPS request exists');request.success({timestamp:now,coords:{latitude:lat,longitude:lng,accuracy:5,speed:5}});},
    deny(){const request=requests.shift();assert.ok(request);request.error({code:1});},
    event:(name)=>new dom.Event(name,{bubbles:true})};
}
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name);}
await check('automatic restore and explicit start cannot launch competing GPS requests',async()=>{
  const a=boot();a.api.sync(a.journey);await a.api.start(a.journey,{requestPermission:true});await flush();
  assert.equal(a.requests.length,1);assert.equal(a.requests[0].options.enableHighAccuracy,false);assert.equal(a.requests[0].options.maximumAge,0);
});
await check('accepted GPS positions become durable distance while later samples allow economical cache age',async()=>{
  const a=boot();await a.api.start(a.journey,{requestPermission:true});a.advance(1000);a.fix();
  a.advance(15000);a.next();assert.equal(a.requests[0].options.maximumAge,10000);a.fix(-23.549,-46.63);
  assert.ok(a.api.distanceMeters(a.journey.id)>100);assert.ok(a.api.hasTrack(a.journey.id));
  const saved=JSON.parse(a.store.get('minha-rodagem-rota-v1:'+a.journey.id));assert.equal(saved.points.length,2);
});
await check('pausing invalidates pending location and resume starts a fresh segment',async()=>{
  const a=boot();await a.api.start(a.journey,{requestPermission:true});a.advance(1000);a.fix();a.advance(15000);a.next();
  a.api.sync({...a.journey,estado:'paused'});a.fix(-23.50,-46.63);assert.equal(a.api.distanceMeters(a.journey.id),0);
  a.advance(60000);a.api.sync(a.journey);await a.api.start(a.journey,{requestPermission:true});await flush();
  assert.equal(a.requests.length,1);assert.equal(a.requests[0].options.maximumAge,0);a.advance(1000);a.fix(-23.50,-46.63);
  assert.equal(a.api.distanceMeters(a.journey.id),0,'paused displacement is excluded');
});
await check('denied GPS does not cancel the financial journey or schedule retries',async()=>{
  const a=boot();await a.api.start(a.journey,{requestPermission:true});a.deny();
  assert.equal(a.journey.estado,'running');assert.equal(a.timers.size,0);assert.match(a.document.getElementById('jornada-gps-status').textContent,/não autorizada/);
});
await check('corrupt saved route is preserved until explicit deletion',async()=>{
  const a=boot();const key='minha-rodagem-rota-v1:'+a.journey.id;a.store.set(key,'{broken route');
  await a.api.start(a.journey,{requestPermission:true});assert.equal(a.requests.length,0);assert.equal(a.store.get(key),'{broken route');
});
await check('stale route writer preserves the newer stored route and durable distance',async()=>{
  const a=boot();await a.api.start(a.journey,{requestPermission:true});a.advance(1000);a.fix();a.advance(15000);a.next();
  const key='minha-rodagem-rota-v1:'+a.journey.id;const newer=JSON.parse(a.store.get(key));newer.updatedAt+=1;const raw=JSON.stringify(newer);a.store.set(key,raw);
  a.fix(-23.549,-46.63);assert.equal(a.store.get(key),raw);assert.equal(a.api.distanceMeters(a.journey.id),0);assert.ok(a.warnings.some(s=>s.includes('outra aba')));
});
await check('an empty or denied GPS attempt never evicts ten real saved routes',async()=>{
  const seed=boot();await seed.api.start(seed.journey,{requestPermission:true});seed.advance(1000);seed.fix();seed.api.sync({...seed.journey,estado:'paused'});
  const template=JSON.parse(seed.store.get('minha-rodagem-rota-v1:'+seed.journey.id));const store=new Map(),entries=[];
  for(let i=0;i<10;i++){const id='saved-'+i;store.set('minha-rodagem-rota-v1:'+id,JSON.stringify({...template,id}));entries.push({id,updatedAt:template.updatedAt-i,finished:true});}
  store.set('minha-rodagem-rotas-indice-v1',JSON.stringify(entries));
  const a=boot(store);await a.api.start(a.journey,{requestPermission:true});a.deny();
  assert.equal(JSON.parse(store.get('minha-rodagem-rotas-indice-v1')).length,10);
  for(const entry of entries)assert.ok(store.has('minha-rodagem-rota-v1:'+entry.id));
});
await check('a late browser callback can renew its own expired lease without silently losing GPS',async()=>{
  const a=boot();await a.api.start(a.journey,{requestPermission:true});a.advance(50000);a.fix();
  assert.equal(a.api.getSummary(a.journey.id).points,1);assert.equal(a.timers.size,1);
});
console.log('PASS '+passed+' GPS capture integration suites');
