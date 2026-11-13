'use strict';

// Personalização e jornada ficam separadas dos lançamentos da versão 1.
const perfilStorageKey = 'minha-rodagem-perfil-v2';
const jornadaStorageKey = 'minha-rodagem-jornada-v2';
const perfilPadrao = Object.freeze({versao: 1, nome: '', trabalho: 'apps', jornada: 0, meta: 0, moto: '110–160 cc', modelo: '', combustivel: 'Gasolina', configurado: false});
let perfilRodagem = {...perfilPadrao};
let perfilRaw = null;
let perfilAlterado = false;
let jornadaRodagem = null;
let jornadaRaw = null;
let jornadaOcupada = false;
let jornadaInvalida = false;
let perfilSalvando = false;

function comTravaExperiencia(nome, acao) {
  return navigator.locks?.request ? navigator.locks.request(nome, acao) : Promise.resolve().then(acao);
}

function lerPerfilRodagem(raw) {
  if (!raw) return {...perfilPadrao};
  const p = JSON.parse(raw);
  if (!p || p.versao !== 1 || typeof p.nome !== 'string' || p.nome.length > 32 ||
      typeof p.modelo !== 'string' || p.modelo.length > 40 ||
      !['apps', 'restaurante', 'encomendas', 'misto'].includes(p.trabalho) ||
      !['110–160 cc', '200–300 cc', 'Scooter', 'Outra moto'].includes(p.moto) ||
      !['Gasolina', 'Etanol', 'Flex / alternado'].includes(p.combustivel) ||
      !Number.isFinite(p.jornada) || p.jornada < 0 || p.jornada > 24 ||
      !inteiro(p.meta) || typeof p.configurado !== 'boolean') throw Error('Perfil inválido.');
  return {versao: 1, nome: p.nome.trim(), trabalho: p.trabalho, jornada: p.jornada,
    meta: p.meta, moto: p.moto, modelo: p.modelo.trim(), combustivel: p.combustivel,
    configurado: p.configurado};
}

function lerJornadaRodagem(raw) {
  if (!raw) return null;
  const j = JSON.parse(raw);
  if (!j || j.versao !== 1 || typeof j.id !== 'string' || !j.id || j.id.length > 100 ||
      !['running', 'paused', 'pending'].includes(j.estado) || !dataValida(j.data) ||
      !Number.isSafeInteger(j.iniciadaEm) || j.iniciadaEm < 0 || j.iniciadaEm > 8.64e15 ||
      !Number.isSafeInteger(j.acumulado) || j.acumulado < 0 ||
      (j.estado === 'running' && (!Number.isSafeInteger(j.rodandoDesde) || j.rodandoDesde < 0 || j.rodandoDesde > 8.64e15))) {
    throw Error('Jornada inválida.');
  }
  return {versao: 1, id: j.id, estado: j.estado, data: j.data,
    iniciadaEm: j.iniciadaEm, acumulado: j.acumulado,
    rodandoDesde: j.estado === 'running' ? j.rodandoDesde : null};
}

try {
  perfilRaw = localStorage.getItem(perfilStorageKey);
  perfilRodagem = lerPerfilRodagem(perfilRaw);
} catch {
  aviso('Não consegui abrir seu perfil. Seus lançamentos continuam no histórico. Confira e salve suas preferências novamente.', true);
}
try {
  jornadaRaw = localStorage.getItem(jornadaStorageKey);
  jornadaRodagem = lerJornadaRodagem(jornadaRaw);
} catch {
  jornadaInvalida = true;
  aviso('Não consegui abrir a jornada anterior. Confira suas horas antes de fazer o fechamento.', true);
}

function moedaInputRodagem(valor, opcional = true) {
  const texto = String(valor).trim();
  if (!texto && opcional) return 0;
  return decimalInteiro(texto, 2);
}

function atualizarPrevia() {
  const form = $('dia');
  const valores = ['ganhos', 'combustivel', 'outros'].map(nome => moedaInputRodagem(form.elements[nome].value));
  const valido = valores.every(valor => valor !== null);
  const liquido = valido ? valores[0] - valores[1] - valores[2] : 0;
  $('previa-saldo').textContent = valido ? moeda.format(liquido / 100) : '—';
  $('previa-dia').dataset.negative = String(valido && liquido < 0);
  $('previa-dia').querySelector('small').textContent = !valido
    ? 'Confira os valores: use números como 180,00.'
    : !form.elements.ganhos.value.trim()
      ? 'Preencha os ganhos e os gastos para conferir.'
      : 'Prévia do fechamento. Salve para adicionar ao painel.';
}

