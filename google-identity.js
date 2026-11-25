/* Google Identity Services: UI opcional, carregada somente após uma solicitação.
 * A autenticação e a verificação da assinatura do ID token pertencem ao servidor.
 * Este módulo recebe apenas o hash do nonce e não usa armazenamento nem logs. */
(() => {
  'use strict';
  const root = window;
  const CLIENT_ID = '421909197196-td982abtadcdh70hesfc3ucp2fe0qqii.apps.googleusercontent.com';
  const SDK_URL = 'https://accounts.google.com/gsi/client';
  const LOAD_TIMEOUT = 12000;
  const REQUEST_TIMEOUT = 180000;
  let active = null;
  let sequence = 0;

  class IdentityError extends Error {
    constructor(code,message) { super(message); this.name = 'RodagemGoogleIdentityError'; this.code = code; }
  }
  const error = (code,message) => new IdentityError(code,message);
  function googleAPI() {
    const api = root.google?.accounts?.id;
    return typeof api?.initialize === 'function' && typeof api?.renderButton === 'function' ? api : null;
  }
  function current(attempt) { return active === attempt && !attempt.settled; }
  function node(tag,text,className) {
    const element = root.document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function cleanup(attempt) {
    root.clearTimeout(attempt.loadTimer);
    root.clearTimeout(attempt.requestTimer);
    root.removeEventListener('offline',attempt.offline);
    if (attempt.script) {
      attempt.script.removeEventListener('load',attempt.loaded);
      attempt.script.removeEventListener('error',attempt.loadFailed);
      attempt.script.remove();
    }
    const dialog = attempt.dialog;
    if (dialog) {
      dialog.removeEventListener('cancel',attempt.cancel);
      dialog.removeEventListener('close',attempt.closed);
      attempt.cancelButton?.removeEventListener('click',attempt.cancel);
      try { if (dialog.open) dialog.close(); } catch { /* Remover o diálogo também libera a interface. */ }
      dialog.remove();
    }
    attempt.nonce = '';
    if (attempt.previousFocus?.isConnected) {
      try { attempt.previousFocus.focus({preventScroll:true}); } catch { /* O controle original pode ter saído da tela. */ }
    }
  }
  function finish(attempt,failure,credential) {
    if (!current(attempt)) return;
    attempt.settled = true;
    active = null;
    cleanup(attempt);
    if (failure) attempt.reject(failure);
    else attempt.resolve(credential);
  }
  function credentialClaims(value) {
    if (typeof value !== 'string' || value.length > 20000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
      const segment = value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const claims = JSON.parse(root.atob(segment.padEnd(Math.ceil(segment.length/4)*4,'=')));
      return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
    } catch { return null; }
  }
  function receive(attempt,response) {
    if (!current(attempt)) return;
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      finish(attempt,error('INVALID_RESPONSE','O Google não confirmou a entrada. Tente novamente.')); return;
    }
    for (const key of ['clientId','client_id']) {
      if (Object.prototype.hasOwnProperty.call(response,key) && response[key] !== attempt.clientId) {
        finish(attempt,error('CLIENT_MISMATCH','A identificação da entrada não confere. Tente novamente.')); return;
      }
    }
    // Decodificar estas duas informações só correlaciona a resposta à tentativa.
    // Nenhuma claim decodificada é considerada prova de identidade neste módulo.
    const claims = credentialClaims(response.credential);
    if (!claims || typeof claims.nonce !== 'string') {
      finish(attempt,error('INVALID_RESPONSE','O Google não confirmou a entrada. Tente novamente.')); return;
    }
    const matchesAudience = claims.aud === attempt.clientId || Array.isArray(claims.aud) && claims.aud.includes(attempt.clientId);
    if (!matchesAudience) {
      finish(attempt,error('CLIENT_MISMATCH','A identificação da entrada não confere. Tente novamente.')); return;
    }
    if (claims.nonce !== attempt.nonce) {
      // O SDK tem configuração global. Um popup antigo pode terminar depois de
      // uma nova initialize; ele nunca deve concluir a tentativa mais recente.
      attempt.status.textContent = 'Esse retorno pertence a outra tentativa. Use o botão do Google para continuar.';
      return;
    }
    finish(attempt,null,response.credential);
  }
  function render(attempt) {
    if (!current(attempt)) return;
    root.clearTimeout(attempt.loadTimer);
    const api = googleAPI();
    if (!api) { finish(attempt,error('SDK_LOAD','Não foi possível carregar a entrada do Google. Tente novamente.')); return; }
    try {
      api.initialize({client_id:attempt.clientId,nonce:attempt.nonce,callback:response => receive(attempt,response),auto_select:false,button_auto_select:false,ux_mode:'popup'});
      if (!current(attempt)) return;
      attempt.status.textContent = 'Toque no botão do Google para escolher sua conta.';
      attempt.dialog.setAttribute('aria-busy','false');
      attempt.buttonHost.hidden = false;
      const width = Math.min(360,Math.max(200,Math.floor(attempt.buttonHost.getBoundingClientRect().width || root.innerWidth - 80)));
      api.renderButton(attempt.buttonHost,{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',locale:'pt-BR',width});
      // O popup só começa quando a pessoa aciona o botão oficial renderizado.
      // Não chamamos prompt(), TokenClient nem um clique programático.
    } catch {
      finish(attempt,error('SDK_LOAD','Não foi possível preparar a entrada do Google. Tente novamente.'));
    }
  }
  function load(attempt) {
    if (googleAPI()) { render(attempt); return; }
    const script = root.document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.dataset.rodagemGoogleSdk = 'true';
    attempt.script = script;
    attempt.loaded = () => render(attempt);
    attempt.loadFailed = () => finish(attempt,error('SDK_LOAD','Não foi possível carregar o Google. Confira a internet e tente novamente.'));
    script.addEventListener('load',attempt.loaded,{once:true});
    script.addEventListener('error',attempt.loadFailed,{once:true});
    attempt.loadTimer = root.setTimeout(() => finish(attempt,error('SDK_TIMEOUT','O Google demorou para responder. Confira a internet e tente novamente.')),LOAD_TIMEOUT);
    root.document.head.append(script);
  }
  function requestCredential(options) {
    if (active) return Promise.reject(error('BUSY','Uma entrada com Google já está em andamento.'));
    const clientId = options?.clientId;
    const nonce = options?.nonce;
    if (clientId !== CLIENT_ID) return Promise.reject(error('CONFIGURATION','A entrada com Google não está configurada corretamente.'));
    if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) return Promise.reject(error('INVALID_ARGUMENT','Não foi possível preparar uma entrada segura. Tente novamente.'));
    if (root.navigator.onLine === false) return Promise.reject(error('OFFLINE','Sem internet. Conecte-se para entrar com Google.'));
    if (!root.document.body || typeof root.HTMLDialogElement?.prototype.showModal !== 'function') {
      return Promise.reject(error('UNSUPPORTED','Atualize o navegador para usar a entrada com Google.'));
    }
    return new Promise((resolve,reject) => {
      const attempt = {clientId,nonce,resolve,reject,settled:false,previousFocus:root.document.activeElement};
      active = attempt;
      try {
        const number = ++sequence;
        const dialog = node('dialog',null,'google-identity-dialog');
        attempt.dialog = dialog;
        dialog.setAttribute('aria-labelledby','google-identity-title-' + number);
        dialog.setAttribute('aria-describedby','google-identity-description-' + number);
        dialog.setAttribute('aria-modal','true');
        dialog.setAttribute('aria-busy','true');
        const content = node('div',null,'google-identity-content');
        const eyebrow = node('p','SUA CONTA','google-identity-eyebrow');
        const title = node('h2','Entrar com Google'); title.id = 'google-identity-title-' + number;
        const description = node('p','Escolha sua conta no Google. Entrar não envia seus lançamentos para a nuvem.','google-identity-description'); description.id = 'google-identity-description-' + number;
        attempt.status = node('p','Carregando a entrada do Google…','google-identity-status');
        attempt.status.setAttribute('role','status');
        attempt.status.setAttribute('aria-live','polite');
        attempt.buttonHost = node('div',null,'google-identity-button'); attempt.buttonHost.hidden = true;
        const footer = node('div',null,'google-identity-actions');
        const cancel = node('button','Cancelar','button secondary google-identity-cancel'); cancel.type = 'button'; cancel.autofocus = true;
        attempt.cancelButton = cancel;
        footer.append(cancel);
        content.append(eyebrow,title,description,attempt.status,attempt.buttonHost,footer);
        dialog.append(content);
        attempt.cancel = event => { event?.preventDefault(); finish(attempt,error('CANCELLED','Entrada com Google cancelada.')); };
        attempt.closed = () => finish(attempt,error('CANCELLED','Entrada com Google cancelada.'));
        attempt.offline = () => finish(attempt,error('OFFLINE','A conexão foi interrompida. Conecte-se e tente entrar novamente.'));
        dialog.addEventListener('cancel',attempt.cancel);
        dialog.addEventListener('close',attempt.closed);
        cancel.addEventListener('click',attempt.cancel);
        root.addEventListener('offline',attempt.offline);
        root.document.body.append(dialog);
        dialog.showModal();
        cancel.focus({preventScroll:true});
        attempt.requestTimer = root.setTimeout(() => finish(attempt,error('TIMEOUT','A tentativa de entrada expirou. Toque em entrar para tentar novamente.')),REQUEST_TIMEOUT);
        load(attempt);
      } catch {
        finish(attempt,error('SDK_LOAD','Não foi possível abrir a entrada do Google. Tente novamente.'));
      }
    });
  }
  root.RodagemGoogleIdentity = Object.freeze({requestCredential});
})();
