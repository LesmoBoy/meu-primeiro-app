/* Pure, deterministic budget tests. No storage, account, network or real ledger. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');

function load(){
  const window={};
  Object.defineProperty(window,'localStorage',{get(){throw Error('Budget must not read storage');}});
  Object.defineProperty(window,'fetch',{get(){throw Error('Budget must not access the network');}});
  vm.runInNewContext(fs.readFileSync(path.join(root,'backup-budget.js'),'utf8'),{window});
  return window.RodagemBackupBudget;
}

function largeSnapshot(count=36000){
  return {version:1,settings:null,records:{versao:1,registros:Array.from({length:count},(_,i)=>({
    id:String(i),tipo:'dia',data:'2026-11-26',ganhos:18000,combustivel:250,
    outros:50,entregas:20,horas:600,km:1200
  }))},routes:[],gpsPreferences:{enabled:true,mode:'eco'},journey:null};
}

function fixtures(){
  let seed=323;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const numbers=[0,-0,1,-1,1e-7,-1e-7,1e21,-1e21,1.25e-7,5e-324,Number.MAX_VALUE,Number.MIN_VALUE,0.000001,999999999999999999999];
  for(let i=0;i<1000;i++){
    const exponent=Math.floor(random()*633)-324;
    const value=Number((random()<.5?'-':'')+(1+random()*8).toPrecision(16)+'e'+exponent);
    if(Number.isFinite(value))numbers.push(value);
  }
  return [
    {label:'primitives',value:[null,true,false,0,'']},
    {label:'separator-whitespace',value:{a:1,b:[1,2,{c:3,d:4}],empty:[],object:{}}},
    {label:'unicode-and-escaping',value:{'🛵 chave':'ação 😃 / \\ " \b\t\n\f\r\u0001\u007f\u2028\u2029\u00a0\ufeff',text:'caminhão, frete: R$'}},
    {label:'numeric-exponents',value:numbers},
    {label:'object-key-order',value:{veryLongKey:1,a:2,ccc:'x',zz:{q:4}}},
    {label:'plain-null-prototype',value:Object.assign(Object.create(null),{one:1,two:[true,null]})},
    {label:'prototype-looking-data',value:JSON.parse('{"__proto__":{"safe":true},"constructor":"data","toJSON":"ordinary text"}')},
    {label:'large-synthetic-snapshot',value:largeSnapshot()},
  ];
}

function run(){
  const api=load(),passed=[];
  const check=(name,fn)=>{fn();passed.push(name);console.log('PASS',name);};
  check('compact bytes match the JSON transport for plain canonical values',()=>{
    for(const {value}of fixtures().slice(0,-1)){
      const before=JSON.stringify(value),budget=api.inspect(value);
      assert.equal(budget.complete,true);assert.equal(budget.wireBytes,Buffer.byteLength(before));
      assert.equal(budget.fits,true);assert.ok(budget.serverBytesUpperBound>=budget.wireBytes);
      assert.equal(JSON.stringify(value),before);
    }
  });
  check('server separators and expanded numeric notation are accounted for',()=>{
    assert.equal(api.inspect({a:1,b:2}).wireBytes,13);
    assert.equal(api.inspect({a:1,b:2}).serverBytesUpperBound,16);
    assert.equal(api.inspect(1e-7).serverBytesUpperBound,9);
    assert.equal(api.inspect(-1.25e-7).serverBytesUpperBound,12);
    assert.equal(api.inspect(1e21).serverBytesUpperBound,22);
    assert.equal(api.inspect(5e-324).serverBytesUpperBound,326);
  });
  check('the audit-sized ledger fits compact JSON but is refused before a server write',()=>{
    const value=largeSnapshot(),before=JSON.stringify(value),budget=api.inspect(value);
    assert.ok(budget.wireBytes<api.limitBytes);assert.ok(budget.serverBytesUpperBound>api.limitBytes);
    assert.equal(budget.fits,false);assert.equal(budget.reason,'server-limit');
    assert.throws(()=>api.assertFits(value),error=>error.code==='BACKUP_TOO_LARGE'&&error.message.includes('JSONB')&&error.message.includes('última cópia válida'));
    assert.equal(JSON.stringify(value),before);
  });
  check('exact byte boundary is allowed and one extra byte is refused',()=>{
    const fit='x'.repeat(api.limitBytes-2),over=fit+'x';
    assert.equal(api.inspect(fit).fits,true);assert.equal(api.inspect(fit).serverBytesUpperBound,api.limitBytes);
    assert.equal(api.inspect(over).fits,false);assert.equal(api.inspect(over).reason,'server-limit');
  });
  check('NUL and unpaired surrogates fail without silent string substitution',()=>{
    for(const value of ['a\u0000b','\ud800','\udfff',{['\ud800']:'x'},{x:'\ud800'}]){
      const result=api.inspect(value);assert.equal(result.fits,false);assert.equal(result.reason,'invalid-unicode');
      assert.throws(()=>api.assertFits(value),error=>error.code==='BACKUP_INVALID_DATA');
    }
  });
  check('non-JSON values fail instead of becoming null or being omitted',()=>{
    for(const value of [NaN,Infinity,-Infinity,undefined,1n,Symbol('x'),()=>{},[undefined],{x:undefined},new Date(),new Number(2)]){
      const result=api.inspect(value);assert.equal(result.fits,false);assert.equal(result.reason,'invalid-json');
    }
    const sparse=[];sparse.length=1;assert.equal(api.inspect(sparse).fits,false);
  });
  check('cycles fail while shared child objects retain normal JSON duplication',()=>{
    const circular={};circular.self=circular;assert.equal(api.inspect(circular).reason,'circular');
    const item={a:1},shared=[item,item];assert.equal(api.inspect(shared).wireBytes,Buffer.byteLength(JSON.stringify(shared)));
  });
  check('getters and serialization hooks are never invoked',()=>{
    let calls=0;const getter={get x(){calls++;return 1;}},hook={toJSON(){calls++;return 1;}};
    assert.equal(api.inspect(getter).fits,false);assert.equal(api.inspect(hook).fits,false);
    const hidden={};Object.defineProperty(hidden,'toJSON',{get(){calls++;return()=>1;}});
    assert.equal(api.inspect(hidden).fits,false);assert.equal(calls,0);
  });
  check('depth and work guards are iterative and do not modify the supplied structure',()=>{
    let allowed={};for(let i=0;i<120;i++)allowed={child:allowed};assert.equal(api.inspect(allowed).fits,true);
    let tooDeep={};for(let i=0;i<140;i++)tooDeep={child:tooDeep};assert.equal(api.inspect(tooDeep).reason,'depth');
    const tooMuchWork=['x'.repeat(api.limitBytes*4),null];assert.equal(api.inspect(tooMuchWork).reason,'complexity');
  });
  check('frozen records are measured without mutation or access to browser state',()=>{
    const value=Object.freeze({records:Object.freeze([Object.freeze({id:'synthetic',amount:123})])});
    const result=api.assertFits(value);assert.equal(result.fits,true);assert.ok(Object.isFrozen(result));
    assert.equal(value.records[0].amount,123);assert.equal(value.records[0].id,'synthetic');
  });
  const report={classification:'automated_local_pure_js',syntheticOnly:true,passed,errors:[],largeFixtureBudget:api.inspect(largeSnapshot())};
  fs.writeFileSync(path.join(__dirname,'backup-budget-unit-result.json'),JSON.stringify(report,null,2)+'\n');
  console.log('BACKUP_BUDGET_UNIT_REPORT '+JSON.stringify({passed:passed.length,errors:0,largeFixtureBudget:report.largeFixtureBudget}));
}

module.exports={load,fixtures,largeSnapshot};
if(require.main===module)run();
