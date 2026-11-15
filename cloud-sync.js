/* Cópia de segurança manual por conta. Entrar não envia nem substitui dados. */
(() => {
  'use strict';
  const root = window, profiles = root.RodagemProfiles, cloud = root.RodagemCloud;
  if (!profiles) return;
  const logical = {
    records:'minha-rodagem-v1',settings:'minha-rodagem-perfil-v2',journey:'minha-rodagem-jornada-v2',
    index:'minha-rodagem-rotas-indice-v1',gps:'minha-rodagem-gps-preferencias-v1',
    binding:'minha-rodagem-cloud-v1',journal:'minha-rodagem-sync-journal-v1'
  };
  const keys = Object.fromEntries(Object.entries(logical).map(([name,key]) => [name,profiles.key(key)]));
  const prefix = profiles.key('minha-rodagem-rota-v1:');
  const bootProfile = profiles.current().id;
  const MAX_BYTES = 5 * 1024 * 1024;
  let session = null, sessionEpoch = 0, busy = false, stale = false, notice = '', recoveryFailed = false;
  let card, status, account, details, actions;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
  const raw = key => localStorage.getItem(key);
  function parse(value,label) { try { return JSON.parse(value); } catch { throw Error(label + ' não pôde ser lido. Nenhum dado foi substituído.'); } }
  function sized(value) {
    let text;
    try { text = JSON.stringify(value); } catch { throw Error('A cópia contém dados inválidos.'); }
    if (typeof text !== 'string' || new Blob([text]).size > MAX_BYTES) throw Error('A cópia excede o limite de 5 MB. Exporte os percursos antigos em GPX antes de tentar novamente.');
    return text;
  }
  function assertProfile() {
    profiles.assertCurrent();
    if (stale || profiles.current().id !== bootProfile) throw Error('O perfil mudou. Recarregue antes de sincronizar.');
  }
  function assertCleanStore() {
    assertProfile();
    if (raw(keys.journal) !== null) throw Error('A recuperação anterior precisa terminar antes de sincronizar. Reabra o app.');
  }
  function assertLoadedVersion() {
    assertCleanStore();
    if (typeof conferirVersao === 'function') conferirVersao();
    if (typeof perfilRaw !== 'undefined' && raw(keys.settings) !== perfilRaw) throw Error('As preferências mudaram em outra aba. Recarregue antes de sincronizar.');
    if (typeof jornadaRaw !== 'undefined' && raw(keys.journey) !== jornadaRaw) throw Error('A jornada mudou em outra aba. Recarregue antes de sincronizar.');
  }
  function readBinding(key = keys.binding) {
    const value = raw(key);
    if (value === null) return null;
    const binding = parse(value,'O vínculo da conta');
    if (!object(binding) || !uuid(binding.userId) || !Number.isSafeInteger(binding.revision) || binding.revision < 0 ||
        (binding.lastSyncedAt !== null && (typeof binding.lastSyncedAt !== 'string' || !Number.isFinite(Date.parse(binding.lastSyncedAt))))) throw Error('O vínculo da conta é inválido. Seus dados locais foram mantidos.');
    return {userId:binding.userId,revision:binding.revision,lastSyncedAt:binding.lastSyncedAt};
  }
  function validateSnapshot(value) {
    sized(value);
    if (!object(value) || value.version !== 1 || !object(value.records) || !Array.isArray(value.routes) || value.routes.length > 10 ||
        !Object.prototype.hasOwnProperty.call(value,'settings') || !Object.prototype.hasOwnProperty.call(value,'journey')) throw Error('A cópia da conta tem um formato incompatível.');
    const records = {versao:1,registros:validarBackup(value.records)};
    const settings = value.settings === null ? null : lerPerfilRodagem(sized(value.settings));
    const prefs = value.gpsPreferences;
    if (!object(prefs) || typeof prefs.enabled !== 'boolean' || !['eco','precise'].includes(prefs.mode)) throw Error('As preferências do GPS da cópia são inválidas.');
    const seen = new Set();
    const routes = value.routes.map(entry => {
      if (!object(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100 || seen.has(entry.id) ||
          !safeTime(entry.updatedAt) || typeof entry.finished !== 'boolean') throw Error('Há percursos inválidos ou repetidos na cópia.');
      if (!root.RodagemGeo?.validate) throw Error('O módulo dos percursos não foi carregado. Reabra o app antes de recuperar.');
      const track = root.RodagemGeo.validate(entry.track);
      if (track.id !== entry.id || track.updatedAt !== entry.updatedAt) throw Error('A identificação de um percurso está inconsistente.');
      seen.add(entry.id);
      return {id:entry.id,track,updatedAt:entry.updatedAt,finished:entry.finished};
    });
    const journey = value.journey === null ? null : lerJornadaRodagem(sized(value.journey));
    if (journey?.estado === 'running') throw Error('Uma jornada em andamento não pode ser recuperada de outro aparelho.');
    const snapshot = {version:1,settings,records,routes,gpsPreferences:{enabled:prefs.enabled,mode:prefs.mode},journey};
    sized(snapshot);
    return snapshot;
  }
  function routeEntries() {
    const value = raw(keys.index);
    const index = value === null ? [] : parse(value,'A lista de percursos');
    if (!Array.isArray(index) || index.length > 10) throw Error('Confira os percursos guardados antes de sincronizar.');
    return index.map(entry => {
      if (!object(entry) || typeof entry.id !== 'string') throw Error('A lista de percursos é inválida.');
      const value = raw(prefix + entry.id);
      if (value === null) throw Error('Um percurso listado não está disponível. Confira o mapa antes de sincronizar.');
      return {id:entry.id,track:parse(value,'Um percurso'),updatedAt:entry.updatedAt,finished:entry.finished};
    });
  }
  function capture() {
    assertLoadedVersion();
    const journeyRaw = raw(keys.journey);
    return validateSnapshot({version:1,
      records:raw(keys.records) === null ? {versao:1,registros:[]} : parse(raw(keys.records),'Os lançamentos'),
      settings:raw(keys.settings) === null ? null : parse(raw(keys.settings),'As preferências'),
      routes:routeEntries(),gpsPreferences:raw(keys.gps) === null ? {enabled:true,mode:'eco'} : parse(raw(keys.gps),'As preferências do GPS'),
      journey:journeyRaw === null ? null : parse(journeyRaw,'A jornada')});
  }
  function withLocks(names,action) {
    const unique = [...new Set(names)];
    function next(index) {
      return index === unique.length ? action() : navigator.locks?.request
        ? navigator.locks.request(unique[index],{mode:'exclusive'},() => next(index+1))
        : Promise.resolve().then(() => next(index+1));
    }
    return next(0);
  }
  const dataLocks = () => [profiles.registryKey,keys.records,keys.settings,keys.journey,keys.binding,keys.index,keys.gps];
  function dirty() {
    if (typeof perfilAlterado !== 'undefined' && perfilAlterado) return true;
    return ['dia','posto'].some(id => {
      const form = document.getElementById(id);
      return form && (form.dataset.id || [...form.querySelectorAll('input:not([type="date"])')].some(field => field.value.trim()));
    });
  }
  function assertCanRestore() {
    assertLoadedVersion();
    if (raw(keys.journey) !== null) throw Error('Encerre ou descarte a jornada deste perfil antes de recuperar dados da conta.');
    if (dirty()) throw Error('Salve ou limpe os campos preenchidos antes de recuperar dados da conta.');
  }
  function assertSession(userId,epoch) {
    assertProfile();
    if (sessionEpoch !== epoch || session?.user?.id !== userId) throw Error('A conta mudou durante a operação. Nenhum dado novo foi importado.');
  }
  async function verifiedUser() {
    assertCleanStore();
    if (!cloud?.configured()) throw Error('A entrada com conta ainda não está disponível nesta instalação.');
    if (typeof cloud.verifySession !== 'function') throw Error('A conexão da conta não foi carregada por completo. Reabra o app com internet.');
    const fresh = await cloud.verifySession();
    if (!uuid(fresh?.user?.id)) throw Error('Entre na sua conta antes de sincronizar.');
    if (session?.user?.id !== fresh.user.id) { session = fresh; sessionEpoch++; }
    else session = fresh;
    assertProfile();
    return {userId:fresh.user.id,epoch:sessionEpoch,label:fresh.user.email || 'sua conta'};
  }
  function requireBinding(user) {
    const binding = readBinding();
    if (!binding) throw Error('Vincule este perfil à sua conta antes de sincronizar.');
    if (binding.userId !== user.userId) throw Error('Este perfil está vinculado a outra conta. Troque de perfil ou entre na conta correspondente.');
    return binding;
  }
  function otherAccountProfile(userId) {
    for (const profile of profiles.list()) {
      if (profile.id === bootProfile) continue;
      const key = profile.id === 'principal' ? logical.binding : 'minha-rodagem-usuario-v1:' + profile.id + ':' + logical.binding;
      const binding = readBinding(key);
      if (binding?.userId === userId) return profile;
    }
    return null;
  }
  function remoteSnapshot(value) {
    if (value === null) return null;
    if (!object(value) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw Error('A resposta da conta está incompleta. Nenhum dado foi substituído.');
    return {revision:value.revision,payload:validateSnapshot(value.payload),updated_at:value.updated_at};
  }
  function compareRaw(expected) {
    for (const [key,value] of expected) if (raw(key) !== value) throw Error('Os dados mudaram enquanto você confirmava. Recarregue e tente novamente.');
  }
  function allStoredData() {
    const entries = new Map(Object.values(keys).filter(key => key !== keys.journal).map(key => [key,raw(key)]));
    const index = raw(keys.index) === null ? [] : parse(raw(keys.index),'A lista de percursos');
    if (!Array.isArray(index)) throw Error('A lista de percursos é inválida.');
    for (const entry of index) {
      if (!object(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100) throw Error('A lista de percursos é inválida.');
      entries.set(prefix+entry.id,raw(prefix+entry.id));
    }
    return entries;
  }
  function allowedKey(key) { return Object.values(keys).some(value => value !== keys.journal && value === key) || key.startsWith(prefix) && key.length > prefix.length && key.length <= prefix.length+100; }
  function validateJournal(value) {
    if (!object(value) || value.version !== 1 || value.profileId !== bootProfile || !Array.isArray(value.before) || !value.before.length || value.before.length > 30) throw Error('A recuperação pendente não pôde ser lida. Seus dados foram mantidos.');
    const seen = new Set();
    for (const entry of value.before) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !allowedKey(entry[0]) || seen.has(entry[0]) || (entry[1] !== null && typeof entry[1] !== 'string')) throw Error('A recuperação pendente contém uma chave inválida.');
      seen.add(entry[0]);
    }
    return value;
  }
  function rollback(before) {
    // Remover primeiro libera o espaço ocupado pelos valores novos.
    for (const [key] of before) localStorage.removeItem(key);
    for (const [key,value] of before) if (value !== null) localStorage.setItem(key,value);
  }
  async function recoverJournal() {
    const value = raw(keys.journal);
    if (value === null) return false;
    const journal = validateJournal(parse(value,'A recuperação pendente'));
    await withLocks(dataLocks(),() => {
      assertProfile();
      if (raw(keys.journal) !== value) throw Error('A recuperação mudou em outra aba. Reabra o app.');
      rollback(journal.before);
      localStorage.removeItem(keys.journal);
    });
    location.reload();
    return true;
  }
  async function bind() {
    const user = await verifiedUser();
    const existing = readBinding();
    if (existing) { requireBinding(user); return existing; }
    const other = otherAccountProfile(user.userId);
    if (other) throw Error('Esta conta já está vinculada ao perfil ' + other.name + '. Use Trocar perfil para abrir os dados corretos.');
    const remote = remoteSnapshot(await cloud.load(user.userId));
    assertSession(user.userId,user.epoch);
    if (!await confirmar('Vincular o perfil ' + profiles.current().name + ' à conta ' + user.label + '? Entrar não transfere dados. Você decidirá quando salvar ou recuperar lançamentos, preferências e percursos GPS na nuvem.')) return null;
    const fresh = await verifiedUser();
    if (fresh.userId !== user.userId) throw Error('A conta mudou. Confira a conta antes de vincular.');
    return withLocks([profiles.registryKey,keys.binding],() => {
      assertSession(fresh.userId,fresh.epoch); assertCleanStore();
      if (raw(keys.binding) !== null || otherAccountProfile(user.userId)) throw Error('O vínculo mudou em outra aba. Recarregue e confira a conta.');
      const binding = {userId:user.userId,revision:remote?.revision || 0,lastSyncedAt:null};
      localStorage.setItem(keys.binding,JSON.stringify(binding));
      return binding;
    });
  }
  async function upload() {
    const user = await verifiedUser();
    const binding = requireBinding(user);
    const bindingRaw = raw(keys.binding);
    const snapshot = await withLocks(dataLocks(),capture);
    const remote = remoteSnapshot(await cloud.load(user.userId));
    assertSession(user.userId,user.epoch);
    if ((remote?.revision || 0) !== binding.revision) throw Error('Há uma versão mais recente na conta. Recupere-a ou use outro perfil antes de salvar; nenhuma versão foi sobrescrita.');
    if (!await confirmar((remote ? 'Substituir a cópia da conta ' : 'Salvar uma cópia na conta ') + user.label + ' pelos ' + snapshot.records.registros.length + ' lançamentos e ' + snapshot.routes.length + ' percursos GPS deste perfil? As posições registradas nos percursos serão enviadas. A cópia é manual; alterações futuras precisam de um novo envio.')) return null;
    const fresh = await verifiedUser();
    if (fresh.userId !== user.userId) throw Error('A conta mudou. O envio foi cancelado.');
    assertSession(fresh.userId,fresh.epoch);
    if (raw(keys.binding) !== bindingRaw) throw Error('O vínculo mudou durante a confirmação. Recarregue antes de enviar.');
    const saved = remoteSnapshot(await cloud.save(binding.revision,snapshot,user.userId));
    if (!saved) throw Error('A conta não confirmou o salvamento. Confira antes de tentar novamente.');
    assertSession(fresh.userId,fresh.epoch);
    await withLocks([profiles.registryKey,keys.binding],() => {
      assertSession(fresh.userId,fresh.epoch); assertCleanStore();
      if (raw(keys.binding) !== bindingRaw) throw Error('A cópia foi enviada, mas o vínculo local mudou. Recarregue antes de enviar novamente.');
      try { localStorage.setItem(keys.binding,JSON.stringify({userId:user.userId,revision:saved.revision,lastSyncedAt:saved.updated_at})); }
      catch { throw Error('A cópia foi salva na conta, mas faltou espaço para confirmar neste aparelho. Reabra o app e recupere a cópia antes de enviar novamente.'); }
    });
    return saved;
  }
  async function restore() {
    const user = await verifiedUser();
    requireBinding(user); assertCanRestore();
    const before = allStoredData();
    const remote = remoteSnapshot(await cloud.load(user.userId));
    assertSession(user.userId,user.epoch);
    if (!remote) throw Error('Esta conta ainda não tem uma cópia salva.');
    const snapshot = remote.payload;
    for (const route of snapshot.routes) if (!before.has(prefix+route.id)) before.set(prefix+route.id,raw(prefix+route.id));
    if (!await confirmar('Recuperar a cópia de ' + user.label + ' neste perfil? Os lançamentos locais serão substituídos por ' + snapshot.records.registros.length + ' lançamentos e ' + snapshot.routes.length + ' percursos GPS da conta. Preferências e veículo também serão substituídos. Baixe um backup local primeiro se quiser guardar a versão atual. Os outros perfis serão mantidos.')) return null;
    const fresh = await verifiedUser();
    if (fresh.userId !== user.userId) throw Error('A conta mudou. A recuperação foi cancelada.');
    return withLocks(dataLocks(),async () => {
      assertSession(fresh.userId,fresh.epoch); assertCanRestore(); compareRaw(before);
      const confirmed = await verifiedUser();
      if (confirmed.userId !== user.userId) throw Error('A conta mudou. A recuperação foi cancelada.');
      assertCanRestore(); compareRaw(before); assertSession(confirmed.userId,confirmed.epoch);
      const changes = new Map();
      for (const [key] of before) if (key.startsWith(prefix)) changes.set(key,null);
      changes.set(keys.records,JSON.stringify(snapshot.records));
      changes.set(keys.settings,snapshot.settings === null ? null : JSON.stringify(snapshot.settings));
      changes.set(keys.journey,snapshot.journey === null ? null : JSON.stringify(snapshot.journey));
      changes.set(keys.gps,JSON.stringify(snapshot.gpsPreferences));
      changes.set(keys.index,JSON.stringify(snapshot.routes.map(({id,updatedAt,finished}) => ({id,updatedAt,finished}))));
      changes.set(keys.binding,JSON.stringify({userId:user.userId,revision:remote.revision,lastSyncedAt:remote.updated_at}));
      for (const route of snapshot.routes) changes.set(prefix+route.id,JSON.stringify(route.track));
      const journal = {version:1,profileId:bootProfile,before:[...before]};
      try { localStorage.setItem(keys.journal,JSON.stringify(journal)); }
      catch { throw Error('Não há espaço para recuperar com segurança. Libere espaço ou exporte percursos antigos; os dados locais foram mantidos.'); }
      try {
        root.RodagemGPS?.suspend?.();
        assertSession(confirmed.userId,confirmed.epoch);
        for (const [key,value] of changes) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key,value); }
        localStorage.removeItem(keys.journal);
      } catch (failure) {
        try { rollback(journal.before); localStorage.removeItem(keys.journal); }
        catch { recoveryFailed = true; throw Error('A recuperação foi interrompida. Os dados anteriores estão protegidos para nova tentativa. Reabra o app antes de salvar.'); }
        throw Error('Não foi possível recuperar a cópia. Os dados locais anteriores foram restaurados.');
      }
      location.reload();
      return remote;
    });
  }
  function element(tag,text,className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function providerEnabled(provider) {
    const providers = root.RodagemCloudConfig?.providers;
    return !Array.isArray(providers) || providers.includes(provider);
  }
  function button(text,action,provider) {
    const node = element('button',text,'button secondary'); node.type = 'button';
    if (provider) node.dataset.cloudProvider = provider;
    node.addEventListener('click',() => {
      if (node.disabled || provider && !providerEnabled(provider)) return;
      run(action);
    }); return node;
  }
  function render() {
    if (!card) return;
    const configured = Boolean(cloud?.configured());
    let binding,problem = '';
    try { binding = readBinding(); } catch (failure) { problem = failure.message; }
    const mismatch = binding && session?.user?.id !== binding.userId;
    const unavailable = !configured || busy || stale || recoveryFailed || Boolean(problem);
    const buttons = [...actions.querySelectorAll('button')];
    for (const node of buttons) node.disabled = unavailable;
    for (const node of buttons.filter(node => node.dataset.cloudProvider)) {
      node.hidden = Boolean(session);
      node.disabled = unavailable || !providerEnabled(node.dataset.cloudProvider);
    }
    document.getElementById('cloud-link').hidden = !session || Boolean(binding);
    document.getElementById('cloud-upload').hidden = !session || !binding;
    document.getElementById('cloud-restore').hidden = !session || !binding;
    document.getElementById('cloud-signout').hidden = !session;
    if (mismatch) {
      document.getElementById('cloud-upload').disabled = true;
      document.getElementById('cloud-restore').disabled = true;
    }
    account.textContent = session ? 'Conta: ' + (session.user.email || 'identificação confirmada') : 'Você está usando um perfil local.';
    if (recoveryFailed) status.textContent = notice || 'Reabra o app para terminar a recuperação dos dados antes de salvar.';
    else if (!configured) status.textContent = 'A entrada com Google e Facebook ainda não está disponível nesta instalação. Seus dados continuam salvos neste aparelho.';
    else if (problem) status.textContent = problem;
    else if (stale) status.textContent = 'O perfil mudou em outra aba. Recarregue para continuar.';
    else if (busy) status.textContent = 'Aguarde a conclusão da operação…';
    else if (mismatch) status.textContent = 'Este perfil está vinculado a outra conta. Entre na conta correspondente ou use Trocar perfil.';
    else status.textContent = notice || (session ? binding ? 'Conta vinculada a este perfil. Escolha quando salvar ou recuperar sua cópia.' : 'Entrar não transfere dados. Vincule este perfil se ele pertence a esta conta.' : 'Entre com sua conta para guardar uma cópia e recuperá-la em outro aparelho.');
    details.textContent = binding?.lastSyncedAt ? 'Última cópia confirmada: ' + new Date(binding.lastSyncedAt).toLocaleString('pt-BR') + '. Alterações posteriores continuam apenas neste aparelho até um novo envio.' : 'A cópia na nuvem é manual. Lançamentos, veículo, preferências e percursos GPS são incluídos somente após sua confirmação.';
  }
  async function run(action) {
    if (busy || stale || recoveryFailed) return;
    busy = true; notice = ''; render();
    try {
      const result = await action();
      if (result !== null) notice = 'Operação concluída. Seus dados locais foram mantidos, salvo a recuperação que você confirmou.';
    } catch (failure) { notice = failure.code === 'CONFLICT' ? 'A cópia da conta mudou em outro aparelho. Recupere a versão mais recente antes de enviar novamente.' : failure.message || 'Não foi possível concluir. Confira sua conexão e tente novamente.'; }
    finally { busy = false; render(); }
  }
  function mount() {
    const form = document.getElementById('perfil'); if (!form) return;
    card = element('section',null,'card cloud-card'); card.id = 'conta-cloud'; card.setAttribute('aria-labelledby','cloud-title');
    const heading = element('h2','Sua conta, seus dados'); heading.id = 'cloud-title';
    account = element('p',null,'cloud-account'); status = element('p',null,'cloud-status'); status.id = 'cloud-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    details = element('p',null,'hint'); actions = element('div',null,'actions cloud-actions');
    actions.append(button('Entrar com Google',() => cloud.signIn('google'),'google'),button('Entrar com Facebook',() => cloud.signIn('facebook'),'facebook'));
    for (const [id,label,action] of [['cloud-link','Vincular este perfil à conta',bind],['cloud-upload','Salvar cópia na nuvem',upload],['cloud-restore','Recuperar cópia da conta',restore],['cloud-signout','Sair da conta',async () => { await cloud.signOut(); session = null; sessionEpoch++; return true; }]]) {
      const node = button(label,action); node.id = id; actions.append(node);
    }
    const signoutHint = element('p','Sair da conta mantém os dados locais neste aparelho.','microcopy');
    card.append(heading,account,status,actions,details,signoutHint); form.after(card); render();
  }
  root.RodagemSync = Object.freeze({validateSnapshot,capture,bind,upload,restore,readBinding,recoverJournal});
  document.addEventListener('rodagem:profile-stale',() => { stale = true; sessionEpoch++; render(); });
  document.addEventListener('rodagem:profile-will-change',() => { stale = true; sessionEpoch++; render(); });
  document.addEventListener('rodagem:profile-saved',render);
  document.addEventListener('rodagem:changed',render);
  root.addEventListener('storage',event => { if (event.key === keys.binding || event.key === null) render(); });
  mount();
  (async () => {
    try {
      if (await recoverJournal()) return;
      if (!cloud?.configured()) return;
      cloud.onAuth((_event,value) => { if (session?.user?.id !== value?.user?.id) sessionEpoch++; session = value; render(); });
      session = await cloud.getSession(); render();
    } catch (failure) { notice = failure.message; recoveryFailed = raw(keys.journal) !== null; render(); }
  })();
})();
