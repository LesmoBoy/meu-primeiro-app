// DOM simulation: verifies accessible status and concurrency; not visual/real OAuth.
import {parseHTML} from 'linkedom';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=await fs.readFile(new URL('../../session-diagnostics.js',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const session=id=>({user:{id},expires_at:1900000000,access_token:'SYNTHETIC-SECRET'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function boot({configured=true,anchor=true}={}) {
  const {document,window:dom}=parseHTML('<html><body><form id="perfil"></form>'+(anchor?'<section id="conta-cloud"></section>':'')+'</body></html>');
  const calls=[],local=new Map([['synthetic-ledger','{"centavos":123}']]);
  const state={session:session(A),profile:'first',behavior:{},listeners:[],focusCount:0};
  const cloud={configured:()=>configured,
    async getSession(){calls.push('getSession');return state.behavior.getSession?state.behavior.getSession():state.session;},
    async verifySession(uid){calls.push(['verifySession',uid]);return state.behavior.verifySession?state.behavior.verifySession(uid):state.session;},
    onAuth(callback){state.listeners.push(callback);return()=>{};}
  };
  for(const name of ['save','load','call','invoke','signOut','signIn'])cloud[name]=()=>{calls.push(name);throw Error('Unexpected mutation');};
  const window={RodagemCloud:cloud,RodagemProfiles:{current:()=>({id:state.profile}),assertCurrent(){if(state.profile==='stale')throw Error('SYNTHETIC-SECRET');}},getComputedStyle:()=>({visibility:'visible',display:'block'}),
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>{calls.push('local-write');local.set(k,v);},removeItem:k=>local.delete(k)}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-11-26T12:34:56Z']));}}
  vm.runInNewContext(source,{window,document,Date:FixedDate});
  const button=document.getElementById('sessao-verificar'),status=document.getElementById('sessao-diagnostico-status');
  button.focus=()=>{state.focusCount++;};button.getClientRects=()=>[{}];
  Object.defineProperty(document,'activeElement',{value:button,configurable:true,writable:true});
  state.emit=(event,id)=>{state.session=id?session(id):null;for(const callback of state.listeners)callback(event,state.session);};
  return{document,dom,window,api:window.RodagemSessionDiagnostics,button,status,state,calls,local};
}
let passed=0;
async function check(label,fn){await fn();passed++;console.log('PASS',label);}
await check('mount is idempotent, uses existing classes and makes no automatic Auth/financial request',async()=>{
  const b=boot(),before=[...b.local];assert.deepEqual(b.calls,[]);b.api.mount();assert.equal(b.document.querySelectorAll('#sessao-diagnostico').length,1);
  assert.equal(b.document.getElementById('conta-cloud').nextElementSibling.id,'sessao-diagnostico');assert.equal(b.button.type,'button');assert.equal(b.button.textContent,'Verificar sessão no servidor');assert.ok(b.button.classList.contains('secondary'));
  assert.equal(b.status.getAttribute('role'),'status');assert.equal(b.status.getAttribute('aria-live'),'polite');assert.deepEqual([...b.local],before);
});
await check('manual verification pins current UID and shows only safe timestamped confirmation',async()=>{
  const b=boot(),before=[...b.local];assert.equal(await b.api.verify(),true);assert.deepEqual(b.calls,['getSession',['verifySession',A]]);
  assert.match(b.status.textContent,/Sessão confirmada pelo servidor em/);assert.match(b.status.textContent,/26\/11\/2026/);assert.ok(!b.status.textContent.includes(A));assert.ok(!b.document.body.textContent.includes('SYNTHETIC-SECRET'));
  assert.equal(b.button.disabled,false);assert.equal(b.button.getAttribute('aria-busy'),'false');assert.equal(b.state.focusCount,1);assert.deepEqual([...b.local],before);
});
await check('click triggers verification and busy state prevents repeated requests',async()=>{
  const b=boot(),wait=deferred();b.state.behavior.verifySession=()=>wait.promise;b.button.dispatchEvent(new b.dom.Event('click'));await tick();
  assert.equal(b.button.disabled,true);assert.equal(b.button.getAttribute('aria-busy'),'true');assert.equal(await b.api.verify(),false);assert.equal(b.calls.filter(Array.isArray).length,1);
  wait.resolve(session(A));await tick();assert.match(b.status.textContent,/Sessão confirmada/);assert.equal(b.button.disabled,false);
});
await check('unavailable installation stays local and disables verification',async()=>{
  const b=boot({configured:false,anchor:false});assert.equal(b.document.getElementById('perfil').nextElementSibling.id,'sessao-diagnostico');assert.equal(b.button.disabled,true);assert.equal(await b.api.verify(),false);assert.deepEqual(b.calls,[]);
});
await check('missing sessions and unsafe SDK errors show only public messages',async()=>{
  const b=boot();b.state.session=null;assert.equal(await b.api.verify(),false);assert.match(b.status.textContent,/Entre novamente/);assert.equal(b.calls.filter(Array.isArray).length,0);
  b.state.session=session(A);for(const code of ['AUTH_REQUIRED','SESSION_CHANGED','AUTH_PENDING','CONNECTION','untrusted']){b.state.behavior.verifySession=()=>{const e=new Error('<img src=x> SYNTHETIC-SECRET');e.code=code;throw e;};assert.equal(await b.api.verify(),false);assert.ok(!/SYNTHETIC|img/.test(b.status.textContent));assert.equal(b.status.querySelector('img'),null);}
});
await check('account replacement during verification discards success and permits a new check',async()=>{
  const b=boot(),wait=deferred();b.state.emit('SIGNED_IN',A);b.state.behavior.verifySession=()=>wait.promise;const pending=b.api.verify();await tick();b.state.emit('SIGNED_IN',B);wait.resolve(session(A));assert.equal(await pending,false);
  assert.ok(!b.status.textContent.includes('Sessão confirmada'));assert.match(b.status.textContent,/conta ou o perfil mudou/);assert.equal(b.state.focusCount,0);
  delete b.state.behavior.verifySession;assert.equal(await b.api.verify(),true);assert.deepEqual(b.calls.at(-1),['verifySession',B]);
});
await check('same-account token renewal can complete authoritative verification',async()=>{
  const b=boot();b.state.emit('SIGNED_IN',A);b.state.behavior.getSession=()=>{b.state.emit('TOKEN_REFRESHED',A);return b.state.session;};assert.equal(await b.api.verify(),true);
});
await check('logout while server verification waits invalidates its late response',async()=>{
  const b=boot(),wait=deferred();b.state.emit('SIGNED_IN',A);b.state.behavior.verifySession=()=>wait.promise;const pending=b.api.verify();await tick();b.state.emit('SIGNED_OUT',null);wait.resolve(session(A));assert.equal(await pending,false);assert.ok(!b.status.textContent.includes('Sessão confirmada'));assert.equal(b.state.focusCount,0);
});
await check('profile transitions and cross-tab stale notifications disable late verification',async()=>{
  for(const event of ['rodagem:profile-will-change','rodagem:profile-stale']){const b=boot(),wait=deferred();b.state.behavior.verifySession=()=>wait.promise;const pending=b.api.verify();await tick();b.document.dispatchEvent(new b.dom.Event(event));wait.resolve(session(A));assert.equal(await pending,false);assert.equal(b.button.disabled,true);assert.match(b.status.textContent,/Recarregue/);assert.equal(await b.api.verify(),false);assert.equal(b.state.focusCount,0);}
});
await check('a changed profile without an event and a mismatched helper response fail closed',async()=>{
  const b=boot(),wait=deferred();b.state.behavior.verifySession=()=>wait.promise;const pending=b.api.verify();await tick();b.state.profile='other';wait.resolve(session(A));assert.equal(await pending,false);assert.ok(!b.status.textContent.includes('Sessão confirmada'));
  const c=boot();c.state.behavior.verifySession=()=>session(B);assert.equal(await c.api.verify(),false);assert.match(c.status.textContent,/conta ou o perfil mudou/);
});
await check('hidden or disabled previous focus is not restored after completion',async()=>{
  for(const hidden of [true,false]){const b=boot(),wait=deferred();const previous=b.document.createElement('button');b.document.body.append(previous);previous.focus=()=>{b.state.focusCount++;};b.document.activeElement=previous;b.state.behavior.verifySession=()=>wait.promise;const pending=b.api.verify();await tick();previous.hidden=hidden;previous.disabled=!hidden;wait.resolve(session(A));await pending;assert.equal(b.state.focusCount,0);}
  // The captured control is removed while the request is pending.
  const b=boot(),wait=deferred();b.state.behavior.verifySession=()=>wait.promise;const pending=b.api.verify();await tick();b.button.remove();wait.resolve(session(A));await pending;assert.equal(b.state.focusCount,0);
});
console.log(`PASS ${passed} v3.2.3 session diagnostics DOM suites (simulation; no real OAuth/browser rendering)`);