function atualizarOpcoesRotina() {
  const valor = Number($('perfil').elements.jornada.value.replace(',', '.'));
  document.querySelectorAll('[data-rotina]').forEach(botao => {
    botao.setAttribute('aria-pressed', String(valor === Number(botao.dataset.rotina)));
  });
}

function preencherPerfilRodagem() {
  const form = $('perfil');
  for (const campo of ['nome', 'trabalho', 'moto', 'modelo', 'combustivel']) form.elements[campo].value = perfilRodagem[campo];
  form.elements.jornada.value = perfilRodagem.jornada ? String(perfilRodagem.jornada).replace('.', ',') : '';
  form.elements.meta.value = perfilRodagem.meta ? (perfilRodagem.meta / 100).toFixed(2).replace('.', ',') : '';
  perfilAlterado = false;
  atualizarOpcoesRotina();
}

function graficoSemanaRodagem() {
  const hoje = new Date();
  const dias = Array.from({length: 7}, (_, i) => {
    const dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6 + i);
    const data = dataLocal(dia);
    const itens = registros.filter(r => r.tipo === 'dia' && r.data === data);
    return {dia, data, saldo: itens.reduce((soma, r) => soma + saldo(r), 0), quantidade: itens.length};
  });
  const maior = Math.max(100, ...dias.map(dia => Math.abs(dia.saldo)));
  const grafico = $('semana-grafico');
  grafico.replaceChildren();
  for (const d of dias) {
    const coluna = document.createElement('div');
    coluna.className = 'chart-day';
    coluna.setAttribute('role','img');
    coluna.dataset.negative = String(d.saldo < 0);
    coluna.dataset.today = String(d.data === dataLocal());
    const detalhe = formatarData(d.data) + ': ' + (d.quantidade ? moeda.format(d.saldo / 100) + ' de saldo' : 'sem fechamento');
    coluna.setAttribute('aria-label', detalhe);
    coluna.title = detalhe;
    const valor = document.createElement('span');
    valor.className = 'chart-value';
    valor.textContent = d.quantidade ? numero.format(d.saldo / 100) : '—';
    valor.setAttribute('aria-hidden', 'true');
    const barra = document.createElement('span');
    barra.className = 'chart-bar';
    barra.style.height = Math.max(3, Math.abs(d.saldo) / maior * 100) + '%';
    barra.style.setProperty('--bar-height', Math.max(3, Math.abs(d.saldo) / maior * 100) + '%');
    barra.dataset.empty = String(!d.quantidade);
    barra.setAttribute('aria-hidden', 'true');
    const rotulo = document.createElement('span');
    rotulo.className = 'chart-label';
    rotulo.textContent = d.dia.toLocaleDateString('pt-BR', {weekday: 'short'}).replace('.', '');
    rotulo.setAttribute('aria-hidden', 'true');
    coluna.append(valor, barra, rotulo);
    grafico.append(coluna);
  }
  const total = dias.reduce((soma, dia) => soma + dia.saldo, 0);
  $('semana-total').textContent = dias.some(dia => dia.quantidade)
    ? moeda.format(total / 100) + ' de saldo nos fechamentos dos últimos 7 dias.'
    : 'Sem fechamentos por enquanto. Seu próximo registro começa essa história.';
}

