/* Área de empresas: dados locais e contas online são contextos explícitos. */
(() => {
  'use strict';
  const root = window, C = root.RodagemBusinessCore, R = root.RodagemBusiness;
  const host = document.getElementById('business-app');
  if (!host) return;
  if (!C || !R) { host.textContent = 'A área de empresas não foi carregada. Reabra o app com internet para tentar novamente.'; return; }
  const tabs = [['dashboard','Visão geral'],['members','Equipe'],['vehicles','Frota'],['trips','Viagens'],['reminders','Alertas'],['plan','Plano']];
  const roles = {owner:'Responsável',manager:'Gestor',finance:'Financeiro',driver:'Motorista'};
  const statuses = {planned:'Agendada',in_progress:'Em andamento',completed:'Concluída'};
  const costs = [['fuel','Combustível ou energia'],['tolls','Pedágios'],['parking','Estacionamento'],['commission','Comissões'],['helper','Ajudante'],['maintenance','Manutenção'],['other','Outros gastos']];
  const alertLabels = {overdue:'Vencido',due:'Vence agora',soon:'Próximo do vencimento',upcoming:'Programado',completed:'Concluído'};
  const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const number = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
  let companies = [], workspace = null, tab = 'dashboard', busy = false, stale = false, notice = '', noticeError = false;
  let content, status, companySelect, modeSelect, inviteBox = null, importEpoch = 0;
  const invitationKey='minha-rodagem-convite-pendente-v1';
  let pendingInvitation='';
  try {
    const incoming=new URL(location.href).searchParams.get('convite');
    if(incoming&&/^[0-9a-f]{64}$/i.test(incoming)){pendingInvitation=incoming;sessionStorage.setItem(invitationKey,incoming);const url=new URL(location.href);url.searchParams.delete('convite');history.replaceState(null,'',url.href);}
    else {const stored=sessionStorage.getItem(invitationKey);if(stored&&/^[0-9a-f]{64}$/i.test(stored))pendingInvitation=stored;}
  }catch { /* O código ainda pode ser colado manualmente quando o armazenamento temporário não está disponível. */ }
  let edit = {member:null,vehicle:null,trip:null,reminder:null};
  let filters = {from:'',to:'',vehicleId:'',driverId:''};
  const drafts = new Set();
  const billingCache = new Map(), billingLoading = new Set();
  const currentRole = () => workspace?.membership?.role || 'owner';
  const allowed = action => Boolean(workspace && C.can(currentRole(),action));
  const today = () => typeof dataLocal === 'function' ? dataLocal() : new Date().toLocaleDateString('en-CA');
  const id = () => crypto.randomUUID();
  const fmtMoney = value => money.format(value/100);
  const priceLabel = plan => {
    if(!Number.isSafeInteger(plan.amount)||plan.amount<0)return 'Preço a configurar';
    const currency=typeof plan.currency==='string'&&/^[a-z]{3}$/i.test(plan.currency)?plan.currency.toUpperCase():'BRL';
    const period=({day:'dia',week:'semana',month:'mês',year:'ano'})[plan.interval]||'';
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(plan.amount/100)+' / '+plan.unit+(period?' por '+period:'');
  };
  const fmtNumber = value => number.format(value/100);
  const dateLabel = value => value ? value.split('-').reverse().join('/') : 'Sem data';
  const valueOf = (form,name) => form.elements.namedItem(name).value.trim();
  const amount = (form,name) => { const value = valueOf(form,name); return value ? C.parseDecimal(value,2) : 0; };
  const currentMode = () => R.getMode();
  function node(tag,text,className) { const el = document.createElement(tag); if (text !== undefined && text !== null) el.textContent = text; if (className) el.className = className; return el; }
  function button(text,fn,style='secondary') { const el=node('button',text,'button '+style); el.type='button'; el.addEventListener('click',fn); return el; }
  function option(value,label,selected) { const el=node('option',label); el.value=value; el.selected=value===selected; return el; }
  function badge(text,kind='') { const el=node('span',text,'business-badge'); if(kind)el.dataset.kind=kind; return el; }
  function field(form,label,name,value='',settings={}) {
    const wrap=node('label'), title=node('span',label); let el;
    if(settings.options){el=node('select');for(const item of settings.options)el.append(option(item.value,item.label,String(value??'')));}
    else {el=node('input');el.type=settings.type||'text';el.value=value??'';if(settings.inputMode)el.inputMode=settings.inputMode;if(settings.maxLength)el.maxLength=settings.maxLength;if(settings.pattern)el.pattern=settings.pattern;if(settings.placeholder)el.placeholder=settings.placeholder;}
    el.name=name;if(settings.required)el.required=true;if(settings.disabled)el.disabled=true;if(settings.readOnly)el.readOnly=true;
    wrap.append(title,el);if(settings.hint)wrap.append(node('small',settings.hint));form.append(wrap);return el;
  }
  function form(id,label,submit) {
    const el=node('form',null,'business-form');el.id=id;el.setAttribute('aria-label',label);
    el.addEventListener('input',()=>drafts.add(id));el.addEventListener('change',()=>drafts.add(id));
    el.addEventListener('submit',event=>{event.preventDefault();if(!busy&&!stale)submit(el);});return el;
  }
  function formActions(form,label,cancel) {
    const actions=node('div',null,'actions business-form-actions'), save=node('button',label,'button primary');save.type='submit';actions.append(save);
    if(cancel)actions.append(button('Cancelar edição',()=>{if(!busy)discard().then(ok=>{if(ok){cancel();renderTab();}});}));form.append(actions);
  }
  function card(title,text) { const el=node('div',null,'card business-card');if(title)el.append(node('h2',title));if(text)el.append(node('p',text));return el; }
  function empty(text) { return node('p',text,'business-empty'); }
  function actionRow(item,title,description,actions=[],state) {
    const row=node('article',null,'business-row');row.dataset.businessId=item.id;
    const body=node('div',null,'business-row-body');body.append(node('strong',title));if(description)body.append(node('p',description));
    if(state)body.append(state);if(item.archivedAt)body.append(badge('Arquivado','archived'));
    row.append(body);if(actions.length){const group=node('div',null,'business-row-actions');group.append(...actions);row.append(group);}return row;
  }
  function setNotice(text,error=false) {notice=text||'';noticeError=error;if(status){status.textContent=notice;status.hidden=!notice;status.dataset.error=String(error);}}
  function setBusy(value) {
    busy=value;host.setAttribute('aria-busy',String(value));
    for(const el of host.querySelectorAll('button,input,select')) {
      if(value){el.dataset.businessDisabled=String(el.disabled);el.disabled=true;}
      else if(el.dataset.businessDisabled!==undefined){el.disabled=el.dataset.businessDisabled==='true';delete el.dataset.businessDisabled;}
    }
  }
  async function discard() {
    if(!drafts.size)return true;
    const ok=await confirmar('Os campos ainda não salvos da empresa serão descartados. Continuar?');
    if(ok)drafts.clear();return ok;
  }
  async function run(fn,{reset=true}={}) {
    if(busy||stale)return;
    setBusy(true);setNotice('');
    try {await fn();if(reset){drafts.clear();workspace=R.getCurrentWorkspace();render();}}
    catch(error){setNotice(error.message||'Não foi possível concluir. Os dados anteriores foram mantidos.',true);}
    finally {setBusy(false);}
  }
  async function refreshCompanies(preferred) {
    companies=await R.listCompanies();
    if(preferred)workspace=await R.loadCompany(preferred);
    else workspace=R.getCurrentWorkspace();
  }
  async function chooseCompany(value) {
    const previous=workspace?.company.id||'';
    if(!await discard()){companySelect.value=previous;return;}
    await run(async()=>{workspace=value?await R.loadCompany(value):null;edit={member:null,vehicle:null,trip:null,reminder:null};tab='dashboard';});
  }
  async function chooseMode(value) {
    const previous=currentMode();
    if(!await discard()){modeSelect.value=previous;return;}
    await run(async()=>{await R.selectMode(value);workspace=null;companies=[];billingCache.clear();edit={member:null,vehicle:null,trip:null,reminder:null};await refreshCompanies();tab='dashboard';});
    if(currentMode()!==value&&modeSelect)modeSelect.value=previous;
  }
  function render() {
    host.replaceChildren();
    const top=card('Sua operação, em um só lugar');
    top.append(node('p','Os fechamentos pessoais continuam no Histórico. Viagens e custos da empresa são registrados nesta área.'));
    const tools=node('div',null,'business-toolbar');
    modeSelect=field(tools,'Onde guardar os dados','mode',currentMode(),{options:[{value:'local',label:'Neste aparelho'},{value:'cloud',label:'Na minha conta'}]});modeSelect.id='business-mode';modeSelect.addEventListener('change',()=>chooseMode(modeSelect.value));
    const cloudOption=modeSelect.querySelector('option[value="cloud"]');if(cloudOption)cloudOption.disabled=!root.RodagemCloud?.configured();
    companySelect=field(tools,'Empresa em uso','companyId',workspace?.company.id||'',{options:[{value:'',label:'Selecione uma empresa'},...companies.map(c=>({value:c.id,label:c.name}))]});companySelect.id='business-company';companySelect.addEventListener('change',()=>chooseCompany(companySelect.value));
    top.append(tools);
    const summary=node('div',null,'business-context');summary.append(badge(currentMode()==='local'?'Empresa neste aparelho':'Empresa na conta',currentMode()));
    if(workspace)summary.append(badge(roles[currentRole()]||'Equipe'));
    top.append(summary);
    top.append(node('p',currentMode()==='local'?'No modo local, a equipe organiza os registros deste aparelho. O acesso autenticado por função está disponível nas empresas da conta online.':'O acesso à empresa segue a função da conta conectada. Os dados são verificados pelo servidor.','hint'));
    if(!root.RodagemCloud?.configured()){const link=button('Conectar conta em Meu perfil',()=>abrir('ajustes'),'secondary');top.append(link);}
    const create=form('business-company-form','Criar empresa',f=>run(async()=>{const ws=await R.createCompany(valueOf(f,'name'));await refreshCompanies(ws.company.id);tab='dashboard';}));
    field(create,'Nome da nova empresa','name','',{required:true,maxLength:80,placeholder:'Ex.: Entregas da cidade'});formActions(create,'Criar empresa');top.append(create);
    host.append(top);
    status=node('p',notice,'business-notice');status.id='business-notice';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=!notice;status.dataset.error=String(noticeError);host.append(status);
    if(stale){host.append(card('Reabra a área da empresa','A conta ou o perfil foi alterado. Recarregue o app para continuar com os dados corretos.'));return;}
    if(!workspace){host.append(card('Comece pela sua empresa','Crie uma empresa ou selecione uma existente. Depois, cadastre a equipe, os veículos e a primeira viagem.'));renderBackup();renderInviteAccept();return;}
    const nav=node('div',null,'business-tabs');nav.setAttribute('role','group');nav.setAttribute('aria-label','Páginas da empresa');
    for(const[key,label]of tabs){const b=button(label,async()=>{if(key===tab)return;if(!await discard())return;tab=key;edit={member:null,vehicle:null,trip:null,reminder:null};render();});b.dataset.businessTab=key;b.setAttribute('aria-pressed',String(key===tab));nav.append(b);}
    host.append(nav);content=node('div',null,'business-content');content.id='business-content';host.append(content);renderTab();renderBackup();renderInviteAccept();
  }
  function renderTab() {
    if(!content)return;content.replaceChildren();
    ({dashboard:renderDashboard,members:renderMembers,vehicles:renderVehicles,trips:renderTrips,reminders:renderReminders,plan:renderPlan}[tab]||renderDashboard)();
  }
  function currentFilters(){return Object.fromEntries(Object.entries(filters).filter(([,v])=>v));}
  function renderFilters(container) {
    const f=form('business-filters','Filtrar resultados',()=>{});f.classList.add('business-filters');
    field(f,'De','from',filters.from,{type:'date'});field(f,'Até','to',filters.to,{type:'date'});
    field(f,'Veículo','vehicleId',filters.vehicleId,{options:[{value:'',label:'Todos os veículos'},...workspace.vehicles.map(v=>({value:v.id,label:v.name+(v.archivedAt?' · arquivado':'')}))]});
    field(f,'Motorista','driverId',filters.driverId,{options:[{value:'',label:'Toda a equipe'},...workspace.members.map(m=>({value:m.id,label:m.name+(m.archivedAt?' · arquivado':'')}))]});
    f.addEventListener('change',()=>{for(const key of Object.keys(filters))filters[key]=valueOf(f,key);drafts.delete('business-filters');renderTab();});container.append(f);
  }
  function renderDashboard() {
    const section=card('Resultados da empresa','Os totais consideram somente viagens concluídas e não arquivadas.');renderFilters(section);
    let report;try{report=C.reports(workspace,currentFilters());}catch(error){section.append(empty(error.message));content.append(section);return;}
    const stats=node('div',null,'business-stats');
    for(const[key,label,value]of [['revenue','Receita',fmtMoney(report.totals.revenue)],['costs','Custos',fmtMoney(report.totals.costs)],['profit','Resultado',fmtMoney(report.totals.profit)],['distance','Distância',fmtNumber(report.totals.distance)+' km']]){const tile=node('div',null,'business-stat');tile.append(node('span',label));const strong=node('strong',value);strong.id='business-'+key;if(key==='profit'&&report.totals.profit<0)strong.dataset.negative='true';tile.append(strong);stats.append(tile);}
    section.append(stats,node('p',report.totals.count+' viagens concluídas no período.','hint'));
    const exportButton=button('Exportar relatório CSV',exportReport);exportButton.id='business-csv';section.append(exportButton);content.append(section);
    const cols=node('div',null,'business-report-grid');
    for(const[key,title]of [['byVehicle','Por veículo'],['byDriver','Por motorista']]){const part=card(title);if(!report[key].length)part.append(empty('Sem viagens concluídas neste filtro.'));for(const row of report[key])part.append(actionRow({id:row.id||'none'},row.label,fmtMoney(row.revenue)+' de receita · '+fmtMoney(row.costs)+' de custos · '+fmtMoney(row.profit)+' de resultado'));cols.append(part);}content.append(cols);
    const alerts=C.alerts(workspace,{today:today(),includeCompleted:false}).filter(a=>['overdue','due','soon'].includes(a.status));
    const pending=card('Atenção aos próximos vencimentos');if(!alerts.length)pending.append(empty('Nenhum alerta próximo ou vencido cadastrado.'));for(const item of alerts.slice(0,5))pending.append(actionRow(item,item.title,reminderDetail(item),[],badge(alertLabels[item.status],item.status)));pending.append(button('Abrir alertas',async()=>{if(await discard()){tab='reminders';render();}}));content.append(pending);
  }
  function exportReport() {
    try {
      const rows=C.filterTrips(workspace,{...currentFilters(),status:'completed'}).filter(t=>!t.archivedAt&&t.status==='completed');
      const csv=[['Data','Viagem','Cliente','Veículo','Motorista','Receita (R$)','Custos (R$)','Resultado (R$)','Km']];
      for(const t of rows){const total=C.totals([t]);csv.push([t.date,t.title,t.customer,workspace.vehicles.find(v=>v.id===t.vehicleId)?.name||'',workspace.members.find(m=>m.id===t.driverId)?.name||'',C.formatDecimal(total.revenue,2),C.formatDecimal(total.costs,2),C.formatDecimal(total.profit,2),C.formatDecimal(total.distance,2)]);}
      const escape=(value,isText)=>{let text=String(value??'');if(isText&&/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
      baixar('minha-rodagem-empresa.csv','\uFEFF'+csv.map((row,rowIndex)=>row.map((value,column)=>escape(value,rowIndex===0||column<5)).join(';')).join('\r\n'),'text/csv;charset=utf-8');setNotice('Relatório exportado.');
    }catch(error){setNotice(error.message,true);}
  }
  async function openEdit(kind,item,targetTab) {if(!await discard())return;edit[kind]=item;tab=targetTab;render();document.getElementById('business-'+kind+'-form')?.scrollIntoView?.({block:'start',behavior:'smooth'});}
  async function archive(kind,item) {
    const message=kind==='trip'?'Arquivar '+item.title+'? A viagem ficará no histórico como arquivada e deixará de entrar nos totais. Continuar?':'Arquivar '+(item.name||item.title)+'? O histórico de viagens e custos será mantido.';
    if(!await confirmar(message))return;
    await run(async()=>{await R.archiveEntity(kind,item.id,item.revision);edit[kind]=null;setNotice('Registro arquivado. O histórico foi mantido.');});
  }
  function renderMembers() {
    const section=card('Sua equipe',currentMode()==='local'?'Cadastre os responsáveis pelos serviços deste aparelho. Estas funções locais não são senhas nem convites enviados.':'Convide a equipe para entrar com sua própria conta. Copie o link do convite e compartilhe com a pessoa.');
    const list=node('div',null,'business-list');list.id='business-members';
    if(!workspace.members.length)list.append(empty('Nenhuma pessoa cadastrada.'));
    for(const m of workspace.members){const actions=[];if(allowed('members.invite')&&m.status!=='invited'&&(currentRole()==='owner'||!['owner','manager'].includes(m.role))){if(!m.archivedAt)actions.push(button('Editar',()=>openEdit('member',m,'members')));else actions.push(button('Reativar pessoa',()=>run(async()=>{await R.saveMember({...m,active:true,archivedAt:null},m.revision);setNotice('Pessoa reativada.');})));}if(m.status==='invited'&&allowed('members.invite')&&R.revokeInvite)actions.push(button('Revogar convite',()=>run(async()=>{if(await confirmar('Revogar o convite de '+m.name+'?'))await R.revokeInvite(m.id);})));list.append(actionRow(m,m.name,[roles[m.role]||m.role,m.email].filter(Boolean).join(' · '),actions,m.status==='invited'?badge('Convite pendente'):null));}
    section.append(list);content.append(section);
    if(!allowed('members.invite')){content.append(card('Equipe protegida','Sua função permite consultar os dados disponíveis, mas não gerenciar convites.'));return;}
    const existing=edit.member, panel=card(existing?'Editar pessoa':currentMode()==='cloud'?'Convidar pessoa':'Adicionar pessoa');
    const f=form('business-member-form',existing?'Editar pessoa':'Adicionar pessoa',formEl=>{
      const data={...(existing||{}),id:existing?.id||id(),companyId:workspace.company.id,userId:existing?.userId||null,name:valueOf(formEl,'name'),email:valueOf(formEl,'email'),role:valueOf(formEl,'role'),status:existing?.status||'active',revision:existing?.revision||1,archivedAt:existing?.archivedAt||null};
      if(existing&&formEl.elements.namedItem('active'))data.active=formEl.elements.namedItem('active').checked;
      run(async()=>{if(!existing&&currentMode()==='cloud'){const result=await R.inviteMember({name:data.name,email:data.email,role:data.role});inviteBox=result?.token?inviteURL(result.token):null;}else await R.saveMember(data,existing?.revision||0);edit.member=null;setNotice(currentMode()==='cloud'&&!existing?'Convite criado. Copie o link e compartilhe com a pessoa.':'Pessoa salva.');});
    });
    field(f,'Nome','name',existing?.name||'',{required:true,maxLength:80});field(f,'E-mail','email',existing?.email||'',{type:'email',maxLength:254,required:currentMode()==='cloud',readOnly:currentMode()==='cloud'&&Boolean(existing)});
    const roleOptions=[...(existing?.role==='owner'?[{value:'owner',label:'Responsável'}]:[]),...(currentRole()==='owner'?[{value:'manager',label:'Gestor'}]:[]),{value:'finance',label:'Financeiro'},{value:'driver',label:'Motorista'}];
    field(f,'Função','role',existing?.role||'driver',{options:roleOptions});
    if(existing&&existing.role!=='owner'){const label=node('label',null,'business-checkbox'), check=node('input');check.type='checkbox';check.name='active';check.checked=!existing.archivedAt;label.append(check,node('span','Pessoa ativa na equipe'));f.append(label);}
    formActions(f,existing?'Salvar pessoa':currentMode()==='cloud'?'Criar convite':'Adicionar pessoa',existing?()=>edit.member=null:null);panel.append(f);content.append(panel);
    if(inviteBox){const box=card('Link do convite');const input=node('input');input.value=inviteBox;input.readOnly=true;input.setAttribute('aria-label','Link do convite');box.append(input,button('Copiar link',()=>copyText(inviteBox)));box.append(node('p','O convite precisa ser aceito pela conta do e-mail informado e tem prazo de validade.','hint'));content.append(box);}
  }
  function inviteURL(token){const url=new URL(location.href);url.searchParams.set('convite',token);url.hash='empresa';return url.href;}
  async function copyText(text){try{await navigator.clipboard.writeText(text);setNotice('Link copiado.');}catch{setNotice('Selecione e copie o link exibido. O navegador não permitiu copiar automaticamente.');}}
  function renderVehicles() {
    const section=card('Frota da empresa','Cada veículo mantém suas próprias viagens, custos e alertas. Arquivar não apaga o histórico.');
    const list=node('div',null,'business-list');list.id='business-vehicles';if(!workspace.vehicles.length)list.append(empty('Cadastre o primeiro veículo da empresa.'));
    for(const v of workspace.vehicles){const actions=[];if(allowed('fleet.write')&&!v.archivedAt){actions.push(button('Editar',()=>openEdit('vehicle',v,'vehicles')),button('Arquivar',()=>archive('vehicle',v)));}list.append(actionRow(v,v.name,[root.RodagemVehicles?.category(v.category)?.label,v.year,v.plate,v.fuel,fmtNumber(v.odometer)+' km no hodômetro'].filter(Boolean).join(' · '),actions,!v.active&&!v.archivedAt?badge('Inativo'):null));}
    section.append(list);content.append(section);if(!allowed('fleet.write'))return;
    const existing=edit.vehicle,panel=card(existing?'Editar veículo':'Novo veículo'), f=form('business-vehicle-form','Cadastro do veículo',formEl=>{
      let data;try{const year=valueOf(formEl,'year');if(year&&!/^\d{4}$/.test(year))throw Error('Informe um ano com quatro dígitos.');data={...(existing||{}),id:existing?.id||id(),companyId:workspace.company.id,name:valueOf(formEl,'name'),category:valueOf(formEl,'category'),year:year?Number(year):null,fuel:valueOf(formEl,'fuel'),plate:valueOf(formEl,'plate'),odometer:amount(formEl,'odometer'),active:formEl.elements.namedItem('active').checked,revision:existing?.revision||1,archivedAt:existing?.archivedAt||null};C.validateVehicle(data);}catch(error){setNotice(error.message,true);return;}
      run(async()=>{await R.saveEntity('vehicle',data,existing?.revision||0);edit.vehicle=null;setNotice('Veículo salvo.');});
    });
    field(f,'Nome ou modelo do veículo','name',existing?.name||'',{required:true,maxLength:60,placeholder:'Digite o nome que identifica o veículo'});
    const categories=(root.RodagemVehicles?.categories||[]).map(c=>({value:c.id,label:c.label}));field(f,'Categoria','category',existing?.category||'moto',{options:categories});
    field(f,'Ano','year',existing?.year||'',{maxLength:4,inputMode:'numeric',pattern:'[0-9]{4}',placeholder:'Opcional'});field(f,'Combustível ou energia','fuel',existing?.fuel||'Gasolina',{options:(root.RodagemVehicles?.fuels||[]).map(value=>({value,label:value}))});
    field(f,'Placa ou identificação','plate',existing?.plate||'',{maxLength:20,placeholder:'Opcional'});field(f,'Hodômetro atual (km)','odometer',C.formatDecimal(existing?.odometer||0,2),{inputMode:'decimal',hint:'Atualize para acompanhar os alertas por quilometragem.'});
    const active=node('label',null,'business-checkbox'),check=node('input');check.type='checkbox';check.name='active';check.checked=existing?existing.active:true;active.append(check,node('span','Veículo ativo'));f.append(active);
    const adjustFuel=()=>{const category=valueOf(f,'category'),fuel=f.elements.namedItem('fuel');if(category==='bicicleta'){fuel.value='Sem combustível';fuel.disabled=true;}else if(category==='bicicleta-eletrica'){fuel.value='Elétrico';fuel.disabled=true;}else fuel.disabled=false;};f.elements.namedItem('category').addEventListener('change',adjustFuel);adjustFuel();formActions(f,'Salvar veículo',existing?()=>edit.vehicle=null:null);panel.append(f);
    if(!existing){panel.append(button('Copiar veículo do meu perfil',async()=>{if(typeof perfilRodagem==='undefined'){setNotice('Cadastre seu veículo em Meu perfil antes de copiar.',true);return;}if(!await confirmar('Copiar somente o cadastro do veículo deste perfil? Os lançamentos pessoais não serão transferidos.'))return;const p=perfilRodagem;f.elements.namedItem('name').value=p.modelo||'';f.elements.namedItem('category').value=p.categoria||'moto';f.elements.namedItem('year').value=p.ano||'';f.elements.namedItem('fuel').value=p.combustivel||'Gasolina';adjustFuel();drafts.add(f.id);}));}content.append(panel);
  }
  function vehicleOptions(selected,includeExisting=false){return [{value:'',label:'Selecione um veículo'},...workspace.vehicles.filter(v=>(v.active&&!v.archivedAt)||(includeExisting&&v.id===selected)).map(v=>({value:v.id,label:v.name+(v.archivedAt?' · arquivado':'')}))];}
  function memberOptions(selected,includeExisting=false){return [{value:'',label:'Sem motorista definido'},...workspace.members.filter(m=>(m.status==='active'&&!m.archivedAt)||(includeExisting&&m.id===selected)).map(m=>({value:m.id,label:m.name+(m.archivedAt?' · arquivado':'')}))];}
  function renderTrips() {
    const section=card('Viagens e serviços','Registre a receita e os gastos uma vez nesta viagem. Somente as concluídas entram nos resultados.');const list=node('div',null,'business-list');list.id='business-trips';
    if(!workspace.trips.length)list.append(empty('Nenhuma viagem registrada nesta empresa.'));
    for(const t of workspace.trips){const actions=[],own=currentRole()!=='driver'||t.driverId===workspace.membership.memberId;if(!t.archivedAt&&own&&(allowed('trips.write')||allowed('trips.costs')))actions.push(button('Editar',()=>openEdit('trip',t,'trips')));if(!t.archivedAt&&own&&allowed('trips.write'))actions.push(button('Arquivar',()=>archive('trip',t)));const sum=Object.values(t.costs).reduce((s,v)=>s+v,0);list.append(actionRow(t,t.title,dateLabel(t.date)+' · '+(workspace.vehicles.find(v=>v.id===t.vehicleId)?.name||'Veículo')+' · '+fmtMoney(t.revenue)+' de receita · '+fmtMoney(sum)+' de custos · '+fmtMoney(t.revenue-sum)+' de resultado',actions,badge(statuses[t.status]||t.status,t.status)));}section.append(list);content.append(section);
    const existing=edit.trip,finance=currentRole()==='finance';if(!allowed('trips.write')&&!(existing&&allowed('trips.costs'))){if(finance)content.append(card('Custos da operação','Use Editar em uma viagem existente para atualizar os custos.'));return;}
    const panel=card(existing?'Editar viagem':'Nova viagem');const f=form('business-trip-form','Cadastro da viagem',formEl=>{
      let data;try{const entries={};for(const[key]of costs)entries[key]=amount(formEl,'cost-'+key);data={...(existing||{}),id:existing?.id||id(),companyId:workspace.company.id,title:valueOf(formEl,'title'),customer:valueOf(formEl,'customer'),date:valueOf(formEl,'date'),vehicleId:valueOf(formEl,'vehicleId'),driverId:valueOf(formEl,'driverId')||null,status:valueOf(formEl,'status'),revenue:amount(formEl,'revenue'),distance:amount(formEl,'distance'),costs:entries,revision:existing?.revision||1,archivedAt:existing?.archivedAt||null,createdAt:existing?.createdAt||new Date().toISOString()};C.validateTrip(data,workspace);}catch(error){setNotice(error.message,true);return;}
      run(async()=>{await R.saveEntity('trip',data,existing?.revision||0);edit.trip=null;setNotice('Viagem salva.');});
    });
    field(f,'Serviço ou viagem','title',existing?.title||'',{required:true,maxLength:120,readOnly:finance});field(f,'Cliente','customer',existing?.customer||'',{maxLength:120,readOnly:finance});field(f,'Data','date',existing?.date||today(),{type:'date',required:true,readOnly:finance});
    field(f,'Veículo','vehicleId',existing?.vehicleId||'',{options:vehicleOptions(existing?.vehicleId,true),required:true,disabled:finance});
    const driver=existing?.driverId||(currentRole()==='driver'?workspace.membership.memberId:'');field(f,'Motorista','driverId',driver,{options:memberOptions(driver,true),disabled:finance||currentRole()==='driver'});
    field(f,'Situação','status',existing?.status||'completed',{options:Object.entries(statuses).map(([value,label])=>({value,label})),disabled:finance});
    field(f,'Receita (R$)','revenue',existing?C.formatDecimal(existing.revenue,2):'',{required:true,inputMode:'decimal',placeholder:'0,00',readOnly:finance});field(f,'Distância (km)','distance',existing?C.formatDecimal(existing.distance,2):'',{inputMode:'decimal',placeholder:'0,00',readOnly:finance});
    const expense=node('fieldset',null,'business-cost-fields');expense.append(node('legend','Gastos da viagem (R$)'));for(const[key,label]of costs)field(expense,label,'cost-'+key,existing?C.formatDecimal(existing.costs[key],2):'',{inputMode:'decimal',placeholder:'0,00'});f.append(expense);
    const preview=node('output','Resultado previsto: R$ 0,00','business-profit-preview');preview.id='business-trip-preview';preview.setAttribute('aria-live','polite');f.append(preview);
    const updatePreview=()=>{try{const total=costs.reduce((sum,[key])=>sum+amount(f,'cost-'+key),0);const profit=amount(f,'revenue')-total;preview.textContent='Resultado previsto: '+fmtMoney(profit);preview.dataset.negative=String(profit<0);}catch{preview.textContent='Confira os valores para calcular o resultado.';}};f.addEventListener('input',updatePreview);updatePreview();formActions(f,finance?'Salvar custos':'Salvar viagem',existing?()=>edit.trip=null:null);panel.append(f);if(!workspace.vehicles.some(v=>v.active&&!v.archivedAt)&&!existing)panel.append(node('p','Cadastre um veículo ativo na Frota para salvar a primeira viagem.','hint'));content.append(panel);
  }
  function reminderDetail(r){const vehicle=workspace.vehicles.find(v=>v.id===r.vehicleId),member=workspace.members.find(m=>m.id===r.memberId);return [r.kind==='document'?'Documento':'Manutenção',vehicle?.name,member?.name,r.dueDate?'Data: '+dateLabel(r.dueDate):'',r.dueOdometer!==null?'Hodômetro: '+fmtNumber(r.dueOdometer)+' km':''].filter(Boolean).join(' · ');}
  function renderReminders() {
    const section=card('Manutenção e documentos','Acompanhe vencimentos por data ou hodômetro. Os alertas aparecem ao abrir o app; não são notificações enviadas em segundo plano.');const list=node('div',null,'business-list');list.id='business-reminders';
    const entries=C.alerts(workspace,{today:today(),includeCompleted:true});if(!entries.length)list.append(empty('Cadastre revisões, seguros, licenciamento ou habilitações para acompanhar os vencimentos.'));
    for(const r of entries){const actions=[];if(allowed('reminders.write')&&!r.archivedAt){actions.push(button('Editar',()=>openEdit('reminder',r,'reminders')),button(r.completedAt?'Reativar':'Concluir',()=>run(async()=>{await R.saveEntity('reminder',{...r,completedAt:r.completedAt?null:new Date().toISOString()},r.revision);setNotice(r.completedAt?'Alerta reativado.':'Alerta concluído.');})),button('Arquivar',()=>archive('reminder',r)));}list.append(actionRow(r,r.title,reminderDetail(r),actions,badge(alertLabels[r.status]||r.status,r.status)));}section.append(list);content.append(section);if(!allowed('reminders.write'))return;
    const existing=edit.reminder,panel=card(existing?'Editar alerta':'Novo alerta'),f=form('business-reminder-form','Cadastro de alerta',formEl=>{
      let data;try{data={...(existing||{}),id:existing?.id||id(),companyId:workspace.company.id,title:valueOf(formEl,'title'),kind:valueOf(formEl,'kind'),vehicleId:valueOf(formEl,'vehicleId')||null,memberId:valueOf(formEl,'memberId')||null,dueDate:valueOf(formEl,'dueDate')||null,dueOdometer:valueOf(formEl,'dueOdometer')?amount(formEl,'dueOdometer'):null,completedAt:existing?.completedAt||null,revision:existing?.revision||1,archivedAt:existing?.archivedAt||null};delete data.status;delete data.daysRemaining;delete data.distanceRemaining;C.validateReminder(data,workspace);}catch(error){setNotice(error.message,true);return;}
      run(async()=>{await R.saveEntity('reminder',data,existing?.revision||0);edit.reminder=null;setNotice('Alerta salvo.');});
    });
    field(f,'O que acompanhar?','title',existing?.title||'',{required:true,maxLength:120,placeholder:'Ex.: Revisão, seguro ou habilitação'});field(f,'Tipo','kind',existing?.kind||'maintenance',{options:[{value:'maintenance',label:'Manutenção'},{value:'document',label:'Documento'}]});field(f,'Veículo','vehicleId',existing?.vehicleId||'',{options:[{value:'',label:'Sem veículo específico'},...vehicleOptions(existing?.vehicleId,true).slice(1)]});field(f,'Pessoa da equipe','memberId',existing?.memberId||'',{options:memberOptions(existing?.memberId,true)});field(f,'Data de vencimento','dueDate',existing?.dueDate||'',{type:'date'});field(f,'Hodômetro de vencimento (km)','dueOdometer',existing?.dueOdometer===null||existing?.dueOdometer===undefined?'':C.formatDecimal(existing.dueOdometer,2),{inputMode:'decimal',placeholder:'Opcional',hint:'Informe um veículo para usar vencimento por km.'});formActions(f,'Salvar alerta',existing?()=>edit.reminder=null:null);panel.append(f);content.append(panel);
  }
  function renderPlan() {
    const B=root.RodagemBilling,section=card('Plano da empresa','Escolha a cobrança por empresa ou por veículo ativo. Valores e contratação aparecem somente após a configuração do serviço de pagamentos.');
    const configured=Boolean(B?.configured()&&currentMode()==='cloud'&&allowed('billing.manage'));
    const companyId=workspace.company.id,cached=billingCache.get(companyId);
    const enabled=Boolean(configured&&cached&&!cached.error&&cached.configured!==false);
    const state=cached?.entitlement||workspace.entitlement;
    const statusText=state?.status==='active'?'Assinatura ativa':state?.status==='trialing'?'Período de teste informado pelo provedor':state?.status==='past_due'?'Pagamento pendente':state?.status==='canceled'?'Assinatura cancelada':'Sem assinatura ativa';
    const statusLabel=node('p',statusText,'business-plan-status');statusLabel.id='business-plan-status';section.append(statusLabel);
    if(!enabled)section.append(node('p',currentMode()==='local'?'A organização local funciona neste aparelho. Para contratar online, conecte a conta e abra uma empresa na nuvem.':!B?.configured()?'A contratação online ainda não está disponível nesta instalação. Nenhuma cobrança será iniciada.':!allowed('billing.manage')?'Somente o responsável da empresa pode contratar ou gerenciar a assinatura.':cached?.error||(!cached?'Conferindo os planos disponíveis…':'A contratação ainda não foi ativada para esta instalação.'),'hint'));
    const plans=cached?.plans||B?.plans?.()||[{id:'company',name:'Por empresa',unit:'empresa',amount:null},{id:'vehicle',name:'Por veículo ativo',unit:'veículo ativo',amount:null}];
    const list=node('div',null,'business-plan-grid');for(const plan of plans){const panel=card(plan.name||plan.id);panel.append(node('p',plan.id==='company'?'Uma assinatura para organizar a empresa.':'A quantidade contratada define as vagas para veículos ativos.'));const price=node('strong',priceLabel(plan),'business-plan-price');panel.append(price);const choose=button('Contratar plano',()=>run(async()=>{if(!await confirmar('Abrir a contratação segura do plano '+plan.name+'? Você verá o preço e confirmará o pagamento no serviço de cobrança.'))return;await B.checkout(workspace.company.id,plan.id);},{reset:false}),'primary');choose.dataset.businessPlan=plan.id;choose.disabled=!enabled||!Number.isSafeInteger(plan.amount)||plan.amount<0;panel.append(choose);list.append(panel);}section.append(list);
    const portal=button('Gerenciar assinatura',()=>run(async()=>{await B.portal(workspace.company.id);},{reset:false}));portal.id='business-billing-portal';portal.disabled=!enabled||cached?.portalAvailable!==true;section.append(portal);
    if(configured){const reload=button('Atualizar planos',()=>{billingCache.delete(companyId);renderTab();});reload.disabled=billingLoading.has(companyId);section.append(reload);}
    content.append(section);
    if(configured&&!cached&&!billingLoading.has(companyId)&&B.status){
      billingLoading.add(companyId);
      B.status(companyId).then(response=>{if(currentMode()!=='cloud'||workspace?.company.id!==companyId)return;billingCache.set(companyId,response||{configured:false});}).catch(error=>{if(workspace?.company.id===companyId)billingCache.set(companyId,{error:error.message||'Não foi possível consultar os planos.'});}).finally(()=>{billingLoading.delete(companyId);if(tab==='plan'&&workspace?.company.id===companyId&&!stale)renderTab();});
    }
  }
  function renderBackup() {
    if(currentMode()!=='local')return;
    const section=card('Cópia das empresas deste perfil','O backup empresarial inclui equipe, veículos, viagens e alertas locais deste perfil. Os lançamentos pessoais têm backup próprio no Histórico.');const actions=node('div',null,'actions');
    const download=button('Baixar backup das empresas',()=>{try{const data=R.exportLocal();baixar('minha-rodagem-empresas-'+today()+'.json',JSON.stringify(data,null,2),'application/json');setNotice('Backup das empresas baixado.');}catch(error){setNotice(error.message,true);}});download.id='business-backup';actions.append(download);
    const file=node('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.id='business-import-file';
    const restore=button('Restaurar empresas',()=>file.click());restore.id='business-import';actions.append(restore,file);file.addEventListener('change',async()=>{const operation=++importEpoch,selected=file.files[0];file.value='';if(!selected)return;try{const before=R.exportLocal();if(selected.size>5*1024*1024)throw Error('Escolha um backup empresarial de até 5 MB.');const data=C.validateState(JSON.parse(await selected.text()));if(operation!==importEpoch)return;if(!await confirmar('Substituir as empresas locais deste perfil pelo backup? Equipe, veículos, viagens e alertas locais serão substituídos. Os lançamentos pessoais e outros perfis serão mantidos. Baixe uma cópia dos atuais antes se quiser guardá-los.'))return;if(operation!==importEpoch)return;if(!await discard())return;if(operation!==importEpoch)return;await run(async()=>{await R.importLocal(data,before);workspace=null;await refreshCompanies();edit={member:null,vehicle:null,trip:null,reminder:null};setNotice('Empresas restauradas. Selecione a empresa que deseja abrir.');});}catch(error){if(operation===importEpoch)setNotice(error.message||'Escolha um backup empresarial válido.',true);}});
    section.append(actions);host.append(section);
  }
  function renderInviteAccept() {
    if(currentMode()!=='cloud'){
      if(pendingInvitation){const panel=card('Você recebeu um convite','Conecte a conta do e-mail convidado em Meu perfil e selecione Na minha conta para aceitar. O código fica temporariamente neste navegador durante a entrada.');panel.append(button('Ir para Meu perfil',()=>abrir('ajustes')));host.append(panel);}return;
    }
    const panel=card('Recebeu um convite?','Entre com a conta do e-mail convidado e cole o código ou o link recebido.');
    const f=form('business-accept-invite','Aceitar convite',formEl=>{let value=valueOf(formEl,'token');try{if(value.includes('://'))value=new URL(value).searchParams.get('convite')||'';}catch{setNotice('Confira o link do convite.',true);return;}run(async()=>{const ws=await R.acceptInvite(value);pendingInvitation='';try{sessionStorage.removeItem(invitationKey);}catch{}await refreshCompanies(ws.company.id);const url=new URL(location.href);url.searchParams.delete('convite');history.replaceState(null,'',url.href);setNotice('Convite aceito. Empresa aberta.');});});field(f,'Código ou link do convite','token',pendingInvitation,{required:true,maxLength:2000});formActions(f,'Aceitar convite');panel.append(f);host.append(panel);
  }
  root.RodagemBusinessUI=Object.freeze({isDirty:()=>drafts.size>0,refresh:async()=>{if(!await discard())return false;await run(async()=>refreshCompanies(workspace?.company.id));return true;}});
  document.addEventListener('rodagem:profile-stale',()=>{stale=true;drafts.clear();billingCache.clear();workspace=null;companies=[];setNotice('O perfil mudou. Recarregue para abrir os dados corretos.',true);render();});
  document.addEventListener('rodagem:profile-will-change',()=>{stale=true;});
  R.subscribe?.(event=>{if(['auth','access','stale'].includes(event?.type)){workspace=null;companies=[];drafts.clear();billingCache.clear();if(event.type==='stale')stale=true;setNotice('A conta ou o contexto da empresa mudou. Selecione novamente a empresa.',true);render();return;}if(busy)return;const current=R.getCurrentWorkspace();if(workspace&&!current){workspace=null;companies=[];drafts.clear();billingCache.clear();setNotice('A conta ou o contexto da empresa mudou. Selecione novamente a empresa.',true);render();}});
  render();run(async()=>{await refreshCompanies();},{reset:true});
})();
