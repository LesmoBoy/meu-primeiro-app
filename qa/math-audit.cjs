// Pure arithmetic/data checks against production functions; no DOM/browser claim.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const beforeUI = source.slice(0,source.indexOf('function aviso'));
const calculationFunctions = source.slice(source.indexOf('function campoNumerico'),source.indexOf('function apresentar'));
const sandbox = vm.createContext({window:{},document:{getElementById(){}},Intl,Date,Map,Set,Math,Number,Error,crypto:{randomUUID:()=> 'new-id'}});
vm.runInContext(beforeUI+calculationFunctions,sandbox);
const run = code => vm.runInContext(code,sandbox);
let count=0;
const check = (label,fn) => {fn();count++;console.log('PASS',label);};
function parse(text,places=2,name='ganhos') {
  sandbox.field={name,value:text,focus(){},closest(){return {childNodes:[{textContent:name}]};}};
  return run(`campoNumerico(field,${places})`);
}
check('currency inputs preserve exact cents across range',()=>{
  for(const cents of [0,1,9,10,29,99,100,101,175,999,10000,100000001,9999999999,10000000000]){
    const digits=String(cents).padStart(3,'0');
    assert.equal(parse(digits.slice(0,-2)+','+digits.slice(-2)),cents);
  }
  let seed=49287;
  for(let i=0;i<50000;i++){
    seed=(seed*48271)%2147483647;
    const cents=seed*3;
    const digits=String(cents).padStart(3,'0');
    assert.equal(parse(digits.slice(0,-2)+'.'+digits.slice(-2)),cents);
  }
});
check('invalid, negative, exponential and excess-precision inputs rejected',()=>{
  for(const value of ['-1','1e3','NaN','Infinity','1,001','1.234,56','1,2,3','  ','1 000','1_000','100000000,01'])assert.throws(()=>parse(value));
});
check('Brazilian odometer grouping and litre precision',()=>{
  assert.equal(parse('65.240',2,'odometro'),6524000);
  assert.equal(parse('65.240,75',2,'odometro'),6524075);
  assert.equal(parse('65240.75',2,'odometro'),6524075);
  assert.equal(parse('0,001',3,'litros'),1);
  assert.equal(parse('8,555',3,'litros'),8555);
  assert.throws(()=>parse('8,5555',3,'litros'));
});
check('calendar and leap dates are validated without timezone conversion',()=>{
  for(const date of ['2024-02-29','2026-01-31','2026-12-31','0001-01-01','9999-12-31']){sandbox.date=date;assert.equal(run('dataValida(date)'),true,date);}
  for(const date of ['2026-02-29','2026-02-31','2026-04-31','2026-13-01','2026-01-00','2026-1-01']){sandbox.date=date;assert.equal(run('dataValida(date)'),false,date);}
});
check('full-partial-full fuel cycle excludes initial fill and includes partial fill',()=>{
  sandbox.rows=[
    {tipo:'posto',id:'before',data:'2026-11-09',odometro:990000,litros:10000,valor:6000,tanque:'parcial'},
    {tipo:'posto',id:'initial',data:'2026-11-10',odometro:1000000,litros:7000,valor:4200,tanque:'cheio'},
    {tipo:'posto',id:'partial',data:'2026-11-11',odometro:1015000,litros:4000,valor:2400,tanque:'parcial'},
    {tipo:'posto',id:'final',data:'2026-11-12',odometro:1030000,litros:6000,valor:3600,tanque:'cheio'}
  ];
  const cycle=run('ciclos(rows).get("final")');
  assert.equal(cycle.kmPorLitro,30);
  assert.equal(cycle.custoPorKm,.2);
  assert.equal(run('ciclos(rows).size'),1);
  assert.equal(sandbox.rows[0].id,'before','function must not reorder input array');
});
check('backup rejects duplicate IDs, duplicate odometers and noninteger monetary data',()=>{
  const base={tipo:'dia',id:'test',data:'2026-11-13',ganhos:18000,combustivel:2000,outros:1000,entregas:20,horas:600,km:10000};
  const cases=[
    {versao:2,registros:[]},
    {versao:1,registros:[base,{...base}]},
    {versao:1,registros:[{...base,ganhos:.1}]},
    {versao:1,registros:[{...base,entregas:-1}]},
    {versao:1,registros:[{...base,data:'2026-02-31'}]},
    {versao:1,registros:[{tipo:'posto',id:'a',data:'2026-11-13',odometro:100,litros:1000,valor:600,tanque:'cheio'},{tipo:'posto',id:'b',data:'2026-11-13',odometro:100,litros:1000,valor:600,tanque:'cheio'}]}
  ];
  for(const data of cases){sandbox.backup=data;assert.throws(()=>run('validarBackup(backup)'));}
  sandbox.backup={versao:1,registros:[base]};assert.equal(run('validarBackup(backup).length'),1);
});
console.log(`PASS ${count} arithmetic/data suites, including 50,000 generated exact-decimal cases`);