function atualizarExperiencia() {
  const hoje = dataLocal();
  const dias = registros.filter(r => r.tipo === 'dia' && r.data === hoje);
  const total = dias.reduce((soma, r) => soma + saldo(r), 0);
  $('saldo-hoje').textContent = moeda.format(total / 100);
  $('saldo-hoje').dataset.negative = String(total < 0);
  $('ganhos-hoje').textContent = moeda.format(dias.reduce((soma, r) => soma + r.ganhos, 0) / 100);
  $('gastos-hoje').textContent = moeda.format(dias.reduce((soma, r) => soma + r.combustivel + r.outros, 0) / 100);
  $('entregas-hoje').textContent = numero.format(dias.reduce((soma, r) => soma + r.entregas, 0));
  const progresso = perfilRodagem.meta > 0 ? Math.min(100, Math.max(0, total / perfilRodagem.meta * 100)) : 0;
  const meta = $('meta-progresso');
  meta.setAttribute('aria-valuenow', String(Math.round(progresso)));
  meta.setAttribute('aria-valuetext', perfilRodagem.meta ? Math.round(progresso) + '% da meta de saldo' : 'Meta ainda não definida');
  meta.querySelector('span').style.width = progresso + '%';
  $('meta-valor').textContent = perfilRodagem.meta ? moeda.format(perfilRodagem.meta / 100) : 'Defina sua meta';
  $('meta-texto').textContent = !perfilRodagem.meta
    ? 'Escolha quanto você quer ter de saldo ao fim do dia.'
    : total >= perfilRodagem.meta
      ? 'Meta atingida! ' + moeda.format(total / 100) + ' de saldo registrado hoje.'
      : 'Faltam ' + moeda.format((perfilRodagem.meta - total) / 100) + ' de saldo para chegar à sua meta.';
  $('boas-vindas').hidden = perfilRodagem.configurado;
  $('data-hoje').textContent = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'}).toLocaleUpperCase('pt-BR');
  const titulo = $('titulo-inicio');
  const saudacao = perfilRodagem.nome ? 'Bora rodar, ' + perfilRodagem.nome : 'Bora fazer um bom dia';
  titulo.replaceChildren(document.createTextNode(saudacao));
  const ponto = document.createElement('span');
  ponto.className = 'accent';
  ponto.textContent = '.';
  titulo.append(ponto);
  const avatar = document.querySelector('.avatar');
  avatar.textContent = perfilRodagem.nome ? Array.from(perfilRodagem.nome.trim().split(/\s+/).map(p => p[0]).join('')).slice(0, 2).join('').toLocaleUpperCase('pt-BR') : 'MR';
  avatar.setAttribute('aria-label', 'Abrir perfil' + (perfilRodagem.nome ? ' de ' + perfilRodagem.nome : ''));
  const datasInconsistentes = abastecimentosForaDeOrdem(registros);
  const medidos = [...ciclos(registros.filter(r => r.data <= hoje)).values()];
  const ultimo = medidos.at(-1);
  $('moto-consumo').textContent = ultimo ? kmLitro(ultimo.kmPorLitro) : '— km/L';
  $('moto-consumo-dica').textContent = datasInconsistentes
    ? 'Há datas fora da ordem do hodômetro. Revise no Histórico; ciclos inconsistentes são ignorados.'
    : ultimo ? 'Último ciclo entre tanques cheios, até hoje.' : 'Complete um ciclo para medir.';
  $('moto-custo').textContent = ultimo ? moeda.format(ultimo.custoPorKm) : '—';
  $('moto-nome').textContent = perfilRodagem.configurado ? (perfilRodagem.modelo || perfilRodagem.moto) : 'Do seu jeito';
  $('moto-combustivel').textContent = perfilRodagem.configurado ? perfilRodagem.moto + ' · ' + perfilRodagem.combustivel : 'Cadastre no seu perfil.';
  $('insight-titulo').textContent = ultimo ? kmLitro(ultimo.kmPorLitro) + ' na prática' : 'Conheça seu custo por km';
  $('insight-texto').textContent = datasInconsistentes
    ? 'Algumas datas de abastecimento estão fora da ordem do hodômetro. Confira os lançamentos no Histórico para corrigir o consumo.'
    : ultimo
    ? 'No último ciclo, cada km custou ' + moeda.format(ultimo.custoPorKm) + ' em combustível. Use essa referência no fechamento.'
    : 'Dois tanques cheios ajudam a descobrir quanto a moto consome de verdade.';
  atualizarDicaPosto();
  graficoSemanaRodagem();
  atualizarPrevia();
  atualizarJornadaRodagem();
}

function atualizarDicaPosto() {
  if (abastecimentosForaDeOrdem(registros)) {
    $('posto-dica').textContent = 'Há abastecimentos com datas fora da ordem do hodômetro. Revise-os no Histórico antes de usar o consumo como referência.';
    return;
  }
  const parcial = $('posto').elements.tanque.value === 'parcial';
  const existeCheio = registros.some(r => r.tipo === 'posto' && r.tanque === 'cheio');
  $('posto-dica').textContent = parcial
    ? 'Abastecimento parcial: os litros entrarão na conta quando você completar o tanque novamente.'
    : existeCheio
      ? 'Um novo tanque cheio encerra o ciclo anterior e atualiza seu consumo medido.'
      : 'O primeiro tanque cheio é seu ponto de partida. O próximo permite calcular o consumo.';
}

