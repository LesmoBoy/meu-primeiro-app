/* Captura local por jornada. O mapa pede somente os blocos de ruas visíveis;
 * coordenadas e percursos não são enviados pelo app a um servidor próprio. */
(() => {
  'use strict';
  const PREFIX = 'minha-rodagem-rota-v1:';
  const INDEX = 'minha-rodagem-rotas-indice-v1';
  const PREFS = 'minha-rodagem-gps-preferencias-v1';
  const LEASE = 'minha-rodagem-gps-lease-v1';
  const owner = globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random();
  const geo = () => globalThis.RodagemGeo;
  const el = id => document.getElementById(id);
  const text = (id, value) => { const node = el(id); if (node && node.textContent !== value) node.textContent = value; };
  const km = meters => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(meters / 1000) + ' km';
  let prefs = {enabled:true,mode:'eco'};
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) || 'null');
    if (saved && typeof saved.enabled === 'boolean' && ['eco','precise'].includes(saved.mode)) prefs = {enabled:saved.enabled,mode:saved.mode};
  } catch { /* Preferências inválidas não impedem a jornada. */ }
  let journey = null, active = null, raw = null, viewedId = null;
  let timer = null, token = 0, pending = false, releaseLock = null, lockToken = null, capturing = false;
  let status = 'O GPS começa com a jornada, se você permitir.';
  let lastState = '', lastDraw = '', map = null, line = null, marker = null, roads = null;
  let follow = true, roadsFailed = false, acquiring = false;
  const invalidRoutes = new Set();

  function warn(message) { if (typeof aviso === 'function') aviso(message,true); }
  function read(id) {
    if (!id || !geo()) return null;
    try {
      const value = localStorage.getItem(PREFIX + id);
      const track = value ? geo().validate(value) : null;
      invalidRoutes.delete(id);
      return track;
    } catch { invalidRoutes.add(id); return null; }
  }
  function index() {
    try {
      const value = JSON.parse(localStorage.getItem(INDEX) || '[]');
      return Array.isArray(value) ? value.filter(r => r && typeof r.id === 'string' && r.id.length <= 100 && Number.isFinite(r.updatedAt)).map(r => ({id:r.id,updatedAt:r.updatedAt,finished:Boolean(r.finished)})) : [];
    } catch { return []; }
  }
  function updateIndex(track, finished) {
    let entries = index().filter(r => r.id !== track.id).map(r => ({...r,finished:r.id === journey?.id && journey?.estado === 'running' ? false : true}));
    if (track.points.length) entries.push({id:track.id,updatedAt:track.updatedAt,finished});
    entries.sort((a,b) => b.updatedAt-a.updatedAt);
    const keep = [], remove = [];
    for (const entry of entries) {
      if (keep.length < 10 || !entry.finished || entry.id === journey?.id) keep.push(entry);
      else remove.push(entry);
    }
    // Grave o índice antes de remover somente percursos concluídos antigos.
    localStorage.setItem(INDEX,JSON.stringify(keep));
    for (const entry of remove) localStorage.removeItem(PREFIX + entry.id);
  }
  function save(track, finished = journey?.estado !== 'running') {
    const key = PREFIX + track.id;
    if (track.id === active?.id && localStorage.getItem(key) !== raw) throw Error('O percurso mudou em outra aba. O GPS desta aba foi interrompido para preservar o trajeto.');
    const canonical = geo().validate(track);
    const nextRaw = JSON.stringify(canonical);
    localStorage.setItem(key,nextRaw);
    active = canonical;
    raw = nextRaw;
    updateIndex(canonical,finished);
    return canonical;
  }
  function ownLease() {
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE) || 'null');
      return Boolean(lease && lease.owner === owner && lease.id === active?.id && lease.until >= Date.now());
    } catch { return false; }
  }
  function renewLease() {
    const now = Date.now();
    const previous = JSON.parse(localStorage.getItem(LEASE) || 'null');
    if (previous && previous.owner !== owner && previous.until > now) return false;
    localStorage.setItem(LEASE,JSON.stringify({owner,id:active.id,until:now+45000}));
    return ownLease();
  }
  function stop() {
    token++;
    clearTimeout(timer); timer = null; pending = false; capturing = false;
    releaseLock?.(); releaseLock = null; lockToken = null;
    try { if (JSON.parse(localStorage.getItem(LEASE) || 'null')?.owner === owner) localStorage.removeItem(LEASE); } catch {}
  }
  async function acquire(id, attempt) {
    if (navigator.locks?.request) {
      return new Promise(resolve => {
        let answered = false;
        const answer = value => { if (!answered) { answered = true; resolve(value); } };
        navigator.locks.request('minha-rodagem-gps-ativo-v1',{ifAvailable:true},lock => {
          if (!lock || attempt !== token || journey?.id !== id) { answer(false); return; }
          return new Promise(release => { releaseLock = release; lockToken = attempt; answer(true); });
        }).catch(() => answer(false));
      });
    }
    return true;
  }
  function messageFor(reason) {
    return ({accuracy:'Sinal impreciso. Aguarde ou escolha Mais precisão.',stale:'Aguardando uma posição atual do aparelho.',future:'Aguardando o relógio e uma posição válidos.',jump:'Salto de GPS ignorado. Aguardando a próxima posição.',gap:'Retomamos o GPS. O trecho sem sinal não foi somado.',stationary:'GPS ativo. Paradas não viram quilômetros.',jitter:'GPS ativo. Pequenas oscilações são ignoradas.'})[reason] || 'Registrando seu percurso por GPS.';
  }
  function schedule(attempt) {
    if (attempt !== token || !capturing || journey?.estado !== 'running') return;
    clearTimeout(timer);
    timer = setTimeout(() => poll(attempt),prefs.mode === 'precise' ? 8000 : 15000);
  }
  function poll(attempt) {
    if (attempt !== token || pending || !capturing || journey?.estado !== 'running' || active?.enabled === false) return;
    try {
      if (!renewLease()) { stop(); status = 'GPS em outra aba. Continue nela ou toque em Ativar GPS.'; render(); return; }
    } catch { stop(); status = 'Sem espaço para guardar o trajeto. Os lançamentos existentes foram preservados.'; render(); warn(status); return; }
    pending = true;
    status = active.points.length ? 'Atualizando sua posição…' : 'Aguardando a primeira posição do GPS…';
    render();
    navigator.geolocation.getCurrentPosition(position => {
      if (attempt !== token) return;
      pending = false;
      try {
        if (journey?.estado !== 'running') { stop(); render(); return; }
        if (!renewLease()) { stop(); status = 'GPS em outra aba. Continue nela ou toque em Ativar GPS.'; render(); return; }
        const result = geo().accept(active,position,Date.now());
        active = result.track;
        status = messageFor(result.reason);
        if (result.accepted) save(result.track,false);
      } catch (error) {
        const id = active?.id; stop(); active = read(id);
        try { raw = id ? localStorage.getItem(PREFIX+id) : null; } catch { raw = null; }
        status = error.message || 'Não foi possível guardar o ponto GPS. Os dados anteriores foram mantidos.'; warn(status);
      }
      render(); schedule(attempt);
    },error => {
      if (attempt !== token) return;
      pending = false;
      status = error.code === 1 ? 'Localização não autorizada. Libere o GPS no navegador ou informe os km manualmente.' : error.code === 3 ? 'O GPS demorou para responder. Tentaremos novamente.' : 'Posição indisponível. Confira a localização do aparelho.';
      if (error.code === 1) stop();
      render();
      if (error.code !== 1) schedule(attempt);
    },{enableHighAccuracy:prefs.mode === 'precise',maximumAge:active?.lastFix ? (prefs.mode === 'precise' ? 5000 : 10000) : 0,timeout:20000});
  }
  async function start(j, options = {}) {
    if (!j?.id || j.estado !== 'running' || !geo()) return;
    journey = {...j};
    if (!prefs.enabled || (el('gps-usar') && !el('gps-usar').checked)) { status = 'Jornada sem GPS. Você pode ativar quando quiser.'; render(); return; }
    if (capturing && active?.id === j.id) return;
    if (acquiring) return;
    if (!navigator.geolocation) { status = 'Este navegador não oferece GPS. Informe os km no fechamento.'; render(); return; }
    if (!options.requestPermission) {
      try {
        if (!navigator.permissions?.query || (await navigator.permissions.query({name:'geolocation'})).state !== 'granted') { status = 'Toque em Ativar GPS para retomar o percurso.'; render(); return; }
      } catch { status = 'Toque em Ativar GPS para retomar o percurso.'; render(); return; }
    }
    if (capturing || acquiring || journey?.id !== j.id || journey.estado !== 'running' || !prefs.enabled) return;
    stop();
    const attempt = token;
    try {
      raw = localStorage.getItem(PREFIX+j.id);
      active = raw ? geo().validate(raw) : geo().create(j.id,prefs.mode,Date.now());
      invalidRoutes.delete(j.id);
    } catch {
      invalidRoutes.add(j.id); active = null;
      status = 'O percurso guardado não pôde ser lido. Abra o mapa para apagar somente esse percurso antes de reiniciar o GPS.';
      render(); return;
    }
    if (active.enabled === false) { status = 'GPS desligado nesta jornada. Toque em Ativar GPS.'; render(); return; }
    const gap = Boolean(active.lastFix && Date.now()-(active.lastSeenAt || active.lastSampleAt) > 90000);
    active = geo().breakSegment({...active,mode:prefs.mode},Date.now(),gap);
    acquiring = true;
    const granted = await acquire(j.id,attempt);
    acquiring = false;
    if (attempt !== token || journey?.id !== j.id || journey.estado !== 'running') {
      if (lockToken === attempt) { releaseLock?.(); releaseLock = null; lockToken = null; }
      return;
    }
    if (!granted) { status = 'O GPS já está sendo usado em outra aba.'; render(); return; }
    try {
      if (!renewLease()) { stop(); status = 'O GPS já está sendo usado em outra aba.'; render(); return; }
      save(active,false);
      capturing = true;
      poll(attempt);
    } catch (error) { stop(); status = error.message || 'Não foi possível guardar o percurso. Confira o espaço do navegador.'; render(); warn(status); }
  }
  function sync(j) {
    const previousId = journey?.id;
    journey = j ? {...j} : null;
    if (j?.id && j.id !== previousId) { viewedId = j.id; lastDraw = ''; }
    const signature = j ? j.id + ':' + j.estado : 'none';
    if (signature !== lastState) {
      lastState = signature;
      if (!j || j.estado !== 'running') {
        const before = active; stop();
        if (before) {
          try { save(geo().breakSegment(before,Date.now(),false),true); } catch { /* Preserve a cópia já gravada. */ }
        }
        status = j?.estado === 'paused' ? 'Jornada em pausa. O deslocamento da pausa não é contado.' : j?.estado === 'pending' ? 'Percurso encerrado. Confira os km antes de salvar.' : 'Seu percurso fica guardado neste aparelho.';
      } else {
        active = read(j.id);
        try { raw = localStorage.getItem(PREFIX+j.id); }
        catch { raw = null; status = 'O navegador não conseguiu acessar o percurso. Confira o armazenamento.'; render(false); return; }
        // Recarregar não pede autorização de novo sem um gesto do usuário.
        start(j,{requestPermission:false}).catch(() => {});
      }
    }
    render(false);
  }
  function currentTrack() { return viewedId && viewedId !== active?.id ? read(viewedId) : active || read(viewedId || journey?.id); }
  function render(draw = true) {
    const current = active || read(journey?.id);
    text('jornada-km',current ? km(current.totalMeters) : '0 km');
    text('jornada-gps-status',status);
    if (!isMapVisible()) return;
    const track = currentTrack();
    text('gps-distancia',track ? km(track.totalMeters) : '0 km');
    text('gps-pontos',String(track?.points.length || 0));
    text('gps-lacunas',String(track?.gaps || 0));
    const point = track?.points.at(-1);
    text('gps-precisao',point ? 'Último ponto: precisão de cerca de ' + Math.round(point.accuracy) + ' m' : 'Aguardando uma posição válida.');
    const historical = Boolean(viewedId && viewedId !== journey?.id);
    const description = historical ? 'Percurso salvo neste aparelho.' : status;
    text('mapa-status',description + (roadsFailed ? ' Ruas indisponíveis; a trilha guardada continua visível.' : ''));
    text('gps-ajuda','Distância aproximada por GPS. Ruas precisam de internet; a trilha guardada pode ser vista offline. Tela bloqueada ou segundo plano podem interromper a captura. Até 10 percursos ficam no aparelho.');
    const canStart = !historical && journey?.estado === 'running';
    if (el('gps-ativar')) { el('gps-ativar').disabled = !canStart || capturing; el('gps-ativar').textContent = capturing ? 'GPS ativo' : 'Ativar GPS'; }
    if (el('gps-desativar')) el('gps-desativar').disabled = !canStart || !capturing;
    if (el('gps-exportar')) el('gps-exportar').disabled = !track?.points.length;
    if (el('gps-apagar')) el('gps-apagar').disabled = !track && !invalidRoutes.has(viewedId || journey?.id);
    if (el('gps-voltar')) { el('gps-voltar').hidden = !historical; el('gps-voltar').textContent = journey?.id ? 'Voltar à jornada' : 'Ir para o início'; }
    text('gps-tempo',historical ? 'Percurso salvo' : el('jornada-tempo')?.textContent || '00:00:00');
    if (el('gps-pausar')) { el('gps-pausar').hidden = historical || !['running','paused'].includes(journey?.estado); el('gps-pausar').textContent = journey?.estado === 'paused' ? 'Retomar jornada' : 'Pausar jornada'; }
    if (el('gps-encerrar')) el('gps-encerrar').hidden = historical || !['running','paused'].includes(journey?.estado);
    if (draw && isMapVisible()) drawMap(track);
  }
  function isMapVisible() { return el('percurso') && !el('percurso').hidden && !document.hidden; }
  function ensureMap() {
    if (map) return true;
    if (!globalThis.L || !el('mapa')) { text('mapa-status','O mapa não pôde abrir. O registro de km pode continuar.'); return false; }
    map = L.map(el('mapa'),{zoomControl:true,attributionControl:true,preferCanvas:true}).setView([-15.78,-47.93],4);
    roads = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom:18,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false
    }).on('tileerror',() => { roadsFailed = true; render(false); }).on('tileload',() => { if (roadsFailed) { roadsFailed = false; render(false); } }).addTo(map);
    line = L.polyline([],{color:'#743dc0',weight:5,opacity:.95,lineCap:'round'}).addTo(map);
    map.on('dragstart',() => { follow = false; if (el('gps-seguir')) el('gps-seguir').checked = false; });
    return true;
  }
  function drawMap(track, force = false) {
    if (!ensureMap()) return;
    map.invalidateSize({pan:false});
    const signature = track ? track.id + ':' + track.points.length + ':' + track.totalMeters : 'empty';
    if (!force && signature === lastDraw) return;
    lastDraw = signature;
    const segments = []; let segment = [];
    for (const p of track?.points || []) {
      if (p.break && segment.length) { segments.push(segment); segment = []; }
      segment.push([p.lat,p.lng]);
    }
    if (segment.length) segments.push(segment);
    line.setLatLngs(segments);
    const last = track?.points.at(-1);
    if (last) {
      if (!marker) marker = L.circleMarker([last.lat,last.lng],{radius:7,color:'#fff',weight:2,fillColor:'#ff8ac6',fillOpacity:1}).addTo(map);
      else marker.setLatLng([last.lat,last.lng]);
      if (force && track.points.length > 1) map.fitBounds(line.getBounds(),{padding:[28,28],maxZoom:16,animate:false});
      else if (follow) map.setView([last.lat,last.lng],Math.max(15,map.getZoom()),{animate:false});
    } else if (marker) { marker.remove(); marker = null; }
  }
  function openRoute(id) {
    viewedId = id || journey?.id || active?.id || index()[0]?.id || null;
    follow = !viewedId || viewedId === journey?.id;
    if (el('gps-seguir')) el('gps-seguir').checked = follow;
    lastDraw = '';
    abrir('percurso');
    render();
    if (isMapVisible()) drawMap(currentTrack(),true);
  }
  function distanceMeters(id) { return (id === active?.id ? active : read(id))?.totalMeters || 0; }
  function getSummary(id) { const t = id === active?.id ? active : read(id); return t ? {meters:t.totalMeters,points:t.points.length,gaps:t.gaps,mode:t.mode,updatedAt:t.updatedAt} : null; }
  function persistPrefs() {
    try { localStorage.setItem(PREFS,JSON.stringify(prefs)); }
    catch { warn('Não foi possível guardar a preferência de GPS. Ela vale apenas nesta tela.'); }
  }
  el('gps-usar')?.addEventListener('change',() => {
    prefs.enabled = el('gps-usar').checked; persistPrefs();
    if (!prefs.enabled && capturing) disable();
    else if (prefs.enabled && journey?.estado === 'running') enable().catch(error => warn(error.message));
  });
  if (el('gps-usar')) el('gps-usar').checked = prefs.enabled;
  if (el('gps-modo')) el('gps-modo').value = prefs.mode;
  el('gps-modo')?.addEventListener('change',async () => {
    prefs.mode = el('gps-modo').value === 'precise' ? 'precise' : 'eco'; persistPrefs();
    if (capturing) { stop(); await start(journey,{requestPermission:true}); }
    render();
  });
  async function enable() {
    prefs.enabled = true; persistPrefs(); if (el('gps-usar')) el('gps-usar').checked = true;
    if (active?.id === journey?.id && active.enabled === false) {
      try { save({...active,enabled:true,mode:prefs.mode},false); } catch (error) { warn(error.message); return; }
    }
    await start(journey,{requestPermission:true});
  }
  function disable() {
    stop();
    prefs.enabled = false; persistPrefs(); if (el('gps-usar')) el('gps-usar').checked = false;
    if (active) { try { save({...geo().breakSegment(active,Date.now(),false),enabled:false},journey?.estado !== 'running'); } catch (error) { warn(error.message); } }
    status = 'GPS desligado nesta jornada. O cronômetro continua.'; render();
  }
  el('gps-ativar')?.addEventListener('click',() => enable().catch(error => warn(error.message)));
  el('gps-desativar')?.addEventListener('click',disable);
  el('jornada-mapa')?.addEventListener('click',() => openRoute(journey?.id));
  el('gps-voltar')?.addEventListener('click',() => journey?.id ? openRoute(journey.id) : abrir('inicio'));
  el('gps-recentrar')?.addEventListener('click',() => { follow = true; if (el('gps-seguir')) el('gps-seguir').checked = true; drawMap(currentTrack(),true); });
  el('gps-seguir')?.addEventListener('change',() => { follow = el('gps-seguir').checked; if (follow) drawMap(currentTrack(),true); });
  el('gps-pausar')?.addEventListener('click',() => el('jornada-pausar')?.click());
  el('gps-encerrar')?.addEventListener('click',() => el('jornada-encerrar')?.click());
  el('gps-exportar')?.addEventListener('click',() => {
    const track = currentTrack(); if (!track?.points.length) return;
    baixar('minha-rodagem-percurso-' + new Date(track.createdAt).toISOString().slice(0,10) + '.gpx',geo().toGPX(track),'application/gpx+xml');
  });
  el('gps-apagar')?.addEventListener('click',async () => {
    const track = currentTrack();
    const id = track?.id || viewedId || journey?.id;
    if (!id || (!track && !invalidRoutes.has(id))) return;
    if (!await confirmar('Apagar somente este percurso GPS? Os km e valores já salvos nos fechamentos serão mantidos.')) return;
    try {
      if (!track) {
        if (journey?.id === id) { stop(); active = null; raw = null; prefs.enabled = false; persistPrefs(); if (el('gps-usar')) el('gps-usar').checked = false; }
        localStorage.removeItem(PREFIX + id); invalidRoutes.delete(id);
      } else if (active?.id === track.id) {
        stop();
        const empty = {...geo().create(track.id,prefs.mode,Date.now()),enabled:false};
        save(empty,journey?.estado !== 'running');
      } else localStorage.removeItem(PREFIX + track.id);
      localStorage.setItem(INDEX,JSON.stringify(index().filter(r => r.id !== id)));
      status = 'Percurso apagado. Os lançamentos do histórico foram preservados.'; lastDraw = ''; render();
    } catch { warn('Não consegui apagar o percurso. Tente novamente.'); }
  });
  document.addEventListener('rodagem:route',event => { if (event.detail?.panel === 'percurso') { if (!viewedId) viewedId = journey?.id || active?.id || null; render(); if (map) setTimeout(() => map.invalidateSize({pan:false}),0); } });
  document.addEventListener('visibilitychange',() => { if (!document.hidden) { render(); if (capturing && !pending) { clearTimeout(timer); poll(token); } } });
  window.addEventListener('storage',event => {
    if (event.key === PREFIX+active?.id && event.newValue !== raw) {
      stop(); active = read(active.id); raw = event.newValue; status = 'Percurso atualizado em outra aba. Ative o GPS para continuar aqui.'; render();
    } else if (event.key === PREFIX+viewedId) { lastDraw = ''; render(); }
  });
  window.addEventListener('pagehide',() => { stop(); });
  window.addEventListener('pageshow',() => { if (journey?.estado === 'running') start(journey,{requestPermission:false}).catch(() => {}); });
  window.addEventListener('offline',() => { roadsFailed = true; render(false); });
  window.addEventListener('online',() => { if (isMapVisible() && map) roads?.redraw(); });
  window.RodagemGPS = {sync,start,distanceMeters,hasTrack:id => Boolean(read(id)?.points.length),openRoute,getSummary};
  render(false);
})();
