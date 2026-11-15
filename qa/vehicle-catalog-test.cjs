// Domain validation against the production catalog; no rendering claim.
const assert = require('node:assert/strict');
const catalog = require('../vehicle-catalog.js');
const legacy = {versao:1,nome:'Ana',trabalho:'apps',jornada:6,meta:20000,moto:'110–160 cc',modelo:'Minha moto',combustivel:'Gasolina',configurado:true};
const current = {versao:2,nome:'Ana',trabalho:'taxi',jornada:8,meta:25000,categoria:'carro',modelo:'Veículo nomeado livremente',ano:2020,combustivel:'Flex / alternado',configurado:true};
let passed = 0;
function check(name,test) { test(); passed++; console.log('PASS',name); }

check('legacy motorcycles load without mutating their stored payload',() => {
  for (const moto of ['110–160 cc','200–300 cc','Scooter','Outra moto']) {
    const input={...legacy,moto};const before=JSON.stringify(input);
    const loaded=catalog.validateProfile(input);
    assert.equal(loaded.versao,2);assert.equal(loaded.categoria,'moto');assert.equal(loaded.modelo,input.modelo);assert.equal(loaded.ano,null);
    assert.equal(JSON.stringify(input),before);
  }
});
check('all transport categories preserve a free-form model and optional year',() => {
  for (const category of catalog.categories) {
    const fuel=category.id==='bicicleta'?'Sem combustível':category.id==='bicicleta-eletrica'?'Elétrico':'Diesel';
    const loaded=catalog.validateProfile({...current,categoria:category.id,combustivel:fuel,modelo:'Meu veículo — qualquer marca',ano:null});
    assert.equal(loaded.modelo,'Meu veículo — qualquer marca');assert.equal(loaded.categoria,category.id);assert.equal(loaded.ano,null);
  }
  assert.equal(catalog.validateProfile({...current,modelo:'x'.repeat(60)}).modelo.length,60);
  assert.throws(()=>catalog.validateProfile({...current,modelo:'x'.repeat(61)}));
  assert.equal(catalog.vehicleLabel({...current,modelo:''}),'Carro');
});
check('year boundaries reject fractions, strings and implausible future dates',() => {
  for(const year of [1900,new Date().getFullYear(),new Date().getFullYear()+1])assert.equal(catalog.validateProfile({...current,ano:year}).ano,year);
  for(const year of [1899,2020.5,'2020',NaN,Infinity,new Date().getFullYear()+2,undefined])assert.throws(()=>catalog.validateProfile({...current,ano:year}));
  for(const year of ['',null])assert.equal(catalog.validateProfile({...current,ano:year}).ano,null);
});
check('activities remain independent from categories and adapt work units',() => {
  for(const category of catalog.categories)for(const activity of catalog.activities){
    const fuel=category.id==='bicicleta'?'Sem combustível':category.id==='bicicleta-eletrica'?'Elétrico':'Gasolina';
    assert.equal(catalog.validateProfile({...current,categoria:category.id,trabalho:activity.id,combustivel:fuel}).trabalho,activity.id);
  }
  assert.equal(catalog.workUnits({trabalho:'taxi'}),'Corridas');
  assert.equal(catalog.workUnits({trabalho:'passageiros-app'}),'Corridas');
  assert.equal(catalog.workUnits({trabalho:'frete'}),'Viagens');
  assert.equal(catalog.workUnits({trabalho:'apps'}),'Entregas');
  assert.deepEqual(catalog.workUnitDetails({trabalho:'servicos-campo'}),{singular:'serviço',plural:'serviços',label:'Serviços'});
});
check('only liquid fuel can use the existing litres and km/L calculation',() => {
  for(const fuel of ['Gasolina','Etanol','Flex / alternado','Diesel','Híbrido'])assert.equal(catalog.liquidFuel({...current,combustivel:fuel}),true);
  for(const fuel of ['GNV','Elétrico','Sem combustível','Outro'])assert.equal(catalog.liquidFuel({...current,combustivel:fuel}),false);
  assert.equal(catalog.liquidFuel({...current,categoria:'bicicleta'}),false);
  assert.equal(catalog.liquidFuel({...current,categoria:'bicicleta-eletrica'}),false);
  assert.match(catalog.fuelHint({...current,combustivel:'GNV'}),/m³/);
  assert.match(catalog.fuelHint({...current,combustivel:'Elétrico'}),/kWh/);
});
check('bicycle energy cannot be persisted with incompatible fuel',() => {
  assert.throws(()=>catalog.validateProfile({...current,categoria:'bicicleta',combustivel:'Diesel'}));
  assert.throws(()=>catalog.validateProfile({...current,categoria:'bicicleta-eletrica',combustivel:'Gasolina'}));
  assert.equal(catalog.validateProfile({...current,categoria:'bicicleta',combustivel:'Sem combustível'}).combustivel,'Sem combustível');
});
check('malformed profile fields and unsupported future schemas fail closed',() => {
  const invalid=[{versao:3},{categoria:'aeroespacial'},{trabalho:'not-an-activity'},{meta:-1},{meta:.5},{jornada:25},{jornada:NaN},{ano:{}},{nome:'x'.repeat(33)},{combustivel:'made-up'},{configurado:1},{modelo:null}];
  for(const fields of invalid)assert.throws(()=>catalog.validateProfile({...current,...fields}));
  assert.throws(()=>catalog.validateProfile({...legacy,moto:'unknown'}));
  assert.throws(()=>catalog.validateProfile('{'));assert.throws(()=>catalog.validateProfile(null));
});
check('empty profiles return detached defaults and catalog definitions stay immutable',() => {
  const loaded=catalog.validateProfile(null,current);loaded.modelo='changed';assert.equal(current.modelo,'Veículo nomeado livremente');
  assert.equal(Object.isFrozen(catalog),true);assert.equal(Object.isFrozen(catalog.categories),true);assert.equal(Object.isFrozen(catalog.categories[0]),true);
});
console.log(`PASS ${passed} vehicle catalog suites`);