function atualizarConexaoRodagem() {
  const online = navigator.onLine !== false;
  const alvo = $('conexao');
  alvo.dataset.offline = String(!online);
  const ponto = document.createElement('span');
  ponto.className = 'status-dot';
  alvo.replaceChildren(ponto, document.createTextNode(online ? 'Online' : 'Sem internet'));
  alvo.title = online ? 'Conectado à internet. Os registros são salvos neste navegador.' : 'Sem internet. Continue registrando neste navegador.';
}

$('perfil').addEventListener('input', () => { perfilAlterado = true; atualizarOpcoesRotina(); });
$('perfil').addEventListener('change', () => { perfilAlterado = true; });
document.querySelectorAll('[data-rotina]').forEach(botao => botao.addEventListener('click', () => {
  $('perfil').elements.jornada.value = botao.dataset.rotina;
  perfilAlterado = true;
  atualizarOpcoesRotina();
}));
$('perfil').addEventListener('submit', async evento => {
  evento.preventDefault();
  if (perfilSalvando) return;
  perfilSalvando = true;
  const botaoSalvar = $('perfil').querySelector('button[type="submit"]');
  botaoSalvar.disabled = true;
  try {
    const c = $('perfil').elements;
    const textoHoras = c.jornada.value.trim();
    const jornada = textoHoras ? Number(textoHoras.replace(',', '.')) : 0;
    if (textoHoras && (!/^\d+(?:[,.]\d{1,2})?$/.test(textoHoras) || !Number.isFinite(jornada) || jornada <= 0 || jornada > 24)) {
      c.jornada.focus();
      throw Error('Informe uma jornada maior que zero e de até 24 horas, ou deixe em branco.');
    }
    const meta = moedaInputRodagem(c.meta.value);
    if (meta === null) { c.meta.focus(); throw Error('Confira a meta. Use um valor como 150,00.'); }
    const novo = {versao: 1, nome: c.nome.value.trim(), trabalho: c.trabalho.value, jornada, meta,
      moto: c.moto.value, modelo: c.modelo.value.trim(), combustivel: c.combustivel.value, configurado: true};
    const raw = JSON.stringify(novo);
    lerPerfilRodagem(raw);
    const formularioEnviado = [...$('perfil').querySelectorAll('input,select')].map(campo => campo.value).join('\u0000');
    const versaoPerfilEsperada = perfilRaw;
    await comTravaExperiencia(perfilStorageKey, () => {
      let atual;
      try { atual = localStorage.getItem(perfilStorageKey); }
      catch { throw Error('O navegador não conseguiu acessar seu perfil. Confira se o armazenamento está disponível.'); }
      if (atual !== versaoPerfilEsperada) throw Error('Seu perfil mudou em outra aba. Reabra a página antes de salvar suas preferências.');
      try { localStorage.setItem(perfilStorageKey, raw); }
      catch { throw Error('Não foi possível salvar o perfil neste navegador. Libere espaço e tente novamente.'); }
      perfilRaw = raw;
      perfilRodagem = novo;
    });
    perfilAlterado = formularioEnviado !== [...$('perfil').querySelectorAll('input,select')].map(campo => campo.value).join('\u0000');
    atualizarExperiencia();
    aviso('Perfil salvo. Sua rotina está pronta para os próximos fechamentos.');
  } catch (erro) { aviso(erro.message || 'Não consegui salvar seu perfil neste navegador.', true); }
  finally { perfilSalvando = false; botaoSalvar.disabled = false; }
});

async function preencherHorasRodagem(horas) {
  const campo = $('dia').elements.horas;
  if (campo.value.trim() && Number(campo.value.replace(',', '.')) !== horas &&
      !await confirmar('Substituir as horas preenchidas por ' + numero.format(horas) + ' horas?')) return;
  campo.value = String(horas).replace('.', ',');
  campo.dispatchEvent(new Event('input', {bubbles: true}));
  aviso('Jornada de ' + numero.format(horas) + ' horas preenchida. Ajuste às horas que você realmente trabalhou.');
}
document.querySelectorAll('[data-horas]').forEach(botao => botao.addEventListener('click', () => {
  preencherHorasRodagem(Number(botao.dataset.horas)).catch(erro => aviso(erro.message, true));
}));
$('usar-rotina').addEventListener('click', () => {
  if (!perfilRodagem.jornada) {
    aviso('Escolha sua jornada habitual no perfil para usar esse atalho.');
    abrir('ajustes');
    $('perfil').elements.jornada.focus();
    return;
  }
  preencherHorasRodagem(perfilRodagem.jornada).catch(erro => aviso(erro.message, true));
});
$('dia').addEventListener('input', atualizarPrevia);
$('posto').elements.tanque.addEventListener('change', atualizarDicaPosto);

