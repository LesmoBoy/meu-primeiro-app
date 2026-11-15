/* Perfis locais: o principal mantém as chaves antigas; os demais usam um
 * namespace fixado ao abrir esta aba. Trocar de perfil exige recarregar a UI. */
(() => {
  'use strict';
  const root = window;
  const REGISTRY = 'minha-rodagem-perfis-v1';
  const PREFIX = 'minha-rodagem-usuario-v1:';
  const MAX_PROFILES = 20;
  const STALE_MESSAGE = 'O perfil mudou em outra aba. Recarregue esta página antes de continuar.';
  let error = '', stale = false, notified = false, ownSwitch = false;

  function emit(name, detail) {
    root.document?.dispatchEvent(new CustomEvent(name, {detail}));
  }
  function label(value) {
    if (typeof value !== 'string') throw Error('Informe um nome para o perfil.');
    const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) throw Error('Use um nome de perfil entre 1 e 32 caracteres.');
    return name;
  }
  const folded = value => value.normalize('NFKC').toLocaleLowerCase('pt-BR');
  function legacyName() {
    try {
      const value = JSON.parse(root.localStorage.getItem('minha-rodagem-perfil-v2') || 'null');
      if (value && typeof value.nome === 'string' && value.nome.trim()) return label(value.nome);
    } catch { /* O núcleo de registros informa os próprios erros de leitura. */ }
    return 'Perfil principal';
  }
  function virtualRegistry() {
    return {version:1,activeId:'principal',profiles:[{id:'principal',name:legacyName(),createdAt:0}]};
  }
  function validate(value) {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (!data || data.version !== 1 || typeof data.activeId !== 'string' ||
        !Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length > MAX_PROFILES) throw Error('Lista de perfis inválida.');
    const ids = new Set(), names = new Set();
    const profiles = data.profiles.map(profile => {
      if (!profile || typeof profile.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(profile.id) ||
          ids.has(profile.id) || !Number.isSafeInteger(profile.createdAt) || profile.createdAt < 0 || profile.createdAt > 8.64e15) throw Error('Lista de perfis inválida.');
      const name = label(profile.name), comparison = folded(name);
      if (names.has(comparison)) throw Error('Há nomes de perfil repetidos.');
      ids.add(profile.id); names.add(comparison);
      return {id:profile.id,name,createdAt:profile.createdAt};
    });
    if (!ids.has('principal') || !ids.has(data.activeId)) throw Error('Perfil ativo inválido.');
    return {version:1,activeId:data.activeId,profiles};
  }
  function read() {
    const raw = root.localStorage.getItem(REGISTRY);
    return {raw,data:raw === null ? virtualRegistry() : validate(raw)};
  }
  let boot;
  try { boot = read().data; }
  catch {
    error = 'Não foi possível abrir a lista de perfis. Os dados existentes foram mantidos. Recarregue antes de continuar.';
    // Um registro ilegível nunca é substituído por uma lista vazia.
    boot = {version:1,activeId:'principal',profiles:[{id:'principal',name:'Perfil principal',createdAt:0}]};
  }
  const bootId = boot.activeId;
  const bootProfile = boot.profiles.find(profile => profile.id === bootId);

  function markStale(message = STALE_MESSAGE) {
    stale = true; error = message;
    if (!notified && !ownSwitch) {
      notified = true;
      emit('rodagem:profile-stale',{id:bootId,message});
    }
  }
  function assertSnapshot(snapshot) {
    if (stale || error) throw Error(error || STALE_MESSAGE);
    if (snapshot.data.activeId !== bootId) { markStale(); throw Error(STALE_MESSAGE); }
  }
  function assertCurrent() {
    if (stale || error) throw Error(error || STALE_MESSAGE);
    try { assertSnapshot(read()); }
    catch (failure) {
      if (!stale) markStale('Não foi possível confirmar o perfil ativo. Recarregue esta página antes de salvar.');
      throw Error(error || failure.message);
    }
  }
  function key(logical) {
    if (typeof logical !== 'string' || !logical) throw Error('Chave de armazenamento inválida.');
    return bootId === 'principal' ? logical : PREFIX + bootId + ':' + logical;
  }
  function current() {
    try {
      const profile = read().data.profiles.find(entry => entry.id === bootId);
      if (profile) return {...profile};
    } catch { /* A interface ainda pode nomear o perfil cuja aba foi pausada. */ }
    return {...bootProfile};
  }
  function list() {
    try { return read().data.profiles.map(profile => ({...profile})); }
    catch { throw Error('Não foi possível ler a lista de perfis. Nenhum dado foi alterado.'); }
  }
  function transact(operation) {
    assertCurrent();
    const apply = () => {
      const snapshot = read();
      assertSnapshot(snapshot);
      return operation(snapshot);
    };
    return root.navigator?.locks?.request
      ? root.navigator.locks.request(REGISTRY,{mode:'exclusive'},apply)
      : Promise.resolve().then(apply);
  }
  function write(snapshot, value) {
    const canonical = validate(value);
    if (root.localStorage.getItem(REGISTRY) !== snapshot.raw) throw Error('A lista de perfis mudou em outra aba. Abra a lista novamente e tente outra vez.');
    try { root.localStorage.setItem(REGISTRY,JSON.stringify(canonical)); }
    catch { throw Error('Não foi possível guardar o perfil neste navegador. Confira o espaço disponível e tente novamente.'); }
    return canonical;
  }
  function uniqueName(profiles, name, ignoreId = null) {
    if (profiles.some(profile => profile.id !== ignoreId && folded(profile.name) === folded(name))) throw Error('Já existe um perfil com esse nome. Escolha outro.');
  }
  async function create(value) {
    const name = label(value);
    return transact(snapshot => {
      if (snapshot.data.profiles.length >= MAX_PROFILES) throw Error('Este aparelho já tem 20 perfis.');
      uniqueName(snapshot.data.profiles,name);
      const existing = new Set(snapshot.data.profiles.map(profile => profile.id));
      let id;
      do { id = root.crypto?.randomUUID?.() || 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); } while (existing.has(id));
      const profile = {id,name,createdAt:Date.now()};
      const saved = write(snapshot,{...snapshot.data,profiles:[...snapshot.data.profiles,profile]});
      emit('rodagem:profiles-updated',{profiles:saved.profiles.map(entry => ({...entry}))});
      emit('rodagem:profile-list-changed',{profiles:saved.profiles.map(entry => ({...entry}))});
      return {...profile};
    });
  }
  async function renameCurrent(value) {
    const name = label(value);
    return transact(snapshot => {
      uniqueName(snapshot.data.profiles,name,bootId);
      const profile = snapshot.data.profiles.find(entry => entry.id === bootId);
      if (profile.name === name) return {...profile};
      const renamed = {...profile,name};
      write(snapshot,{...snapshot.data,profiles:snapshot.data.profiles.map(entry => entry.id === bootId ? renamed : entry)});
      emit('rodagem:profiles-updated',{profile:{...renamed}});
      emit('rodagem:profile-renamed',{profile:{...renamed}});
      return {...renamed};
    });
  }
  async function switchTo(id) {
    return transact(async snapshot => {
      const profile = snapshot.data.profiles.find(entry => entry.id === id);
      if (!profile) throw Error('Esse perfil não foi encontrado. Abra a lista novamente.');
      if (id === bootId) return {...profile};
      const journeyKey = key('minha-rodagem-jornada-v2');
      const commit = () => {
        assertSnapshot(read());
        const raw = root.localStorage.getItem(journeyKey);
        if (raw !== null) {
          let journey;
          try {
            journey = JSON.parse(raw);
            const date = journey?.data;
            if (!journey || journey.versao !== 1 || typeof journey.id !== 'string' || !journey.id || journey.id.length > 100 ||
                !['running','paused','pending'].includes(journey.estado) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-') ||
                !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date ||
                !Number.isSafeInteger(journey.iniciadaEm) || journey.iniciadaEm < 0 || journey.iniciadaEm > 8.64e15 ||
                !Number.isSafeInteger(journey.acumulado) || journey.acumulado < 0 ||
                (journey.estado === 'running' && (!Number.isSafeInteger(journey.rodandoDesde) || journey.rodandoDesde < 0 || journey.rodandoDesde > 8.64e15))) throw Error();
          } catch { throw Error('Não foi possível ler a jornada deste perfil. Revise ou recupere a jornada antes de trocar.'); }
          if (journey.estado === 'running') {
            const now = Date.now();
            const accumulated = journey.acumulado + now - journey.rodandoDesde;
            if (now < journey.rodandoDesde || !Number.isSafeInteger(accumulated) || accumulated < 0) throw Error('Confira a data e a hora do aparelho antes de pausar a jornada e trocar de perfil.');
            const paused = {versao:1,id:journey.id,estado:'paused',data:journey.data,
              iniciadaEm:journey.iniciadaEm,rodandoDesde:null,acumulado:accumulated};
            if (root.localStorage.getItem(journeyKey) !== raw) throw Error('A jornada mudou em outra aba. Confira o estado antes de trocar de perfil.');
            try { root.localStorage.setItem(journeyKey,JSON.stringify(paused)); }
            catch { throw Error('Não foi possível pausar a jornada. Confira o armazenamento e tente trocar de perfil novamente.'); }
          }
        }
        emit('rodagem:profile-will-change',{from:bootId,to:id});
        write(snapshot,{...snapshot.data,activeId:id});
        ownSwitch = true; stale = true;
        error = 'O perfil foi alterado. Recarregue esta página para abrir os dados dele.';
        emit('rodagem:profile-changed',{from:bootId,to:id,profile:{...profile}});
        return {...profile};
      };
      // A trava da jornada impede que outra aba a retome entre a pausa e a troca.
      return root.navigator?.locks?.request
        ? root.navigator.locks.request(journeyKey,{mode:'exclusive'},commit)
        : commit();
    });
  }
  root.addEventListener('storage',event => {
    if (event.key !== REGISTRY && event.key !== null) return;
    try {
      const snapshot = read();
      if (snapshot.data.activeId !== bootId) markStale();
      else emit('rodagem:profiles-updated',{});
    } catch { markStale('A lista de perfis mudou e não pôde ser lida. Recarregue antes de continuar.'); }
  });
  root.RodagemProfiles = Object.freeze({
    current,key,list,assertCurrent,create,switchTo,renameCurrent,
    isCurrent:() => { try { assertCurrent(); return true; } catch { return false; } },
    get error() { return error; },
    registryKey:REGISTRY
  });
})();
