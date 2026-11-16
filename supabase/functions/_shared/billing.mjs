/* Shared by the Edge Function and isolated tests. No credentials are bundled. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_STATUSES=new Set(['active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused']);
const finalStatuses=new Set(['canceled','incomplete_expired']);
export class BillingError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status=400)=>{throw new BillingError(code,message,status);};
const id=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9_]+$').test(value);
const safeInteger=value=>Number.isSafeInteger(value)&&value>=0;
async function readBody(request,maximum){
  const declared=Number(request.headers.get('Content-Length'));
  if(Number.isFinite(declared)&&declared>maximum)fail('INVALID_DATA','Requisição muito grande.',413);
  if(!request.body)return '';
  const reader=request.body.getReader(),parts=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maximum){await reader.cancel();fail('INVALID_DATA','Requisição muito grande.',413);}parts.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('INVALID_DATA','A requisição contém texto inválido.');}
}
export function serverConfig(env){
  const read=name=>typeof env==='function'?env(name):env[name];
  let app;try{app=new URL(read('APP_URL')||'');if(app.protocol!=='https:'&&!(app.protocol==='http:'&&['127.0.0.1','localhost'].includes(app.hostname)))app=null;if(app){app.search='';app.hash='';}}catch{app=null;}
  const value={enabled:read('BILLING_ENABLED')==='true',key:read('STRIPE_SECRET_KEY')||'',webhookSecret:read('STRIPE_WEBHOOK_SECRET')||'',companyPrice:read('STRIPE_PRICE_COMPANY')||'',vehiclePrice:read('STRIPE_PRICE_VEHICLE')||'',appURL:app?.href||'',origin:app?.origin||''};
  value.ready=Boolean(app&&/^sk_(test|live)_/.test(value.key)&&/^whsec_/.test(value.webhookSecret)&&id(value.companyPrice,'price')&&id(value.vehiclePrice,'price')&&value.companyPrice!==value.vehiclePrice);
  value.live=value.key.startsWith('sk_live_');return Object.freeze(value);
}
export async function verifyStripeSignature(body,signature,secret,now=Date.now()){
  if(typeof signature!=='string'||signature.length>4096||typeof secret!=='string'||!secret)return false;
  const parts=signature.split(',').map(part=>part.trim().split('='));
  const stamp=parts.find(([key])=>key==='t')?.[1],digests=parts.filter(([key,value])=>key==='v1'&&/^[0-9a-f]{64}$/.test(value||'')).map(([,value])=>value);
  if(!/^\d+$/.test(stamp||'')||!digests.length||Math.abs(now/1000-Number(stamp))>300)return false;
  const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(stamp+'.'+body)));
  const expected=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  return digests.some(digest=>{let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^digest.charCodeAt(i);return difference===0;});
}
export function publicPlans(config,prices={}){return [
  {id:'company',name:'Por empresa',unit:'empresa',amount:prices.company?.unit_amount??null,currency:'BRL',interval:prices.company?.recurring?.interval??null},
  {id:'vehicle',name:'Por veículo ativo',unit:'veículo ativo',amount:prices.vehicle?.unit_amount??null,currency:'BRL',interval:prices.vehicle?.recurring?.interval??null}
];}
function checkPrice(price,expected){
  if(price?.id!==expected||price.active!==true||price.currency!=='brl'||!safeInteger(price.unit_amount)||!price.recurring||!['month','year'].includes(price.recurring.interval)||(price.recurring.interval_count??1)!==1)fail('BILLING_NOT_CONFIGURED','O preço recorrente mensal ou anual em reais ainda não foi configurado.',503);
  return price;
}
function subscriptionInfo(subscription,account,config){
  if(subscription?.customer!==account.stripe_customer_id||subscription.metadata?.company_id!==account.company_id||!PROVIDER_STATUSES.has(subscription.status))fail('INVALID_SUBSCRIPTION','A confirmação de assinatura não corresponde à empresa.',400);
  const items=subscription.items?.data;if(!Array.isArray(items)||items.length!==1)fail('INVALID_SUBSCRIPTION','A assinatura contém itens incompatíveis.',400);
  const item=items[0],price=typeof item.price==='string'?item.price:item.price?.id;
  const plan=price===config.companyPrice?'company':price===config.vehiclePrice?'vehicle':null;
  const end=subscription.current_period_end??item.current_period_end;
  if(!plan||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>10000||!safeInteger(end)||end===0)fail('INVALID_SUBSCRIPTION','O plano ou a quantidade da assinatura é inválido.',400);
  return {plan,status:subscription.status,quantity:item.quantity,periodEnd:new Date(end*1000).toISOString(),subscriptionId:subscription.id};
}
export function createBillingHandler({config,db,stripe,now=()=>Date.now()}){
  const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(config.origin?{'Access-Control-Allow-Origin':config.origin,'Vary':'Origin'}:{})}});
  async function prices(){return {company:checkPrice(await stripe.get('/prices/'+config.companyPrice),config.companyPrice),vehicle:checkPrice(await stripe.get('/prices/'+config.vehiclePrice),config.vehiclePrice)};}
  async function authenticate(request,body,owner){
    const authorization=request.headers.get('Authorization')||'';
    if(!authorization.startsWith('Bearer '))fail('AUTH_REQUIRED','Entre na sua conta para continuar.',401);
    const user=await db.authenticate(authorization.slice(7));
    if(!UUID.test(user?.id||''))fail('AUTH_REQUIRED','Entre novamente na sua conta.',401);
    if(body.expected_user_id!==user.id)fail('SESSION_CHANGED','A conta mudou. Entre novamente antes de continuar.',409);
    if(!UUID.test(body.companyId||''))fail('INVALID_DATA','Selecione uma empresa válida.');
    const membership=await db.membership(body.companyId,user.id);
    if(!membership||membership.active!==true||(owner&&membership.role!=='owner'))fail('FORBIDDEN',owner?'Somente o responsável pode gerenciar a assinatura.':'Você não tem acesso a esta empresa.',403);
    return {...user,role:membership.role};
  }
  async function webhook(request){
    if(!config.ready)fail('BILLING_NOT_CONFIGURED','A confirmação de pagamento não está configurada.',503);
    const raw=await readBody(request,1024*1024);
    if(!await verifyStripeSignature(raw,request.headers.get('Stripe-Signature'),config.webhookSecret,now()))fail('INVALID_SIGNATURE','Assinatura do evento inválida.',400);
    let event;try{event=JSON.parse(raw);}catch{fail('INVALID_EVENT','Evento inválido.');}
    if(!id(event.id,'evt')||event.livemode!==config.live)fail('INVALID_EVENT','Evento de outro ambiente.');
    if(!['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed'].includes(event.type))return respond({received:true,ignored:true});
    const object=event.data?.object,customer=typeof object?.customer==='string'?object.customer:object?.customer?.id;
    const subscriptionId=event.type.startsWith('customer.subscription.')?object?.id:object?.subscription;
    if(!id(customer,'cus')||!id(subscriptionId,'sub'))return respond({received:true,ignored:true});
    let account=await db.accountByCustomer(customer);if(!account)return respond({received:true,ignored:true});
    const claim=await db.acquire(account.company_id,event.id);
    if(claim.state==='processed')return respond({received:true,duplicate:true});
    if(claim.state!=='claimed')fail('BUSY','A empresa já está processando uma confirmação. Tente novamente.',409);
    try{
      account=await db.account(account.company_id);
      if(!account||account.stripe_customer_id!==customer)fail('INVALID_SUBSCRIPTION','O cliente da confirmação foi alterado.',409);
      let subscription=await stripe.get('/subscriptions/'+subscriptionId);
      if(account.stripe_subscription_id&&account.stripe_subscription_id!==subscriptionId){
        const current=await stripe.get('/subscriptions/'+account.stripe_subscription_id);
        if(!finalStatuses.has(current.status)||finalStatuses.has(subscription.status))subscription=current;
      }
      const info=subscriptionInfo(subscription,account,config);
      await db.apply({company_id:account.company_id,lease_token:claim.token,event_id:event.id,customer_id:customer,subscription_id:info.subscriptionId,plan_id:info.plan,subscription_status:info.status,quantity:info.quantity,period_end_at:info.periodEnd});
      return respond({received:true});
    }finally{await db.release(account.company_id,claim.token).catch(()=>{});}
  }
  return async request=>{
    try{
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':config.origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
      if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED',message:'Use POST.'},405);
      if(new URL(request.url).searchParams.get('webhook')==='1')return await webhook(request);
      const raw=await readBody(request,10000);
      let body;try{body=JSON.parse(raw);}catch{fail('INVALID_DATA','Requisição inválida.');}
      if(!body||typeof body!=='object'||Array.isArray(body)||!['status','checkout','portal'].includes(body.action))fail('INVALID_DATA','Operação de contratação inválida.');
      const actor=await authenticate(request,body,body.action!=='status');
      const settings=await db.settings(),enabled=Boolean(config.ready&&config.enabled&&settings?.enabled===true);
      if(body.action==='status')return respond({configured:enabled,plans:publicPlans(config,enabled?await prices():{}),entitlement:await db.entitlement(body.companyId),canManage:actor.role==='owner',portalAvailable:actor.role==='owner'&&Boolean((await db.account(body.companyId))?.stripe_customer_id)});
      if(!enabled)fail('BILLING_NOT_CONFIGURED','A contratação online ainda não está disponível. Nenhuma cobrança foi iniciada.',503);
      if(body.action==='checkout'&&!['company','vehicle'].includes(body.plan))fail('INVALID_DATA','Escolha um plano válido.');
      const claim=await db.acquire(body.companyId,null);if(claim.state!=='claimed')fail('BUSY','Já existe uma operação em andamento para esta empresa.',409);
      try{
        let account=await db.account(body.companyId);
        if(body.action==='portal'){
          if(!account?.stripe_customer_id)fail('NO_SUBSCRIPTION','Esta empresa ainda não possui um cliente de cobrança.');
          const portal=await stripe.post('/billing_portal/sessions',{customer:account.stripe_customer_id,return_url:config.appURL+'#empresa'});
          return respond({url:portal.url});
        }
        const entitlement=await db.entitlement(body.companyId);
        if(entitlement&&['active','trialing','past_due','paused'].includes(entitlement.status))fail('PLAN_ACTIVE','Use Gerenciar plano para alterar a assinatura existente.',409);
        if(account?.stripe_subscription_id){
          const current=await stripe.get('/subscriptions/'+account.stripe_subscription_id);
          if(!finalStatuses.has(current.status))fail('PLAN_ACTIVE','Use Gerenciar plano para alterar ou regularizar a assinatura existente.',409);
        }
        const company=await db.company(body.companyId);if(!company)fail('INVALID_DATA','Empresa não encontrada.');
        const planPrices=await prices(),price=body.plan==='company'?planPrices.company:planPrices.vehicle;
        const quantity=body.plan==='company'?1:Math.max(1,await db.countActiveVehicles(body.companyId));
        if(!Number.isSafeInteger(quantity)||quantity>10000)fail('INVALID_DATA','A quantidade de veículos ultrapassa o limite.');
        if(!account?.stripe_customer_id){
          const customer=await stripe.post('/customers',{name:company.name,'metadata[company_id]':body.companyId},'rodagem-customer-'+body.companyId);
          if(!id(customer.id,'cus'))fail('PROVIDER_ERROR','Não foi possível preparar o cliente de cobrança.',502);
          account=await db.updateAccount(body.companyId,{stripe_customer_id:customer.id});
        }
        if(account.checkout_id){
          const previous=await stripe.get('/checkout/sessions/'+account.checkout_id);
          if(previous.status==='open'&&account.checkout_plan===body.plan&&Number(previous.metadata?.quantity)===quantity)return respond({url:previous.url});
          if(previous.status==='open')await stripe.post('/checkout/sessions/'+account.checkout_id+'/expire',{});
          if(previous.status==='complete')fail('PAYMENT_PENDING','O pagamento anterior está sendo confirmado. Aguarde antes de abrir outra contratação.',409);
        }
        const session=await stripe.post('/checkout/sessions',{mode:'subscription',customer:account.stripe_customer_id,'line_items[0][price]':price.id,'line_items[0][quantity]':String(quantity),'metadata[company_id]':body.companyId,'metadata[quantity]':String(quantity),'subscription_data[metadata][company_id]':body.companyId,success_url:config.appURL+'?billing=return#empresa',cancel_url:config.appURL+'#empresa'},'rodagem-checkout-'+claim.token);
        if(!id(session.id,'cs')||typeof session.url!=='string'||!safeInteger(session.expires_at))fail('PROVIDER_ERROR','O serviço não retornou uma contratação válida.',502);
        await db.updateAccount(body.companyId,{checkout_id:session.id,checkout_url:session.url,checkout_plan:body.plan,checkout_expires_at:new Date(session.expires_at*1000).toISOString()});
        return respond({url:session.url,quantity,plan:body.plan});
      }finally{await db.release(body.companyId,claim.token).catch(()=>{});}
    }catch(error){
      if(error instanceof BillingError)return respond({code:error.code,message:error.message},error.status);
      return respond({code:'PROVIDER_ERROR',message:'Não foi possível confirmar a operação. Tente novamente em alguns instantes.'},502);
    }
  };
}

export function createStripeClient({key,fetcher=fetch}){
  async function request(method,path,body,idempotency){
    const response=await fetcher('https://api.stripe.com/v1'+path,{method,headers:{Authorization:'Bearer '+key,'Stripe-Version':'2024-06-20',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:new URLSearchParams(body)}:{}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw new BillingError('PROVIDER_ERROR','O serviço de pagamento recusou a operação. Confira a configuração e tente novamente.',502);return data;
  }
  return {get:path=>request('GET',path),post:(path,body,idempotency)=>request('POST',path,body,idempotency)};
}
export function createSupabaseStore({url,serviceKey,anonKey,fetcher=fetch}){
  const base=url.replace(/\/$/,'');
  async function request(path,{method='GET',body,token=serviceKey,headers={}}={}){
    const response=await fetcher(base+path,{method,headers:{apikey:token===serviceKey?serviceKey:anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new BillingError(response.status===401?'AUTH_REQUIRED':'PROVIDER_ERROR',response.status===401?'Entre novamente na sua conta.':'Não foi possível confirmar os dados da empresa.',response.status===401?401:502);
    if(response.status===204)return null;return response.json();
  }
  const rows=(table,query)=>request('/rest/v1/'+table+'?'+query);
  const first=async(table,query)=>(await rows(table,query))[0]||null;
  const rpc=(name,body)=>request('/rest/v1/rpc/'+name,{method:'POST',body});
  return {
    authenticate:token=>request('/auth/v1/user',{token}),
    membership:(company,user)=>first('business_members','company_id=eq.'+company+'&user_id=eq.'+user+'&active=eq.true&select=role,active'),
    company:company=>first('business_companies','id=eq.'+company+'&select=id,name'),
    settings:()=>first('business_billing_settings','singleton=eq.true&select=enabled,enforcement'),
    entitlement:company=>first('business_entitlements','company_id=eq.'+company+'&select=company_id,plan,status,vehicle_quantity,period_end,revision,updated_at'),
    account:company=>first('business_billing_accounts','company_id=eq.'+company+'&select=*'),
    accountByCustomer:customer=>first('business_billing_accounts','stripe_customer_id=eq.'+encodeURIComponent(customer)+'&select=*'),
    countActiveVehicles:company=>rpc('business_billing_vehicle_count',{company_id:company}),
    async updateAccount(company,patch){const result=await request('/rest/v1/business_billing_accounts?on_conflict=company_id',{method:'POST',body:{company_id:company,...patch},headers:{Prefer:'resolution=merge-duplicates,return=representation'}});return result[0];},
    acquire:(company,event)=>rpc('business_billing_acquire',{company_id:company,event_id:event}),
    release:(company,token)=>rpc('business_billing_release',{company_id:company,lease_token:token}),
    apply:data=>rpc('business_billing_apply',data)
  };
}