function duracaoJornadaRodagem(j = jornadaRodagem, agora = Date.now()) {
  return !j ? 0 : Math.min(Number.MAX_SAFE_INTEGER,
    j.acumulado + (j.estado === 'running' ? Math.max(0, agora - j.rodandoDesde) : 0));
}
function jornadaJaRegistrada(j = jornadaRodagem) {
  return Boolean(j && registros.some(r => r.tipo === 'dia' && r.jornadaId === j.id));
}
function formatarTempoRodagem(ms) {
  const segundos = Math.floor(ms / 1000);
  return [Math.floor(segundos / 3600), Math.floor(segundos / 60) % 60, segundos % 60]
    .map(v => String(v).padStart(2, '0')).join(':');
}
function atualizarJornadaRodagem() {
  const j = jornadaRodagem;
  const estado = jornadaInvalida ? 'invalid' : jornadaJaRegistrada(j) ? 'completed' : j?.estado || 'idle';
  const status = $('jornada-status');
  status.dataset.state = estado;
  status.textContent = ({idle: 'Não iniciada', running: 'Em andamento', paused: 'Em pausa', pending: 'Pronta para fechar', completed: 'Já registrada', invalid: 'Precisa de revisão'})[estado];
  $('jornada-tempo').textContent = formatarTempoRodagem(duracaoJornadaRodagem());
  $('jornada-tempo').dataset.state = estado;
  $('jornada-iniciar').hidden = estado === 'running' || estado === 'paused';
  $('jornada-iniciar').textContent = estado === 'pending' ? 'Levar ao fechamento' : estado === 'completed' ? 'Iniciar outra jornada' : estado === 'invalid' ? 'Revisar jornada' : 'Iniciar jornada';
  $('jornada-pausar').hidden = ['idle','completed','invalid'].includes(estado);
  $('jornada-pausar').textContent = estado === 'pending' ? 'Descartar jornada' : estado === 'paused' ? 'Retomar' : 'Pausar';
  $('jornada-encerrar').hidden = ['idle','pending','completed','invalid'].includes(estado);
  $('jornada-dica').textContent = estado === 'running'
    ? 'Tempo contado desde ' + new Date(j.iniciadaEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) + '. Pode fechar o app: a jornada continua.'
    : estado === 'paused' ? 'Respire um pouco. O tempo da pausa fica fora do total.'
      : estado === 'pending' ? 'Suas horas estão guardadas. Revise os valores e salve o fechamento para concluir.'
        : estado === 'completed' ? 'Esta jornada já foi salva em um fechamento. Você pode iniciar outra sem registrar as mesmas horas novamente.'
          : estado === 'invalid' ? 'O marcador anterior não pôde ser lido. Revise suas horas no fechamento antes de iniciar outra jornada.'
            : 'Inicie para acompanhar suas horas. As pausas ficam fora da conta.';
}

async function salvarJornadaRodagem(nova) {
  const versaoEsperada = jornadaRaw;
  return comTravaExperiencia(jornadaStorageKey, () => {
    let atual;
    try { atual = localStorage.getItem(jornadaStorageKey); }
    catch { throw Error('O navegador não conseguiu acessar sua jornada. Confira se o armazenamento está disponível.'); }
    if (atual !== versaoEsperada) {
      jornadaRaw = atual;
      try { jornadaRodagem = lerJornadaRodagem(atual); jornadaInvalida = false; }
      catch { jornadaRodagem = null; jornadaInvalida = true; }
      atualizarJornadaRodagem();
      throw Error('A jornada mudou em outra aba. Confira o estado atualizado e tente novamente.');
    }
    const raw = nova ? JSON.stringify(nova) : null;
    const validada = lerJornadaRodagem(raw);
    try {
      if (nova) localStorage.setItem(jornadaStorageKey, raw);
      else localStorage.removeItem(jornadaStorageKey);
    } catch { throw Error('Não foi possível guardar a jornada neste navegador. Confira o espaço disponível e tente novamente.'); }
    jornadaRodagem = validada;
    jornadaRaw = raw;
    jornadaInvalida = false;
    atualizarJornadaRodagem();
  });
}

