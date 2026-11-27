// Simulated Cache Storage, network and timers; no real-browser offline claim.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),scope='https://example.test/meu-primeiro-app/';
const prefix='rodagem-cache:'+scope+':',current=prefix+'3.2.3';
const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
function boot({missingInstallFile=null}={}){
 const events={},stores=new Map(),timers=new Map();let nextTimer=0,skipped=false,claimed=false,mode='offline',requests=0;
 const urlOf=input=>new URL(typeof input==='string'?input:input.url,scope).href;
 const caches={async keys(){return [...stores.keys()]},async delete(key){return stores.delete(key)},async open(key){
  if(!stores.has(key))stores.set(key,new Map());const items=stores.get(key);return {
   async addAll(list){const pending=[];for(const request of list){const name=new URL(request.url).pathname.slice('/meu-primeiro-app/'.length);if(name===missingInstallFile)throw new TypeError('Failed precache response');pending.push([request.url,new Response(fs.readFileSync(path.join(root,name)))]);}for(const [url,response]of pending)items.set(url,response)},
   async match(request){return items.get(urlOf(request))?.clone()},async keys(){return [...items.keys()].map(url=>new Request(url))},async delete(request){return items.delete(urlOf(request))}
  };
 }};
 class ScopedRequest extends Request{constructor(input,options){super(new URL(input,scope),options)}}
 const fetch=async(_request,{signal}={})=>{requests++;if(mode==='offline')throw new TypeError('Simulated offline');if(mode==='hang')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted by timeout')),{once:true}));if(typeof mode==='number')return new Response('HTTP '+mode,{status:mode});return new Response('Successful network content',{status:200})};
 const context=vm.createContext({caches,Request:ScopedRequest,Response,URL,AbortController,fetch,setTimeout(callback,delay){assert.equal(delay,5000);timers.set(++nextTimer,callback);return nextTimer},clearTimeout(id){timers.delete(id)},self:{registration:{scope},addEventListener:(type,handler)=>events[type]=handler,skipWaiting:async()=>{skipped=true},clients:{claim:async()=>{claimed=true}}}});
 vm.runInContext(source,context,{filename:'sw.js'});
 async function lifecycle(type){let work;events[type]({waitUntil(p){work=p}});await work}
 function request(url,{mode='cors',method='GET'}={}){let response;events.fetch({request:{url,mode,method},respondWith(p){response=p}});return response||Promise.resolve(null)}
 return {stores,timers,lifecycle,request,network(value){mode=value},expire(){for(const callback of [...timers.values()])callback()},skipped:()=>skipped,claimed:()=>claimed,requests:()=>requests};
}
let passed=0;async function check(name,test){await test();passed++;console.log('PASS',name)}
(async()=>{
 const app=boot();
 await check('complete forty-two-file install before skipWaiting',async()=>{
  await app.lifecycle('install');assert.ok(app.skipped());assert.equal(app.stores.get(current).size,42);
  for(const[url,response]of app.stores.get(current)){const name=new URL(url).pathname.slice('/meu-primeiro-app/'.length);assert.equal((await response.clone().arrayBuffer()).byteLength,fs.statSync(path.join(root,name)).size,name)}
 });
 await check('scope-safe upgrade preserves sibling scoped and legacy files',async()=>{
  app.stores.set(prefix+'2.0.0',new Map());const sibling='rodagem-cache:https://example.test/another-app/:2.0.0';app.stores.set(sibling,new Map());app.stores.set('another-app',new Map());
  app.stores.set('minha-rodagem-1.6.0',new Map([[scope+'index.html',new Response('legacy this scope')],['https://example.test/another-app/index.html',new Response('legacy sibling')]]));
  app.stores.set('minha-rodagem-2.0.0',new Map([[scope+'app.js',new Response('only this scope')]]));
  await app.lifecycle('activate');assert.ok(app.claimed());assert.ok(!app.stores.has(prefix+'2.0.0'));assert.ok(app.stores.has(current));assert.ok(app.stores.has(sibling));assert.ok(app.stores.has('another-app'));assert.equal(app.stores.get('minha-rodagem-1.6.0').size,1);assert.ok(app.stores.get('minha-rodagem-1.6.0').has('https://example.test/another-app/index.html'));assert.ok(!app.stores.has('minha-rodagem-2.0.0'));
 });
 await check('successful network response takes precedence',async()=>{app.network('success');const response=await app.request(scope,{mode:'navigate'});assert.equal(response.status,200);assert.equal(await response.text(),'Successful network content');assert.equal(app.timers.size,0)});
 await check('404 and 503 recover cached navigation and assets',async()=>{
  for(const status of [404,503]){app.network(status);const page=await app.request(scope,{mode:'navigate'});assert.equal(page.status,200);assert.ok((await page.text()).includes('experience.js'));const script=await app.request(scope+'app.js');assert.equal(script.status,200);assert.equal((await script.arrayBuffer()).byteLength,fs.statSync(path.join(root,'app.js')).size);assert.equal(app.timers.size,0)}
 });
 await check('offline root, index and query routes load cached shell',async()=>{
  app.network('offline');for(const url of [scope,scope+'index.html',scope+'?v=3.2.3',scope+'index.html?from=home']){const response=await app.request(url,{mode:'navigate'});assert.equal(response.status,200,url);assert.ok((await response.text()).includes('experience.js'))}
 });
 await check('offline dependency bytes remain complete with query parameters',async()=>{
  for(const name of ['privacidade.html','exclusao-dados.html','transport-art.css','assets/transportes.webp','business-core.js','business-client.js','business-ui.js','business.css','billing-config.js','billing.js','fleet.css','cloud.css','cloud-config.js','google-identity.js','cloud-client.js','cloud-sync.js','backup-budget.js','session-diagnostics.js','device-data.js','vendor/supabase/supabase.js','vehicle-catalog.js','styles.css','enhancements.css','profiles.css','profiles-core.js','profiles-ui.js','app.js','gps-core.js','tracking.js','experience.js','interactions.js','vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css','assets/inicio.svg','assets/fechamento.svg','assets/consumo.svg','assets/historico.svg','assets/ajustes.svg','manifest.webmanifest','icon-192.png','icon-512.png']){const response=await app.request(scope+name+'?v=refined');assert.equal(response.status,200,name);assert.equal((await response.arrayBuffer()).byteLength,fs.statSync(path.join(root,name)).size,name)}
 });
 await check('hanging network aborts and falls back after deadline',async()=>{
  app.network('hang');const pending=app.request(scope,{mode:'navigate'});assert.equal(app.timers.size,1);app.expire();const response=await pending;assert.equal(response.status,200);assert.ok((await response.text()).includes('experience.js'));assert.equal(app.timers.size,0)
 });
 await check('cross-origin, sibling, unrelated requests and writes untouched',async()=>{
  const before=app.requests();assert.equal(await app.request('https://other.test/app.js'),null);assert.equal(await app.request('https://example.test/another-app/index.html',{mode:'navigate'}),null);assert.equal(await app.request(scope+'private.json'),null);assert.equal(await app.request(scope+'index.html',{method:'POST'}),null);assert.equal(app.requests(),before)
 });
 await check('missing asset gets informative offline503 or original online404',async()=>{
  app.stores.get(current).delete(scope+'styles.css');app.network('offline');const unavailable=await app.request(scope+'styles.css');assert.equal(unavailable.status,503);assert.ok((await unavailable.text()).includes('internet'));app.network(404);const missing=await app.request(scope+'styles.css');assert.equal(missing.status,404);assert.equal(await missing.text(),'HTTP 404')
 });
 await check('incomplete install rejects without replacing working cache',async()=>{
  const broken=boot({missingInstallFile:'experience.js'}),oldKey=prefix+'2.0.0';broken.stores.set(oldKey,new Map([[scope+'index.html',new Response('working old version')]]));await assert.rejects(broken.lifecycle('install'),/Failed precache/);assert.equal(broken.skipped(),false);assert.equal(broken.claimed(),false);assert.ok(broken.stores.has(oldKey))
 });
 console.log('PASS '+passed+' service-worker simulation suites');
})().catch(error=>{console.error(error);process.exitCode=1});
