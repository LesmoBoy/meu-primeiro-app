// Exercises production profile parsing and save handlers with simulated DOM.
import assert from 'node:assert/strict';
import {boot,recordKey} from './harness.mjs';
const profileKey='minha-rodagem-perfil-v2';
const legacy={versao:1,nome:'Ana',trabalho:'apps',jornada:6,meta:20000,moto:'110–160 cc',modelo:'Minha moto antiga',combustivel:'Gasolina',configurado:true};
const fuels={versao:1,registros:[
  {id:'pump-one',tipo:'posto',data:'2026-11-12',odometro:100000,litros:10000,valor:5000,tanque:'cheio'},
  {id:'pump-two',tipo:'posto',data:'2026-11-13',odometro:120000,litros:10000,valor:5000,tanque:'cheio'}
]};
let passed=0;
async function check(name,test){await test();passed++;console.log('PASS',name);}

await check('legacy profile and fuel history are not rewritten during the vehicle upgrade',async()=>{
  const raw=JSON.stringify(legacy),records=JSON.stringify(fuels);const a=boot(new Map([[profileKey,raw],[recordKey,records]]));
  assert.equal(a.store.get(profileKey),raw);assert.equal(a.store.get(recordKey),records);
  assert.equal(a.get('perfil').elements.categoria.value,'moto');assert.equal(a.get('perfil').elements.modelo.value,legacy.modelo);
  assert.equal(a.get('perfil').elements.ano.value,'');assert.equal(a.get('moto-consumo').textContent,'20 km/L');
  assert.equal(a.evaluate('perfilRodagem.versao'),2);
});
await check('truck registration persists free model and year and restores on reload',async()=>{
  const a=boot();a.fill('perfil',{nome:'Ana',categoria:'caminhao',modelo:'Meu caminhão da equipe Azul',ano:'2020',combustivel:'Diesel',trabalho:'frete',meta:'450'});await a.submit('perfil');
  const saved=JSON.parse(a.store.get(profileKey));assert.equal(saved.versao,2);assert.equal(saved.categoria,'caminhao');assert.equal(saved.ano,2020);
  assert.equal(saved.modelo,'Meu caminhão da equipe Azul');assert.equal(saved.combustivel,'Diesel');assert.equal(saved.trabalho,'frete');
  const reload=boot(a.store);assert.equal(reload.get('perfil').elements.modelo.value,saved.modelo);assert.equal(reload.get('perfil').elements.ano.value,'2020');
  assert.equal(reload.get('veiculo-unidade-entregas').textContent,'Viagens realizadas');assert.equal(reload.get('novo-abastecimento').hidden,false);
  assert.match(reload.get('moto-combustivel').textContent,/Caminhão.*2020.*Diesel/);
});
await check('passenger services switch count labels without changing ledger field names',async()=>{
  const a=boot();a.fill('perfil',{categoria:'carro',trabalho:'taxi'});await a.submit('perfil');
  assert.equal(a.get('veiculo-unidade-entregas').textContent,'Corridas realizadas');assert.ok(a.get('dia').elements.entregas);
  assert.equal(a.evaluate('window.RodagemVehicles.workUnitDetails(perfilRodagem).singular'),'corrida');
});
await check('electric vehicle preserves old liquid records while refusing new litre calculations',async()=>{
  const records=JSON.stringify(fuels);const a=boot(new Map([[recordKey,records],[profileKey,JSON.stringify(legacy)]]));
  a.fill('perfil',{categoria:'carro',combustivel:'Elétrico'});await a.submit('perfil');
  assert.equal(a.get('novo-abastecimento').hidden,true);assert.equal(a.get('estimar').disabled,true);assert.equal(a.get('moto-consumo').textContent,'Não se aplica');
  assert.match(a.get('veiculo-resumo-dica').textContent,/kWh/);assert.equal(a.store.get(recordKey),records);
  a.fill('posto',{data:'2026-11-13',odometro:'1500',litros:'10',valor:'60'});await a.submit('posto');
  assert.equal(a.store.get(recordKey),records);assert.match(a.get('mensagem').textContent,/não usa a medição por litro/);
});
await check('bicycles use compatible energy automatically and GNV never displays km/L',async()=>{
  const a=boot();a.fill('perfil',{categoria:'bicicleta'});assert.equal(a.get('perfil').elements.combustivel.value,'Sem combustível');assert.equal(a.get('perfil').elements.combustivel.disabled,true);
  await a.submit('perfil');assert.equal(a.get('novo-abastecimento').hidden,true);assert.equal(JSON.parse(a.store.get(profileKey)).combustivel,'Sem combustível');
  a.fill('perfil',{categoria:'bicicleta-eletrica'});assert.equal(a.get('perfil').elements.combustivel.value,'Elétrico');await a.submit('perfil');assert.match(a.get('gasto-energia-label').textContent,/Energia/);
  a.fill('perfil',{categoria:'carro',combustivel:'GNV'});assert.equal(a.get('perfil').elements.combustivel.disabled,false);await a.submit('perfil');
  assert.match(a.get('veiculo-resumo-dica').textContent,/m³/);assert.equal(a.get('moto-consumo').textContent,'Não se aplica');
});
await check('an invalid year cannot replace saved preferences or discard its draft',async()=>{
  const raw=JSON.stringify(legacy);const a=boot(new Map([[profileKey,raw]]));a.fill('perfil',{modelo:'Novo nome ainda não salvo',ano:'1800'});await a.submit('perfil');
  assert.equal(a.store.get(profileKey),raw);assert.equal(a.get('perfil').elements.modelo.value,'Novo nome ainda não salvo');assert.equal(a.evaluate('perfilAlterado'),true);
  assert.match(a.get('mensagem').textContent,/categoria e o ano/);
});
console.log(`PASS ${passed} vehicle DOM integration suites`);