async function levarJornadaAoFechamento() {
  const j = jornadaRodagem;
  if (!j || j.estado !== 'pending') return;
  if (jornadaJaRegistrada(j)) throw Error('Esta jornada já foi registrada. Confira o lançamento no Histórico.');
  const form = $('dia');
  const campos = ['ganhos', 'entregas', 'horas', 'km', 'combustivel', 'outros'];
  const editando = Boolean(form.dataset.id);
  const mesmoRascunho = form.dataset.jornada === j.id;
  const horasEsperadas = Math.max(0.01, Math.round(j.acumulado / 3600000 * 100) / 100);
  if (mesmoRascunho && (form.elements.data.value !== j.data || Number(form.elements.horas.value.replace(',', '.')) !== horasEsperadas) &&
      !await confirmar('Você ajustou a data ou as horas deste fechamento. Substituir pelos valores da jornada?')) return;
  if (!mesmoRascunho && (editando || campos.some(c => form.elements[c].value.trim()))) {
    const texto = editando
      ? 'Há um lançamento em edição. Preparar um novo fechamento para esta jornada? Os campos da edição serão limpos; o lançamento original permanece no histórico.'
      : 'Há um fechamento preenchido. Usar a data e as horas desta jornada nele? Os ganhos e gastos preenchidos serão mantidos.';
    if (!await confirmar(texto)) return;
  }
  // Uma confirmação pode ficar aberta enquanto a jornada muda em outra aba.
  if (!jornadaRodagem || jornadaRodagem.id !== j.id || jornadaRodagem.estado !== 'pending' || jornadaJaRegistrada(j)) throw Error('A jornada mudou ou já foi registrada. Confira antes de fechar.');
  if (editando) limpar(form);
  form.elements.data.value = j.data;
  form.elements.horas.value = String(horasEsperadas).replace('.', ',');
  form.dataset.jornada = j.id;
  form.elements.horas.dispatchEvent(new Event('input', {bubbles: true}));
  abrir('fechamento');
  aviso('Horas da jornada preenchidas. Revise seus ganhos e gastos e salve o fechamento.');
  form.elements.ganhos.focus();
}

async function acaoJornadaRodagem(acao) {
  if (jornadaOcupada) return;
  jornadaOcupada = true;
  try {
    if (jornadaInvalida) {
      if (acao !== 'iniciar' || !await confirmar('O marcador da jornada anterior está inválido. Descartar somente esse marcador? Seus fechamentos e abastecimentos salvos serão mantidos. Confira suas horas no fechamento antes de continuar.')) return;
      await salvarJornadaRodagem(null);
      aviso('Marcador inválido descartado. Confira as horas anteriores no fechamento e toque em Iniciar jornada quando estiver pronto.');
      return;
    }
    if (jornadaJaRegistrada()) {
      if (acao !== 'iniciar') throw Error('Esta jornada já foi registrada. Confira o Histórico.');
      await salvarJornadaRodagem(null);
    }
    const j = jornadaRodagem;
    const agora = Date.now();
    if (j?.estado === 'running' && agora < j.rodandoDesde) throw Error('O relógio do aparelho ficou anterior ao início da contagem. Corrija a data e a hora antes de pausar ou encerrar; sua jornada foi mantida.');
    if (acao === 'iniciar') {
      if (j?.estado === 'pending') await levarJornadaAoFechamento();
      else if (!j) {
        const id = globalThis.crypto?.randomUUID?.() || agora + '-' + Math.random();
        await salvarJornadaRodagem({versao: 1, id, estado: 'running', iniciadaEm: agora, rodandoDesde: agora, acumulado: 0, data: dataLocal(new Date(agora))});
        aviso('Jornada iniciada. Pause quando fizer uma parada.');
      }
    } else if (acao === 'pausar' && j) {
      if (j.estado === 'pending') {
        if (await confirmar('Descartar o tempo desta jornada? Seus fechamentos e abastecimentos salvos não serão alterados.')) {
          if (!jornadaRodagem || jornadaRodagem.id !== j.id || jornadaRodagem.estado !== 'pending') throw Error('A jornada mudou em outra aba. Confira antes de descartar.');
          await salvarJornadaRodagem(null);
          if ($('dia').dataset.jornada === j.id) delete $('dia').dataset.jornada;
          aviso('Jornada descartada.');
        }
      } else if (j.estado === 'running') {
        await salvarJornadaRodagem({...j, estado: 'paused', acumulado: duracaoJornadaRodagem(j, agora), rodandoDesde: null});
        aviso('Jornada pausada. Toque em Retomar quando voltar.');
      } else {
        await salvarJornadaRodagem({...j, estado: 'running', rodandoDesde: agora});
        aviso('Jornada retomada.');
      }
    } else if (acao === 'encerrar' && j && j.estado !== 'pending') {
      await salvarJornadaRodagem({...j, estado: 'pending', acumulado: duracaoJornadaRodagem(j, agora), rodandoDesde: null});
      await levarJornadaAoFechamento();
    }
  } catch (erro) {
    aviso(erro.message || 'Não consegui guardar a jornada neste navegador.', true);
  } finally { jornadaOcupada = false; }
}

