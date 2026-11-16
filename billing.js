/* A assinatura só muda após confirmação do provedor no servidor. */
(() => {
  'use strict';
  const root=window;
  const catalog=Object.freeze([
    Object.freeze({id:'company',name:'Por empresa',unit:'empresa',amount:null,currency:'BRL'}),
    Object.freeze({id:'vehicle',name:'Por veículo ativo',unit:'veículo ativo',amount:null,currency:'BRL'})
  ]);
  const configured=()=>Boolean(root.RodagemBillingConfig?.enabled===true && root.RodagemCloud?.configured());
  const clone=value=>JSON.parse(JSON.stringify(value));
  function error(code,message){return Object.assign(new Error(message),{code});}
  function profileCheck(){const p=root.RodagemProfiles,id=p?.current().id;return()=>{p?.assertCurrent();if(p&&p.current().id!==id)throw error('SESSION_CHANGED','O perfil mudou. Reabra a empresa antes de continuar.');};}
  async function context(companyId,owner=false){
    if(!configured())throw error('BILLING_NOT_CONFIGURED','A contratação online ainda não está disponível. Nenhuma cobrança foi iniciada.');
    const repo=root.RodagemBusiness;
    if(!repo||repo.getMode()!=='cloud')throw error('AUTH_REQUIRED','Abra uma empresa da sua conta para gerenciar a assinatura.');
    const check=profileCheck();check();
    const workspace=repo.getCurrentWorkspace();
    if(!workspace||workspace.company.id!==companyId)throw error('SESSION_CHANGED','Selecione novamente a empresa antes de continuar.');
    if(owner&&workspace.membership.role!=='owner')throw error('FORBIDDEN','Somente o responsável pela empresa pode gerenciar a assinatura.');
    const session=await repo.getSession();check();
    if(session?.user?.id!==workspace.membership.userId)throw error('SESSION_CHANGED','A conta mudou. Entre novamente antes de continuar.');
    const assert=()=>{check();const now=repo.getCurrentWorkspace();if(repo.getMode()!=='cloud'||now?.company.id!==companyId||now?.membership.userId!==session.user.id||repo.getCloudUserId?.()!==session.user.id)throw error('SESSION_CHANGED','A conta ou empresa mudou. A operação foi interrompida.');};
    assert();return {userId:session.user.id,assert};
  }
  async function request(companyId,action,extra={},owner=false){
    const ctx=await context(companyId,owner);
    const data=await root.RodagemCloud.invoke('rodagem-billing',{action,companyId,...extra},ctx.userId);
    ctx.assert();return {data,ctx};
  }
  function safeURL(value){
    let url;try{url=new URL(value);}catch{throw error('INVALID_RESPONSE','O serviço não retornou um endereço válido.');}
    if(url.protocol!=='https:'||url.username||url.password||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw error('INVALID_RESPONSE','O endereço de pagamento não foi reconhecido.');
    return url.href;
  }
  async function status(companyId){
    if(!configured())return {configured:false,plans:clone(catalog),entitlement:null,canManage:false,portalAvailable:false};
    const {data}=await request(companyId,'status');
    if(!data||typeof data.configured!=='boolean'||!Array.isArray(data.plans))throw error('INVALID_RESPONSE','Não foi possível conferir a assinatura.');
    return data;
  }
  async function redirect(companyId,action,extra){
    const {data,ctx}=await request(companyId,action,extra,true);const url=safeURL(data?.url);
    ctx.assert();root.location.assign(url);return {url};
  }
  function checkout(companyId,plan){
    if(!['company','vehicle'].includes(plan))return Promise.reject(error('INVALID_DATA','Escolha um plano válido.'));
    return redirect(companyId,'checkout',{plan});
  }
  root.RodagemBilling=Object.freeze({configured,plans:()=>clone(catalog),status,loadStatus:status,checkout,portal:companyId=>redirect(companyId,'portal',{})});
})();
