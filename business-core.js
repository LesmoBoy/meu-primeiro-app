/* Regras puras da área empresarial. Valores monetários são centavos e
 * distâncias são centésimos de quilômetro; autorização definitiva é do banco. */
(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX = 10000000000;
  const roles = Object.freeze(['owner','manager','finance','driver']);
  const categories = Object.freeze(['moto','bicicleta','bicicleta-eletrica','carro','utilitario','van','caminhao','onibus','trator','barco','outro']);
  const fuels = Object.freeze(['Gasolina','Etanol','Flex / alternado','Diesel','GNV','Elétrico','Híbrido','Sem combustível','Outro']);
  const costKeys = Object.freeze(['fuel','tolls','parking','commission','helper','maintenance','other']);
  const kinds = Object.freeze({member:'members',vehicle:'vehicles',trip:'trips',reminder:'reminders'});
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw Error(message); };
  function uuid(value,label = 'Identificador') {
    if (typeof value !== 'string' || !UUID.test(value)) fail(label + ' inválido.');
    return value.toLowerCase();
  }
  function text(value,limit,label,optional = false) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || Array.from(value).length > limit || (!optional && !value.trim())) fail('Confira ' + label + '.');
    return value.trim();
  }
  function uint(value,label,maximum = MAX) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail('Confira ' + label + '.');
    return value;
  }
  function safeAdd(a,b) {
    const result = a+b;
    if (!Number.isSafeInteger(result)) fail('O total ultrapassa o limite de cálculo. Reduza o período do relatório.');
    return result;
  }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000-') &&
      Number.isFinite(Date.parse(value+'T00:00:00.000Z')) && new Date(value+'T00:00:00.000Z').toISOString().slice(0,10) === value;
  }
  function date(value,label) { if (!validDate(value)) fail('Confira ' + label + '.'); return value; }
  function timestamp(value,label,nullable = true) {
    if ((value === null || value === undefined) && nullable) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !validDate(value.slice(0,10)) || !Number.isFinite(Date.parse(value))) fail('Confira ' + label + '.');
    return new Date(value).toISOString();
  }
  function common(value,company = true) {
    if (!object(value)) fail('Registro empresarial inválido.');
    const revision = value.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) fail('Revisão empresarial inválida.');
    return {id:uuid(value.id),...(company ? {companyId:uuid(value.companyId,'Empresa')} : {}),revision,archivedAt:timestamp(value.archivedAt,'a data do arquivamento')};
  }
  function validateCompany(value) {
    const result = {...common(value,false),name:text(value.name,80,'o nome da empresa'),createdAt:timestamp(value.createdAt,'a criação da empresa',false)};
    if (value.role !== undefined) { if (!roles.includes(value.role)) fail('Função na empresa inválida.'); result.role=value.role; }
    return result;
  }
  function validateMember(value) {
    const result = {...common(value),userId:value.userId === null || value.userId === undefined ? null : uuid(value.userId,'Conta'),name:text(value.name,80,'o nome da pessoa'),email:text(value.email ?? '',254,'o e-mail',true).toLowerCase(),role:value.role,status:value.status};
    if (!roles.includes(result.role) || !['active','invited'].includes(result.status)) fail('Confira a função e o estado da pessoa na equipe.');
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) fail('Informe um e-mail válido.');
    if (result.status === 'invited' && (!result.email || result.userId !== null)) fail('Confira o convite da equipe.');
    return result;
  }
  function validateVehicle(value) {
    const result = {...common(value),category:value.category,name:text(value.name,60,'o nome ou modelo do veículo'),year:value.year,fuel:value.fuel,plate:text(value.plate ?? '',20,'a placa ou identificação',true),odometer:uint(value.odometer,'o hodômetro'),active:value.active};
    if (!categories.includes(result.category) || !fuels.includes(result.fuel) || typeof result.active !== 'boolean' ||
        (result.year !== null && (!Number.isInteger(result.year) || result.year < 1900 || result.year > new Date().getFullYear()+1))) fail('Confira a categoria, o ano e a energia do veículo.');
    if ((result.category === 'bicicleta' && result.fuel !== 'Sem combustível') || (result.category === 'bicicleta-eletrica' && result.fuel !== 'Elétrico')) fail('Confira a energia da bicicleta.');
    if (result.archivedAt !== null && result.active) fail('Um veículo arquivado precisa estar inativo.');
    return result;
  }
  function validateTrip(value) {
    const result = {...common(value),vehicleId:uuid(value.vehicleId,'Veículo'),driverId:value.driverId === null ? null : uuid(value.driverId,'Motorista'),date:date(value.date,'a data da viagem'),title:text(value.title,120,'a descrição da viagem'),customer:text(value.customer ?? '',120,'o cliente',true),status:value.status,revenue:uint(value.revenue,'a receita em centavos'),distance:uint(value.distance,'a distância'),costs:{},createdAt:timestamp(value.createdAt,'a criação da viagem',false)};
    if (!['planned','in_progress','completed'].includes(result.status) || !object(value.costs) || Object.keys(value.costs).length !== costKeys.length || Object.keys(value.costs).some(key => !costKeys.includes(key))) fail('Confira a situação da viagem e as categorias de custo.');
    for (const key of costKeys) result.costs[key]=uint(value.costs[key],'o custo de '+key+' em centavos');
    return result;
  }
  function validateReminder(value) {
    const result = {...common(value),vehicleId:value.vehicleId === null ? null : uuid(value.vehicleId,'Veículo'),memberId:value.memberId === null ? null : uuid(value.memberId,'Pessoa da equipe'),kind:value.kind,title:text(value.title,120,'o título do alerta'),dueDate:value.dueDate === null ? null : date(value.dueDate,'o vencimento'),dueOdometer:value.dueOdometer === null ? null : uint(value.dueOdometer,'o hodômetro de vencimento'),completedAt:timestamp(value.completedAt,'a conclusão do alerta')};
    if (!['maintenance','document'].includes(result.kind) || (result.dueDate === null && result.dueOdometer === null) || (result.dueOdometer !== null && result.vehicleId === null)) fail('Informe uma data de vencimento ou um hodômetro associado ao veículo.');
    return result;
  }
  function list(value,label) {
    if (!Array.isArray(value) || value.length > 100000) fail('Lista de '+label+' inválida ou muito extensa.');
    return value;
  }
  function unique(values,label) {
    const seen = new Set();
    for (const value of values) { if (seen.has(value.id)) fail('Há identificadores repetidos em '+label+'.'); seen.add(value.id); }
  }
  function emptyState() { return {version:1,companies:[],members:[],vehicles:[],trips:[],reminders:[]}; }
  function checkReferences(state) {
    const companies=new Map(state.companies.map(value => [value.id,value]));
    const members=new Map(state.members.map(value => [value.id,value]));
    const vehicles=new Map(state.vehicles.map(value => [value.id,value]));
    for (const key of ['members','vehicles','trips','reminders']) for (const entity of state[key]) if (!companies.has(entity.companyId)) fail('O registro aponta para uma empresa que não está disponível.');
    function reference(entity,id,values,label) {
      if (id === null) return;
      const referenced = values.get(id);
      if (!referenced || referenced.companyId !== entity.companyId) fail('Selecione '+label+' desta empresa.');
      if (values === members && referenced.status === 'invited') fail('O convite precisa ser aceito antes de atribuir uma viagem ou um alerta.');
    }
    for (const trip of state.trips) { reference(trip,trip.vehicleId,vehicles,'um veículo'); reference(trip,trip.driverId,members,'uma pessoa'); }
    for (const reminder of state.reminders) { reference(reminder,reminder.vehicleId,vehicles,'um veículo'); reference(reminder,reminder.memberId,members,'uma pessoa'); }
  }
  function validateState(value) {
    if (!object(value) || value.version !== 1) fail('A cópia empresarial tem um formato incompatível.');
    const state = {version:1,companies:list(value.companies,'empresas').map(validateCompany),members:list(value.members,'pessoas').map(validateMember),vehicles:list(value.vehicles,'veículos').map(validateVehicle),trips:list(value.trips,'viagens').map(validateTrip),reminders:list(value.reminders,'alertas').map(validateReminder)};
    for (const key of ['companies','members','vehicles','trips','reminders']) unique(state[key],key);
    unique([...state.vehicles,...state.trips,...state.reminders],'registros da empresa');
    checkReferences(state);
    return state;
  }
  function validateWorkspace(value) {
    if (!object(value) || !object(value.membership)) fail('Área da empresa inválida.');
    const company=validateCompany(value.company);
    const state=validateState({version:1,companies:[company],members:value.members,vehicles:value.vehicles,trips:value.trips,reminders:value.reminders});
    const membership = {userId:value.membership.userId == null ? null : uuid(value.membership.userId,'Conta'),memberId:uuid(value.membership.memberId,'Pessoa da equipe'),role:value.membership.role};
    const member=state.members.find(person => person.id === membership.memberId);
    if (!roles.includes(membership.role) || !member || member.role !== membership.role || member.status !== 'active' || member.archivedAt !== null || member.userId !== membership.userId) fail('O vínculo da conta com a empresa não pôde ser confirmado.');
    return {company,membership,members:state.members,vehicles:state.vehicles,trips:state.trips,reminders:state.reminders,entitlement:value.entitlement === undefined ? null : JSON.parse(JSON.stringify(value.entitlement))};
  }
  function validateEntity(kind,value,state,options = {}) {
    const validators={member:validateMember,vehicle:validateVehicle,trip:validateTrip,reminder:validateReminder};
    if (!validators[kind]) fail('Tipo de registro empresarial desconhecido.');
    const entity=validators[kind](value);
    if (!state) return entity;
    const normalized = state.company ? {version:1,companies:[state.company],members:state.members,vehicles:state.vehicles,trips:state.trips,reminders:state.reminders} : state;
    const key=kinds[kind];
    validateState({...normalized,[key]:normalized[key].filter(item => item.id !== entity.id).concat(entity)});
    if (options.forWrite && ['trip','reminder'].includes(kind)) {
      if (entity.vehicleId !== null) {
        const vehicle=normalized.vehicles.find(item => item.id === entity.vehicleId);
        if ((!vehicle.active || vehicle.archivedAt !== null) && options.previous?.vehicleId !== vehicle.id) fail('Selecione um veículo ativo para um novo vínculo.');
      }
      const memberId=kind === 'trip' ? entity.driverId : entity.memberId;
      const member=normalized.members.find(item => item.id === memberId);
      const previousId=kind === 'trip' ? options.previous?.driverId : options.previous?.memberId;
      if (member && member.archivedAt !== null && previousId !== member.id) fail('Selecione uma pessoa ativa para um novo vínculo.');
    }
    return entity;
  }
  function parseDecimal(value,places = 2) {
    if (!Number.isInteger(places) || places < 0 || places > 3 || typeof value !== 'string') fail('Valor decimal inválido.');
    const source=value.trim();
    const pattern=places ? new RegExp('^\\d+(?:[,.]\\d{1,'+places+'})?$') : /^\d+$/;
    if (!pattern.test(source)) fail('Use um número como '+(places ? '120,50' : '120')+', sem separador de milhar.');
    const parts=source.replace(',','.').split('.');
    const amount=Number(parts[0])*10**places+Number((parts[1] || '').padEnd(places,'0'));
    return uint(amount,'o valor informado');
  }
  function formatDecimal(amount,places = 2) {
    if (!Number.isSafeInteger(amount) || !Number.isInteger(places) || places < 0 || places > 3) fail('Valor decimal inválido.');
    const sign=amount < 0 ? '-' : '',digits=String(Math.abs(amount)).padStart(places+1,'0');
    return sign+(places ? digits.slice(0,-places)+','+digits.slice(-places) : digits);
  }
  function filterTrips(value,filters = {}) {
    const trips=Array.isArray(value) ? value : value?.trips || [];
    if (!Array.isArray(trips) || !object(filters)) fail('Filtro de viagens inválido.');
    const from=filters.from || filters.fromDate || '',to=filters.to || filters.toDate || '';
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) fail('Confira o período do relatório.');
    const driver=filters.driverId;
    return trips.filter(trip => (filters.includeArchived || trip.archivedAt == null) &&
      (!filters.companyId || trip.companyId === filters.companyId) && (!filters.vehicleId || trip.vehicleId === filters.vehicleId) &&
      ((driver === undefined || driver === '') || (driver === null || driver === 'unassigned' ? trip.driverId === null : trip.driverId === driver)) &&
      (!filters.status || trip.status === filters.status) && (!from || trip.date >= from) && (!to || trip.date <= to));
  }
  function totals(value,filters = {}) {
    const result={count:0,revenue:0,costs:0,profit:0,distance:0,byCost:Object.fromEntries(costKeys.map(key => [key,0]))};
    for (const rawTrip of filterTrips(value,filters)) {
      const trip=validateTrip(rawTrip);
      if (trip.status !== 'completed' || trip.archivedAt !== null) continue;
      result.count++; result.revenue=safeAdd(result.revenue,trip.revenue); result.distance=safeAdd(result.distance,trip.distance);
      for (const key of costKeys) { result.byCost[key]=safeAdd(result.byCost[key],trip.costs[key]); result.costs=safeAdd(result.costs,trip.costs[key]); }
    }
    result.profit=safeAdd(result.revenue,-result.costs);
    return result;
  }
  function reports(value,filters = {}) {
    const trips=filterTrips(value,filters).filter(trip => trip.status === 'completed' && trip.archivedAt == null);
    const vehicleNames=new Map((value?.vehicles || []).map(item => [item.id,item.name]));
    const memberNames=new Map((value?.members || []).map(item => [item.id,item.name]));
    function group(key,label) {
      const groups=new Map();
      for (const trip of trips) { const id=trip[key]; if (!groups.has(id)) groups.set(id,[]); groups.get(id).push(trip); }
      return [...groups].map(([id,rows]) => ({id,label:label(id),...totals(rows)}));
    }
    return {totals:totals(trips),byVehicle:group('vehicleId',id => vehicleNames.get(id) || 'Veículo'),byDriver:group('driverId',id => id === null ? 'Sem motorista' : memberNames.get(id) || 'Motorista'),byDate:group('date',id => id).sort((a,b) => a.id.localeCompare(b.id))};
  }
  function alerts(workspace,todayOrOptions = {}) {
    const options=typeof todayOrOptions === 'string' ? {today:todayOrOptions} : todayOrOptions;
    const today=date(options.today || new Date().toISOString().slice(0,10),'a data de referência');
    const days=options.days === undefined ? 30 : uint(options.days,'o intervalo de dias',36500);
    const distance=options.distance === undefined ? 50000 : uint(options.distance,'o intervalo de quilômetros');
    const vehicles=new Map((workspace?.vehicles || []).map(item => [item.id,item]));
    const members=new Map((workspace?.members || []).map(item => [item.id,item]));
    const ranks={upcoming:0,soon:1,due:2,overdue:3,completed:-1};
    const rows=[];
    for (const rawReminder of workspace?.reminders || []) {
      const reminder=validateReminder(rawReminder);
      if (reminder.archivedAt !== null || (reminder.completedAt !== null && !options.includeCompleted)) continue;
      const vehicle=reminder.vehicleId === null ? null : vehicles.get(reminder.vehicleId);
      const member=reminder.memberId === null ? null : members.get(reminder.memberId);
      if (reminder.vehicleId !== null && (!vehicle || vehicle.companyId !== reminder.companyId)) fail('O alerta aponta para um veículo indisponível nesta empresa.');
      if (reminder.memberId !== null && (!member || member.companyId !== reminder.companyId)) fail('O alerta aponta para uma pessoa indisponível nesta empresa.');
      if (!options.includeArchivedReferences && ((vehicle && (!vehicle.active || vehicle.archivedAt !== null)) || member?.archivedAt != null)) continue;
      const daysRemaining=reminder.dueDate === null ? null : (Date.parse(reminder.dueDate+'T00:00:00.000Z')-Date.parse(today+'T00:00:00.000Z'))/86400000;
      const distanceRemaining=reminder.dueOdometer === null ? null : reminder.dueOdometer-vehicle.odometer;
      const statuses=[daysRemaining === null ? 'upcoming' : daysRemaining < 0 ? 'overdue' : daysRemaining === 0 ? 'due' : daysRemaining <= days ? 'soon' : 'upcoming',distanceRemaining === null ? 'upcoming' : distanceRemaining < 0 ? 'overdue' : distanceRemaining === 0 ? 'due' : distanceRemaining <= distance ? 'soon' : 'upcoming'];
      const status=reminder.completedAt !== null ? 'completed' : statuses.sort((a,b) => ranks[b]-ranks[a])[0];
      rows.push({...reminder,status,daysRemaining,distanceRemaining});
    }
    return rows.sort((a,b) => ranks[b.status]-ranks[a.status] || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || a.title.localeCompare(b.title));
  }
  const permissions = {
    'company.read':['owner','manager','finance','driver'],'company.create':['owner','manager','finance','driver'],'company.update':['owner'],
    'members.read':['owner','manager','finance','driver'],'members.invite':['owner','manager'],'members.write':['owner','manager'],'members.archive':['owner','manager'],
    'fleet.read':['owner','manager','finance','driver'],'fleet.write':['owner','manager'],'fleet.archive':['owner','manager'],
    'trips.read':['owner','manager','finance','driver'],'trips.create':['owner','manager','driver'],'trips.write':['owner','manager','driver'],'trips.costs':['owner','manager','finance','driver'],'trips.own':['driver'],'trips.archive':['owner','manager','driver'],
    'reminders.read':['owner','manager','finance','driver'],'reminders.write':['owner','manager'],'reminders.archive':['owner','manager'],
    'reports.read':['owner','manager','finance','driver'],'reports.export':['owner','manager','finance','driver'],'billing.read':['owner','manager','finance','driver'],'billing.manage':['owner']
  };
  function can(role,action) {
    if (!roles.includes(role) && roles.includes(action)) [role,action]=[action,role];
    if (!roles.includes(role) || typeof action !== 'string') return false;
    const normalized=action.replace(/^vehicles\./,'fleet.').replace(/^(team|equipe)\./,'members.').replace(/^alerts\./,'reminders.').replace(/\.manage$/,'.write');
    if (action === 'billing.manage') return role === 'owner';
    return Boolean(permissions[normalized]?.includes(role));
  }
  const api=Object.freeze({roles,categories,fuels,costKeys,kinds,MAX,uuid,validDate,emptyState,validateCompany,validateMember,validateVehicle,validateTrip,validateReminder,validateEntity,validateState,validateWorkspace,parseDecimal,formatDecimal,parseMoney:value => parseDecimal(value,2),formatMoney:value => formatDecimal(value,2),filterTrips,totals,reports,alerts,can});
  root.RodagemBusinessCore=api;
  if (typeof module === 'object' && module.exports) module.exports=api;
})(typeof window !== 'undefined' ? window : globalThis);