$('jornada-iniciar').addEventListener('click', () => acaoJornadaRodagem('iniciar'));
$('jornada-pausar').addEventListener('click', () => acaoJornadaRodagem('pausar'));
$('jornada-encerrar').addEventListener('click', () => acaoJornadaRodagem('encerrar'));
document.addEventListener('rodagem:saved', async evento => {
  const {tipo, registro, jornadaId} = evento.detail || {};
  const j = jornadaRodagem;
  if (tipo !== 'dia' || !j || j.estado !== 'pending' || j.id !== jornadaId || registro?.jornadaId !== j.id) return;
  try { await salvarJornadaRodagem(null); }
  catch { atualizarJornadaRodagem(); aviso('Fechamento salvo. O marcador antigo permaneceu neste navegador, mas essa jornada já está registrada no Histórico.', true); }
});
document.addEventListener('rodagem:changed', atualizarExperiencia);
document.addEventListener('rodagem:route', evento => {
  if (evento.detail?.panel === 'inicio') atualizarExperiencia();
  if (evento.detail?.panel === 'consumo') atualizarDicaPosto();
});
window.addEventListener('online', atualizarConexaoRodagem);
window.addEventListener('offline', atualizarConexaoRodagem);
function sincronizarJornadaRodagem() {
  let raw;
  try {
    raw = localStorage.getItem(jornadaStorageKey);
    if (raw === jornadaRaw) return;
    const nova = lerJornadaRodagem(raw);
    jornadaRaw = raw;
    jornadaRodagem = nova;
    jornadaInvalida = false;
    atualizarJornadaRodagem();
  } catch {
    if (raw !== undefined) {
      jornadaRaw = raw;
      jornadaRodagem = null;
      jornadaInvalida = true;
      atualizarJornadaRodagem();
    }
    aviso('A jornada mudou e não pôde ser lida. Revise suas horas antes de continuar.', true);
  }
}
window.addEventListener('storage', evento => {
  if (evento.key === perfilStorageKey || evento.key === null) {
    try {
      const raw = localStorage.getItem(perfilStorageKey);
      const novo = lerPerfilRodagem(raw);
      if (perfilAlterado && raw !== perfilRaw) {
        aviso('Seu perfil mudou em outra aba. Reabra a página para conferir antes de salvar suas alterações.', true);
      } else {
        perfilRaw = raw;
        perfilRodagem = novo;
        preencherPerfilRodagem();
        atualizarExperiencia();
      }
    } catch { aviso('Não consegui atualizar o perfil desta aba. Reabra a página para conferir.', true); }
  }
  if (evento.key === jornadaStorageKey || evento.key === null) {
    sincronizarJornadaRodagem();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    sincronizarJornadaRodagem();
    atualizarDiaRodagem();
    atualizarExperiencia();
  }
});
let diaExibidoRodagem = dataLocal();
function atualizarDiaRodagem() {
  const novoDia = dataLocal();
  if (diaExibidoRodagem === novoDia) return false;
  if (typeof atualizarDatasFormularios === 'function') atualizarDatasFormularios(diaExibidoRodagem, novoDia);
  diaExibidoRodagem = novoDia;
  return true;
}
setInterval(() => {
  atualizarJornadaRodagem();
  if (atualizarDiaRodagem()) atualizarExperiencia();
}, 1000);
preencherPerfilRodagem();
atualizarConexaoRodagem();
atualizarExperiencia();
