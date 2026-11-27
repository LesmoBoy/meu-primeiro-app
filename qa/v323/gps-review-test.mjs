// Independent focused review: real GPS controller/engine, simulated permission lifecycle.
// No physical device, live coordinates, browser rendering or battery claims.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {bootTracking} from '../deep-audit-data-tracking-harness.mjs';
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const route=a=>'minha-rodagem-rota-v1:'+a.journey.id;
const start=Date.parse('2026-11-13T16:00:00Z');
const position=()=>({timestamp:start,coords:{latitude:-23.55,longitude:-46.63,accuracy:5,speed:5}});
const report={classification:'automated-local-simulated-permission-review',physicalDevice:false,batteryMeasured:false,passed:[],failures:[]};
async function check(name,run){try{await run();report.passed.push(name);console.log('PASS',name);}catch(error){report.failures.push({name,message:error.message});console.error('FAIL',name,error.message);}}

await check('removing a granted permission back to prompt invalidates a queued callback',async()=>{
 const a=bootTracking(),permission={state:'granted'};
 a.navigator.permissions.query=async()=>permission;
 await a.api.start(a.journey,{requestPermission:true});await flush();
 const queued=a.requests.shift();assert.ok(queued);permission.state='prompt';permission.onchange();
 const saved=a.store.get(route(a));queued.success(position());await flush();
 assert.equal(a.store.get(route(a)),saved,'revoked permission must invalidate queued position callbacks');
 assert.equal(a.store.has('minha-rodagem-gps-lease-v1'),false,'revocation releases the capture lease');
 assert.equal(a.timers.size,0);a.api.suspend();
});
await check('initial prompt still allows an explicitly requested location permission',async()=>{
 const a=bootTracking(),permission={state:'prompt'};
 a.navigator.permissions.query=async()=>permission;
 await a.api.start(a.journey,{requestPermission:true});await flush();assert.equal(a.requests.length,1);
 permission.state='granted';permission.onchange();a.fix();
 assert.equal(JSON.parse(a.store.get(route(a))).points.length,1);a.api.suspend();
});
await check('revocation while acquiring a Web Lock cancels without a position request',async()=>{
 const a=bootTracking(),permission={state:'granted'};let grant;
 a.navigator.permissions.query=async()=>permission;
 a.navigator.locks={request(name,_options,callback){return new Promise(resolve=>{grant=()=>resolve(callback({name}));});}};
 const running=a.api.start(a.journey,{requestPermission:true});await flush();assert.equal(typeof grant,'function');
 permission.state='prompt';permission.onchange();grant();await running;await flush();
 assert.equal(a.requests.length,0);assert.equal(a.store.has('minha-rodagem-gps-lease-v1'),false);a.api.suspend();
});
await check('permission granted again does not silently resume a revoked capture',async()=>{
 const a=bootTracking(),permission={state:'granted'};
 a.navigator.permissions.query=async()=>permission;
 await a.api.start(a.journey,{requestPermission:true});await flush();a.fix();
 permission.state='prompt';permission.onchange();permission.state='granted';permission.onchange();await flush();
 assert.equal(a.requests.length,0);assert.equal(a.timers.size,0);a.api.suspend();
});
await fs.writeFile(new URL('./gps-review-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed.length,failed:report.failures.length}));
process.exitCode=report.failures.length?1:0;
