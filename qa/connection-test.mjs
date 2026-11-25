import {boot,flush} from './harness.mjs';
import assert from 'node:assert/strict';

const a = boot();
a.context.AbortController = AbortController;
a.context.setTimeout = setTimeout;
a.context.clearTimeout = clearTimeout;
const run = () => a.evaluate('atualizarConexaoRodagem()');
const label = () => a.get('conexao').textContent;
let calls = 0;

a.context.fetch = async () => {calls++;return {status:200};};
a.window.navigator.onLine = false;
await run();
assert.equal(label(),'Sem internet');assert.equal(calls,0);
console.log('PASS native offline updates immediately without a request');

a.window.navigator.onLine = true;
a.context.fetch = async () => {throw Error('No network despite native online');};
await run();assert.equal(label(),'Sem internet');
console.log('PASS failed real probe overrides a misleading native online value');

let request;
a.context.fetch = async (url,options) => {request={url,options};return {status:503};};
await run();assert.equal(label(),'Online');
assert.equal(request.url,'./sw.js');assert.equal(request.options.method,'HEAD');
assert.equal(request.options.cache,'no-store');assert.ok(request.options.signal);
console.log('PASS a received HTTP response proves reachability, including HTTP errors');

let resolveOld;
a.context.fetch = () => new Promise(resolve => {resolveOld=resolve;});
const older=run();
a.window.navigator.onLine=false;
a.window.dispatchEvent(new a.window.Event('offline'));
assert.equal(label(),'Sem internet');
resolveOld({status:200});await older;
assert.equal(label(),'Sem internet');
console.log('PASS an old successful probe cannot reverse a newer offline event');

a.window.navigator.onLine=true;
let expire;
a.context.setTimeout = fn => {expire=fn;return 1;};
a.context.clearTimeout = () => {};
a.context.fetch = (_url,{signal}) => new Promise((_resolve,reject) => signal.addEventListener('abort',() => reject(Error('timeout'))));
const pending=run();expire();await pending;
assert.equal(label(),'Sem internet');
console.log('PASS a stalled network probe aborts and reports offline');

calls=0;
a.context.fetch = async () => {calls++;return {status:200};};
a.document.dispatchEvent(new a.window.Event('visibilitychange'));
await flush();assert.equal(calls,1);assert.equal(label(),'Online');
console.log('PASS returning to the app verifies connection once');
console.log('PASS 6 connection indicator regression suites');
