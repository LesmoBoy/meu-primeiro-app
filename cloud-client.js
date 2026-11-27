/* Autenticação oficial por OAuth/PKCE ou ID token e revisão no servidor.
 * A configuração vazia mantém o app local funcionando sem pedidos de rede. */
(() => {
  'use strict';
  const root = window;
  const TIMEOUT = 15000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const GOOGLE_CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
  let client = null, googleAttempt = null, refreshAttempt = null, logoutAttempt = null;
  let authVersion = 0, observedUserId;

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
    const googleAuthMode = value.googleAuthMode === undefined ? 'oauth' : value.googleAuthMode;
    if (!['oauth','id_token'].includes(googleAuthMode)) return {issue:'A forma de entrada com Google desta instalação está inválida.'};
    const googleClientId = value.googleClientId === undefined ? '' : typeof value.googleClientId === 'string' ? value.googleClientId.trim() : null;
    if (googleClientId === null || googleClientId && (googleClientId.length > 256 || !GOOGLE_CLIENT_ID.test(googleClientId)) || googleAuthMode === 'id_token' && !googleClientId) {
      return {issue:'O identificador público de entrada com Google desta instalação está inválido.'};
    }
    if (typeof root.supabase?.createClient !== 'function') return {issue:'A conexão não foi carregada. Reabra o app com internet para tentar novamente.'};
    return {url:parsed.origin,key,providers:[...new Set(value.providers)],googleAuthMode,googleClientId,issue:''};
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
      // A logical CAS conflict requires user review, never an automatic replay.
      db:{retry:false},
      global:{fetch:timedFetch}
    });
    return client;
  }
  function failure(error, fallback = 'Não foi possível conectar sua conta. Tente novamente com internet.') {
    if (error instanceof CloudError) return error;
    if (error?.name === 'AuthSessionMissingError' || ['session_not_found','refresh_token_not_found','refresh_token_already_used','bad_jwt','jwt_expired','user_not_found','user_banned'].includes(error?.code)) {
      return new CloudError('AUTH_REQUIRED','A sessão expirou ou não está mais disponível. Entre novamente na sua conta.');
    }
    if (error?.code === '28000') return new CloudError('SESSION_CHANGED','A conta foi alterada durante a sincronização. Confira a conta em uso antes de continuar.');
    if (['40001','PT409'].includes(error?.code) || error?.status === 409) return new CloudError('CONFLICT','Os dados mudaram em outro aparelho. Confira a versão da nuvem antes de enviar novamente.');
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
  function observeSession(session) {
    const id = session?.user?.id || null;
    if (observedUserId !== undefined && observedUserId !== id) authVersion++;
    observedUserId = id;
  }
  async function getSession() {
    try {
      const {data,error} = await connection().auth.getSession();
      if (error) throw error;
      const session = publicSession(data?.session);
      observeSession(session);
      return session;
    } catch (error) { throw failure(error); }
  }
  async function verifySession(expectedUserId) {
    assertNoLogout();
    const check = profileGuard(); check();
    if (expectedUserId !== undefined && !UUID.test(expectedUserId || '')) throw new CloudError('SESSION_CHANGED','Confira a conta em uso antes de continuar.');
    const version = authVersion;
    try {
      // getSession can renew an expired token in the SDK, but its cached user
      // never authorizes an operation. getUser is the server verification.
      const session = await getSession(); check();
      if (!session) throw new CloudError('AUTH_REQUIRED','Entre na sua conta para sincronizar.');
      if (version !== authVersion) throw new CloudError('SESSION_CHANGED','A conta mudou durante a verificação. Confira a conta em uso antes de continuar.');
      if (expectedUserId !== undefined && session.user.id !== expectedUserId) throw new CloudError('SESSION_CHANGED','A conta foi alterada. Confira a conta vinculada a este perfil antes de continuar.');
      const {data,error} = await connection().auth.getUser();
      check();
      if (error) throw error;
      if (!UUID.test(data?.user?.id || '')) throw new CloudError('AUTH_REQUIRED','O servidor não confirmou sua conta. Entre novamente para continuar.');
      if (version !== authVersion) throw new CloudError('SESSION_CHANGED','A conta mudou durante a verificação. Confira a conta em uso antes de continuar.');
      if (data?.user?.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada. Confira a conta em uso antes de continuar.');
      if (expectedUserId !== undefined && data.user.id !== expectedUserId) throw new CloudError('SESSION_CHANGED','A conta foi alterada. Confira a conta vinculada a este perfil antes de continuar.');
      const current = await getSession(); check();
      if (version !== authVersion || current?.user?.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta mudou durante a verificação. Confira a conta em uso antes de continuar.');
      if (current.expires_at !== null && current.expires_at * 1000 <= Date.now()) throw new CloudError('AUTH_REQUIRED','A sessão expirou. Entre novamente na sua conta antes de continuar.');
      return publicSession(current,data.user);
    } catch (error) { throw failure(error); }
  }
  async function refreshSession(expectedUserId) {
    assertNoLogout();
    if (refreshAttempt) throw new CloudError('AUTH_PENDING','Uma renovação de sessão já está em andamento. Aguarde a conclusão.');
    const attempt = {}; refreshAttempt = attempt;
    const version = authVersion;
    try {
      const check = profileGuard();
      check();
      if (expectedUserId !== undefined && !UUID.test(expectedUserId || '')) throw new CloudError('SESSION_CHANGED','Confira a conta em uso antes de continuar.');
      const session = await getSession(); check();
      if (!session) throw new CloudError('AUTH_REQUIRED','Entre na sua conta antes de renovar a sessão.');
      if (version !== authVersion) throw new CloudError('SESSION_CHANGED','A conta mudou durante a renovação. Confira a conta em uso.');
      const userId = session.user.id;
      if (expectedUserId !== undefined && userId !== expectedUserId) throw new CloudError('SESSION_CHANGED','A conta foi alterada. Confira a conta em uso antes de continuar.');
      const {data,error} = await connection().auth.refreshSession(); check();
      if (error) throw error;
      if (version !== authVersion || data?.session?.user?.id !== userId) throw new CloudError('SESSION_CHANGED','A conta mudou durante a renovação. Entre novamente antes de continuar.');
      const verified = await verifySession(userId); check();
      if (version !== authVersion) throw new CloudError('SESSION_CHANGED','A conta mudou durante a renovação. Confira a conta em uso.');
      return verified;
    } catch (error) { throw failure(error,'Não foi possível renovar a sessão. Confira a internet e entre novamente se necessário.'); }
    finally { if (refreshAttempt === attempt) refreshAttempt = null; }
  }
  function onAuth(callback) {
    if (typeof callback !== 'function') throw new TypeError('Informe a função que acompanha a conta.');
    let closed = false;
    const {data} = connection().auth.onAuthStateChange((event,session) => {
      // Não aguarde outras chamadas do SDK dentro da trava do listener de auth.
      let value;
      try { value = publicSession(session); } catch { value = null; }
      observeSession(value);
      queueMicrotask(() => { if (!closed) callback(event,value); });
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
    assertNoLogout();
    const config = configuration();
    if (config.issue) throw new CloudError('CONFIGURATION',config.issue);
    if (!config.providers.includes(provider)) throw new CloudError('PROVIDER','Essa forma de entrada não está disponível nesta instalação.');
    if (provider === 'google' && config.googleAuthMode === 'id_token') return signInGoogleIdToken(config);
    try {
      if (googleAttempt) googleAttempt.cancelled = true;
      authVersion++;
      const {error} = await connection().auth.signInWithOAuth({provider,options:{redirectTo:redirectURL(),...(provider === 'facebook' ? {scopes:'email'} : {})}});
      if (error) throw error;
      return null;
    } catch (error) { throw failure(error,'Não foi possível iniciar a entrada. Tente novamente com internet.'); }
  }
  async function signInGoogleIdToken(config) {
    if (googleAttempt) throw new CloudError('AUTH_PENDING','Já existe uma entrada com Google em andamento. Conclua ou cancele a janela aberta.');
    authVersion++;
    const attempt = {}; googleAttempt = attempt;
    try {
      const guard = profileGuard();
      const check = () => {
        if (attempt.cancelled) throw new CloudError('SESSION_CHANGED','A entrada foi interrompida pela saída ou troca de conta. Confira a conta em uso antes de continuar.');
        try { guard(); } catch { throw new CloudError('SESSION_CHANGED','O perfil mudou durante a entrada. Reabra o perfil antes de tentar novamente.'); }
      };
      check();
      const encoder = root.TextEncoder || (typeof TextEncoder === 'function' ? TextEncoder : null);
      if (typeof root.crypto?.getRandomValues !== 'function' || typeof root.crypto.subtle?.digest !== 'function' || typeof encoder !== 'function') {
        throw new CloudError('UNSUPPORTED_BROWSER','Este navegador não oferece a conexão segura necessária para entrar com Google. Atualize-o e tente novamente.');
      }
      if (typeof root.RodagemGoogleIdentity?.requestCredential !== 'function') {
        throw new CloudError('GOOGLE_UNAVAILABLE','A conexão com Google não foi carregada. Reabra o app com internet e tente novamente.');
      }
      const hex = bytes => Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
      const rawNonce = hex(root.crypto.getRandomValues(new Uint8Array(32)));
      const hash = await root.crypto.subtle.digest('SHA-256',new encoder().encode(rawNonce));
      check();
      let credential;
      try { credential = await root.RodagemGoogleIdentity.requestCredential({clientId:config.googleClientId,nonce:hex(new Uint8Array(hash))}); }
      catch (cause) {
        if (cause?.code === 'CANCELLED' || cause?.name === 'AbortError') throw new CloudError('CANCELLED','A entrada com Google foi cancelada. Seus dados locais foram mantidos.');
        throw new CloudError('GOOGLE_UNAVAILABLE','Não foi possível receber a confirmação do Google. Confira sua conexão e tente novamente.');
      }
      check();
      if (!validIdTokenShape(credential)) {
        throw new CloudError('INVALID_CREDENTIAL','O Google não retornou uma identificação válida. Tente entrar novamente.');
      }
      // The SDK's ID-token exchange does not share signOut's auth lock. Keep
      // this promise so an explicit logout can finish after it, without a
      // delayed exchange silently signing the user back in.
      attempt.exchange = connection().auth.signInWithIdToken({provider:'google',token:credential,nonce:rawNonce});
      const {error} = await attempt.exchange;
      if (error) throw error;
      check();
      return null;
    } catch (cause) { throw failure(cause,'Não foi possível concluir a entrada com Google. Tente novamente com internet.'); }
    finally { if (googleAttempt === attempt) googleAttempt = null; }
  }
  function validIdTokenShape(value) {
    if (typeof value !== 'string' || value.length > 65536 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
    try {
      const parts = value.split('.').slice(0,2).map(part => {
        const encoded = part.replace(/-/g,'+').replace(/_/g,'/');
        return JSON.parse(root.atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
      });
      // Apenas formato: assinatura, issuer, audience e nonce são autenticados
      // pelo Supabase. Decodificar o JWT não torna suas claims confiáveis.
      return parts.every(part => part && typeof part === 'object' && !Array.isArray(part)) && typeof parts[0].alg === 'string';
    } catch { return false; }
  }
  function assertNoLogout() {
    if (logoutAttempt) throw new CloudError('AUTH_PENDING','A saída da conta está em andamento. Aguarde sua conclusão antes de continuar.');
  }
  async function signOut() {
    if (logoutAttempt) return logoutAttempt;
    // Invalidate a pending verification at the user's logout request, even if
    // the SDK is waiting for an earlier refresh to release its auth lock.
    authVersion++;
    const attempt = googleAttempt;
    if (attempt) attempt.cancelled = true;
    const exchange = attempt?.exchange;
    const operation = Promise.resolve().then(async () => {
      try {
        const auth = connection().auth;
        if (exchange) {
          let before;
          try { before = await auth.getSession(); }
          catch { /* A broken old session must not skip waiting for the exchange. */ }
          // Only wait for HTTP already sent, never for the Google popup.
          let result;
          try { result = await exchange; } catch { /* Still complete logout. */ }
          const current = await auth.getSession();
          if (current.error) throw current.error;
          const intendedId = result?.data?.user?.id || result?.data?.session?.user?.id || before?.data?.session?.user?.id || null;
          if (current.data?.session && current.data.session.user?.id !== intendedId) {
            throw new CloudError('SESSION_CHANGED','Outra conta entrou durante a saída. Confira a conta em uso antes de sair novamente.');
          }
        }
        const {error} = await auth.signOut({scope:'local'});
        if (error) throw error;
      } catch (error) { throw failure(error,'Não foi possível sair da conta. Tente novamente com internet.'); }
    });
    logoutAttempt = operation;
    try { return await operation; }
    finally { if (logoutAttempt === operation) logoutAttempt = null; }
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
    const check = profileGuard(); check();
    const session = await verifySession(expectedUserId); check();
    const version = authVersion;
    try {
      // O servidor compara este UID com auth.uid() antes de ler ou gravar.
      // Se o SDK trocar o token entre verifySession e o fetch, a operação falha.
      const {data,error} = await connection().rpc(name,{...params,expected_user_id:session.user.id});
      if (error) throw error;
      check();
      const current = await getSession(); check();
      if (version !== authVersion || current?.user.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada durante a sincronização. Confira a conta em uso antes de continuar.');
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
      try { profiles.assertCurrent(); }
      catch { throw new CloudError('SESSION_CHANGED','O perfil foi alterado. Reabra a área da conta antes de continuar.'); }
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
    const version = authVersion;
    try {
      const {data,error} = await connection().rpc(name,{...params,expected_user_id:session.user.id});
      if (error) throw error;
      check();
      const current = await getSession(); check();
      if (version !== authVersion || current?.user.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada durante a operação. Confira a conta em uso antes de continuar.');
      return data;
    } catch (error) { throw businessFailure(error); }
  }
  async function invoke(name,body,expectedUserId) {
    if (name !== 'rodagem-billing' || !body || typeof body !== 'object' || Array.isArray(body)) throw new CloudError('INVALID_DATA','Essa operação de contratação não está disponível.');
    if (!UUID.test(expectedUserId || '')) throw new CloudError('SESSION_CHANGED','Confira a conta em uso antes de continuar.');
    const check = profileGuard(); check();
    const session = await verifySession(expectedUserId); check();
    const version = authVersion;
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
      if (version !== authVersion || current?.user.id !== session.user.id) throw new CloudError('SESSION_CHANGED','A conta foi alterada durante a operação. Confira a conta em uso antes de continuar.');
      return data;
    } catch (error) { throw businessFailure(error); }
  }
  root.RodagemCloud = Object.freeze({configured,configurationIssue,ready:getSession,getSession,verifySession,refreshSession,onAuth,signIn,signOut,load,save,call,invoke});
})();
