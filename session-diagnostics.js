/* Verificação voluntária da sessão: somente Auth, sem transferir dados do app. */
(() => {
  'use strict';
  const root = window, cloud = root.RodagemCloud, profiles = root.RodagemProfiles;
  let card, button, status, busy = false, stale = false, epoch = 0, observedUserId;
  const messages = {
    AUTH_REQUIRED:'Entre novamente na sua conta para verificar a sessão.',
    SESSION_CHANGED:'A conta ou o perfil mudou. Confira a conta em uso e verifique novamente.',
    CONFIGURATION:'A conexão com a conta não está disponível nesta instalação.',
    AUTH_PENDING:'Aguarde a conclusão da operação de entrada e tente novamente.'
  };
  const idle = 'Confira se o servidor reconhece sua sessão atual.';
  function currentProfile() { return profiles?.current().id; }
  function render() {
    if (!button) return;
    button.disabled = busy || stale || !cloud?.configured();
    button.setAttribute('aria-busy',String(busy));
    button.textContent = busy ? 'Verificando sessão…' : 'Verificar sessão no servidor';
  }
  function checkContext(version, profile) {
    profiles?.assertCurrent();
    if (stale || epoch !== version || currentProfile() !== profile) {
      const error = new Error(); error.code = 'SESSION_CHANGED'; throw error;
    }
  }
  async function verify() {
    if (!button || busy || stale || !cloud?.configured()) return false;
    const version = epoch, profile = currentProfile(), focused = document.activeElement;
    busy = true; status.textContent = 'Consultando a sessão no servidor…'; render();
    try {
      checkContext(version,profile);
      // Cache is only used to pin the intended UID. getUser inside verifySession
      // supplies the authoritative identity; no local financial data is read.
      const cached = await cloud.getSession(); checkContext(version,profile);
      if (!cached?.user?.id) { const error = new Error(); error.code = 'AUTH_REQUIRED'; throw error; }
      const verified = await cloud.verifySession(cached.user.id); checkContext(version,profile);
      if (verified?.user?.id !== cached.user.id) { const error = new Error(); error.code = 'SESSION_CHANGED'; throw error; }
      status.textContent = 'Sessão confirmada pelo servidor em ' + new Date().toLocaleString('pt-BR') + '. Esta confirmação vale para o momento da consulta.';
      return true;
    } catch (error) {
      if (stale || epoch !== version || currentProfile() !== profile) {
        status.textContent = stale ? 'O perfil mudou. Recarregue o app antes de verificar.' : messages.SESSION_CHANGED;
      } else status.textContent = messages[error?.code] || 'Não foi possível confirmar a sessão. Confira sua internet e tente novamente.';
      return false;
    } finally {
      busy = false; render();
      if (!stale && epoch === version && focused?.isConnected && !focused.disabled && !focused.hidden && !focused.closest?.('[hidden], [inert], fieldset[disabled]')) {
        const style = root.getComputedStyle?.(focused);
        const visible = (!style || !['hidden','collapse'].includes(style.visibility) && style.display !== 'none') &&
          (typeof focused.getClientRects !== 'function' || focused.getClientRects().length > 0);
        if (visible) focused.focus?.({preventScroll:true});
      }
    }
  }
  function mount() {
    if (card) return;
    const anchor = document.getElementById('conta-cloud') || document.getElementById('perfil');
    if (!anchor || !cloud) return;
    card = document.createElement('section'); card.id = 'sessao-diagnostico'; card.className = 'card cloud-card';
    card.setAttribute('aria-labelledby','sessao-diagnostico-titulo');
    const heading = document.createElement('h2'); heading.id = 'sessao-diagnostico-titulo'; heading.textContent = 'Segurança da sessão';
    status = document.createElement('p'); status.id = 'sessao-diagnostico-status'; status.className = 'cloud-status';
    status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    status.textContent = cloud.configured() ? idle : messages.CONFIGURATION;
    const actions = document.createElement('div'); actions.className = 'actions cloud-actions';
    button = document.createElement('button'); button.id = 'sessao-verificar'; button.type = 'button'; button.className = 'button secondary';
    button.addEventListener('click',verify); actions.append(button);
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Esta consulta não vincula perfis, não envia cópias e não recupera dados financeiros. Sair da conta mantém os dados salvos neste aparelho.';
    card.append(heading,status,actions,hint); anchor.after(card); render();
    if (cloud.configured()) {
      try {
        cloud.onAuth((event,session) => {
          const id = session?.user?.id || null;
          if (event === 'SIGNED_OUT' || observedUserId !== undefined && id !== observedUserId) {
            epoch++;
            status.textContent = stale ? 'O perfil mudou. Recarregue o app antes de verificar.' : messages.SESSION_CHANGED;
          }
          observedUserId = id;
          render();
        });
      } catch { status.textContent = 'Não foi possível acompanhar a conta. Recarregue o app e tente novamente.'; }
    }
  }
  for (const event of ['rodagem:profile-stale','rodagem:profile-will-change']) {
    document.addEventListener(event,() => {
      stale = true; epoch++;
      if (status) status.textContent = 'O perfil mudou. Recarregue o app antes de verificar.';
      render();
    });
  }
  root.RodagemSessionDiagnostics = Object.freeze({mount,verify});
  mount();
})();
