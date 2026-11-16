/* Autenticação oficial por PKCE e sincronização com revisão no servidor.
 * A configuração vazia mantém o app local funcionando sem pedidos de rede. */
(() => {
  'use strict';
  const root = window;
  const TIMEOUT = 15000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let client = null;

  class CloudError extends Error {
    constructor(code, message) { super(message); this.name = 'RodagemCloudError'; this.code = code; }
  }
  function configuration() {
    const value = root.RodagemCloudConfig;
    if (!value || typeof value.url !== 'string' || !value.url.trim() ||
        typeof value.publishableKey !== 'string' || !value.publishableKey.trim()) {
      return {issue:'A entrada com Google e Facebook ainda não está disponível nesta instalação.'};
    }
    const url = value.url.trim(), key = value.publishableKey.trim();
    let parsed;
    try { parsed = new URL(url); } catch { return {issue:'A configuração de conexão desta instalação está inválida.'}; }
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) ||
        parsed.port || parsed.username || parsed.password || !['','/'].includes(parsed.pathname) || parsed.search || parsed.hash) {
      return {issue:'A configuração de conexão desta instalação está inválida.'};
    }
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(key);
    if (!publicKey && key.split('.').length === 3) {
      try {
        const encoded = key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        const decoded = JSON.parse(root.atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
        publicKey = decoded?.role === 'anon';
      } catch { publicKey = false; }
    }
    if (!publicKey) return {issue:'A configuração pública de conexão desta instalação está inválida.'};
    if (!Array.isArray(value.providers) || !value.providers.length || value.providers.some(p => !['google','facebook'].includes(p))) {
      return {issue:'Nenhuma forma de entrada válida foi ativada nesta instalação.'};
    }
    if (typeof root.supabase?.createClient !== 'function') return {issue:'A conexão não foi carregada. Reabra o app com internet para tentar novamente.'};
    return {url:parsed.origin,key,providers:[...new Set(value.providers)],issue:''};
  }
  function configured() { return !configuration().issue; }
  function configurationIssue() { return configuration().issue; }
  async function timedFetch(input, init = {}) {
    const controller = new AbortController();
    const external = init.signal;
    const abort = () => controller.abort();
    if (external?.aborted) abort();
    else external?.addEventListener('abort',abort,{once:true});
    const timeout = setTimeout(abort,TIMEOUT);
    try { return await root.fetch(input,{...init,signal:controller.signal}); }
    finally { clearTimeout(timeout); external?.removeEventListener('abort',abort); }
  }
  function connection() {
    const config = configuration();
    if (config.issue) throw new CloudError('CONFIGURATION',config.issue);
    if (!client) client = root.supabase.createClient(config.url,config.key,{
      auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true,storageKey:'minha-rodagem-supabase-auth-v1'},
      global:{fetch:timedFetch}
    });
    return client;
  }
  function failure(error, fallback = 'Não foi possível conectar sua conta. Tente novamente com internet.') {
    if (error instanceof CloudError) return error;
    if (error?.code === '28000') return new CloudError('SESSION_CHANGED','A conta foi alterada durante a sincronização. Confira a conta em uso antes de continuar.');
    if (error?.code === '40001' || error?.status === 409) return new CloudError('CONFLICT','Os dados mudaram em outro aparelho. Confira a versão da nuvem antes de enviar novamente.');
    if (error?.code === '42501' || [401,403].includes(error?.status)) return new CloudError('AUTH_REQUIRED','Entre novamente na sua conta para sincronizar.');
    if (error?.code === '22023') return new CloudError('INVALID_DATA','Não foi possível validar os dados para sincronização. Os dados locais foram mantidos.');
    return new CloudError('CONNECTION',fallback);
  }
  function publicSession(session, authoritativeUser = session?.user) {
    if (!session) return null;
    if (!UUID.test(authoritativeUser?.id || '')) throw new CloudError('AUTH_REQUIRED','Entre novamente na sua conta para continuar.');
    const text = (value,max) => typeof value === 'string' ? value.slice(0,max) : '';
    const metadata = authoritativeUser.user_metadata || {};
    const application = authoritativeUser.app_metadata || {};
    return {
      user:{id:authoritativeUser.id,email:text(authoritativeUser.email,254),
        user_metadata:{name:text(metadata.name,120),full_name:text(metadata.full_name,120),avatar_url:text(metadata.avatar_url,2048)},
        app_metadata:{provider:text(application.provider,40),providers:Array.isArray(application.providers) ? application.providers.filter(p => typeof p === 'string').slice(0,10) : []}},
      expires_at:Number.isSafeInteger(session.expires_at) ? session.expires_at : null
    };
  }
  async function getSession() {
    try {
      const {data,error} = await connection().auth.getSession();
      if (error) throw error;
      return publicSession(data?.session);
    } catch (error) { throw failure(error); }
  }
  async function verifySession(expectedUserId) {
    const session = await getSession();
    if (!session) throw new CloudError('AUTH_REQUIRED','Entre na sua conta para sincronizar.');
    try {
      const {data,error} = await connection().auth.getUser();
      if (error) throw error;
      if (data?.user?.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada. Confira a conta em uso antes de continuar.');
      if (expectedUserId !== undefined && data.user.id !== expectedUserId) throw new CloudError('SESSION_CHANGED','A conta foi alterada. Confira a conta vinculada a este perfil antes de continuar.');
      return publicSession(session,data.user);
    } catch (error) { throw failure(error); }
  }
  function onAuth(callback) {
    if (typeof callback !== 'function') throw new TypeError('Informe a função que acompanha a conta.');
    let closed = false;
    const {data} = connection().auth.onAuthStateChange((event,session) => {
      // Não aguarde outras chamadas do SDK dentro da trava do listener de auth.
      queueMicrotask(() => { if (!closed) callback(event,publicSession(session)); });
    });
    return () => { if (!closed) { closed = true; data?.subscription?.unsubscribe(); } };
  }
  function redirectURL() {
    const url = new URL('./',root.location.href);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) {
      throw new CloudError('CONFIGURATION','Abra a versão publicada do app para entrar na sua conta.');
    }
    url.hash = ''; url.search = '';
    return url.href;
  }
  async function signIn(provider) {
    const config = configuration();
    if (config.issue) throw new CloudError('CONFIGURATION',config.issue);
    if (!config.providers.includes(provider)) throw new CloudError('PROVIDER','Essa forma de entrada não está disponível nesta instalação.');
    try {
      const {error} = await connection().auth.signInWithOAuth({provider,options:{redirectTo:redirectURL(),...(provider === 'facebook' ? {scopes:'email'} : {})}});
      if (error) throw error;
    } catch (error) { throw failure(error,'Não foi possível iniciar a entrada. Tente novamente com internet.'); }
  }
  async function signOut() {
    try {
      const {error} = await connection().auth.signOut({scope:'local'});
      if (error) throw error;
    } catch (error) { throw failure(error,'Não foi possível sair da conta. Tente novamente com internet.'); }
  }
  function envelope(value, allowNull = false) {
    if (value === null && allowNull) return null;
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload) ||
        typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) {
      throw new CloudError('INVALID_RESPONSE','A cópia da nuvem não pôde ser lida. Os dados locais foram mantidos.');
    }
    return {revision:value.revision,payload:value.payload,updated_at:value.updated_at};
  }
  async function rpc(name, params, allowNull, expectedUserId) {
    if (!UUID.test(expectedUserId || '')) throw new CloudError('SESSION_CHANGED','Confira a conta vinculada a este perfil antes de sincronizar.');
    const session = await verifySession(expectedUserId);
    try {
      // O servidor compara este UID com auth.uid() antes de ler ou gravar.
      // Se o SDK trocar o token entre verifySession e o fetch, a operação falha.
      const {data,error} = await connection().rpc(name,{...params,expected_user_id:session.user.id});
      if (error) throw error;
      const current = await getSession();
      if (current?.user.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada durante a sincronização. Confira a conta em uso antes de continuar.');
      return envelope(data,allowNull);
    } catch (error) { throw failure(error); }
  }
  function load(expectedUserId) { return rpc('rodagem_load_snapshot',undefined,true,expectedUserId); }
  function save(expectedRevision,snapshot,expectedUserId) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return Promise.reject(new CloudError('INVALID_DATA','Confira os dados antes de sincronizar.'));
    }
    return rpc('rodagem_save_snapshot',{expected_revision:expectedRevision,snapshot},false,expectedUserId);
  }
  const businessRPCs = new Set(['business_list_companies','business_create_company','business_load_workspace','business_save_entity','business_archive_entity','business_invite_member','business_accept_invite','business_save_member','business_revoke_invite']);
  function profileGuard() {
    const profiles = root.RodagemProfiles;
    const id = profiles?.current().id;
    return () => {
      if (!profiles) return;
      profiles.assertCurrent();
      if (profiles.current().id !== id) throw new CloudError('SESSION_CHANGED','O perfil foi alterado. Reabra a área da empresa antes de continuar.');
    };
  }
  function businessFailure(error) {
    if (error?.code === '42501') return new CloudError('FORBIDDEN','Sua função nesta empresa não permite essa ação.');
    if (error?.code === 'BILLING_NOT_CONFIGURED') return new CloudError('BILLING_NOT_CONFIGURED','A contratação online ainda não está disponível nesta instalação.');
    if (error?.code === 'PROVIDER_ERROR') return new CloudError('PROVIDER_ERROR','O serviço de pagamento não respondeu. Tente novamente em alguns instantes.');
    if (error?.code === 'PLAN_LIMIT' || (error?.code === 'P0001' && error?.message === 'PLAN_LIMIT')) return new CloudError('PLAN_LIMIT','O limite do plano desta empresa foi atingido. Confira o plano antes de continuar.');
    return failure(error);
  }
  async function call(name,params,expectedUserId) {
    if (!businessRPCs.has(name) || !params || typeof params !== 'object' || Array.isArray(params)) throw new CloudError('INVALID_DATA','Essa operação empresarial não está disponível.');
    if (!UUID.test(expectedUserId || '')) throw new CloudError('SESSION_CHANGED','Confira a conta em uso antes de abrir sua empresa.');
    const check = profileGuard(); check();
    const session = await verifySession(expectedUserId); check();
    try {
      const {data,error} = await connection().rpc(name,{...params,expected_user_id:session.user.id});
      if (error) throw error;
      check();
      const current = await getSession(); check();
      if (current?.user.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada durante a operação. Confira a conta em uso antes de continuar.');
      return data;
    } catch (error) { throw businessFailure(error); }
  }
  async function invoke(name,body,expectedUserId) {
    if (name !== 'rodagem-billing' || !body || typeof body !== 'object' || Array.isArray(body)) throw new CloudError('INVALID_DATA','Essa operação de contratação não está disponível.');
    if (!UUID.test(expectedUserId || '')) throw new CloudError('SESSION_CHANGED','Confira a conta em uso antes de continuar.');
    const check = profileGuard(); check();
    const session = await verifySession(expectedUserId); check();
    try {
      const {data,error} = await connection().functions.invoke(name,{body:{...body,expected_user_id:session.user.id}});
      if (error) {
        let details = null;
        try { details = await error.context?.clone?.().json(); } catch { /* Use uma mensagem pública sem o retorno bruto. */ }
        if (details && typeof details.code === 'string') throw businessFailure({code:details.code,status:error.context?.status});
        throw error;
      }
      check();
      const current = await getSession(); check();
      if (current?.user.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada durante a operação. Confira a conta em uso antes de continuar.');
      return data;
    } catch (error) { throw businessFailure(error); }
  }
  root.RodagemCloud = Object.freeze({configured,configurationIssue,ready:getSession,getSession,verifySession,onAuth,signIn,signOut,load,save,call,invoke});
})();
