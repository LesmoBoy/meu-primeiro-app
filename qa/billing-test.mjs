// Real WebCrypto signatures, isolated fake providers/database. No live payments.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {serverConfig,verifyStripeSignature,createBillingHandler,createSupabaseStore,createStripeClient} from '../supabase/functions/_shared/billing.mjs';
const company='64ef760e-b98e-410a-a14b-bdd016812345',user='3f970604-74c6-48d9-baa1-267ac5e12345',other='53f7507e-9d82-4948-8771-72e473712345';
const stamp=Date.parse('2026-11-16T12:00:00Z');
const config=serverConfig({BILLING_ENABLED:'true',APP_URL:'https://example.test/app/',STRIPE_SECRET_KEY:'sk_test_FIXTURE',STRIPE_WEBHOOK_SECRET:'whsec_FIXTURE',STRIPE_PRICE_COMPANY:'price_company',STRIPE_PRICE_VEHICLE:'price_vehicle'});
const price=(id,amount)=>({id,active:true,currency:'brl',unit_amount:amount,recurring:{interval:'month'}});
const subscription=(id='sub_current',status='active',quantity=2)=>({id,status,customer:'cus_current',metadata:{company_id:company},current_period_end:stamp/1000+86400*30,items:{data:[{price:{id:'price_vehicle'},quantity}]}});
async function sign(raw,time=stamp){const t=String(Math.floor(time/1000)),encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(config.webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(t+'.'+raw)));return 't='+t+',v1='+Array.from(sig,x=>x.toString(16).padStart(2,'0')).join('');}
function setup(){
  const calls=[],applied=[],processed=new Set();let account={company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:null},entitlement=null,role='owner',memberCompany=company,count=3,busy=false,enabled=true;
  const subs=new Map([['sub_current',subscription()]]),sessions=new Map();
  const db={
    async authenticate(token){calls.push(['authenticate']);if(token!=='fixture')return null;return {id:user};},
    async membership(id,uid){calls.push(['membership']);return id===memberCompany&&uid===user?{role,active:true}:null;},
    async settings(){return {enabled,enforcement:false};},async entitlement(){return entitlement;},async company(){return {id:company,name:'Empresa de teste'};},
    async account(){return account;},async accountByCustomer(id){return account?.stripe_customer_id===id?account:null;},async countActiveVehicles(){return count;},
    async updateAccount(id,patch){account={...account,company_id:id,...patch};return account;},
    async acquire(id,event){if(processed.has(event))return {state:'processed'};return busy?{state:'busy'}:{state:'claimed',token:other};},async release(){},
    async apply(data){applied.push(data);processed.add(data.event_id);entitlement={company_id:company,plan:data.plan_id,status:data.subscription_status,vehicle_quantity:data.quantity};account={...account,stripe_subscription_id:data.subscription_id,...(account.checkout_id&&account.checkout_id===data.confirmed_checkout_id?{checkout_id:null,checkout_url:null,checkout_plan:null,checkout_expires_at:null}:{})};}
  };
  const stripe={async get(path){calls.push(['GET',path]);if(path==='/prices/price_company')return price('price_company',5000);if(path==='/prices/price_vehicle')return price('price_vehicle',2000);if(path.startsWith('/subscriptions/'))return subs.get(path.split('/').at(-1));if(path.startsWith('/checkout/sessions/'))return sessions.get(path.split('/').at(-1));throw Error('Unexpected Stripe GET');},
    async post(path,body,key){calls.push(['POST',path,body,key]);if(path==='/customers')return {id:'cus_current'};if(path==='/billing_portal/sessions')return {url:'https://billing.stripe.com/p/session_fixture'};if(path.endsWith('/expire'))return {status:'expired'};if(path==='/checkout/sessions'){const session={id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expires_at:stamp/1000+86400,status:'open',metadata:{quantity:body['metadata[quantity]']}};sessions.set(session.id,session);return session;}throw Error('Unexpected Stripe POST');}};
  const handler=createBillingHandler({config,db,stripe,now:()=>stamp});
  const request=async(body,authorization='Bearer fixture')=>{const response=await handler(new Request('https://edge.test/rodagem-billing',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({companyId:company,expected_user_id:user,...body})}));return {status:response.status,body:await response.json()};};
  const webhook=async(event,signature)=>{const raw=JSON.stringify(event);const response=await handler(new Request('https://edge.test/rodagem-billing?webhook=1',{method:'POST',headers:{'Stripe-Signature':signature??await sign(raw)},body:raw}));return {status:response.status,body:await response.json()};};
  return {request,webhook,calls,applied,subs,sessions,db,stripe,setRole:value=>role=value,setCompany:value=>memberCompany=value,setCount:value=>count=value,setAccount:value=>account=value,setEntitlement:value=>entitlement=value,setBusy:value=>busy=value,setEnabled:value=>enabled=value,getAccount:()=>account};
}
let passed=0;async function test(name,run){await run();passed++;console.log('PASS',name);}
await test('billing needs complete server configuration and has no invented price',()=>{
  assert.equal(serverConfig({}).ready,false);assert.equal(serverConfig({...Object.fromEntries([]),APP_URL:'javascript:alert(1)'}).ready,false);assert.equal(config.ready,true);
});
await test('JWT identity mismatch and missing authorization stop before provider access',async()=>{
  const a=setup();assert.equal((await a.request({action:'checkout',plan:'vehicle',expected_user_id:other})).body.code,'SESSION_CHANGED');assert.equal((await a.request({action:'checkout',plan:'vehicle'},'')).status,401);assert.equal(a.calls.filter(x=>x[0]==='POST'||x[0]==='GET').length,0);
});
await test('only the real company owner can start checkout or open the payment portal',async()=>{
  for(const role of ['manager','finance','driver']){const a=setup();a.setRole(role);assert.equal((await a.request({action:'checkout',plan:'company',role:'owner'})).status,403);assert.equal((await a.request({action:'portal'})).status,403);assert.equal(a.calls.filter(x=>x[0]==='POST').length,0);}
  const a=setup();a.setCompany(other);assert.equal((await a.request({action:'status'})).status,403);
});
await test('disabled server billing never constructs a checkout even if the public switch is changed',async()=>{
  const a=setup();a.setEnabled(false);const result=await a.request({action:'status'});assert.equal(result.body.configured,false);assert.equal(result.body.plans[0].amount,null);assert.equal((await a.request({action:'checkout',plan:'company'})).body.code,'BILLING_NOT_CONFIGURED');assert.equal(a.calls.filter(x=>x[0]==='POST').length,0);
});
await test('checkout ignores caller amount, price, quantity and customer and counts active vehicles on the server',async()=>{
  const a=setup();const result=await a.request({action:'checkout',plan:'vehicle',price:'price_attacker',amount:1,quantity:999,customer:'cus_attacker'});assert.equal(result.status,200);
  const post=a.calls.find(x=>x[1]==='/checkout/sessions');assert.equal(post[2]['line_items[0][price]'],'price_vehicle');assert.equal(post[2]['line_items[0][quantity]'],'3');assert.equal(post[2].customer,'cus_current');assert.equal(post[2].success_url,'https://example.test/app/?billing=return#empresa');assert.equal(a.applied.length,0);
});
await test('a new company purchases one initial vehicle slot and company pricing always uses one unit',async()=>{
  for(const plan of ['vehicle','company']){const a=setup();a.setCount(0);assert.equal((await a.request({action:'checkout',plan})).body.quantity,1);}
});
await test('a pending open checkout is reused instead of creating a second subscription',async()=>{
  const a=setup();await a.request({action:'checkout',plan:'vehicle'});await a.request({action:'checkout',plan:'vehicle'});assert.equal(a.calls.filter(x=>x[0]==='POST'&&x[1]==='/checkout/sessions').length,1);
});
await test('existing provider subscriptions cannot be duplicated while a webhook is delayed',async()=>{
  const a=setup();a.setAccount({company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:'sub_current'});assert.equal((await a.request({action:'checkout',plan:'company'})).body.code,'PLAN_ACTIVE');assert.equal(a.calls.filter(x=>x[0]==='POST'&&x[1]==='/checkout/sessions').length,0);
});
await test('portal uses the server customer and the fixed application return URL',async()=>{
  const a=setup();assert.equal((await a.request({action:'portal',customer:'cus_attacker',return_url:'https://attacker.test'})).status,200);const post=a.calls.find(x=>x[1]==='/billing_portal/sessions');assert.equal(post[2].customer,'cus_current');assert.equal(post[2].return_url,'https://example.test/app/#empresa');
});
await test('status prices come from configured recurring BRL Stripe prices',async()=>{
  const a=setup();const result=await a.request({action:'status'});assert.equal(result.body.plans[0].amount,5000);assert.equal(result.body.plans[1].amount,2000);assert.equal(JSON.stringify(result.body).includes('sk_test'),false);assert.equal(JSON.stringify(result.body).includes('whsec'),false);
});
await test('raw webhook signatures reject body tampering and expired timestamps',async()=>{
  const raw='{"id":"evt_fixture"}',header=await sign(raw);assert.equal(await verifyStripeSignature(raw,header,config.webhookSecret,stamp),true);assert.equal(await verifyStripeSignature(raw+' ',header,config.webhookSecret,stamp),false);assert.equal(await verifyStripeSignature(raw,header,config.webhookSecret,stamp+301000),false);
  const a=setup();assert.equal((await a.webhook({id:'evt_fixture',livemode:false},'t=1,v1='+'0'.repeat(64))).status,400);assert.equal(a.applied.length,0);
});
const event=(id='evt_current',sub='sub_current')=>({id,livemode:false,type:'customer.subscription.updated',data:{object:{id:sub,customer:'cus_current',status:'canceled',metadata:{quantity:'9999'}}}});
await test('a valid webhook refetches authoritative subscription state before activating a plan',async()=>{
  const a=setup();assert.equal((await a.webhook(event())).status,200);assert.equal(a.applied[0].subscription_status,'active');assert.equal(a.applied[0].quantity,2);assert.equal(a.applied[0].plan_id,'vehicle');assert.equal(a.applied[0].company_id,company);
});
await test('duplicate signed webhook events are applied once and busy leases request a retry',async()=>{
  const a=setup();await a.webhook(event());assert.equal((await a.webhook(event())).body.duplicate,true);assert.equal(a.applied.length,1);const b=setup();b.setBusy(true);assert.equal((await b.webhook(event())).status,409);assert.equal(b.applied.length,0);
});
await test('an old canceled event cannot overwrite the current active subscription',async()=>{
  const a=setup();a.setAccount({company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:'sub_current'});a.subs.set('sub_old',subscription('sub_old','canceled',1));assert.equal((await a.webhook(event('evt_old','sub_old'))).status,200);assert.equal(a.applied[0].subscription_id,'sub_current');assert.equal(a.applied[0].subscription_status,'active');
});
await test('a webhook refreshes the company mapping after its lease to avoid an out-of-order subscription overwrite',async()=>{
  const a=setup();a.setAccount({company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:'sub_old'});a.subs.set('sub_old',subscription('sub_old','canceled',1));
  a.db.acquire=async()=>{a.setAccount({company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:'sub_current'});return {state:'claimed',token:other};};
  assert.equal((await a.webhook(event('evt_mappingrace','sub_old'))).status,200);assert.equal(a.applied[0].subscription_id,'sub_current');assert.equal(a.applied[0].subscription_status,'active');
});
await test('a delayed cancellation preserves a newer open checkout and retry reuses its URL',async()=>{
  const a=setup();a.setAccount({company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:'sub_old'});a.subs.set('sub_old',subscription('sub_old','canceled',1));
  const first=await a.request({action:'checkout',plan:'vehicle'});assert.equal(first.status,200);const checkoutId=a.getAccount().checkout_id;
  assert.equal((await a.webhook(event('evt_delayed_cancellation','sub_old'))).status,200);
  assert.equal(a.getAccount().checkout_id,checkoutId);assert.equal(a.applied[0].confirmed_checkout_id,null);
  const second=await a.request({action:'checkout',plan:'vehicle'});assert.equal(second.body.url,first.body.url);
  assert.equal(a.calls.filter(x=>x[0]==='POST'&&x[1]==='/checkout/sessions').length,1);
});
await test('a webhook clears only a completed checkout for its confirmed customer and subscription',async()=>{
  for(const [status,customer,sub,clears] of [['open','cus_current','sub_current',false],['complete','cus_current','sub_unrelated',false],['complete','cus_other','sub_current',false],['complete','cus_current','sub_current',true]]){
    const a=setup();a.setAccount({company_id:company,stripe_customer_id:'cus_current',stripe_subscription_id:'sub_current',checkout_id:'cs_test_pending'});
    a.sessions.set('cs_test_pending',{id:'cs_test_pending',status,customer,subscription:sub});
    assert.equal((await a.webhook(event())).status,200);assert.equal(a.getAccount().checkout_id,clears?null:'cs_test_pending');
    assert.equal(a.applied[0].confirmed_checkout_id,clears?'cs_test_pending':null);
  }
});
await test('a multi-month Stripe price is not mislabeled as a monthly plan',async()=>{
  const a=setup(),get=a.stripe.get;a.stripe.get=async path=>{const value=await get(path);if(path==='/prices/price_company')value.recurring.interval_count=6;return value;};assert.equal((await a.request({action:'status'})).body.code,'BILLING_NOT_CONFIGURED');
});
await test('foreign subscription metadata and unapproved Stripe prices never grant entitlements',async()=>{
  for(const change of [sub=>sub.metadata.company_id=other,sub=>sub.items.data[0].price.id='price_attacker']){const a=setup();const sub=subscription();change(sub);a.subs.set('sub_current',sub);assert.equal((await a.webhook(event())).status,400);assert.equal(a.applied.length,0);}
});
await test('the server vehicle count uses an unrestricted aggregate RPC rather than a capped REST row list',async()=>{
  let request;const store=createSupabaseStore({url:'https://example.test',serviceKey:'fixture',anonKey:'public',fetcher:async(url,options)=>{request={url,options};return Response.json(1800);}});assert.equal(await store.countActiveVehicles(company),1800);assert.ok(request.url.endsWith('/rest/v1/rpc/business_billing_vehicle_count'));assert.equal(JSON.parse(request.options.body).company_id,company);
});
await test('Stripe adapter pins its API version, timeout and server idempotency key',async()=>{
  let request;const stripe=createStripeClient({key:'fixture',fetcher:async(url,options)=>{request={url,options};return Response.json({id:'cus_current'});}});await stripe.post('/customers',{name:'Empresa de teste'},'fixture-key');assert.equal(request.options.headers['Stripe-Version'],'2024-06-20');assert.equal(request.options.headers['Idempotency-Key'],'fixture-key');assert.ok(request.options.signal);assert.equal(request.url,'https://api.stripe.com/v1/customers');
});
await test('the public billing client stays disabled without configuration and refuses foreign payment URLs',async()=>{
  const source=await fs.readFile(new URL('../billing.js',import.meta.url),'utf8');let navigated=false,invoked=0;
  const workspace={company:{id:company},membership:{role:'owner',userId:user}},window={RodagemBillingConfig:{enabled:false},RodagemCloud:{configured:()=>true,invoke:async()=>{invoked++;return {url:'https://attacker.test/pay'};}},RodagemBusiness:{getMode:()=> 'cloud',getCurrentWorkspace:()=>workspace,getCloudUserId:()=>user,getSession:async()=>({user:{id:user}})},RodagemProfiles:{current:()=>({id:'principal'}),assertCurrent(){}},location:{assign(){navigated=true;}}};
  vm.runInNewContext(source,{window,URL});assert.equal(window.RodagemBilling.configured(),false);assert.equal((await window.RodagemBilling.status(company)).configured,false);assert.equal(invoked,0);
  window.RodagemBillingConfig={enabled:true};await assert.rejects(()=>window.RodagemBilling.checkout(company,'vehicle'),error=>error.code==='INVALID_RESPONSE');assert.equal(navigated,false);
  window.RodagemCloud.invoke=async()=>{workspace.company.id=other;return {url:'https://checkout.stripe.com/c/pay/fixture'};};await assert.rejects(()=>window.RodagemBilling.checkout(company,'vehicle'),error=>error.code==='SESSION_CHANGED');assert.equal(navigated,false);
});
await test('the Edge wrapper type-strips to valid JavaScript without executing a server or importing credentials',async()=>{
  const source=await fs.readFile(new URL('../supabase/functions/rodagem-billing/index.ts',import.meta.url),'utf8');const stripped=stripTypeScriptTypes(source);assert.ok(stripped.includes('Deno.serve'));assert.equal(stripped.includes('name:string'),false);
});
console.log(`PASS ${passed} billing suites (mock payment provider; no real checkout or remote project)`);
