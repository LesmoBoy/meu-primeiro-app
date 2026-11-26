// Real GPS controller and engine; deterministic browser APIs, no live location.
import assert from 'node:assert/strict';
import {bootTracking} from './deep-audit-data-tracking-harness.mjs';
const flush = async () => { for(let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve)); };
const preferenceKey = 'minha-rodagem-gps-preferencias-v1';
const leaseKey = 'minha-rodagem-gps-lease-v1';
const routeKey = id => 'minha-rodagem-rota-v1:' + id;
const passed=[];
async function check(name,fn){await fn();passed.push(name);console.log('PASS',name);}
function setConsent(app,value){const input=app.document.getElementById('gps-usar');input.checked=value;input.dispatchEvent(app.event('change'));}

await check('opting out while Web Lock acquisition is pending cancels before location and lease',async()=>{
 const app=bootTracking();let grant;
 app.navigator.locks={request(name,_options,callback){return new Promise(resolve=>{grant=()=>resolve(callback({name}));});}};
 const starting=app.api.start(app.journey,{requestPermission:true});await flush();assert.equal(typeof grant,'function');
 setConsent(app,false);grant();await starting;await flush();
 assert.equal(JSON.parse(app.store.get(preferenceKey)).enabled,false);
 assert.equal(app.requests.length,0,'revoked consent must not request location');
 assert.equal(app.store.has(leaseKey),false,'revoked attempt must not acquire a capture lease');
 assert.equal(JSON.parse(app.store.get(routeKey(app.journey.id))).enabled,false);
 assert.equal(app.timers.size,0);app.api.suspend();
});

await check('opting out while browser permission lookup is pending never acquires the GPS lock',async()=>{
 const app=bootTracking();let allow,locks=0;
 app.navigator.permissions.query=()=>new Promise(resolve=>{allow=()=>resolve({state:'granted'});});
 app.navigator.locks={request(){locks++;throw Error('No lock should be requested');}};
 const starting=app.api.start(app.journey);await flush();setConsent(app,false);allow();await starting;
 assert.equal(locks,0);assert.equal(app.requests.length,0);assert.equal(app.store.has(leaseKey),false);app.api.suspend();
});

await check('a position received after opting out is ignored and only a fresh opt-in resumes capture',async()=>{
 const app=bootTracking();await app.api.start(app.journey,{requestPermission:true});assert.equal(app.requests.length,1);
 const old=app.requests.shift();setConsent(app,false);const before=app.store.get(routeKey(app.journey.id));
 old.success({timestamp:Date.parse('2026-11-13T16:00:00Z'),coords:{latitude:-23.55,longitude:-46.63,accuracy:5,speed:5}});
 await flush();assert.equal(app.store.get(routeKey(app.journey.id)),before);assert.equal(app.store.has(leaseKey),false);assert.equal(app.timers.size,0);
 setConsent(app,true);await flush();assert.equal(app.requests.length,1,'an explicit new opt-in can start a new request');
 app.fix();assert.equal(app.api.getSummary(app.journey.id).points,1);app.api.suspend();
});

await check('a denied checkbox also prevents direct startup without changing persisted positions',async()=>{
 const app=bootTracking();setConsent(app,false);const before=new Map(app.store);
 await app.api.start(app.journey,{requestPermission:true});assert.equal(app.requests.length,0);assert.deepEqual(app.store,before);app.api.suspend();
});
console.log('GPS_CONSENT_AUDIT_REPORT '+JSON.stringify({passed,errors:[],physicalDevice:false}));
