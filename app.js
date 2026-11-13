const $ = id => document.getElementById(id);
const chave = 'minha-rodagem-v1';
const moeda = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const numero = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:2});
const litrosFormatados = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:3});
const tipos = {dia:'Fechamento', posto:'Abastecimento'};
const secoes = {dia:'fechamento', posto:'consumo'};
let registros = [];
let erroLeitura = false;
let versaoLida = null;

function dataLocal(data = new Date()) {
  return [data.getFullYear(), data.getMonth()+1, data.getDate()]
    .map((parte, i) => String(parte).padStart(i ? 2 : 4, '0')).join('-');
}
function dataValida(data) {
  return typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data) &&
    Number.isFinite(Date.parse(data)) && new Date(data).toISOString().slice(0,10) === data;
}
function inteiro(valor, minimo = 0) {
  return Number.isSafeInteger(valor) && valor >= minimo && valor <= 1e10;
}
function validarBackup(dados) {
  if (!dados || dados.versao !== 1 || !Array.isArray(dados.registros)) throw Error('Backup inválido.');
  const ids = new Set();
  const odometros = new Set();
  for (const r of dados.registros) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !dataValida(r.data)) throw Error('Backup inválido.');
    ids.add(r.id);
    if (r.tipo === 'dia' && ['ganhos','combustivel','outros','entregas','horas','km'].every(c => inteiro(r[c]))) continue;
    if (r.tipo === 'posto' && inteiro(r.odometro) && inteiro(r.litros,1) && inteiro(r.valor) &&
        ['cheio','parcial'].includes(r.tanque) && !odometros.has(r.odometro)) {
      odometros.add(r.odometro);
      continue;
    }
    throw Error('Backup inválido ou com hodômetros repetidos.');
  }
  return dados.registros;
}
function aviso(texto, erro = false) {
  $('mensagem').textContent = texto;
  $('mensagem').hidden = !texto;
  $('mensagem').dataset.error = String(erro);
  if (texto) $('mensagem').scrollIntoView?.({block:'nearest',behavior:'smooth'});
}
function confirmar(texto) {
  const dialogo = $('confirmacao');
  if (dialogo.open) return Promise.resolve(false);
  $('confirmacao-texto').textContent = texto;
  return new Promise(resolve => {
    dialogo.returnValue = '';
    dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'confirmar'), {once:true});
    dialogo.showModal();
  });
}
try {
  versaoLida = localStorage.getItem(chave);
  if (versaoLida) registros = validarBackup(JSON.parse(versaoLida));
} catch {
  erroLeitura = true;
  aviso('Não consegui abrir os registros. Se tiver uma cópia, restaure seu backup.');
}
function persistir(novos, restaurando = false) {
  if (erroLeitura && !restaurando) throw Error('Restaure um backup antes de salvar novos registros.');
  if (localStorage.getItem(chave) !== versaoLida) {
    throw Error('Os registros mudaram em outra aba. Reabra a página antes de salvar.');
  }
  const conteudo = JSON.stringify({versao:1, registros:novos});
  localStorage.setItem(chave, conteudo);
  versaoLida = conteudo;
  registros = novos;
  erroLeitura = false;
  document.dispatchEvent(new CustomEvent('rodagem:changed'));
}
function campoNumerico(campo, casas, opcional = false, minimo = 0) {
  let texto = campo.value.trim();
  if (!texto && opcional) return 0;
  if (campo.name === 'odometro' && /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(texto)) texto = texto.replaceAll('.', '');
  const formato = casas ? new RegExp('^\\d+(?:[,.]\\d{1,' + casas + '})?$') : /^\d+$/;
  const valor = Math.round(Number(texto.replace(',', '.')) * 10 ** casas);
  if (!formato.test(texto) || !inteiro(valor, minimo)) {
    campo.focus();
    throw Error('Confira o campo ' + campo.closest('label').childNodes[0].textContent.trim() + '.');
  }
  return valor;
}
function ler(form) {
  const c = form.elements;
  const r = {id:form.dataset.id || (globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random()), tipo:form.id, data:c.data.value};
  if (!dataValida(r.data)) throw Error('Escolha uma data válida.');
  if (r.tipo === 'dia') {
    for (const chave of ['ganhos','combustivel','outros','entregas','horas','km']) {
      r[chave] = campoNumerico(c[chave], chave === 'entregas' ? 0 : 2, !['ganhos','entregas'].includes(chave));
    }
  } else {
    r.odometro = campoNumerico(c.odometro,2);
    r.litros = campoNumerico(c.litros,3,false,1);
    r.valor = campoNumerico(c.valor,2);
    r.tanque = c.tanque.value;
    if (registros.some(a => a.tipo === 'posto' && a.id !== r.id && a.odometro === r.odometro)) {
      throw Error('Já existe um abastecimento com esse hodômetro. Edite pelo histórico se precisar corrigir.');
    }
  }
  return r;
}
function saldo(r) { return r.ganhos - r.combustivel - r.outros; }
function ciclos(dados) {
  const abastecimentos = dados.filter(r => r.tipo === 'posto').sort((a,b) => a.odometro-b.odometro);
  const calculados = new Map();
  let inicio, litros = 0, custo = 0;
  for (const r of abastecimentos) {
    if (inicio) {
      litros += r.litros;
      custo += r.valor;
    }
    if (r.tanque === 'cheio') {
      if (inicio) {
        const distancia = (r.odometro-inicio.odometro)/100;
        calculados.set(r.id, {kmPorLitro:distancia/(litros/1000), custoPorKm:(custo/100)/distancia});
      }
      inicio = r;
      litros = 0;
      custo = 0;
    }
  }
  return calculados;
}
function kmLitro(valor) { return numero.format(valor) + ' km/L'; }
function apresentar(destino, linhas) {
  const lista = document.createElement('dl');
  for (const [rotulo, valor] of linhas) {
    const linha = document.createElement('div');
    const termo = document.createElement('dt');
    const dado = document.createElement('dd');
    termo.textContent = rotulo;
    dado.textContent = valor;
    linha.append(termo,dado);
    lista.append(linha);
  }
  destino.replaceChildren(lista);
  destino.hidden = false;
}
function calcular(r, novos) {
  const destino = $('resultado-' + r.tipo);
  if (r.tipo === 'dia') {
    const liquido = saldo(r)/100;
    const linhas = [['Saldo do dia',moeda.format(liquido)], ['Saldo por entrega',r.entregas ? moeda.format(liquido/r.entregas) : '—']];
    if (r.horas) linhas.push(['Saldo por hora',moeda.format(liquido/(r.horas/100))]);
    if (r.km) linhas.push(['Saldo por km',moeda.format(liquido/(r.km/100))]);
    apresentar(destino,linhas);
    return;
  }
  const ciclo = ciclos(novos).get(r.id);
  if (ciclo) apresentar(destino,[['Consumo médio',kmLitro(ciclo.kmPorLitro)],['Combustível por km',moeda.format(ciclo.custoPorKm)]]);
  else {
    destino.textContent = r.tanque === 'parcial'
      ? 'Este abastecimento entra na conta quando você completar o tanque.'
      : 'Este tanque cheio inicia um ciclo. Complete o tanque novamente para calcular o consumo.';
    destino.hidden = false;
  }
}
const paineis = ['inicio','fechamento','consumo','historico','ajustes'];
const nomesPaineis = {inicio:'Início',fechamento:'Fechamento',consumo:'Minha moto',historico:'Histórico',ajustes:'Meu perfil'};
function abrir(painel, navegar = true) {
  if (!paineis.includes(painel)) painel = 'inicio';
  for (const aba of document.querySelectorAll('nav button')) {
    const ativa = aba.dataset.panel === painel;
    aba.setAttribute('aria-pressed',ativa);
    $(aba.dataset.panel).hidden = !ativa;
  }
  if (painel === 'historico') renderizarHistorico();
  document.title = nomesPaineis[painel] + ' · Minha Rodagem';
  if (navegar && location.hash !== '#' + painel) history.pushState(null,'','#' + painel);
  document.dispatchEvent(new CustomEvent('rodagem:route',{detail:{panel:painel}}));
  if (navegar) {
    window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    const titulo = $(painel).querySelector('h1');
    titulo.setAttribute('tabindex','-1');
    titulo.focus({preventScroll:true});
  }
}
function limpar(form) {
  form.reset();
  form.elements.data.value = dataLocal();
  delete form.dataset.id;
  delete form.dataset.jornada;
  form.querySelector('[data-cancelar]').hidden = true;
  $('resultado-' + form.id).hidden = true;
  if (form.id === 'dia') $('estimativa').hidden = true;
  $('apos-' + form.id).hidden = true;
  if (typeof atualizarPrevia === 'function' && form.id === 'dia') atualizarPrevia();
}
for (const tipo of Object.keys(tipos)) {
  const form = $(tipo);
  limpar(form);
  form.querySelector('[data-cancelar]').onclick = () => { limpar(form); aviso('Edição cancelada.'); };
  form.addEventListener('input', () => {
    $('resultado-' + tipo).hidden = true;
    if (tipo === 'dia') $('estimativa').hidden = true;
    if (tipo === 'dia' && typeof atualizarPrevia === 'function') atualizarPrevia();
  });
  let salvando = false;
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (salvando) return;
    salvando = true;
    aviso('');
    try {
      const registro = ler(form);
      const novos = [...registros.filter(r => r.id !== registro.id),registro];
      if (evento.submitter?.value === 'salvar') {
        const editando = Boolean(form.dataset.id);
        if (!editando && tipo === 'dia' && registros.some(r => r.tipo === 'dia' && r.data === registro.data)) {
          if (!await confirmar('Já existe um fechamento nesta data. Adicionar outro lançamento ao mesmo dia? Você também pode voltar e editar o anterior no Histórico.')) return;
        }
        const jornadaId = form.dataset.jornada;
        persistir(novos);
        limpar(form);
        aviso(editando ? 'Alterações salvas.' : tipos[tipo] + ' salvo no histórico.');
        $('apos-' + tipo).hidden = false;
        document.dispatchEvent(new CustomEvent('rodagem:saved',{detail:{tipo,registro,jornadaId}}));
      }
      calcular(registro,novos);
    } catch (erro) { aviso(erro.message,true); }
    finally { salvando = false; }
  });
}
$('estimar').onclick = async () => {
  aviso('');
  try {
    const form = $('dia');
    const km = campoNumerico(form.elements.km,2,false,1)/100;
    const ultimo = [...ciclos(registros.filter(r => r.data <= form.elements.data.value)).values()].at(-1);
    if (!ultimo) throw Error('Salve um ciclo com dois tanques cheios para estimar o combustível.');
    const estimado = (km*ultimo.custoPorKm).toFixed(2);
    const campo = form.elements.combustivel;
    if (campo.value.trim() && !await confirmar('Substituir o combustível informado por ' + moeda.format(Number(estimado)) + '?')) return;
    campo.value = estimado.replace('.',',');
    $('resultado-dia').hidden = true;
    $('estimativa').textContent = 'Estimativa preenchida no campo Combustível. Confira antes de salvar.';
    $('estimativa').hidden = false;
    if (typeof atualizarPrevia === 'function') atualizarPrevia();
  } catch (erro) {
    aviso(erro.message,true);
    if (!ciclos(registros).size) $('estimativa').replaceChildren(botao('Registrar abastecimento',() => abrir('consumo')));
    if (!ciclos(registros).size) $('estimativa').hidden = false;
  }
};
document.querySelectorAll('nav button').forEach(aba => aba.onclick = () => abrir(aba.dataset.panel));
document.addEventListener('click', evento => {
  const atalho = evento.target.closest('[data-go]');
  if (atalho) abrir(atalho.dataset.go);
});
window.addEventListener('hashchange',() => abrir(location.hash.slice(1),false));
$('filtro').onchange = renderizarHistorico;
$('tipo-filtro').onchange = renderizarHistorico;
function filtrados() {
  const agora = new Date();
  const hoje = dataLocal(agora);
  const segunda = new Date(agora);
  segunda.setDate(agora.getDate() - (agora.getDay()+6)%7);
  const filtro = $('filtro').value;
  const tipo = $('tipo-filtro').value;
  return registros.filter(r => {
    if (tipo !== 'todos' && tipo !== r.tipo) return false;
    if (filtro === 'hoje') return r.data === hoje;
    if (filtro === 'mes') return r.data.startsWith(hoje.slice(0,7));
    if (filtro === 'semana') return r.data >= dataLocal(segunda) && r.data <= hoje;
    return true;
  }).sort((a,b) => b.data.localeCompare(a.data));
}
function editar(r) {
  const form = $(r.tipo);
  limpar(form);
  form.dataset.id = r.id;
  form.elements.data.value = r.data;
  const campos = r.tipo === 'dia'
    ? {ganhos:100,combustivel:100,outros:100,entregas:1,horas:100,km:100}
    : {odometro:100,litros:1000,valor:100};
  for (const [chave, divisor] of Object.entries(campos)) {
    form.elements[chave].value = String(r[chave]/divisor).replace('.',',');
  }
  if (r.tipo === 'posto') form.elements.tanque.value = r.tanque;
  form.querySelector('[data-cancelar]').hidden = false;
  abrir(secoes[r.tipo]);
  aviso('Editando lançamento de ' + formatarData(r.data) + '.');
  form.elements.data.focus();
  if (r.tipo === 'dia' && typeof atualizarPrevia === 'function') atualizarPrevia();
}
function formatarData(data) { return data.split('-').reverse().join('/'); }
function botao(texto, acao) {
  const elemento = document.createElement('button');
  elemento.className = 'secondary';
  elemento.textContent = texto;
  elemento.onclick = acao;
  return elemento;
}
function renderizarHistorico() {
  const dados = filtrados();
  const dias = dados.filter(r => r.tipo === 'dia');
  const somar = calcular => dias.reduce((total,r) => total + calcular(r),0);
  apresentar($('periodo'),[
    ['Ganhos das entregas',moeda.format(somar(r => r.ganhos)/100)],
    ['Gastos lançados no fechamento',moeda.format(somar(r => r.combustivel+r.outros)/100)],
    ['Saldo dos fechamentos',moeda.format(somar(saldo)/100)],
    ['Entregas',numero.format(somar(r => r.entregas))],
    ['Total pago no posto',moeda.format(dados.reduce((total,r) => total + (r.tipo === 'posto' ? r.valor : 0),0)/100)]
  ]);
  const lista = $('lista');
  lista.replaceChildren();
  if (!dados.length) {
    const vazio = document.createElement('div');
    vazio.className = 'empty-state';
    const titulo = document.createElement('h3');
    titulo.textContent = 'Seu histórico começa aqui';
    const dica = document.createElement('p');
    dica.textContent = registros.length ? 'Nenhum lançamento com estes filtros. Experimente outro período ou tipo.' : 'Guarde o primeiro fechamento ou abastecimento para acompanhar seus resultados.';
    vazio.append(titulo,dica);
    if (!registros.length) vazio.append(botao('Registrar meu primeiro dia',() => abrir('fechamento')));
    lista.append(vazio);
  }
  const consumos = ciclos(registros);
  for (const r of dados) {
    const item = document.createElement('article');
    item.className = 'history-item';
    const icone = document.createElement('span');
    icone.className = 'history-icon icon-tile ' + (r.tipo === 'dia' ? 'mint' : 'peach');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden','true');
    const use = document.createElementNS('http://www.w3.org/2000/svg','use');
    use.setAttribute('href', r.tipo === 'dia' ? '#i-wallet' : '#i-fuel');
    svg.append(use);
    icone.append(svg);
    const conteudo = document.createElement('div');
    conteudo.className = 'history-content';
    const titulo = document.createElement('strong');
    const detalhe = document.createElement('p');
    const acoes = document.createElement('div');
    const consumo = consumos.get(r.id);
    titulo.textContent = tipos[r.tipo] + ' · ' + formatarData(r.data);
    detalhe.textContent = r.tipo === 'dia'
      ? moeda.format(saldo(r)/100) + ' de saldo · ' + r.entregas + ' entregas'
      : numero.format(r.odometro/100) + ' km · ' + moeda.format(r.valor/100) + ' · ' +
        litrosFormatados.format(r.litros/1000) + ' L · ' +
        (consumo ? kmLitro(consumo.kmPorLitro) + ' · ' + moeda.format(consumo.custoPorKm) + '/km' : r.tanque === 'cheio' ? 'Tanque cheio' : 'Parcial');
    acoes.className = 'history-actions';
    acoes.append(botao('Editar',async () => {
      const form = $(r.tipo);
      const preenchido = [...form.querySelectorAll('input:not([type="date"])')].some(c => c.value.trim());
      if (preenchido && !await confirmar('Abrir este lançamento para editar? Os campos ainda não salvos deste formulário serão substituídos.')) return;
      editar(r);
    }),botao('Excluir',async () => {
      if (!await confirmar('Excluir o lançamento de ' + formatarData(r.data) + '? Essa ação não pode ser desfeita.')) return;
      try {
        persistir(registros.filter(item => item.id !== r.id));
        if ($(r.tipo).dataset.id === r.id) limpar($(r.tipo));
        renderizarHistorico();
        aviso('Lançamento excluído.');
      } catch (erro) { aviso(erro.message,true); }
    }));
    conteudo.append(titulo,detalhe);
    item.append(icone,conteudo,acoes);
    lista.append(item);
  }
}
function baixar(nome, conteudo, tipo) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([conteudo],{type:tipo}));
  link.href = url;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
