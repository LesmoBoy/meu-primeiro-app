/* Categorias do veículo e atividades são independentes. Nenhum modelo,
 * rendimento ou custo é escolhido automaticamente para a pessoa. */
(function (root) {
  'use strict';
  const categories = Object.freeze([
    {id:'moto',label:'Moto ou scooter',description:'Entregas, mototáxi e deslocamentos em motocicleta ou scooter.'},
    {id:'bicicleta',label:'Bicicleta',description:'Deslocamento por esforço humano, sem consumo em litros.'},
    {id:'bicicleta-eletrica',label:'Bicicleta elétrica',description:'Energia elétrica; o app não converte carga da bateria em litros.'},
    {id:'carro',label:'Carro',description:'Táxi, transporte por aplicativo, entregas e uso profissional.'},
    {id:'utilitario',label:'Utilitário ou picape',description:'Cargas leves, pequenas mudanças e atendimento externo.'},
    {id:'van',label:'Van ou furgão',description:'Cargas, entregas, transporte escolar e passageiros.'},
    {id:'caminhao',label:'Caminhão',description:'Fretes e transporte de cargas urbano ou rodoviário.'},
    {id:'onibus',label:'Ônibus ou micro-ônibus',description:'Transporte coletivo, fretamento e viagens.'},
    {id:'trator',label:'Trator ou máquina de trabalho',description:'Operações agrícolas e serviços com máquinas.'},
    {id:'barco',label:'Barco ou embarcação',description:'Transporte profissional de cargas ou passageiros por água.'},
    {id:'outro',label:'Outra categoria',description:'Descreva seu veículo no campo Nome ou modelo.'}
  ].map(Object.freeze));
  const activities = Object.freeze([
    {id:'apps',label:'Entregas por aplicativo',units:'Entregas'},
    {id:'restaurante',label:'Restaurante ou comércio',units:'Entregas'},
    {id:'encomendas',label:'Encomendas e documentos',units:'Entregas'},
    {id:'taxi',label:'Táxi ou mototáxi',units:'Corridas'},
    {id:'passageiros-app',label:'Passageiros por aplicativo',units:'Corridas'},
    {id:'frete',label:'Fretes, cargas e mudanças',units:'Viagens'},
    {id:'logistica',label:'Distribuição e logística',units:'Entregas'},
    {id:'transporte-escolar',label:'Transporte escolar',units:'Viagens'},
    {id:'fretamento',label:'Fretamento e turismo',units:'Viagens'},
    {id:'coletivo',label:'Transporte coletivo',units:'Viagens'},
    {id:'servicos-campo',label:'Serviços externos ou rurais',units:'Serviços'},
    {id:'mobilidade-corporativa',label:'Transporte de funcionários',units:'Viagens'},
    {id:'misto',label:'Atividades variadas',units:'Serviços'}
  ].map(Object.freeze));
  const fuels = Object.freeze(['Gasolina','Etanol','Flex / alternado','Diesel','GNV','Elétrico','Híbrido','Sem combustível','Outro']);
  const legacyMotorcycles = ['110–160 cc','200–300 cc','Scooter','Outra moto'];
  const liquidFuels = ['Gasolina','Etanol','Flex / alternado','Diesel','Híbrido'];
  const category = id => categories.find(value => value.id === id);
  const activity = id => activities.find(value => value.id === id);

  function validateProfile(input, defaults) {
    if (!input) {
      if (!defaults) throw Error('Perfil inválido.');
      return {...defaults};
    }
    const profile = typeof input === 'string' ? JSON.parse(input) : input;
    const legacy = profile?.versao === 1;
    if (!profile || (!legacy && profile.versao !== 2) ||
        typeof profile.nome !== 'string' || profile.nome.length > 32 ||
        typeof profile.modelo !== 'string' || profile.modelo.length > (legacy ? 40 : 60) ||
        !activity(profile.trabalho) || !fuels.includes(profile.combustivel) ||
        !Number.isFinite(profile.jornada) || profile.jornada < 0 || profile.jornada > 24 ||
        !Number.isSafeInteger(profile.meta) || profile.meta < 0 || profile.meta > 1e10 ||
        typeof profile.configurado !== 'boolean') throw Error('Confira os dados do perfil e do veículo.');
    if (legacy && (!legacyMotorcycles.includes(profile.moto) ||
        !['apps','restaurante','encomendas','misto'].includes(profile.trabalho) ||
        !['Gasolina','Etanol','Flex / alternado'].includes(profile.combustivel))) throw Error('Perfil antigo inválido.');
    const categoria = legacy ? 'moto' : profile.categoria;
    const ano = legacy || profile.ano === '' || profile.ano === null ? null : profile.ano;
    if (!category(categoria) ||
        (ano !== null && (!Number.isInteger(ano) || ano < 1900 || ano > new Date().getFullYear() + 1))) throw Error('Confira a categoria e o ano do veículo.');
    if ((categoria === 'bicicleta' && profile.combustivel !== 'Sem combustível') ||
        (categoria === 'bicicleta-eletrica' && profile.combustivel !== 'Elétrico')) throw Error('Confira a fonte de energia da bicicleta.');
    return {versao:2,nome:profile.nome.trim(),trabalho:profile.trabalho,jornada:profile.jornada,meta:profile.meta,
      categoria,modelo:profile.modelo.trim(),ano,combustivel:profile.combustivel,configurado:profile.configurado};
  }
  function vehicleLabel(profile) {
    return profile.modelo || category(profile.categoria)?.label || 'Seu veículo';
  }
  function liquidFuel(profile) {
    return Boolean(profile && !['bicicleta','bicicleta-eletrica'].includes(profile.categoria) && liquidFuels.includes(profile.combustivel));
  }
  function workUnits(profile) { return activity(profile?.trabalho)?.units || 'Serviços'; }
  function workUnitDetails(profile) {
    const label = workUnits(profile);
    const singular = ({Entregas:'entrega',Corridas:'corrida',Viagens:'viagem',Serviços:'serviço'})[label];
    return {singular,plural:label.toLocaleLowerCase('pt-BR'),label};
  }
  function fuelHint(profile) {
    if (liquidFuel(profile)) return 'O consumo em km/L vem dos abastecimentos deste perfil. A categoria não define uma média de consumo.';
    if (profile.combustivel === 'GNV') return 'GNV é medido em m³. O cálculo em litros fica desativado. Registre o gasto do turno no Fechamento; seus abastecimentos anteriores continuam no Histórico.';
    if (profile.combustivel === 'Elétrico') return 'Recargas são medidas em kWh. O cálculo em litros fica desativado. Registre o gasto de energia do turno no Fechamento; seus registros anteriores continuam no Histórico.';
    if (profile.combustivel === 'Sem combustível' || profile.categoria === 'bicicleta') return 'Seu veículo não usa combustível em litros. Acompanhe os km pelo GPS e registre manutenção e outros gastos no Fechamento.';
    return 'Sem uma unidade de combustível definida, o app não calcula km/L. Registre o gasto do turno no Fechamento.';
  }
  const api = Object.freeze({categories,activities,fuels,category,activity,validateProfile,vehicleLabel,liquidFuel,workUnits,workUnitDetails,fuelHint});
  root.RodagemVehicles = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
