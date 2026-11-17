// Pure business rules tested with synthetic data; no server or payments.
const assert=require('node:assert/strict');
const core=require('../business-core.js');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const stamp='2026-11-16T12:00:00.000Z';
const company=(n=1)=>({id:id(n),name:'Empresa '+n,createdAt:stamp,revision:1,archivedAt:null});
const member=(n=11,c=1)=>({id:id(n),companyId:id(c),userId:null,name:'Motorista '+n,email:'pessoa'+n+'@example.test',role:'driver',status:'active',revision:1,archivedAt:null});
const vehicle=(n=21,c=1)=>({id:id(n),companyId:id(c),name:'Veículo livre '+n,category:'caminhao',year:2022,fuel:'Diesel',plate:'ABC1D23',odometer:10000000,active:true,revision:1,archivedAt:null});
const zero=()=>Object.fromEntries(core.costKeys.map(key=>[key,0]));
const trip=(n=31,c=1,v=21,d=11)=>({id:id(n),companyId:id(c),vehicleId:id(v),driverId:d===null?null:id(d),date:'2026-11-16',title:'Entrega '+n,customer:'Cliente',status:'completed',revenue:10000,distance:2500,costs:{...zero(),fuel:2500,tolls:1000},createdAt:stamp,revision:1,archivedAt:null});
const reminder=(n=41,c=1,v=21)=>({id:id(n),companyId:id(c),vehicleId:v===null?null:id(v),memberId:null,kind:'maintenance',title:'Revisão',dueDate:'2026-11-16',dueOdometer:null,completedAt:null,revision:1,archivedAt:null});
const state=()=>({version:1,companies:[company()],members:[member()],vehicles:[vehicle()],trips:[trip()],reminders:[reminder()]});
const copy=value=>JSON.parse(JSON.stringify(value));
let passed=0;
function check(name,run){run();passed++;console.log('PASS',name);}

