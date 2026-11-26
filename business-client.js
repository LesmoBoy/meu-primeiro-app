/* Área empresarial: o modo local organiza este aparelho; permissões online são
 * verificadas no servidor. Nenhum dado local é enviado ao alternar de modo. */
(() => {
  'use strict';
  const root = window, profiles = root.RodagemProfiles, core = root.RodagemBusinessCore, cloud = root.RodagemCloud;
  if (!profiles || !core) return;
  const key = profiles.key('minha-rodagem-business-v1');
  const profileId = profiles.current().id;
  const MAX_BYTES = 5 * 1024 * 1024;
  const kinds = {vehicle:'vehicles',trip:'trips',reminder:'reminders',member:'members'};
  const roles = ['owner','manager','finance','driver'];
  const listeners = new Set();
  let mode = 'local', epoch = 0, stale = false, userId = null, workspace = null, unsubscribeAuth = null;
  const copy = value => value === null ? null : JSON.parse(JSON.stringify(value));
  function error(code,message) { const cause = new Error(message); cause.code = code; return cause; }
  function uuid() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char => { const n = Math.floor(Math.random()*16); return (char === 'x' ? n : (n&3)|8).toString(16); });
  }
  const now = () => new Date().toISOString();
  function emit(type) {
    const event = {type,mode,companyId:workspace?.company.id || null};
    for (const listener of listeners) { try { listener(event); } catch { /* Uma tela não pode desfazer uma gravação confirmada. */ } }
  }
  function assertProfile() {
    profiles.assertCurrent();
    if (stale || profiles.current().id !== profileId) throw error('SESSION_CHANGED','O perfil mudou. Recarregue antes de abrir ou salvar dados da empresa.');
    if (root.localStorage.getItem(profiles.key('minha-rodagem-sync-journal-v1')) !== null) throw error('RECOVERY_PENDING','Uma recuperação está pendente. Reabra o app antes de salvar.');
  }
  function scope() { assertProfile(); return {epoch,mode,userId}; }
  function check(context) {
    assertProfile();
    if (context.epoch !== epoch || context.mode !== mode || context.userId !== userId) throw error('SESSION_CHANGED','A conta ou o modo foi alterado durante a operação. Atualize a área da empresa.');
  }
  function sized(value) {
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || new Blob([text]).size > MAX_BYTES) throw error('INVALID_DATA','O backup empresarial excede o limite de 5 MB.');
    return text;
  }
  function empty() { return core.emptyState ? core.emptyState() : {version:1,companies:[],members:[],vehicles:[],trips:[],reminders:[]}; }
  function validateLocal(value) {
    const state = core.validateState(value);
    for (const company of state.companies) if (!state.members.some(member => member.companyId === company.id && member.role === 'owner' && member.status === 'active' && !member.archivedAt)) throw error('INVALID_DATA','Cada empresa local precisa manter pelo menos um responsável ativo.');
    return state;
  }
  function read() {
    assertProfile();
    const raw = root.localStorage.getItem(key);
    if (raw === null) return {raw,state:empty()};
    try { return {raw,state:validateLocal(JSON.parse(raw))}; }
    catch { throw error('UNREADABLE','Não consegui abrir os dados empresariais. Eles foram preservados; restaure um backup empresarial válido.'); }
  }
  function localWorkspace(state,id) {
    const company = state.companies.find(item => item.id === id);
    if (!company) throw error('NOT_FOUND','Esta empresa não foi encontrada neste aparelho.');
    const members = state.members.filter(item => item.companyId === id);
    const owner = members.find(item => item.role === 'owner' && !item.archivedAt && item.status === 'active');
    return core.validateWorkspace({company,membership:{userId:owner?.userId ?? null,memberId:owner?.id || null,role:'owner'},members,
      vehicles:state.vehicles.filter(item => item.companyId === id),trips:state.trips.filter(item => item.companyId === id),
      reminders:state.reminders.filter(item => item.companyId === id),entitlement:null});
  }
  function locked(action) {
    return root.navigator?.locks?.request ? root.navigator.locks.request(key,{mode:'exclusive'},action) : Promise.resolve().then(action);
  }
  async function mutate(action) {
    const context = scope();
    if (mode !== 'local') throw error('MODE','Esta operação precisa do modo local.');
    return locked(() => {
      check(context);
      const before = read();
      const result = action(before.state);
      const canonical = validateLocal(before.state);
      const text = sized(canonical);
      check(context);
      if (root.localStorage.getItem(key) !== before.raw) throw error('CONFLICT','Os dados empresariais mudaram em outra aba. Atualize antes de salvar.');
      try { root.localStorage.setItem(key,text); }
      catch { throw error('STORAGE','Não há espaço para salvar os dados da empresa. Os dados anteriores foram mantidos.'); }
      if (workspace) workspace = localWorkspace(canonical,workspace.company.id);
      emit('changed');
      return copy(result);
    });
  }
  function requireWorkspace() {
    assertProfile();
    if (!workspace) throw error('COMPANY_REQUIRED','Selecione uma empresa antes de continuar.');
    return workspace;
  }
  function requireCompany(id) {
    const current = requireWorkspace();
    if (id !== undefined && id !== current.company.id) throw error('INVALID_DATA','O registro pertence a outra empresa.');
    return current.company.id;
  }
  function listenAuth() {
    if (unsubscribeAuth || !cloud?.configured()) return;
    unsubscribeAuth = cloud.onAuth((_event,session) => {
      if (mode === 'cloud' && session?.user?.id !== userId) {
        userId = null; workspace = null; epoch++; emit('auth');
      }
    });
  }
  async function remoteSession(context = scope()) {
    if (mode !== 'cloud' || !userId) throw error('AUTH_REQUIRED','Conecte sua conta e selecione Empresas da minha conta para continuar.');
    let session;
    try { session = await cloud.verifySession(userId); }
    catch (cause) {
      if (['SESSION_CHANGED','AUTH_REQUIRED'].includes(cause.code)) { workspace = null; userId = null; epoch++; emit('auth'); }
      throw cause;
    }
    check(context);
    if (session?.user?.id !== context.userId) throw error('SESSION_CHANGED','A conta foi alterada. Atualize a área da empresa.');
    return session;
  }
  async function remoteCall(name,params,context = scope()) {
    if (context.mode !== 'cloud') throw error('MODE','Selecione as empresas da sua conta para continuar.');
    await remoteSession(context); check(context);
    const result = await cloud.call(name,params,context.userId);
    check(context);
    return result;
  }
  async function selectMode(value) {
    assertProfile();
    if (!['local','cloud'].includes(value)) throw error('MODE','Escolha empresas deste aparelho ou da sua conta.');
    if (value === 'local') { mode = 'local'; userId = null; workspace = null; epoch++; emit('mode'); return mode; }
    if (!cloud?.configured()) throw error('CONFIGURATION','As empresas online ainda não estão disponíveis nesta instalação. Use o modo neste aparelho.');
    const captured = scope();
    const session = await cloud.verifySession();
    check(captured);
    if (!session?.user?.id) throw error('AUTH_REQUIRED','Entre na sua conta em Meu perfil antes de acessar empresas online.');
    mode = 'cloud'; userId = session.user.id; workspace = null; epoch++; listenAuth(); emit('mode');
    return mode;
  }
  async function listCompanies() {
    const context = scope();
    if (mode === 'local') return read().state.companies.map(company => ({...company,role:'owner'}));
    const result = await remoteCall('business_list_companies',{},context);
    if (!Array.isArray(result)) throw error('INVALID_RESPONSE','A lista de empresas não pôde ser lida. Atualize antes de continuar.');
    return result.map(company => ({...core.validateCompany(company),role:roles.includes(company.role) ? company.role : (() => { throw error('INVALID_RESPONSE','Sua função na empresa não foi confirmada.'); })()}));
  }
  async function createCompany(name) {
    epoch++;
    const context = scope();
    const company = core.validateCompany({id:uuid(),name,createdAt:now(),revision:1,archivedAt:null});
    if (mode === 'cloud') {
      const result = await remoteCall('business_create_company',{company_name:company.name},context);
      const validated = core.validateWorkspace(result); check(context); workspace = validated; emit('company'); return copy(workspace);
    }
    const owner = core.validateMember({id:uuid(),companyId:company.id,userId:null,name:profiles.current().name,email:'',role:'owner',status:'active',revision:1,archivedAt:null});
    await mutate(state => { state.companies.push(company); state.members.push(owner); return company; });
    check(context); workspace = localWorkspace(read().state,company.id); emit('company'); return copy(workspace);
  }
  async function loadCompany(id) {
    // Uma resposta lenta da empresa anterior não pode substituir a seleção nova.
    epoch++;
    const context = scope();
    let result;
    if (mode === 'local') result = localWorkspace(read().state,id);
    else result = core.validateWorkspace(await remoteCall('business_load_workspace',{company_id:id},context));
    if (result.company.id !== id) throw error('INVALID_RESPONSE','A resposta não corresponde à empresa selecionada. Atualize antes de continuar.');
    check(context); workspace = result; emit('company'); return copy(workspace);
  }
  function metadata(kind,input,expectedRevision,companyId) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !kinds[kind]) throw error('INVALID_DATA','Confira o tipo e os dados do registro.');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw error('INVALID_DATA','A revisão do registro é inválida.');
    if (input.companyId !== undefined && input.companyId !== companyId) throw error('INVALID_DATA','O registro pertence a outra empresa.');
    return {...input,id:input.id || uuid(),companyId,revision:expectedRevision+1,archivedAt:input.archivedAt ?? null,
      ...(kind === 'trip' ? {createdAt:input.createdAt || now()} : {})};
  }
  async function saveEntity(kind,input,expectedRevision = 0) {
    if (kind === 'member') return saveMember(input,expectedRevision);
    const context = scope(), companyId = requireCompany(input?.companyId);
    const data = metadata(kind,input,expectedRevision,companyId), collection = kinds[kind];
    if (!['vehicle','trip','reminder'].includes(kind)) throw error('INVALID_DATA','Esse tipo de registro não está disponível.');
    if (mode === 'cloud') {
      const previous = workspace[collection].find(item => item.id === data.id);
      core.validateEntity(kind,data,workspace,{forWrite:true,previous});
      const result = await remoteCall('business_save_entity',{company_id:companyId,entity_kind:kind,entity_id:data.id,expected_revision:expectedRevision,entity_data:data},context);
      const validated = core.validateEntity(kind,result,workspace); check(context);
      if (validated.id !== data.id || validated.companyId !== companyId || validated.revision !== expectedRevision+1) throw error('INVALID_RESPONSE','O registro não confirmou a revisão esperada. Atualize a empresa antes de salvar novamente.');
      workspace = {...workspace,[collection]:workspace[collection].filter(item => item.id !== validated.id).concat(validated)};
      workspace = core.validateWorkspace(workspace); emit('changed'); return copy(validated);
    }
    return mutate(state => {
      const previous = state[collection].find(item => item.id === data.id);
      if (previous && previous.companyId !== companyId) throw error('INVALID_DATA','O registro pertence a outra empresa.');
      if ((!previous && expectedRevision !== 0) || (previous && previous.revision !== expectedRevision)) throw error('CONFLICT','O registro mudou. Atualize a empresa antes de salvar.');
      const entity = core.validateEntity(kind,data,state,{forWrite:true,previous});
      state[collection] = state[collection].filter(item => item.id !== entity.id).concat(entity);
      return entity;
    });
  }
  async function archiveEntity(kind,id,expectedRevision) {
    if (kind === 'member') return archiveMember(id,expectedRevision);
    const context = scope(), companyId = requireCompany(), collection = kinds[kind];
    if (!['vehicle','trip','reminder'].includes(kind)) throw error('INVALID_DATA','Esse registro não pode ser arquivado.');
    if (mode === 'cloud') {
      const result = await remoteCall('business_archive_entity',{company_id:companyId,entity_kind:kind,entity_id:id,expected_revision:expectedRevision},context);
      const entity = core.validateEntity(kind,result,workspace); check(context);
      if (entity.id !== id || entity.companyId !== companyId || entity.revision !== expectedRevision+1 || !entity.archivedAt) throw error('INVALID_RESPONSE','O arquivamento não confirmou a revisão esperada. Atualize a empresa.');
      workspace = core.validateWorkspace({...workspace,[collection]:workspace[collection].filter(item => item.id !== id).concat(entity)});
      emit('changed'); return copy(entity);
    }
    return mutate(state => {
      const previous = state[collection].find(item => item.id === id && item.companyId === companyId);
      if (!previous) throw error('NOT_FOUND','Registro indisponível nesta empresa.');
      if (previous.revision !== expectedRevision) throw error('CONFLICT','O registro mudou. Atualize antes de arquivar.');
      const entity = {...previous,archivedAt:now(),revision:previous.revision+1,...(kind === 'vehicle' ? {active:false} : {})};
      state[collection] = state[collection].map(item => item.id === id ? entity : item);
      return entity;
    });
  }
  async function saveMember(input,expectedRevision = 0) {
    const context = scope(), companyId = requireCompany(input?.companyId);
    const active = input?.active !== undefined ? input.active : !input?.archivedAt;
    const data = metadata('member',{...input,archivedAt:active ? null : input?.archivedAt || now(),status:input?.status || 'active',userId:input?.userId ?? null,email:input?.email || ''},expectedRevision,companyId);
    if (mode === 'cloud') {
      const previous = workspace.members.find(item => item.id === data.id);
      if (!previous || previous.status !== 'active') throw error('INVALID_DATA','Convide a pessoa e aguarde o aceite antes de editar seu acesso.');
      const result = await remoteCall('business_save_member',{company_id:companyId,member_id:data.id,expected_revision:expectedRevision,member_data:{name:data.name,role:data.role,active:Boolean(active)}},context);
      const entity = core.validateMember(result); check(context);
      if (entity.id !== data.id || entity.companyId !== companyId || entity.revision !== expectedRevision+1 || entity.userId !== previous.userId || entity.email !== previous.email) throw error('INVALID_RESPONSE','O acesso não confirmou os dados esperados. Atualize a equipe antes de continuar.');
      if (entity.id === workspace.membership.memberId && (entity.archivedAt || entity.role !== workspace.membership.role)) {
        if (entity.archivedAt) { workspace = null; epoch++; emit('access'); }
        else await loadCompany(companyId);
        return copy(entity);
      }
      workspace = core.validateWorkspace({...workspace,members:workspace.members.filter(item => item.id !== entity.id).concat(entity)}); emit('changed'); return copy(entity);
    }
    return mutate(state => {
      const previous = state.members.find(item => item.id === data.id);
      if (previous && previous.companyId !== companyId) throw error('INVALID_DATA','Esta pessoa pertence a outra empresa.');
      if ((!previous && expectedRevision !== 0) || (previous && previous.revision !== expectedRevision)) throw error('CONFLICT','O acesso mudou. Atualize a equipe antes de salvar.');
      const entity = core.validateMember(data);
      if (previous?.role === 'owner' && !previous.archivedAt && (entity.role !== 'owner' || entity.archivedAt) && !state.members.some(item => item.companyId === companyId && item.id !== entity.id && item.role === 'owner' && item.status === 'active' && !item.archivedAt)) throw error('INVALID_DATA','A empresa precisa manter pelo menos um responsável ativo.');
      state.members = state.members.filter(item => item.id !== entity.id).concat(entity); return entity;
    });
  }
  function archiveMember(id,revision) {
    const previous = requireWorkspace().members.find(item => item.id === id);
    if (!previous) return Promise.reject(error('NOT_FOUND','Pessoa indisponível nesta empresa.'));
    return saveMember({...previous,active:false,archivedAt:now()},revision);
  }
  async function inviteMember(input) {
    if (mode === 'local') return {member:await saveMember({...input,status:'active',userId:null},0)};
    const context = scope(), companyId = requireCompany();
    const result = await remoteCall('business_invite_member',{company_id:companyId,invite_email:input.email,invite_name:input.name,invite_role:input.role},context);
    if (!result || typeof result.token !== 'string' || !/^[0-9a-f]{64}$/.test(result.token)) throw error('INVALID_RESPONSE','O convite não pôde ser confirmado. Atualize a equipe antes de tentar novamente.');
    const member = core.validateMember(result.member); check(context);
    workspace = core.validateWorkspace({...workspace,members:workspace.members.filter(item => !(item.status === 'invited' && item.email.toLocaleLowerCase('pt-BR') === member.email.toLocaleLowerCase('pt-BR'))).concat(member)});
    emit('changed'); return {member:copy(member),token:result.token,expiresAt:result.expiresAt};
  }
  async function revokeInvite(id) {
    const context = scope(), companyId = requireCompany();
    if (mode !== 'cloud') throw error('MODE','No modo local, arquive o contato da equipe.');
    await remoteCall('business_revoke_invite',{company_id:companyId,invite_id:id},context);
    return loadCompany(companyId);
  }
  async function acceptInvite(token) {
    const context = scope();
    if (mode !== 'cloud') throw error('MODE','Entre na conta do convite e selecione Empresas da minha conta para aceitá-lo.');
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw error('INVALID_DATA','Informe o código válido do convite.');
    const result = await remoteCall('business_accept_invite',{invite_token:token},context);
    const validated = core.validateWorkspace(result); check(context); workspace = validated; emit('company'); return copy(workspace);
  }
  function exportLocal() {
    assertProfile();
    if (mode !== 'local') throw error('MODE','Selecione Empresas neste aparelho para exportar o backup local.');
    return copy(read().state);
  }
  function captureLocalVersion() {
    assertProfile();
    if (mode !== 'local') throw error('MODE','Selecione Empresas neste aparelho para recuperar o backup local.');
    // A recuperação precisa capturar também armazenamento que não pode ser
    // interpretado. Não confunda um JSON corrompido com uma versão vazia.
    return root.localStorage.getItem(key);
  }
  async function importLocal(value,expectedSnapshot,expectedRaw) {
    const context = scope();
    if (mode !== 'local') throw error('MODE','O backup local só pode ser recuperado em Empresas neste aparelho.');
    let canonical;
    try { canonical = validateLocal(typeof value === 'string' ? JSON.parse(value) : value); }
    catch (cause) { throw error('INVALID_DATA',cause.message || 'O backup empresarial é inválido.'); }
    const text = sized(canonical);
    return locked(() => {
      check(context);
      const rawBefore = root.localStorage.getItem(key);
      if (expectedRaw !== undefined && rawBefore !== expectedRaw) throw error('CONFLICT','Os dados mudaram enquanto você confirmava o backup. Atualize antes de recuperar.');
      if (expectedSnapshot !== undefined) {
        let expectedText;
        try { expectedText = sized(core.validateState(expectedSnapshot)); }
        catch { throw error('CONFLICT','A versão local não pôde ser confirmada. Atualize antes de recuperar.'); }
        const current = read().state;
        if (sized(current) !== expectedText) throw error('CONFLICT','Os dados mudaram enquanto você confirmava o backup. Atualize antes de recuperar.');
      }
      if (root.localStorage.getItem(key) !== rawBefore) throw error('CONFLICT','Os dados mudaram em outra aba. Atualize antes de recuperar.');
      try { root.localStorage.setItem(key,text); }
      catch { throw error('STORAGE','Não foi possível recuperar o backup. Os dados anteriores foram mantidos.'); }
      workspace = null; emit('import'); return copy(canonical);
    });
  }
  function subscribe(callback) { if (typeof callback !== 'function') throw new TypeError('Informe a função que acompanha a empresa.'); listeners.add(callback); return () => listeners.delete(callback); }
  function staleProfile() { stale = true; workspace = null; userId = null; epoch++; emit('stale'); }
  root.document?.addEventListener('rodagem:profile-stale',staleProfile);
  root.document?.addEventListener('rodagem:profile-will-change',staleProfile);
  root.addEventListener('storage',event => { if (event.key === key || event.key === null) emit('external'); });
  root.RodagemBusiness = Object.freeze({getMode:()=>mode,selectMode,listCompanies,createCompany,loadCompany,
    getCurrentWorkspace:() => { assertProfile(); return copy(workspace); },getCloudUserId:()=>userId,getSession:()=>remoteSession(),
    saveEntity,archiveEntity,saveMember,archiveMember,inviteMember,revokeInvite,acceptInvite,exportLocal,captureLocalVersion,importLocal,subscribe});
})();
