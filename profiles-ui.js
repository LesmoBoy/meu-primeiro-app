/* Perfis locais: a troca reinicia os modelos para manter cada pessoa isolada. */
(() => {
  'use strict';
  const db = window.RodagemProfiles;
  if (!db) {
    document.getElementById('trocar-perfil')?.addEventListener('click',() => aviso('Os perfis não foram carregados. Reabra o app com internet para tentar novamente.',true));
    return;
  }
  const el = id => document.getElementById(id);
  const dialog = el('perfis-dialogo');
  const list = el('perfis-lista');
  const form = el('novo-perfil');
  if (!dialog || !list || !form) return;
  let busy = false;
  let stale = false;

  function error(message = '') {
    const target = el('perfis-erro');
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }
  function initials(name) {
    return Array.from(name.trim().split(/\s+/).map(part => Array.from(part)[0] || '').join('')).slice(0,2).join('').toLocaleUpperCase('pt-BR') || 'MR';
  }
  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy',String(value));
    for (const control of dialog.querySelectorAll('button, input')) control.disabled = value || control.dataset.current === 'true';
  }
  function render() {
    const current = db.current();
    const currentLabel = el('perfil-atual-nome');
    if (currentLabel) currentLabel.textContent = current.name;
    for (const avatar of document.querySelectorAll('[data-profiles-open]')) {
      avatar.setAttribute('aria-label','Trocar perfil. Perfil atual: ' + current.name);
      avatar.title = 'Trocar perfil';
    }
    list.replaceChildren();
    for (const profile of db.list()) {
      const row = document.createElement('div');
      row.className = 'profile-choice';
      row.dataset.profileId = profile.id;
      const active = profile.id === current.id;
      const image = document.createElement('span');
      image.className = 'profile-choice-avatar';
      image.setAttribute('aria-hidden','true');
      image.textContent = initials(profile.name);
      const details = document.createElement('div');
      details.className = 'profile-choice-details';
      const name = document.createElement('strong');
      name.textContent = profile.name;
      const description = document.createElement('small');
      description.textContent = active ? 'Você está usando este perfil' : 'Dados separados neste aparelho';
      details.append(name,description);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = active ? 'profile-current-badge' : 'button secondary';
      button.textContent = active ? 'Atual' : 'Usar perfil';
      button.dataset.current = String(active);
      button.disabled = active || busy;
      button.setAttribute('aria-label',active ? 'Perfil atual: ' + profile.name : 'Usar perfil ' + profile.name);
      if (!active) button.addEventListener('click',() => changeTo(profile.id));
      row.append(image,details,button);
      list.append(row);
    }
    if (db.error) error(db.error);
  }

  function dirtyForms() {
    if (window.RodagemBusinessUI?.isDirty()) return true;
    if (typeof perfilAlterado !== 'undefined' && perfilAlterado) return true;
    return ['dia','posto'].some(id => {
      const target = el(id);
      return Boolean(target && (target.dataset.id || [...target.querySelectorAll('input:not([type="date"])')].some(input => input.value.trim())));
    });
  }
  async function prepareChange() {
    db.assertCurrent();
    if (typeof conferirPerfilAtivo === 'function') conferirPerfilAtivo();
    const running = typeof jornadaRodagem !== 'undefined' && jornadaRodagem?.estado === 'running';
    const dirty = dirtyForms();
    if (running || dirty) {
      const parts = [];
      if (running) parts.push('A jornada deste perfil será pausada e poderá ser retomada quando você voltar.');
      if (dirty) parts.push('Os campos que ainda não foram salvos serão descartados.');
      parts.push('Os lançamentos e percursos já salvos serão mantidos. Continuar a troca de perfil?');
      if (!await confirmar(parts.join(' '))) return false;
      db.assertCurrent();
    }
    // Confirmações podem ficar abertas enquanto outra aba pausa ou retoma.
    if (typeof jornadaRodagem !== 'undefined' && jornadaRodagem?.estado === 'running') {
      await acaoJornadaRodagem('pausar');
      if (jornadaRodagem?.estado !== 'paused') throw Error('Não consegui pausar a jornada. Confira o aviso e tente novamente antes de trocar de perfil.');
    }
    db.assertCurrent();
    return true;
  }
  async function changeTo(id) {
    if (busy || stale || id === db.current().id) return;
    setBusy(true); error();
    try {
      if (!await prepareChange()) return;
      await db.switchTo(id);
      location.reload();
    } catch (cause) {
      error(cause.message || 'Não consegui trocar de perfil. Seus dados foram mantidos.');
    } finally { if (!stale) setBusy(false); }
  }
  function open() {
    if (busy || stale) return;
    try {
      db.assertCurrent(); error(); render();
      if (!dialog.open) dialog.showModal();
    } catch (cause) {
      error(cause.message || 'Não consegui abrir os perfis.');
      if (!dialog.open) dialog.showModal();
    }
  }
  el('trocar-perfil')?.addEventListener('click',open);
  document.querySelectorAll('[data-profiles-open]').forEach(button => button.addEventListener('click',open));
  el('perfis-fechar')?.addEventListener('click',() => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (busy || stale) return;
    const name = form.elements.nome.value.normalize('NFKC').trim().replace(/\s+/g,' ');
    if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) { error('Digite um nome de até 32 caracteres para o novo perfil.'); form.elements.nome.focus(); return; }
    try {
      db.assertCurrent();
      if (db.list().some(profile => profile.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
        error('Já existe um perfil com esse nome. Escolha outro nome ou use o perfil existente.');
        form.elements.nome.focus(); return;
      }
    } catch (cause) { error(cause.message); return; }
    setBusy(true); error();
    try {
      if (!await prepareChange()) return;
      const created = await db.create(name);
      await db.switchTo(created.id);
      location.reload();
    } catch (cause) {
      error(cause.message || 'Não consegui criar o perfil. Os perfis existentes foram mantidos.');
      render();
    } finally { if (!stale) setBusy(false); }
  });

  function freezeStaleTab() {
    if (stale) return;
    stale = true;
    window.RodagemGPS?.suspend?.();
    for (const openDialog of document.querySelectorAll('dialog[open]')) openDialog.close('cancelar');
    for (const selector of ['#conteudo','.main-nav','.app-header','.profile-strip']) {
      const target = document.querySelector(selector);
      if (target) target.inert = true;
    }
    const overlay = document.createElement('div');
    overlay.className = 'profile-stale-overlay';
    overlay.id = 'perfil-desatualizado';
    overlay.setAttribute('role','alertdialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-labelledby','perfil-desatualizado-titulo');
    overlay.setAttribute('aria-describedby','perfil-desatualizado-descricao');
    const card = document.createElement('div');
    card.className = 'profile-stale-card';
    const heading = document.createElement('h2');
    heading.id = 'perfil-desatualizado-titulo';
    heading.textContent = 'Perfil alterado em outra aba';
    const description = document.createElement('p');
    description.id = 'perfil-desatualizado-descricao';
    description.textContent = 'Esta aba foi pausada para não misturar os dados de pessoas diferentes. Recarregue para abrir o perfil selecionado. Campos ainda não salvos desta aba não serão transferidos.';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'button primary';
    reload.textContent = 'Recarregar perfil';
    reload.addEventListener('click',() => location.reload());
    card.append(heading,description,reload); overlay.append(card); document.body.append(overlay); reload.focus();
    overlay.addEventListener('keydown',event => {
      if (event.key === 'Tab') { event.preventDefault(); reload.focus(); }
    });
  }
  document.addEventListener('rodagem:profile-stale',freezeStaleTab);
  document.addEventListener('rodagem:profile-will-change',() => window.RodagemGPS?.suspend?.());
  function renderWhenCurrent() {
    if (stale || (typeof db.isCurrent === 'function' && !db.isCurrent())) return;
    try { render(); }
    catch (cause) { error(cause.message || 'Não consegui atualizar a lista de perfis.'); }
  }
  document.addEventListener('rodagem:profile-renamed',renderWhenCurrent);
  document.addEventListener('rodagem:profiles-updated',renderWhenCurrent);
  if (db.error) { freezeStaleTab(); return; }
  try { render(); }
  catch (cause) { error(cause.message || 'Não consegui ler a lista de perfis.'); }
})();