$('backup').onclick = () => {
  if (erroLeitura) { aviso('Não foi possível ler os registros para o backup.'); return; }
  baixar('minha-rodagem-' + dataLocal() + '.json',JSON.stringify({versao:1,registros},null,2),'application/json');
};
$('csv').onclick = () => {
  const decimal = valor => String(valor).replace('.',',');
  const linhas = [['Tipo','Data','Ganhos (R$)','Combustível no turno (R$)','Outros gastos (R$)','Entregas','Horas','Km de trabalho','Saldo (R$)','Hodômetro (km)','Litros','Valor no posto (R$)','Tanque']];
  for (const r of filtrados()) {
    linhas.push(r.tipo === 'dia'
      ? ['Fechamento',r.data,decimal(r.ganhos/100),decimal(r.combustivel/100),decimal(r.outros/100),r.entregas,decimal(r.horas/100),decimal(r.km/100),decimal(saldo(r)/100),'','','','']
      : ['Abastecimento',r.data,'','','','','','','',decimal(r.odometro/100),decimal(r.litros/1000),decimal(r.valor/100),r.tanque]);
  }
  baixar('minha-rodagem.csv','\uFEFF' + linhas.map(linha => linha.join(';')).join('\r\n'),'text/csv;charset=utf-8');
};
$('restaurar').onclick = () => $('arquivo').click();
$('arquivo').onchange = async evento => {
  const arquivo = evento.target.files[0];
  evento.target.value = '';
  if (!arquivo) return;
  try {
    if (arquivo.size > 5_000_000) throw Error('O arquivo excede 5 MB.');
    let dados;
    try { dados = JSON.parse(await arquivo.text()); }
    catch { throw Error('Escolha um backup JSON do Minha Rodagem.'); }
    const novos = validarBackup(dados);
    if (!await confirmar('Substituir os registros deste navegador pelos ' + novos.length + ' lançamentos do backup? Baixe uma cópia dos atuais antes, se quiser guardá-los.')) return;
    persistir(novos,true);
    limpar($('dia'));
    limpar($('posto'));
    renderizarHistorico();
    aviso('Backup restaurado.');
  } catch (erro) { aviso(erro.message,true); }
};
window.addEventListener('storage', evento => {
  if (evento.key !== chave && evento.key !== null) return;
  aviso('Os lançamentos mudaram em outra aba. Recarregue antes de salvar para manter seus dados atualizados.',true);
});
abrir(location.hash.slice(1),false);
if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(erro => console.warn('Modo offline indisponível.',erro));
}