check('business state canonicalization is detached and never mutates preserved local data',()=>{
  const original=state(),before=JSON.stringify(original),validated=core.validateState(original);
  validated.trips[0].costs.fuel=7;validated.vehicles[0].name='Editado';
  assert.equal(JSON.stringify(original),before);assert.deepEqual(core.validateState(core.emptyState()),core.emptyState());
  assert.throws(()=>core.validateState({...original,version:2}),/incompatível/);
});
check('free vehicle names and all categories use typed year and matching bicycle energy',()=>{
  for(const category of core.categories){
    const item={...vehicle(),category,name:'Meu modelo inventado / 2022',fuel:category==='bicicleta'?'Sem combustível':category==='bicicleta-eletrica'?'Elétrico':'Diesel',year:null};
    assert.equal(core.validateVehicle(item).name,item.name);
  }
  for(const year of [1899,new Date().getFullYear()+2,2022.5,'2022',undefined])assert.throws(()=>core.validateVehicle({...vehicle(),year}));
  assert.throws(()=>core.validateVehicle({...vehicle(),category:'bicicleta',fuel:'Diesel'}),/bicicleta/);
  assert.throws(()=>core.validateVehicle({...vehicle(),name:'x'.repeat(61)}));
});
check('money uses exact decimal integers and rejects lossy, grouped or exponential inputs',()=>{
  for(let cents=0;cents<50000;cents++)assert.equal(core.parseDecimal(core.formatDecimal(cents)),cents);
  assert.equal(core.parseDecimal('0,29'),29);assert.equal(core.parseDecimal('8.555',3),8555);
  assert.equal(core.formatDecimal(-125),'−1,25'.replace('−','-'));
  for(const raw of ['1e3','-1','1,005','1.234,56','1,2,3','Infinity','','0x10','100000000,01'])assert.throws(()=>core.parseDecimal(raw));
});
check('trips and reminders cannot reference a vehicle or member from another company',()=>{
  const data=state();data.companies.push(company(2));data.members.push(member(12,2));data.vehicles.push(vehicle(22,2));
  assert.ok(core.validateState(data));
  assert.throws(()=>core.validateState({...data,trips:[{...trip(),vehicleId:id(22)}]}),/desta empresa/);
  assert.throws(()=>core.validateState({...data,trips:[{...trip(),driverId:id(12)}]}),/desta empresa/);
  assert.throws(()=>core.validateState({...data,reminders:[{...reminder(),memberId:id(12)}]}),/desta empresa/);
  assert.throws(()=>core.validateState({...data,vehicles:[{...vehicle(),companyId:id(999)}]}),/empresa/);
});
check('pending invitations cannot be used as active drivers or document owners',()=>{
  const data=state();data.members[0]={...member(),status:'invited'};
  assert.throws(()=>core.validateState(data),/convite/);
  data.trips=[];data.reminders=[{...reminder(),memberId:id(11)}];
  assert.throws(()=>core.validateState(data),/convite/);
});
check('duplicate entity IDs, corrupt revisions and invalid dates fail closed',()=>{
  const data=state();assert.throws(()=>core.validateState({...data,trips:[trip(),trip()]}),/repetidos/);
  assert.throws(()=>core.validateState({...data,trips:[{...trip(),id:id(21)}]}),/repetidos/);
  for(const revision of [0,-1,.5,Infinity,'1'])assert.throws(()=>core.validateTrip({...trip(),revision}));
  for(const date of ['2026-02-29','2026-02-31','0000-01-01','2026-1-1'])assert.throws(()=>core.validateTrip({...trip(),date}));
  assert.equal(core.validDate('2024-02-29'),true);assert.equal(core.validDate('0001-01-01'),true);
  assert.throws(()=>core.validateCompany({...company(),createdAt:'2026-02-31T12:00:00Z'}));
});
check('completed trip profit subtracts each cost exactly once and permits genuine losses',()=>{
  const first=trip(),second={...trip(32),revenue:100,costs:{...zero(),fuel:200,tolls:50}};
  const result=core.totals([first,second]);
  assert.deepEqual({count:result.count,revenue:result.revenue,costs:result.costs,profit:result.profit,distance:result.distance},{count:2,revenue:10100,costs:3750,profit:6350,distance:5000});
  assert.equal(core.totals([second]).profit,-150);
  assert.equal(result.byCost.fuel,2700);assert.equal(result.byCost.tolls,1050);
  assert.equal(Object.values(result.byCost).reduce((a,b)=>a+b,0),result.costs);
});
check('planned, ongoing and archived trips never inflate completed financial reports',()=>{
  const data=state();data.trips.push({...trip(32),status:'planned'},{...trip(33),status:'in_progress'},{...trip(34),archivedAt:stamp});
  assert.equal(core.totals(data).count,1);assert.equal(core.totals(data).revenue,10000);
  assert.equal(core.totals(data,{status:'planned'}).count,0);
  assert.equal(core.filterTrips(data,{includeArchived:true}).length,4);
});
check('date, company, vehicle and driver reports preserve historical attribution',()=>{
  const data=state();data.members.push(member(12));data.vehicles.push(vehicle(22));
  data.trips.push({...trip(32,1,22,12),date:'2026-11-15',revenue:20000},{...trip(33,1,22,null),date:'2026-11-14',revenue:30000});
  const reports=core.reports(data,{from:'2026-11-15',to:'2026-11-16'});
  assert.equal(reports.totals.revenue,30000);assert.equal(reports.byVehicle.length,2);assert.equal(reports.byDriver.length,2);
  assert.equal(core.totals(data,{vehicleId:id(22),driverId:id(12)}).revenue,20000);
  assert.equal(core.totals(data,{driverId:'unassigned'}).revenue,30000);
  assert.equal(core.totals(data,{companyId:id(2)}).count,0);
  assert.throws(()=>core.reports(data,{from:'2026-12-01',to:'2026-11-01'}),/período/);
});
check('archived vehicles and people retain historical trips but reject new assignments',()=>{
  const data=state();data.vehicles[0]={...vehicle(),active:false,archivedAt:stamp};data.members[0]={...member(),archivedAt:stamp};
  const validated=core.validateState(data);assert.equal(core.reports(validated).byVehicle[0].label,vehicle().name);assert.equal(core.totals(validated).revenue,10000);
  assert.throws(()=>core.validateEntity('trip',trip(32),validated,{forWrite:true}),/ativo/);
  assert.equal(core.validateEntity('trip',trip(),validated,{forWrite:true,previous:trip()}).id,id(31));
});
check('alerts combine date and odometer using the earliest due trigger without timezone drift',()=>{
  const data=state();data.reminders=[
    {...reminder(41),dueDate:'2026-11-15'},
    {...reminder(42),dueDate:'2026-11-16'},
    {...reminder(43),dueDate:'2026-11-30'},
    {...reminder(44),dueDate:'2027-12-30',dueOdometer:9999999},
    {...reminder(45),dueDate:null,dueOdometer:10050000},
    {...reminder(46),dueDate:'2027-12-30',dueOdometer:10060000}
  ];
  const alerts=core.alerts(data,'2026-11-16');
  assert.equal(alerts.find(a=>a.id===id(41)).status,'overdue');assert.equal(alerts.find(a=>a.id===id(42)).status,'due');
  assert.equal(alerts.find(a=>a.id===id(43)).daysRemaining,14);assert.equal(alerts.find(a=>a.id===id(43)).status,'soon');
  assert.equal(alerts.find(a=>a.id===id(44)).status,'overdue');assert.equal(alerts.find(a=>a.id===id(45)).status,'soon');assert.equal(alerts.find(a=>a.id===id(46)).status,'upcoming');
  data.reminders=[{...reminder(),dueDate:'2024-03-11'}];assert.equal(core.alerts(data,'2024-03-10')[0].daysRemaining,1);
});
check('completed and archived-reference reminders are excluded unless explicitly requested',()=>{
  const data=state();data.reminders[0].completedAt=stamp;
  assert.equal(core.alerts(data,'2026-11-16').length,0);
  assert.equal(core.alerts(data,{today:'2026-11-16',includeCompleted:true})[0].status,'completed');
  data.reminders[0].completedAt=null;data.vehicles[0].active=false;
  assert.equal(core.alerts(data,'2026-11-16').length,0);
  assert.equal(core.alerts(data,{today:'2026-11-16',includeArchivedReferences:true}).length,1);
  assert.throws(()=>core.validateReminder({...reminder(),vehicleId:null,dueDate:null,dueOdometer:500}),/hodômetro/);
});
check('driver workspace validation supports filtered membership while refusing identity mismatches',()=>{
  const data=state();const workspace={company:data.companies[0],membership:{role:'driver',userId:null,memberId:id(11)},members:data.members,vehicles:data.vehicles,trips:data.trips,reminders:data.reminders,entitlement:null};
  assert.equal(core.validateWorkspace(workspace).membership.role,'driver');
  assert.throws(()=>core.validateWorkspace({...workspace,membership:{...workspace.membership,role:'owner'}}),/vínculo/);
  assert.throws(()=>core.validateWorkspace({...workspace,membership:{...workspace.membership,userId:id(71)}}),/vínculo/);
});
check('role capabilities never grant billing or fleet administration to finance or drivers',()=>{
  assert.equal(core.can('owner','billing.manage'),true);assert.equal(core.can('manager','billing.manage'),false);
  assert.equal(core.can('finance','trips.costs'),true);assert.equal(core.can('finance','trips.write'),false);
  assert.equal(core.can('driver','trips.write'),true);assert.equal(core.can('driver','fleet.write'),false);
  assert.equal(core.can('manager','members.invite'),true);assert.equal(core.can('finance','members.invite'),false);
  assert.equal(core.can('unknown','fleet.write'),false);assert.equal(core.can('owner','invented.permission'),false);
  assert.equal(core.can('vehicles.write','manager'),true);
});
console.log('PASS '+passed+' business core suites');
