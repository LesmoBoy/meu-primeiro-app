// Regression of the confirmed late-webhook checkout race. No remote calls/payments.
import assert from 'node:assert/strict';
import {serverConfig,createBillingHandler} from '../supabase/functions/_shared/billing.mjs';

const company='64ef760e-b98e-410a-a14b-bdd016812345';
const user='3f970604-74c6-48d9-baa1-267ac5e12345';
const now=Date.parse('2026-11-26T08:00:00Z');
const config=serverConfig({BILLING_ENABLED:'true',APP_URL:'https://example.test/app/',STRIPE_SECRET_KEY:'sk_test_FIXTURE',STRIPE_WEBHOOK_SECRET:'whsec_FIXTURE',STRIPE_PRICE_COMPANY:'price_company',STRIPE_PRICE_VEHICLE:'price_vehicle'});
const subscription={id:'sub_old',status:'canceled',customer:'cus_test',metadata:{company_id:company},current_period_end:now/1000+86400,items:{data:[{price:{id:'price_vehicle'},quantity:1}]}};
let account={company_id:company,stripe_customer_id:'cus_test',stripe_subscription_id:'sub_old'};
let entitlement={status:'canceled'},lease=null;
const sessions=new Map();
const db={
  authenticate:async()=>({id:user}),membership:async()=>({role:'owner',active:true}),
  settings:async()=>({enabled:true}),entitlement:async()=>entitlement,company:async()=>({id:company,name:'Fixture'}),
  account:async()=>({...account}),accountByCustomer:async id=>id==='cus_test'?{...account}:null,
  countActiveVehicles:async()=>1,
  updateAccount:async(id,patch)=>(account={...account,company_id:id,...patch}),
  acquire:async()=>{assert.equal(lease,null);lease=crypto.randomUUID();return{state:'claimed',token:lease};},
  release:async()=>{lease=null;},
  apply:async data=>{
    assert.equal(data.lease_token,lease);
    entitlement={status:data.subscription_status};
    // Match the checkout-ID compare-and-set in the corrected SQL transaction.
    account={...account,stripe_subscription_id:data.subscription_id,...(account.checkout_id===data.confirmed_checkout_id?{checkout_id:null,checkout_url:null,checkout_plan:null,checkout_expires_at:null}:{})};
    lease=null;
  }
};
const stripe={
  get:async path=>{
    if(path.startsWith('/prices/'))return{id:path.split('/').at(-1),active:true,currency:'brl',unit_amount:1000,recurring:{interval:'month'}};
    if(path==='/subscriptions/sub_old')return structuredClone(subscription);
    if(path.startsWith('/checkout/sessions/'))return sessions.get(path.split('/').at(-1));
    throw Error('Unexpected fixture request '+path);
  },
  post:async(path,body)=>{
    if(path==='/checkout/sessions'){
      const n=sessions.size+1,value={id:'cs_test_'+n,url:'https://checkout.stripe.com/c/pay/fixture_'+n,status:'open',expires_at:now/1000+86400,metadata:{quantity:body['metadata[quantity]']}};
      sessions.set(value.id,value);return value;
    }
    throw Error('Unexpected fixture post '+path);
  }
};
const handler=createBillingHandler({config,db,stripe,now:()=>now});
async function checkout(){const response=await handler(new Request('https://edge.test/rodagem-billing',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({action:'checkout',companyId:company,expected_user_id:user,plan:'vehicle'})}));assert.equal(response.status,200);return response.json();}
const first=await checkout();
assert.equal(sessions.size,1);
const event={id:'evt_delayed_cancellation',livemode:false,type:'customer.subscription.deleted',data:{object:{id:'sub_old',customer:'cus_test'}}};
const body=JSON.stringify(event),t=String(now/1000),encoder=new TextEncoder();
const key=await crypto.subtle.importKey('raw',encoder.encode(config.webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(t+'.'+body))),byte=>byte.toString(16).padStart(2,'0')).join('');
const response=await handler(new Request('https://edge.test/rodagem-billing?webhook=1',{method:'POST',headers:{'Stripe-Signature':'t='+t+',v1='+signature},body}));
assert.equal(response.status,200);
assert.equal(account.checkout_id,'cs_test_1','late cancellation must preserve the newer pending checkout mapping');
const second=await checkout();
assert.equal(first.url,second.url);
assert.equal(sessions.size,1);
assert.ok([...sessions.values()].every(s=>s.status==='open'));
console.log(JSON.stringify({regressionPassed:true,kind:'late_webhook_preserves_pending_checkout',firstOpenCheckoutRetained:true,secondOpenCheckoutCreated:false,openCheckouts:sessions.size,livePayments:false}));
