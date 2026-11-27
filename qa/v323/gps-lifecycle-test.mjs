// Real controller/engine, synthetic fixes and browser lifecycle. No physical GPS.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {bootTracking} from '../deep-audit-data-tracking-harness.mjs';
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
const passed=[];
const key=a=>'minha-rodagem-rota-v1:'+a.journey.id;
const track=a=>JSON.parse(a.store.get(key(a)));
async function check(name,fn){await fn();passed.push(name);console.log('PASS',name);}
const position=(timestamp,accuracy=5)=>({timestamp,coords:{latitude:-23.55,longitude:-46.62,accuracy,speed:5}});
const start=Date.parse('2026-11-13T16:00:00Z');

await check('stalled request after Android-like suspension resumes and ignores its late callback',async()=>{
 const a=bootTracking();await a.api.start(a.journey,{requestPermission:true});a.fix();
 a.advance(15000);a.next();const late=a.requests.shift();a.advance(30000);
 a.document.dispatchEvent(a.event('visibilitychange'));await flush();assert.equal(a.requests.length,1);
 const before=a.store.get(key(a));late.success(position(start+45000));
 assert.equal(a.store.get(key(a)),before);a.fix(-23.55,-46.60);
 assert.equal(track(a).totalMeters,0);assert.equal(track(a).points.at(-1).break,true);a.api.suspend();
});
await check('recent pending request is not duplicated by repeated foreground events',async()=>{
 const a=bootTracking();await a.api.start(a.journey,{requestPermission:true});
 for(let i=0;i<4;i++)a.document.dispatchEvent(a.event('visibilitychange'));
 await flush();assert.equal(a.requests.length,1);a.api.suspend();
});
await check('browser permission revocation cancels the lease and all pending callbacks',async()=>{
 const a=bootTracking();const permission={state:'granted'};a.navigator.permissions.query=async()=>permission;
 await a.api.start(a.journey,{requestPermission:true});await flush();const late=a.requests.shift();
 permission.state='denied';permission.onchange();const before=a.store.get(key(a));
 late.success(position(start));await flush();assert.equal(a.store.get(key(a)),before);
 assert.equal(a.timers.size,0);assert.equal(a.store.has('minha-rodagem-gps-lease-v1'),false);
 permission.state='granted';permission.onchange();await flush();assert.equal(a.requests.length,0);
 a.api.suspend();
});
await check('denied callback does not retry or silently restart when foregrounded',async()=>{
 const a=bootTracking();await a.api.start(a.journey,{requestPermission:true});a.deny();
 a.advance(120000);a.document.dispatchEvent(a.event('visibilitychange'));await flush();
 assert.equal(a.requests.length,0);assert.equal(a.timers.size,0);assert.equal(track(a).points.length,0);a.api.suspend();
});
await check('inaccurate fixes do not add distance and long signal loss breaks the route',async()=>{
 const a=bootTracking();await a.api.start(a.journey,{requestPermission:true});a.fix();
 a.advance(15000);a.next();a.requests.shift().success(position(start+15000,500));
 assert.equal(track(a).totalMeters,0);assert.equal(track(a).points.length,1);
 a.advance(100000);a.next();a.fix(-23.55,-46.60);
 assert.equal(track(a).totalMeters,0);assert.equal(track(a).points.at(-1).break,true);assert.equal(track(a).gaps,1);a.api.suspend();
});
await check('synchronous browser failure preserves route and releases capture',async()=>{
 const a=bootTracking();a.navigator.geolocation.getCurrentPosition=()=>{throw Error('unavailable');};
 await a.api.start(a.journey,{requestPermission:true});assert.equal(a.timers.size,0);
 assert.equal(track(a).points.length,0);assert.equal(a.store.has('minha-rodagem-gps-lease-v1'),false);a.api.suspend();
});
await check('economic mode keeps coarse sampling and bounded geolocation timeout',async()=>{
 const a=bootTracking();await a.api.start(a.journey,{requestPermission:true});
 assert.deepEqual(JSON.parse(JSON.stringify(a.requests[0].options)),{enableHighAccuracy:false,maximumAge:0,timeout:20000});
 a.fix();assert.equal(a.timers.size,1);a.api.suspend();
});
const report={classification:'local-simulated-browser-lifecycle',passed,errors:[],physicalDevice:false,batteryMeasured:false};
await fs.writeFile(new URL('./gps-lifecycle-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('GPS_LIFECYCLE_REPORT '+JSON.stringify(report));
