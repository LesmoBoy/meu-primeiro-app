/* Dados deste aparelho: exportação técnica por allowlist e remoção explícita
 * do perfil ativo. Carregar após profiles-core e antes dos módulos de dados. */
(() => {
  'use strict';
  const root = window, profiles = root.RodagemProfiles, storage = root.localStorage;
  if (!profiles || !storage) return;
  const profileId = profiles.current().id;
  const registryKey = profiles.registryKey;
  const logical = Object.freeze({
    records:'minha-rodagem-v1',settings:'minha-rodagem-perfil-v2',journey:'minha-rodagem-jornada-v2',
    index:'minha-rodagem-rotas-indice-v1',gps:'minha-rodagem-gps-preferencias-v1',business:'minha-rodagem-business-v1',
    lease:'minha-rodagem-gps-lease-v1',binding:'minha-rodagem-cloud-v1',sync:'minha-rodagem-sync-journal-v1',
    generation:'minha-rodagem-device-generation-v1',journal:'minha-rodagem-device-journal-v1'
  });
  const keys = Object.fromEntries(Object.entries(logical).map(([name,value]) => [name,profiles.key(value)]));
  const routeLogical = 'minha-rodagem-rota-v1:', routePrefix = profiles.key(routeLogical);
  const dataNames = ['records','settings','journey','index','gps','business','lease'];
  const exportNames = dataNames.filter(name => name !== 'lease');
  const MAX_KEYS = 1000, MAX_UNITS = 16 * 1024 * 1024, MAX_BYTES = 32 * 1024 * 1024;
  const CHANGED = 'Os dados deste perfil mudaram. Recarregue a página e baixe uma nova cópia antes de remover.';
  const PAUSED = 'O gerenciamento dos dados deste aparelho está pendente. Reabra o app antes de salvar.';
  let generationAtBoot = null, initializationError = '', frozen = false, busy = false, exported = null;
  let card, status, exportButton, removeButton, controls, typedName, acknowledged, confirmButton;
  let recoveryPromise = Promise.resolve(false);
  const raw = key => storage.getItem(key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const failure = (code,message) => Object.assign(new Error(message),{code});
  const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
  const uuid = () => root.crypto?.randomUUID?.() || globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);

  function validateGeneration(value) {
    if (value === null) return null;
    const parsed = JSON.parse(value);
    if (!object(parsed) || parsed.version !== 1 || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 100 ||
        !Number.isSafeInteger(parsed.at) || parsed.at < 0 || parsed.at > 8.64e15) throw failure('RECOVERY_PENDING',PAUSED);
    return value;
  }
  try { generationAtBoot = validateGeneration(raw(keys.generation)); }
  catch { initializationError = 'Não foi possível conferir a versão dos dados deste aparelho. Os dados foram preservados; procure suporte antes de removê-los.'; }

  // Não chama profiles.assertCurrent: este guard também é chamado por ele.
  // Não depende do DOM, do SDK de autenticação nem de módulos carregados depois.
  function assertWritable() {
    if (initializationError) throw failure('RECOVERY_PENDING',initializationError);
    if (frozen || raw(keys.journal) !== null) throw failure('RECOVERY_PENDING',PAUSED);
    if (raw(keys.generation) !== generationAtBoot) throw failure('DEVICE_CHANGED',CHANGED);
  }
  function assertProfile() {
    assertWritable(); profiles.assertCurrent();
    if (profiles.current().id !== profileId) throw failure('PROFILE_CHANGED',CHANGED);
  }
  function allowedLogical(value) {
    return typeof value === 'string' && (dataNames.some(name => logical[name] === value) ||
      value.startsWith(routeLogical) && value.length > routeLogical.length && value.length <= routeLogical.length + 1000);
  }
  function dataKeys() {
    const result = dataNames.map(name => keys[name]);
    const count = storage.length;
    if (!Number.isSafeInteger(count) || count < 0 || typeof storage.key !== 'function') throw failure('STORAGE','O navegador não permitiu conferir todos os percursos. Nenhum dado foi removido.');
    for (let index = 0; index < count; index++) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(routePrefix)) {
        const suffix = key.slice(routePrefix.length);
        if (!suffix || suffix.length > 1000) throw failure('STORAGE','Há uma chave de percurso incompatível. Exporte os dados com suporte antes de remover.');
        result.push(key);
      }
    }
    const unique = [...new Set(result)].sort();
    if (unique.length > MAX_KEYS) throw failure('TOO_LARGE','Há muitos percursos neste perfil. Procure suporte para guardar uma cópia completa antes de remover dados.');
    return unique;
  }
  function toLogical(key) {
    for (const name of dataNames) if (keys[name] === key) return logical[name];
    if (key.startsWith(routePrefix)) return routeLogical + key.slice(routePrefix.length);
    throw failure('INVALID_DATA','A cópia contém uma chave incompatível.');
  }
  function capture() {
    assertProfile();
    const entries = dataKeys().map(key => [key,raw(key)]);
    if (entries.reduce((sum,[key,value]) => sum + key.length + (value?.length || 0),0) > MAX_UNITS) throw failure('TOO_LARGE','Os dados deste perfil excedem o limite seguro da cópia técnica. Nenhum dado foi alterado; procure suporte para exportá-los.');
    return {entries,registry:raw(registryKey),generation:raw(keys.generation),name:profiles.current().name};
  }
  function compare(snapshot) {
    assertProfile();
    const current = dataKeys();
    if (raw(registryKey) !== snapshot.registry || raw(keys.generation) !== snapshot.generation ||
        current.length !== snapshot.entries.length || current.some((key,index) => key !== snapshot.entries[index][0]) ||
        snapshot.entries.some(([key,value]) => raw(key) !== value)) throw failure('CONFLICT',CHANGED);
    if (raw(keys.sync) !== null) throw failure('RECOVERY_PENDING','Uma recuperação da conta está pendente. Reabra o app antes de gerenciar os dados locais.');
  }
  const lockNames = entries => [registryKey,keys.records,keys.settings,keys.journey,keys.binding,keys.index,keys.gps,
    keys.business,keys.lease,keys.generation,keys.journal,...entries.map(([key]) => key).filter(key => key.startsWith(routePrefix)).sort()];
  async function withLocks(names,action,wait = false) {
    if (!root.navigator?.locks?.request) throw failure('LOCKS_UNAVAILABLE','Este navegador não oferece a proteção necessária para remover dados. A cópia técnica continua disponível.');
    const unique = [...new Set(names)];
    const next = index => index === unique.length ? action() : root.navigator.locks.request(unique[index],
      wait ? {mode:'exclusive'} : {mode:'exclusive',ifAvailable:true},lock => {
        if (!lock) throw failure('BUSY','Há uma gravação em andamento neste perfil. Aguarde e feche outras abas antes de continuar.');
        return next(index + 1);
      });
    return next(0);
  }
  function dirtyOrBusy() {
    if (root.RodagemBusinessUI?.isDirty?.() || typeof perfilAlterado !== 'undefined' && perfilAlterado) return true;
    if (typeof perfilSalvando !== 'undefined' && perfilSalvando || typeof jornadaOcupada !== 'undefined' && jornadaOcupada) return true;
    if (document.querySelector('#conta-cloud[aria-busy="true"], #empresa [aria-busy="true"], #business-app[aria-busy="true"]')) return true;
    return ['dia','posto'].some(id => {
      const form = document.getElementById(id);
      return Boolean(form && (form.dataset.id || [...form.querySelectorAll('input:not([type="date"])')].some(field => field.value.trim())));
    });
  }
  function assertIdle() {
    assertProfile();
    if (raw(keys.sync) !== null) throw failure('RECOVERY_PENDING','Uma recuperação da conta está pendente. Reabra o app antes de remover dados locais.');
    // Até jornadas pausadas/pendentes ou ilegíveis precisam ser resolvidas pelo
    // fluxo normal. O gerenciamento nunca descarta trabalho em andamento.
    if (raw(keys.journey) !== null) throw failure('JOURNEY_ACTIVE','Encerre ou resolva a jornada deste perfil antes de remover os dados do aparelho.');
    if (dirtyOrBusy()) throw failure('DIRTY','Salve ou cancele as edições e aguarde as gravações antes de remover os dados do aparelho.');
    if (document.querySelector('dialog[open]')) throw failure('BUSY','Conclua ou cancele a confirmação aberta antes de remover dados.');
  }
  async function assertSignedOut() {
    const cloud = root.RodagemCloud;
    const configurationPresent = Boolean(root.RodagemCloudConfig?.url);
    if (!cloud?.getSession || !cloud?.configured?.()) {
      if (configurationPresent) throw failure('AUTH_UNAVAILABLE','A conexão com a conta não carregou. Reabra o app e saia da conta antes de remover os dados locais.');
      return;
    }
    if (await cloud.getSession()) throw failure('AUTH_REQUIRED','Saia da conta na seção Conta e cópia de segurança antes de remover dados deste aparelho. Sair da conta mantém seus dados.');
  }
  function serialized(value,label) {
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || text.length > MAX_UNITS * 2 || new Blob([text]).size > MAX_BYTES) throw failure('TOO_LARGE',label + ' excede o limite seguro. Nenhum dado foi removido.');
    return text;
  }
  function downloadText(text,filename) {
    const url = URL.createObjectURL(new Blob([text],{type:'application/json'}));
    try {
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    } catch (cause) { URL.revokeObjectURL(url); throw cause; }
    setTimeout(() => URL.revokeObjectURL(url),30000);
  }
  async function download() {
    if (busy) throw failure('BUSY','Aguarde a operação atual antes de gerar outra cópia.');
    busy = true; updateButtons();
    try {
      const take = () => {
        const snapshot = capture();
        const entries = snapshot.entries.filter(([key]) => key.startsWith(routePrefix) || exportNames.some(name => keys[name] === key)).map(([key,value]) => [toLogical(key),value]);
        const text = serialized({format:'minha-rodagem-device-profile',version:1,appVersion:'3.2.3',exportedAt:new Date().toISOString(),
          profile:{id:profileId,name:snapshot.name},entries},'A cópia técnica');
        compare(snapshot);
        const filename = 'minha-rodagem-copia-tecnica-' + profileId + '-' + new Date().toISOString().slice(0,10) + '.json';
        downloadText(text,filename);
        exported = snapshot;
        return {filename,bytes:new Blob([text]).size,keys:entries.length};
      };
      // Exportar é permitido em navegadores sem Web Locks. Nesse caso é uma
      // leitura com CAS, e jamais habilita a remoção sem proteção concorrente.
      const result = root.navigator?.locks?.request ? await withLocks(lockNames([]),take) : take();
      notice('Cópia técnica gerada. Confira se o arquivo foi salvo em um lugar privado antes de continuar.');
      return result;
    } finally { busy = false; updateButtons(); }
  }
  function validateJournal(text) {
    if (typeof text !== 'string' || text.length > MAX_UNITS * 2) throw failure('RECOVERY_PENDING',PAUSED);
    const value = JSON.parse(text);
    if (!object(value) || value.version !== 1 || value.kind !== 'device-removal' || value.profileId !== profileId ||
        !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || value.createdAt > 8.64e15 ||
        !own(value,'generationBefore') || typeof value.generationAfter !== 'string' || !Array.isArray(value.before) ||
        value.before.length < dataNames.length || value.before.length > MAX_KEYS) throw failure('RECOVERY_PENDING',PAUSED);
    validateGeneration(value.generationBefore); validateGeneration(value.generationAfter);
    if (value.generationAfter === value.generationBefore) throw failure('RECOVERY_PENDING',PAUSED);
    const seen = new Set();
    const before = value.before.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2 || !allowedLogical(entry[0]) || seen.has(entry[0]) ||
          entry[1] !== null && typeof entry[1] !== 'string') throw failure('RECOVERY_PENDING',PAUSED);
      seen.add(entry[0]); return [profiles.key(entry[0]),entry[1]];
    });
    if (dataNames.some(name => !seen.has(logical[name]))) throw failure('RECOVERY_PENDING',PAUSED);
    if (before.reduce((sum,[key,data]) => sum + key.length + (data?.length || 0),0) > MAX_UNITS) throw failure('RECOVERY_PENDING',PAUSED);
    return {...value,before};
  }
  function rollback(journal,journalRaw) {
    if (raw(keys.journal) !== journalRaw) throw failure('CONFLICT','A recuperação dos dados mudou em outra aba. Nenhum dado adicional foi alterado.');
    const generation = raw(keys.generation);
    if (generation !== journal.generationBefore && generation !== journal.generationAfter) throw failure('CONFLICT','A versão dos dados mudou durante a recuperação. Os dados e a recuperação pendente foram preservados.');
    const target = new Map(journal.before), current = dataKeys();
    if (current.some(key => !target.has(key)) || journal.before.some(([key,value]) => raw(key) !== null && raw(key) !== value)) {
      throw failure('CONFLICT','Há alterações locais posteriores à remoção interrompida. Os dados e a recuperação pendente foram preservados para suporte.');
    }
    for (const [key,value] of journal.before) { if (value === null) storage.removeItem(key); else storage.setItem(key,value); }
    if (journal.generationBefore === null) storage.removeItem(keys.generation); else storage.setItem(keys.generation,journal.generationBefore);
    storage.removeItem(keys.journal);
  }
  function requireReload(message) {
    frozen = true; exported = null; notice(message);
    document.dispatchEvent(new CustomEvent('rodagem:device-data-changed',{detail:{profileId,message}}));
    // The same profile ID remains valid. Announce stale state as well so older
    // UI components stop displaying actions backed by an old in-memory copy.
    document.dispatchEvent(new CustomEvent('rodagem:profile-stale',{detail:{id:profileId,message}}));
    root.location?.reload?.();
  }
  async function remove(options = {}) {
    if (busy) throw failure('BUSY','Aguarde a operação atual antes de remover os dados.');
    if (!exported) throw failure('BACKUP_REQUIRED','Baixe a cópia técnica deste perfil antes de remover os dados do aparelho.');
    if (options.backupSaved !== true) throw failure('BACKUP_REQUIRED','Confirme que guardou a cópia técnica em um lugar seguro.');
    if (options.name !== profiles.current().name || options.name !== exported.name) throw failure('NAME_REQUIRED','Digite exatamente o nome do perfil para confirmar a remoção.');
    if (!root.navigator?.locks?.request) throw failure('LOCKS_UNAVAILABLE','Este navegador não oferece a proteção necessária para remover dados. A cópia técnica continua disponível.');
    busy = true; updateButtons();
    let journalRaw = null, journal = null;
    try {
      assertIdle(); await assertSignedOut(); assertIdle();
      const snapshot = exported;
      return await withLocks(lockNames(snapshot.entries),async () => {
        assertIdle(); compare(snapshot); await assertSignedOut(); assertIdle(); compare(snapshot);
        if (options.name !== profiles.current().name) throw failure('NAME_REQUIRED','O nome do perfil mudou. Baixe outra cópia antes de continuar.');
        const generationAfter = JSON.stringify({version:1,id:uuid(),at:Date.now()});
        journalRaw = serialized({version:1,kind:'device-removal',profileId,createdAt:Date.now(),generationBefore:snapshot.generation,
          generationAfter,before:snapshot.entries.map(([key,value]) => [toLogical(key),value])},'A proteção de recuperação');
        journal = validateJournal(journalRaw);
        try { storage.setItem(keys.journal,journalRaw); }
        catch { throw failure('STORAGE','Não há espaço para preparar a recuperação segura. Nenhum dado foi removido. Guarde a cópia e procure suporte.'); }
        try {
          // Everything above is read-only. Only explicit, fully checked removal
          // reaches this point and suspends GPS before modifying profile data.
          frozen = true;
          storage.setItem(keys.generation,generationAfter);
          root.RodagemGPS?.suspend?.();
          for (const [key] of snapshot.entries) storage.removeItem(key);
          storage.removeItem(keys.journal);
        } catch (cause) {
          try { rollback(journal,journalRaw); }
          catch {
            initializationError = 'A remoção foi interrompida e a recuperação permanece pendente. Não edite os dados; reabra o app para tentar recuperá-los. A cópia técnica anterior foi preservada.';
            throw failure('RECOVERY_PENDING',initializationError);
          }
          requireReload('A remoção não foi concluída. Os dados originais foram recuperados; recarregue antes de continuar.');
          throw failure('STORAGE','A remoção não foi concluída. Os dados originais foram recuperados.');
        }
        requireReload('Os dados locais deste perfil foram removidos. Recarregue para abrir o perfil vazio.');
        return {removed:true,profileId};
      });
    } finally {
      // A failed journal preparation never freezes normal use. Once a journal
      // or generation was changed, keep all old in-memory writers suspended.
      busy = false; updateButtons();
    }
  }
  async function recover() {
    const value = raw(keys.journal);
    if (value === null) return false;
    frozen = true;
    try {
      const journal = validateJournal(value);
      await withLocks(lockNames(journal.before),() => {
        // Another tab may have finished the same transaction while we waited.
        if (raw(keys.journal) === null) { requireReload('O gerenciamento dos dados terminou em outra aba. Recarregue para continuar.'); return; }
        rollback(journal,value);
        requireReload('Uma remoção interrompida foi desfeita. Os dados originais foram recuperados; recarregue para continuar.');
      },true);
      return true;
    } catch {
      initializationError = 'Há uma recuperação local pendente que não pôde ser concluída com segurança. Os dados foram preservados. Feche outras abas, reabra o app e procure suporte se o aviso continuar.';
      notice(initializationError); updateButtons();
      return false;
    }
  }
  function notice(message,error = false) {
    if (!status) return;
    status.textContent = message; status.dataset.error = String(error);
  }
  function updateButtons() {
    if (!card) return;
    card.setAttribute('aria-busy',String(busy));
    exportButton.disabled = busy || frozen || Boolean(initializationError);
    removeButton.disabled = busy || frozen || Boolean(initializationError);
    confirmButton.disabled = busy || frozen || !exported;
  }
  const node = (tag,text,className) => {
    const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
  };
  function mount() {
    const host = document.getElementById('ajustes');
    if (!host || document.getElementById('dados-aparelho')) return;
    card = node('section',null,'card'); card.id = 'dados-aparelho'; card.setAttribute('aria-labelledby','dados-aparelho-titulo');
    const title = node('h2','Dados deste aparelho'); title.id = 'dados-aparelho-titulo'; card.append(title);
    card.append(node('p','Sair da conta mantém os dados neste navegador. Cada perfil tem seu próprio histórico.'));
    card.append(node('p','A cópia técnica guarda lançamentos, ajustes, empresas locais e percursos deste perfil, inclusive dados que precisem de revisão. Ela serve para recuperação assistida; o backup do Histórico continua sendo o arquivo para restaurar lançamentos.','hint'));
    card.append(node('p','O arquivo pode conter valores e localização. Guarde-o em um lugar privado.','microcopy'));
    const actions = node('div',null,'actions');
    exportButton = node('button','Baixar cópia técnica deste perfil','button secondary'); exportButton.type = 'button'; exportButton.id = 'dados-aparelho-exportar';
    removeButton = node('button','Remover dados locais deste perfil…','text-button'); removeButton.type = 'button'; removeButton.id = 'dados-aparelho-abrir';
    actions.append(exportButton,removeButton); card.append(actions);
    controls = node('div'); controls.hidden = true; controls.id = 'dados-aparelho-remocao';
    removeButton.setAttribute('aria-controls',controls.id); removeButton.setAttribute('aria-expanded','false');
    controls.append(node('p','Esta ação remove somente o histórico, os ajustes, as empresas locais e os percursos do perfil “' + profiles.current().name + '” neste navegador. Outros perfis, o vínculo da conta e as cópias guardadas na conta serão preservados. Feche outras abas do Minha Rodagem e saia da conta antes de continuar.'));
    const label = node('label','Para confirmar, digite exatamente: ' + profiles.current().name);
    typedName = node('input'); typedName.id = 'dados-aparelho-nome'; typedName.autocomplete = 'off'; typedName.maxLength = 32; label.append(typedName); controls.append(label);
    const acknowledgement = node('label');
    acknowledged = node('input'); acknowledged.type = 'checkbox'; acknowledged.id = 'dados-aparelho-copia';
    acknowledgement.append(acknowledged,document.createTextNode(' Guardei a cópia técnica em um lugar seguro e entendo que a restauração dela requer suporte.')); controls.append(acknowledgement);
    const removalActions = node('div',null,'actions');
    confirmButton = node('button','Confirmar remoção deste aparelho','button secondary'); confirmButton.type = 'button'; confirmButton.id = 'dados-aparelho-confirmar';
    const cancel = node('button','Cancelar','text-button'); cancel.type = 'button'; cancel.id = 'dados-aparelho-cancelar';
    removalActions.append(confirmButton,cancel); controls.append(removalActions); card.append(controls);
    status = node('p',initializationError || (frozen ? PAUSED : 'A remoção exige uma cópia técnica atual e a conta desconectada.'),'hint');
    status.id = 'dados-aparelho-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); card.append(status);
    exportButton.addEventListener('click',() => download().catch(cause => notice(cause.message,true)));
    removeButton.addEventListener('click',() => {
      controls.hidden = !controls.hidden; removeButton.setAttribute('aria-expanded',String(!controls.hidden));
      if (!controls.hidden) typedName.focus?.();
    });
    cancel.addEventListener('click',() => {
      if (busy) return; controls.hidden = true; typedName.value = ''; acknowledged.checked = false; removeButton.setAttribute('aria-expanded','false');
      notice('Remoção cancelada. Nenhum dado foi alterado.');
    });
    confirmButton.addEventListener('click',() => remove({name:typedName.value,backupSaved:acknowledged.checked}).catch(cause => notice(cause.message,true)));
    const accountCard = document.getElementById('conta-cloud');
    if (accountCard?.parentNode === host) accountCard.after(card); else host.append(card);
    updateButtons();
  }
  root.RodagemDeviceData = Object.freeze({assertWritable,download,remove,recover,get ready(){return recoveryPromise;}});
  root.addEventListener('storage',event => {
    if (event.key === keys.generation || event.key === keys.journal || event.key === null) {
      try { assertWritable(); }
      catch { frozen = true; exported = null; notice(CHANGED,true); updateButtons(); }
    }
  });
  document.addEventListener('rodagem:profile-will-change',() => { exported = null; });
  document.addEventListener('rodagem:profile-stale',() => { frozen = true; exported = null; updateButtons(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
  try { if (raw(keys.journal) !== null) recoveryPromise = recover(); }
  catch { initializationError = PAUSED; frozen = true; notice(PAUSED,true); updateButtons(); }
})();
