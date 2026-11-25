// Driver integration with the SDK boundary mocked; no live account or OAuth claim.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(path.join(root,'cloud-client.js'),'utf8');
const configSource = fs.readFileSync(path.join(root,'cloud-config.js'),'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const valid = {url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrstuvwx',providers:['google','facebook']};
const user = id => ({id,email:'person@example.test',user_metadata:{name:'Pessoa',access_token:'must-not-escape'},app_metadata:{provider:'google',providers:['google']}});
const snapshot = {version:1,settings:null,records:{versao:1,registros:[]},routes:[],gpsPreferences:{enabled:false,mode:'eco'},journey:null};
const row = {revision:1,payload:snapshot,updated_at:'2026-11-15T00:00:00Z'};
function boot(options = {}) {
  const calls = [], timers = new Map(); let nextTimer = 0, listener, unsubscribed = 0;
  const state = {session:options.session === undefined ? {user:user(A),access_token:'private-access',refresh_token:'private-refresh',expires_at:1900000000} : options.session,
    authoritative:options.authoritative || null,getSessionError:null,getUserError:null,rpcResult:{data:row,error:null},signInError:null,signOutError:null};
  const sdk = {
    auth:{async getSession(){return {data:{session:state.session},error:state.getSessionError};},
      async getUser(){calls.push({method:'getUser'});return {data:{user:state.authoritative || state.session?.user},error:state.getUserError};},
      onAuthStateChange(callback){listener=callback;return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};},
      async signInWithOAuth(input){calls.push({method:'signIn',input});return {error:state.signInError};},
      async signOut(input){calls.push({method:'signOut',input});if(!state.signOutError)state.session=null;return {error:state.signOutError};}},
    async rpc(name,params){calls.push({method:'rpc',name,params});return typeof state.rpcResult==='function' ? state.rpcResult() : state.rpcResult;}
  };
  const window = {location:{href:'https://lesmoboy.github.io/meu-primeiro-app/index.html?code=oauth#ajustes'},
    atob:text=>Buffer.from(text,'base64').toString('binary'),fetch:async(...args)=>{calls.push({method:'fetch',args});return 'response';},
    supabase:{createClient(url,key,options){calls.push({method:'create',url,key,options});return sdk;}}};
  if(options.config === undefined)window.RodagemCloudConfig=valid;
  else window.RodagemCloudConfig=options.config;
  if(options.missingSDK)delete window.supabase;
  const context=vm.createContext({window,URL,Date,AbortController,queueMicrotask,
    setTimeout(callback,delay){timers.set(++nextTimer,{callback,delay});return nextTimer;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(source,context);
  return {api:window.RodagemCloud,window,context,state,calls,timers,emit:(event,session=state.session)=>listener?.(event,session),unsubscribed:()=>unsubscribed};
}
let passed=0;
async function check(name,test){await test();passed++;console.log('PASS',name);}
const rejection=(promise,code)=>assert.rejects(promise,error=>error.code===code);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  await check('empty installation stays local and never constructs a cloud client',async()=>{
    const b=boot({config:null});
    assert.equal(b.api.configured(),false);assert.match(b.api.configurationIssue(),/ainda não/);
    await rejection(b.api.ready(),'CONFIGURATION');await rejection(b.api.signIn('google'),'CONFIGURATION');
    assert.deepEqual(b.calls,[]);
  });
  await check('only HTTPS project URLs and public keys can initialize auth',async()=>{
    for(const url of ['http://abcdefghijklmnopqrst.supabase.co','https://evil.example','https://abc.supabase.co.evil.test','https://abc.supabase.co/path','https://user@abc.supabase.co','https://abc.supabase.co?x=1'])assert.equal(boot({config:{...valid,url}}).api.configured(),false,url);
    for(const publishableKey of ['sb_secret_abcdefghijklmnopqrstuvwx','service_role','not-a-key',''])assert.equal(boot({config:{...valid,publishableKey}}).api.configured(),false,publishableKey);
    const jwt=role=>['header',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
    assert.equal(boot({config:{...valid,publishableKey:jwt('service_role')}}).api.configured(),false);
    assert.equal(boot({config:{...valid,publishableKey:jwt('anon')}}).api.configured(),true);
    assert.equal(boot({missingSDK:true}).api.configured(),false);
  });
  await check('the SDK uses PKCE, durable auth and a private storage key',async()=>{
    const b=boot();const session=await b.api.getSession();const create=b.calls.find(x=>x.method==='create');
    assert.equal(create.options.auth.flowType,'pkce');assert.equal(create.options.auth.detectSessionInUrl,true);
    assert.equal(create.options.auth.persistSession,true);assert.equal(create.options.auth.autoRefreshToken,true);
    assert.equal(create.options.auth.storageKey,'minha-rodagem-supabase-auth-v1');
    assert.equal(session.user.id,A);assert.equal(session.access_token,undefined);assert.equal(session.refresh_token,undefined);
    assert.equal(session.user.user_metadata.access_token,undefined);
  });
  await check('Google and Facebook redirect to the canonical app without reading messages',async()=>{
    const b=boot();await b.api.signIn('google');await b.api.signIn('facebook');
    const signIns=b.calls.filter(x=>x.method==='signIn');
    assert.equal(signIns[0].input.options.redirectTo,'https://lesmoboy.github.io/meu-primeiro-app/');
    assert.equal(signIns[0].input.options.scopes,undefined);assert.equal(signIns[1].input.options.scopes,'email');
    assert.equal(signIns[0].input.provider,'google');assert.equal(signIns[1].input.provider,'facebook');
    await rejection(b.api.signIn('github'),'PROVIDER');
    const google=boot({config:{...valid,providers:['google']}});await rejection(google.api.signIn('facebook'),'PROVIDER');
    await google.api.signIn('google');assert.deepEqual(google.calls.filter(x=>x.method==='signIn').map(x=>x.input.provider),['google']);
  });
  await check('auth callbacks run after the SDK listener and unsubscribe cancels pending callbacks',async()=>{
    const b=boot();let got=[];const stop=b.api.onAuth((event,session)=>got.push({event,session}));
    b.emit('SIGNED_IN');assert.equal(got.length,0);await tick();assert.equal(got.length,1);assert.equal(got[0].session.user.id,A);
    b.emit('TOKEN_REFRESHED');stop();stop();await tick();assert.equal(got.length,1);assert.equal(b.unsubscribed(),1);
  });
  await check('a server-verified identity is required and cached identity disagreement fails closed',async()=>{
    const b=boot();const verified=await b.api.verifySession();assert.equal(verified.user.id,A);assert.equal(b.calls.filter(x=>x.method==='getUser').length,1);
    b.state.authoritative=user(B);await rejection(b.api.verifySession(),'SESSION_CHANGED');
    await rejection(boot({session:null}).api.load(A),'AUTH_REQUIRED');
  });
  await check('snapshot RPC uses only server identity and an exact compare-and-swap revision',async()=>{
    const b=boot();assert.equal((await b.api.load(A)).revision,1);const loaded=b.calls.find(x=>x.method==='rpc');
    assert.equal(loaded.name,'rodagem_load_snapshot');assert.equal(loaded.params.expected_user_id,A);
    await b.api.save(0,snapshot,A);const saved=b.calls.filter(x=>x.method==='rpc').at(-1);
    assert.equal(saved.name,'rodagem_save_snapshot');assert.equal(saved.params.expected_revision,0);assert.equal(saved.params.snapshot,snapshot);
    assert.equal(saved.params.expected_user_id,A);
    assert.equal(Object.hasOwn(saved.params,'user_id'),false);
    for(const invalid of [-1,.5,NaN,Number.MAX_SAFE_INTEGER+1])await rejection(b.api.save(invalid,snapshot,A),'INVALID_DATA');
  });
  await check('empty cloud state is distinct from corrupt or malformed replies',async()=>{
    const b=boot();b.state.rpcResult={data:null,error:null};assert.equal(await b.api.load(A),null);
    await rejection(b.api.save(0,snapshot,A),'INVALID_RESPONSE');
    for(const data of [{...row,revision:0},{...row,revision:'1'},{...row,payload:null},{...row,updated_at:'invalid'}]){
      b.state.rpcResult={data,error:null};await rejection(b.api.load(A),'INVALID_RESPONSE');
    }
  });
  await check('conflict, unauthorized and invalid payload errors are typed and do not expose raw responses',async()=>{
    const b=boot();
    for(const [error,code]of [[{code:'40001',message:'private SQL'},'CONFLICT'],[{status:409},'CONFLICT'],[{code:'42501'},'AUTH_REQUIRED'],[{status:401},'AUTH_REQUIRED'],[{code:'22023'},'INVALID_DATA'],[{code:'28000'},'SESSION_CHANGED']]){
      b.state.rpcResult={data:null,error};await rejection(b.api.save(1,snapshot,A),code);
    }
    b.state.rpcResult={data:null,error:{message:'secret-token-value'}};
    await assert.rejects(b.api.load(A),e=>e.code==='CONNECTION'&&!e.message.includes('secret-token-value'));
  });
  await check('switching identity during a response cannot return data to the next account',async()=>{
    const b=boot();b.state.rpcResult=()=>{b.state.session={user:user(B)};return {data:row,error:null};};
    await rejection(b.api.load(A),'SESSION_CHANGED');
  });
  await check('a token changed before an RPC is rejected by the server UID guard before another account is mutated',async()=>{
    const b=boot();const writes=[];
    b.state.rpcResult=()=>{
      // Simulate the SDK choosing a newly signed-in account's bearer token
      // after verifySession has already returned the prior account's UID.
      b.state.session={user:user(B)};
      const request=b.calls.filter(x=>x.method==='rpc').at(-1);
      const authenticatedUID=b.state.session.user.id;
      if(request.params.expected_user_id!==authenticatedUID)return {data:null,error:{code:'28000'}};
      writes.push({uid:authenticatedUID,payload:request.params.snapshot});
      return {data:row,error:null};
    };
    await rejection(b.api.save(1,snapshot,A),'SESSION_CHANGED');assert.deepEqual(writes,[]);
    b.state.session={user:user(A)};
    await rejection(b.api.load(A),'SESSION_CHANGED');assert.deepEqual(writes,[]);
  });
  await check('a caller snapshot from account A is rejected if account B is already active before verification',async()=>{
    const b=boot({session:{user:user(B)}});
    await rejection(b.api.verifySession(A),'SESSION_CHANGED');
    await rejection(b.api.save(1,snapshot,A),'SESSION_CHANGED');
    await rejection(b.api.load(A),'SESSION_CHANGED');
    assert.equal(b.calls.filter(x=>x.method==='rpc').length,0);
    await rejection(b.api.save(1,snapshot),'SESSION_CHANGED');
    await rejection(b.api.load(),'SESSION_CHANGED');
    assert.equal(b.calls.filter(x=>x.method==='rpc').length,0);
  });
  await check('all SDK fetches have a 15-second timeout and honor an external abort',async()=>{
    const b=boot();await b.api.ready();const fetch=b.calls.find(x=>x.method==='create').options.global.fetch;
    let resolve;
    b.window.fetch=(_input,init)=>new Promise((done,reject)=>{resolve=done;init.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});});
    const pending=fetch('https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/example');
    assert.equal(b.timers.size,1);const timer=[...b.timers.values()][0];assert.equal(timer.delay,15000);timer.callback();await assert.rejects(pending);assert.equal(b.timers.size,0);
    const external=new AbortController();const next=fetch('https://abcdefghijklmnopqrst.supabase.co/auth/v1/user',{signal:external.signal});external.abort();await assert.rejects(next);assert.equal(b.timers.size,0);
    const completed=fetch('https://abcdefghijklmnopqrst.supabase.co/auth/v1/user');resolve('ok');assert.equal(await completed,'ok');assert.equal(b.timers.size,0);
  });
  await check('sign out removes this browser session without revoking other devices',async()=>{
    const b=boot();await b.api.signOut();assert.equal((b.calls.find(x=>x.method==='signOut').input).scope,'local');assert.equal(await b.api.getSession(),null);
  });
  await check('business operations pass the verified UID and map server billing limits',async()=>{
    const b=boot();b.state.rpcResult={data:{company:{id:A}},error:null};
    const value=await b.api.call('business_load_workspace',{company_id:B,expected_user_id:B},A);
    assert.equal(value.company.id,A);
    const call=b.calls.filter(x=>x.method==='rpc').at(-1);assert.equal(call.params.expected_user_id,A);assert.equal(call.params.company_id,B);
    b.state.rpcResult={data:null,error:{code:'P0001',message:'PLAN_LIMIT'}};
    await rejection(b.api.call('business_save_entity',{},A),'PLAN_LIMIT');
    await rejection(b.api.call('arbitrary_privileged_rpc',{},A),'INVALID_DATA');
    b.state.session={user:user(B)};await rejection(b.api.call('business_list_companies',{},A),'SESSION_CHANGED');
  });
  await check('the exact SDK accepts the public Google-only install without starting authentication',async()=>{
    const library=fs.readFileSync(path.join(root,'vendor/supabase/supabase.js'),'utf8');
    let networkRequests=0;
    const context=vm.createContext({console,URL,TextEncoder,TextDecoder,AbortController,fetch:()=>{networkRequests++;throw Error('Unexpected live network request in isolated configuration test');},Headers,Request,Response,WebSocket,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,setInterval,clearInterval});
    vm.runInContext(library,context,{timeout:5000});assert.equal(typeof context.supabase.createClient,'function');
    context.window=context;context.location={href:'https://lesmoboy.github.io/meu-primeiro-app/'};
    vm.runInContext(configSource,context);vm.runInContext(source,context);assert.equal(context.RodagemCloud.configured(),true);
    assert.deepEqual(Array.from(context.RodagemCloudConfig.providers),['google']);
    assert.equal(networkRequests,0);
    // configured() validates the install only; it does not construct the SDK
    // session or make a request to a real project or OAuth provider.
  });
  console.log('PASS '+passed+' cloud client suites (SDK boundary mocked; real login requires provider configuration)');
})().catch(error=>{console.error(error);process.exitCode=1;});
