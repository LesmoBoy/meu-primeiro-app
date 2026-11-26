// Focused adversarial tests at the actual cloud-client boundary; no credentials/network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const filename=path.join(__dirname,'cloud-client-test.cjs');const text=fs.readFileSync(filename,'utf8');const prefix=text.slice(0,text.indexOf('let passed=0;'));
const helper={exports:{}};new Function('require','__dirname','module',prefix+';module.exports={boot,A,B,user,row};')(require,__dirname,helper);const {boot,A,B,user,row}=helper.exports;
const tick=()=>new Promise(r=>setImmediate(r));
let passed=0;async function check(label,fn){await fn();passed++;console.log('PASS',label);}
(async()=>{
 await check('authoritative user mismatch rejects before calling a business RPC',async()=>{
  const b=boot({authoritative:user(B)});await assert.rejects(b.api.call('business_list_companies',{},A),e=>e.code==='SESSION_CHANGED');assert.equal(b.calls.filter(x=>x.method==='rpc').length,0);
 });
 await check('a profile changed while a business RPC waits cannot expose its response to the newer profile',async()=>{
  const b=boot();let profile='first',release;b.window.RodagemProfiles={current:()=>({id:profile}),assertCurrent(){if(profile!=='first')throw Error('Profile changed');}};
  b.state.rpcResult=()=>new Promise(resolve=>release=resolve);const pending=b.api.call('business_list_companies',{},A);while(!release)await tick();profile='other';release({data:[{privateCompany:'must-not-return'}],error:null});await assert.rejects(pending,e=>e.code==='CONNECTION'||e.code==='SESSION_CHANGED');
 });
 await check('function invocations pin expected_user_id to the verified session, ignoring a forged body UID',async()=>{
  const b=boot();let input;const create=b.window.supabase.createClient;b.window.supabase.createClient=(...args)=>{const sdk=create(...args);sdk.functions={invoke:async(name,payload)=>{input={name,...payload};return {data:{configured:false},error:null};}};return sdk;};
  assert.equal((await b.api.invoke('rodagem-billing',{expected_user_id:B,company_id:B},A)).configured,false);assert.equal(input.body.expected_user_id,A);
 });
 await check('a late function invocation cannot return after account replacement and preserves its caller data',async()=>{
  const b=boot();let release;const create=b.window.supabase.createClient;b.window.supabase.createClient=(...args)=>{const sdk=create(...args);sdk.functions={invoke:()=>new Promise(resolve=>release=resolve)};return sdk;};
  const pending=b.api.invoke('rodagem-billing',{company_id:B},A);while(!release)await tick();b.state.session={user:user(B)};release({data:{url:'https://billing.example.test/checkout'},error:null});await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');
 });
 await check('function error responses expose the mapped public code but no raw provider secret',async()=>{
  const b=boot();const create=b.window.supabase.createClient;b.window.supabase.createClient=(...args)=>{const sdk=create(...args);sdk.functions={invoke:async()=>({data:null,error:{message:'private-sdk-secret',context:{status:503,clone(){return{json:async()=>({code:'BILLING_NOT_CONFIGURED',token:'must-not-escape'})};}}}})};return sdk;};
  await assert.rejects(b.api.invoke('rodagem-billing',{},A),e=>e.code==='BILLING_NOT_CONFIGURED'&&!/private|token|must-not/.test(e.message));
 });
 console.log('PASS '+passed+' focused cloud boundary audit tests');
})().catch(error=>{console.error(error);process.exitCode=1;});
