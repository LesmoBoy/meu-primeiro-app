// Additional negative paths. All accounts/providers are isolated fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {serverConfig,createBillingHandler,verifyStripeSignature} from '../supabase/functions/_shared/billing.mjs';

const company='64ef760e-b98e-410a-a14b-bdd016812345',user='3f970604-74c6-48d9-baa1-267ac5e12345';
const now=Date.parse('2026-11-26T08:00:00Z');
const config=serverConfig({BILLING_ENABLED:'false',APP_URL:'https://example.test/app/',STRIPE_SECRET_KEY:'sk_test_FIXTURE',STRIPE_WEBHOOK_SECRET:'whsec_FIXTURE',STRIPE_PRICE_COMPANY:'price_company',STRIPE_PRICE_VEHICLE:'price_vehicle'});
let authCalls=0,providerCalls=0,applies=0;
const db={authenticate:async()=>{authCalls++;return{id:user};},membership:async()=>({role:'owner',active:true}),settings:async()=>({enabled:true}),entitlement:async()=>null,accountByCustomer:async()=>null};
const stripe={get:async()=>{providerCalls++;throw Error('Unexpected provider');},post:async()=>{providerCalls++;throw Error('Unexpected provider');}};
const handler=createBillingHandler({config,db,stripe,now:()=>now});
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS',name);}
async function signed(body){const t=String(now/1000),enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(config.webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(t+'.'+body))),b=>b.toString(16).padStart(2,'0')).join('');return't='+t+',v1='+sig;}

await test('streamed oversized JSON is denied before authentication or provider access',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(10001)));controller.close();}});
  const response=await handler(new Request('https://edge.test/billing',{method:'POST',headers:{Authorization:'Bearer fixture'},body,duplex:'half'}));
  assert.equal(response.status,413);assert.equal(authCalls,0);assert.equal(providerCalls,0);
});
await test('malformed UTF-8 is refused without authentication',async()=>{
  const response=await handler(new Request('https://edge.test/billing',{method:'POST',body:new Uint8Array([0xc0,0xaf])}));
  assert.equal(response.status,400);assert.equal(authCalls,0);assert.equal(providerCalls,0);
});
await test('unknown or path-like subscription IDs cannot reach Stripe',async()=>{
  const body=JSON.stringify({id:'evt_test',livemode:false,type:'customer.subscription.updated',data:{object:{customer:'cus_test',id:'sub_../../evil'}}});
  const response=await handler(new Request('https://edge.test/billing?webhook=1',{method:'POST',headers:{'Stripe-Signature':await signed(body)},body}));
  assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);assert.equal(providerCalls,0);
});
await test('missing, malformed and future timestamp HMAC values fail closed',async()=>{
  for(const header of [null,'t=Infinity,v1='+'0'.repeat(64),'t='+String(now/1000+301)+',v1='+'0'.repeat(64),'t='+String(now/1000)+',v1=0'])assert.equal(await verifyStripeSignature('{}',header,config.webhookSecret,now),false);
});
await test('the browser rejects fake Stripe subdomains, user-info URLs and non-HTTPS payment links',async()=>{
  const source=await fs.readFile(new URL('../billing.js',import.meta.url),'utf8');
  const workspace={company:{id:company},membership:{role:'owner',userId:user}};
  let target='',navigations=0;
  const window={RodagemBillingConfig:{enabled:true},RodagemCloud:{configured:()=>true,invoke:async()=>({url:target})},RodagemBusiness:{getMode:()=> 'cloud',getCurrentWorkspace:()=>workspace,getCloudUserId:()=>user,getSession:async()=>({user:{id:user}})},RodagemProfiles:{current:()=>({id:'principal'}),assertCurrent(){}},location:{assign(){navigations++;}}};
  vm.runInNewContext(source,{window,URL});
  for(const bad of ['https://checkout.stripe.com.evil.test/pay','https://evil.test@checkout.stripe.com/pay','http://checkout.stripe.com/pay','javascript:alert(1)']){
    target=bad;await assert.rejects(()=>window.RodagemBilling.checkout(company,'company'),error=>error.code==='INVALID_RESPONSE');
  }
  assert.equal(navigations,0);
});
console.log(JSON.stringify({passed,authCalls,providerCalls,applies,livePayments:false}));
