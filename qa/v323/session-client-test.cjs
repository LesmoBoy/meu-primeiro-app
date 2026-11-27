// Simulated Auth boundary plus real pinned-SDK retry probe with synthetic fetch.
// No real account, network or ledger.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../../cloud-client.js'),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const user=id=>({id,email:'synthetic@example.test',user_metadata:{name:'Homologação',token:'SYNTHETIC-SECRET'},app_metadata:{provider:'google',providers:['google'],private:'SYNTHETIC-SECRET'}});
const session=(id=A,expires_at=Math.floor(Date.now()/1000)+3600)=>({user:user(id),expires_at,access_token:'SYNTHETIC-ACCESS',refresh_token:'SYNTHETIC-REFRESH'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
const credential=()=>{const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return encode({alg:'RS256'})+'.'+encode({synthetic:true})+'.signature';};
function googleMode(b) {
  Object.assign(b.window.RodagemCloudConfig,{googleAuthMode:'id_token',googleClientId:'123456789012-syntheticclient.apps.googleusercontent.com'});
  b.window.RodagemGoogleIdentity={requestCredential:async()=>credential()};
}
const reject=(promise,code)=>assert.rejects(promise,e=>e.code===code&&!/SYNTHETIC-(SECRET|ACCESS|REFRESH)/.test(e.message));
const row={revision:1,payload:{synthetic:true},updated_at:'2026-11-26T12:00:00Z'};
function boot() {
  const calls=[],listeners=new Set(),local=new Map([['synthetic-ledger','{"centavos":123}'],['synthetic-profile','homologacao']]);
  const state={session:session(),profile:'first',behavior:{}};
  const operation=async(name,args,otherwise)=>{calls.push({name,args});return state.behavior[name]?state.behavior[name](args):otherwise();};
  const sdk={auth:{
    getSession:()=>operation('getSession',null,()=>({data:{session:state.session},error:null})),
    getUser:()=>operation('getUser',null,()=>({data:{user:state.session?.user},error:null})),
    refreshSession:()=>operation('refreshSession',null,()=>{state.session=session(state.session.user.id);return{data:{session:state.session},error:null};}),
    signOut:args=>operation('signOut',args,()=>{state.session=null;state.emit('SIGNED_OUT');return{error:null};}),
    signInWithOAuth:args=>operation('signIn',args,()=>({error:null})),
    signInWithIdToken:args=>operation('idToken',args,()=>({error:null})),
    onAuthStateChange(fn){listeners.add(fn);return{data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}
  },rpc:(name,args)=>operation('rpc',{name,args},()=>({data:row,error:null})),functions:{invoke:(name,args)=>operation('invoke',{name,args},()=>({data:{synthetic:true},error:null}))}};
  state.emit=(event)=>{for(const fn of listeners)fn(event,state.session);};
  state.replace=id=>{state.session=id?session(id):null;state.emit(id?'SIGNED_IN':'SIGNED_OUT');};
  const window={location:{href:'https://example.test/app/'},RodagemCloudConfig:{url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrstuvwx',providers:['google']},
    supabase:{createClient:(_url,_key,options)=>{calls.push({name:'createClient',args:{options}});return sdk;}},fetch(){throw Error('Unexpected network');},
    crypto:webcrypto,TextEncoder,atob:value=>Buffer.from(value,'base64').toString('binary'),
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k),clear:()=>local.clear()},
    RodagemProfiles:{current:()=>({id:state.profile}),assertCurrent(){if(state.profile==='stale')throw Error('Synthetic stale profile');}}};
  vm.runInNewContext(source,{window,URL,Date,AbortController,queueMicrotask,setTimeout,clearTimeout});
  return{api:window.RodagemCloud,state,calls,local,window};
}
let count=0;
async function check(label,fn){await fn();count++;console.log('PASS',label);}
(async()=>{
  await check('client disables automatic PostgREST retries for compare-and-swap operations',async()=>{
    const b=boot();await b.api.getSession();const options=b.calls.find(x=>x.name==='createClient').args.options;
    assert.equal(options.db.retry,false);assert.equal(options.auth.autoRefreshToken,true);
  });
  await check('the pinned real SDK makes one fetch for a synthetic HTTP-409 with the configured retry policy',async()=>{
    const b=boot();await b.api.getSession();const options=b.calls.find(x=>x.name==='createClient').args.options;
    const context={URL,Headers,Request,Response,AbortController,TextEncoder,TextDecoder,WebSocket:globalThis.WebSocket,
      setTimeout(fn){queueMicrotask(fn);return 1;},clearTimeout(){},setInterval,clearInterval,
      fetch:globalThis.fetch,console:{warn(){},log(){},error(){}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../vendor/supabase/supabase.js'),'utf8'),context);
    let requests=0;
    const sdk=context.supabase.createClient('https://retry-proof.supabase.co','sb_publishable_synthetic_fixture_key',{accessToken:async()=> 'synthetic-access',db:options.db,
      global:{fetch:async()=>{requests++;return new Response(JSON.stringify({code:'PT409',message:'synthetic conflict',details:null,hint:null}),{status:409,headers:{'Content-Type':'application/json'}});}}});
    const result=await sdk.rpc('synthetic_conflict',{expected_revision:1});
    assert.equal(requests,1);assert.equal(result.status,409);assert.equal(result.error.code,'PT409');
    assert.equal(Object.hasOwn(result.error,'status'),false);
  });
  await check('personal and business logical conflicts map PT409 without HTTP status and keep legacy 40001',async()=>{
    for(const code of ['PT409','40001'])for(const kind of ['personal','business']){
      const b=boot(),before=[...b.local];b.state.behavior.rpc=()=>({data:null,error:{code,message:'SYNTHETIC-SECRET'}});
      await reject(kind==='personal'?b.api.save(1,{synthetic:true},A):b.api.call('business_save_entity',{},A),'CONFLICT');
      assert.deepEqual([...b.local],before);assert.equal(b.calls.filter(x=>x.name==='rpc').length,1);
    }
  });
  await check('server metadata replaces cached metadata and public session contains no credentials',async()=>{
    const b=boot();b.state.behavior.getUser=()=>({data:{user:{...user(A),email:'server@example.test'}},error:null});
    const result=await b.api.verifySession(A);assert.equal(result.user.email,'server@example.test');
    assert.equal(b.calls.filter(x=>x.name==='getUser').length,1);assert.equal(b.calls.filter(x=>x.name==='getSession').length,2);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC-'));assert.equal(Object.hasOwn(result,'access_token'),false);
  });
  await check('cached session alone never authorizes and malformed server identity fails closed',async()=>{
    for(const server of [null,{id:'not-a-uuid'}]){const b=boot();b.state.behavior.getUser=()=>({data:{user:server},error:null});await reject(b.api.verifySession(A),'AUTH_REQUIRED');assert.equal(b.calls.some(x=>x.name==='rpc'),false);}
    const b=boot();b.state.behavior.getUser=()=>({data:{user:user(B)},error:null});await reject(b.api.verifySession(A),'SESSION_CHANGED');
  });
  await check('a changed account in the SDK readback rejects a completed getUser',async()=>{
    const b=boot(),wait=deferred();b.state.behavior.getUser=()=>wait.promise;
    const pending=b.api.verifySession(A);await tick();b.state.session=session(B);wait.resolve({data:{user:user(A)},error:null});await reject(pending,'SESSION_CHANGED');
  });
  await check('observed A to B to A changes invalidate an in-flight verification',async()=>{
    const b=boot(),wait=deferred();b.api.onAuth(()=>{});await b.api.getSession();b.state.behavior.getUser=()=>wait.promise;
    const pending=b.api.verifySession(A);await tick();b.state.replace(B);b.state.replace(A);wait.resolve({data:{user:user(A)},error:null});await reject(pending,'SESSION_CHANGED');
  });
  await check('profile changes during server verification reject without disclosing the response',async()=>{
    const b=boot(),wait=deferred();b.state.behavior.getUser=()=>wait.promise;const pending=b.api.verifySession(A);await tick();b.state.profile='other';wait.resolve({data:{user:user(A)},error:null});await reject(pending,'SESSION_CHANGED');
  });
  await check('SDK auto-refresh on expired cache is followed by authoritative verification',async()=>{
    const b=boot();b.state.session=session(A,1);let renewed=false;
    b.state.behavior.getSession=()=>{if(b.state.session.expires_at===1){b.state.session=session(A);renewed=true;}return{data:{session:b.state.session},error:null};};
    const result=await b.api.verifySession(A);assert.ok(renewed);assert.ok(result.expires_at>Date.now()/1000);assert.equal(b.calls.filter(x=>x.name==='getUser').length,1);
  });
  await check('an SDK that leaves the token expired cannot produce verification success',async()=>{
    const b=boot();b.state.session=session(A,1);await reject(b.api.verifySession(A),'AUTH_REQUIRED');
  });
  await check('automatic refresh failures and revoked server sessions are sanitized',async()=>{
    for(const method of ['getSession','getUser']){const b=boot();b.state.behavior[method]=()=>({data:{},error:{code:'refresh_token_not_found',message:'SYNTHETIC-REFRESH'}});await reject(b.api.verifySession(A),'AUTH_REQUIRED');}
    const b=boot();b.state.behavior.getUser=()=>{throw Error('SYNTHETIC-SECRET network');};await reject(b.api.verifySession(A),'CONNECTION');
  });
  await check('manual refresh re-verifies the same UID and never returns SDK credentials',async()=>{
    const b=boot();const result=await b.api.refreshSession(A);assert.equal(result.user.id,A);assert.equal(b.calls.filter(x=>x.name==='refreshSession').length,1);assert.equal(b.calls.filter(x=>x.name==='getUser').length,1);assert.ok(!JSON.stringify(result).includes('SYNTHETIC-'));
    await reject(b.api.refreshSession(B),'SESSION_CHANGED');assert.equal(b.calls.filter(x=>x.name==='refreshSession').length,1);
  });
  await check('parallel refresh is rejected and a failed refresh releases its busy lock',async()=>{
    const b=boot(),wait=deferred();b.state.behavior.refreshSession=()=>wait.promise;const pending=b.api.refreshSession(A);await tick();await reject(b.api.refreshSession(A),'AUTH_PENDING');
    wait.resolve({data:{},error:{code:'refresh_token_already_used',message:'SYNTHETIC-SECRET'}});await reject(pending,'AUTH_REQUIRED');delete b.state.behavior.refreshSession;assert.equal((await b.api.refreshSession(A)).user.id,A);
  });
  await check('manual refresh rejects replacement accounts and safe network errors',async()=>{
    const b=boot();b.state.behavior.refreshSession=()=>{b.state.session=session(B);return{data:{session:b.state.session},error:null};};await reject(b.api.refreshSession(A),'SESSION_CHANGED');
    const c=boot();c.state.behavior.refreshSession=()=>{throw Error('SYNTHETIC-REFRESH');};await reject(c.api.refreshSession(A),'CONNECTION');
  });
  await check('logout intent cancels pending verification even when logout itself fails',async()=>{
    const b=boot(),wait=deferred();b.state.behavior.getUser=()=>wait.promise;b.state.behavior.signOut=()=>({error:{message:'SYNTHETIC-SECRET'}});
    const pending=b.api.verifySession(A);await tick();await reject(b.api.signOut(),'CONNECTION');wait.resolve({data:{user:user(A)},error:null});await reject(pending,'SESSION_CHANGED');
    assert.equal(JSON.stringify(b.calls.find(x=>x.name==='signOut').args),JSON.stringify({scope:'local'}));
  });
  await check('logout during SDK session read cannot silently authorize a later server read',async()=>{
    const b=boot(),wait=deferred();b.state.behavior.getSession=()=>wait.promise;const pending=b.api.verifySession(A);await tick();await b.api.signOut();wait.resolve({data:{session:session(A)},error:null});await reject(pending,'SESSION_CHANGED');assert.equal(b.calls.some(x=>x.name==='getUser'),false);
  });
  await check('logout affects only this session and preserves all local synthetic data',async()=>{
    for(const fail of [false,true]){const b=boot(),before=[...b.local];if(fail)b.state.behavior.signOut=()=>({error:{status:503}});if(fail)await reject(b.api.signOut(),'CONNECTION');else{await b.api.signOut();assert.equal(await b.api.getSession(),null);}assert.deepEqual([...b.local],before);assert.equal(JSON.stringify(b.calls.find(x=>x.name==='signOut').args),JSON.stringify({scope:'local'}));}
  });
  await check('logout cancels a pending Google credential before any ID-token exchange',async()=>{
    const b=boot(),wait=deferred();let requested=false;
    Object.assign(b.window.RodagemCloudConfig,{googleAuthMode:'id_token',googleClientId:'123456789012-syntheticclient.apps.googleusercontent.com'});
    b.window.RodagemGoogleIdentity={requestCredential(){requested=true;return wait.promise;}};
    const pending=b.api.signIn('google');while(!requested)await tick();await b.api.signOut();
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');wait.resolve(encode({alg:'RS256'})+'.'+encode({synthetic:true})+'.signature');
    await reject(pending,'SESSION_CHANGED');assert.equal(b.calls.some(x=>x.name==='idToken'),false);
  });
  await check('logout waits for an already-sent Google exchange and prevents late reauthentication',async()=>{
    const b=boot(),wait=deferred();googleMode(b);const before=[...b.local];
    b.state.behavior.idToken=async()=>{await wait.promise;b.state.replace(A);return{data:{user:b.state.session.user,session:b.state.session},error:null};};
    const pending=b.api.signIn('google');const rejected=reject(pending,'SESSION_CHANGED');
    while(!b.calls.some(x=>x.name==='idToken'))await tick();
    let finished=false;const out=b.api.signOut().then(()=>{finished=true;});await tick();
    assert.equal(finished,false);assert.equal(b.calls.some(x=>x.name==='signOut'),false);
    wait.resolve();await Promise.all([out,rejected]);assert.equal(await b.api.getSession(),null);
    assert.equal(b.calls.filter(x=>x.name==='signOut').length,1);assert.deepEqual([...b.local],before);
  });
  await check('pending logout blocks new sign-ins, refreshes and authoritative operations without extra SDK mutation',async()=>{
    const b=boot(),wait=deferred();googleMode(b);
    b.state.behavior.idToken=async()=>{await wait.promise;return{data:{user:user(A),session:session(A)},error:null};};
    const pending=b.api.signIn('google');const rejected=reject(pending,'SESSION_CHANGED');
    while(!b.calls.some(x=>x.name==='idToken'))await tick();const out=b.api.signOut();await tick();
    for(const next of [()=>b.api.signIn('google'),()=>b.api.refreshSession(A),()=>b.api.verifySession(A),()=>b.api.load(A),()=>b.api.call('business_list_companies',{},A)])await reject(next(),'AUTH_PENDING');
    const outAgain=b.api.signOut();wait.resolve();await Promise.all([out,outAgain,rejected]);
    assert.equal(b.calls.filter(x=>x.name==='signOut').length,1);assert.equal(b.calls.filter(x=>x.name==='idToken').length,1);assert.equal(b.calls.some(x=>x.name==='refreshSession'||x.name==='rpc'),false);
  });
  await check('logout completes after a failed exchange and releases its pending guard',async()=>{
    const b=boot(),wait=deferred();googleMode(b);b.state.behavior.idToken=()=>wait.promise;
    const pending=b.api.signIn('google');const rejected=reject(pending,'CONNECTION');
    while(!b.calls.some(x=>x.name==='idToken'))await tick();const out=b.api.signOut();
    wait.resolve({data:{session:null,user:null},error:{message:'SYNTHETIC-SECRET'}});await Promise.all([out,rejected]);
    assert.equal(await b.api.getSession(),null);await reject(b.api.verifySession(A),'AUTH_REQUIRED');
  });
  await check('a broken pre-exchange session cannot skip the exchange wait or reinstate a logged-out account',async()=>{
    for(const throws of [false,true]){
      const b=boot(),wait=deferred();googleMode(b);let reads=0;
      b.state.behavior.getSession=()=>{if(++reads===1){if(throws)throw Error('SYNTHETIC-SECRET');return{data:{session:null},error:{code:'refresh_token_not_found',message:'SYNTHETIC-SECRET'}};}return{data:{session:b.state.session},error:null};};
      b.state.behavior.idToken=async()=>{await wait.promise;b.state.replace(A);return{data:{user:user(A),session:b.state.session},error:null};};
      const pending=b.api.signIn('google');const rejected=reject(pending,'SESSION_CHANGED');
      while(!b.calls.some(x=>x.name==='idToken'))await tick();let finished=false;const out=b.api.signOut().then(()=>{finished=true;});await tick();
      assert.equal(finished,false);assert.equal(b.calls.some(x=>x.name==='signOut'),false);wait.resolve();
      await Promise.all([out,rejected]);assert.equal(await b.api.getSession(),null);
    }
  });
  await check('a different account observed after the exchange is not removed by logout cleanup',async()=>{
    const b=boot(),wait=deferred();googleMode(b);b.api.onAuth(()=>{});let reads=0;
    b.state.behavior.idToken=()=>wait.promise;
    b.state.behavior.getSession=()=>{if(++reads===2)b.state.replace(B);return{data:{session:b.state.session},error:null};};
    const pending=b.api.signIn('google');const rejected=reject(pending,'SESSION_CHANGED');
    while(!b.calls.some(x=>x.name==='idToken'))await tick();const out=b.api.signOut();const rejectedOut=reject(out,'SESSION_CHANGED');await tick();
    wait.resolve({data:{user:user(A),session:session(A)},error:null});await Promise.all([rejected,rejectedOut]);
    assert.equal(b.state.session.user.id,B);assert.equal(b.calls.some(x=>x.name==='signOut'),false);
    assert.equal((await b.api.verifySession(B)).user.id,B);
  });
  await check('snapshot, enterprise and function responses cannot cross profile or A-B-A boundaries',async()=>{
    for(const operation of ['load','call','invoke'])for(const change of ['profile','account']){
      const b=boot(),wait=deferred();b.api.onAuth(()=>{});await b.api.getSession();const method=operation==='invoke'?'invoke':'rpc';b.state.behavior[method]=()=>wait.promise;
      const pending=operation==='load'?b.api.load(A):operation==='call'?b.api.call('business_list_companies',{},A):b.api.invoke('rodagem-billing',{},A);
      await tick();assert.ok(b.calls.some(x=>x.name===method));if(change==='profile')b.state.profile='other';else{b.state.replace(B);b.state.replace(A);}
      wait.resolve({data:operation==='load'?row:{synthetic:true},error:null});await reject(pending,'SESSION_CHANGED');
    }
  });
  await check('malformed auth events are delivered safely after the SDK listener returns',async()=>{
    const b=boot();let observed='not-run';b.api.onAuth((_event,value)=>{observed=value;});b.state.session={user:{id:'malformed'}};b.state.emit('SIGNED_IN');assert.equal(observed,'not-run');await tick();assert.equal(observed,null);
  });
  console.log(`PASS ${count} v3.2.3 session client suites (simulated SDK boundary and pinned-SDK retry probe; synthetic data only)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
