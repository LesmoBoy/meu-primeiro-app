import {boot,flush,legacy} from './harness.mjs';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const KEY='minha-rodagem-business-v1';
const load=async(a,name)=>vm.runInContext(await fs.readFile(new URL('../'+name,import.meta.url),'utf8'),a.context,{filename:name});
const backup={version:1,companies:[{id:'11111111-1111-4111-8111-111111111111',name:'Recuperada',revision:1,archivedAt:null,createdAt:'2026-11-26T08:00:00.000Z'}],members:[{id:'22222222-2222-4222-8222-222222222222',companyId:'11111111-1111-4111-8111-111111111111',userId:null,name:'Responsável',email:'',role:'owner',status:'active',revision:1,archivedAt:null}],vehicles:[],trips:[],reminders:[]};
async function setup(raw='{corrupt',options={}){
 const a=boot(new Map([[KEY,raw]]));a.window.crypto=a.context.crypto;a.window.RodagemCloud={configured:()=>false};
 const create=a.document.createElement.bind(a.document);a.document.createElement=tag=>{const node=create(tag);if(tag==='form')Object.defineProperty(node,'elements',{get(){const fields=[...node.querySelectorAll('[name]')];fields.namedItem=name=>fields.find(field=>field.name===name);return fields;}});if(tag==='select')Object.defineProperty(node,'value',{configurable:true,get(){const options=[...node.querySelectorAll('option')];return(options.find(option=>option.selected)||options[0])?.value||'';},set(value){for(const option of node.querySelectorAll('option'))option.selected=option.value===String(value);}});return node;};
 await load(a,'business-core.js');await load(a,'business-client.js');
 if(options.invitation){a.context.location.href='https://example.test/meu-primeiro-app/?convite='+options.invitation+'#empresas';a.context.sessionStorage={setItem(){throw Error('Blocked storage');},getItem(){return null;},removeItem(){}};a.context.history.replaceState=(_a,_b,url)=>{a.context.location.href=String(url);};}
 await load(a,'business-ui.js');await flush();return a;
}
const a=await setup();let reads=0;const file=a.get('business-import-file');assert.ok(file);
Object.defineProperty(file,'files',{configurable:true,value:[{size:1000,text:async()=>{reads++;return JSON.stringify(backup);}}]});
file.dispatchEvent(a.event('change'));await flush();
const beforeFix={reads,dialogOpen:a.get('confirmacao').open,notice:a.get('business-notice').textContent,storeUnchanged:a.store.get(KEY)==='{corrupt'};
console.log('CORRUPT_UI_RECOVERY_RESULT',JSON.stringify(beforeFix));
 assert.equal(reads,1);assert.equal(a.get('confirmacao').open,true);await a.confirm();assert.equal((await a.window.RodagemBusiness.listCompanies())[0].name,'Recuperada');
 assert.match(a.get('business-notice').textContent,/Empresas restauradas/);console.log('PASS valid backup recovers corrupt state through the actual UI');
 const b=await setup();let release;const input=b.get('business-import-file');Object.defineProperty(input,'files',{configurable:true,value:[{size:1000,text:()=>new Promise(resolve=>release=resolve)}]});input.dispatchEvent(b.event('change'));await flush();assert.ok(release);
 const changed=JSON.stringify({...backup,companies:[{...backup.companies[0],name:'Salva durante leitura'}]});b.store.set(KEY,changed);release(JSON.stringify(backup));await flush();assert.equal(b.get('confirmacao').open,true);await b.confirm();assert.equal(b.store.get(KEY),changed);assert.match(b.get('business-notice').textContent,/mudaram/);console.log('PASS a replacement made while reading the backup is not overwritten');
 const c=await setup();const cancelInput=c.get('business-import-file');Object.defineProperty(cancelInput,'files',{configurable:true,value:[{size:1000,text:async()=>JSON.stringify(backup)}]});cancelInput.dispatchEvent(c.event('change'));await flush();await c.confirm(false);assert.equal(c.store.get(KEY),'{corrupt');console.log('PASS cancel preserves corrupt raw bytes for later recovery');

const d=await setup(undefined,{invitation:'ab'.repeat(32)});assert.equal(new URL(d.context.location.href).searchParams.has('convite'),false);assert.match(d.get('business-app').textContent,/Você recebeu um convite/);console.log('PASS invitation URL is scrubbed when temporary storage rejects writes and its in-memory notice remains');
const csvState=JSON.parse(JSON.stringify(backup));csvState.members[0].name='@Responsible';
csvState.vehicles=[{id:'33333333-3333-4333-8333-333333333333',companyId:backup.companies[0].id,name:'+Vehicle',category:'carro',year:2020,fuel:'Gasolina',plate:'',odometer:0,active:true,revision:1,archivedAt:null}];
csvState.trips=[{id:'44444444-4444-4444-8444-444444444444',companyId:backup.companies[0].id,vehicleId:csvState.vehicles[0].id,driverId:csvState.members[0].id,date:'2026-11-26',title:'=SUM(1,1)',customer:'<img src=x onerror=alert(1)>',status:'completed',revenue:100,distance:0,costs:{fuel:200,tolls:0,parking:0,commission:0,helper:0,maintenance:0,other:0},createdAt:'2026-11-26T08:00:00.000Z',revision:1,archivedAt:null}];
const e=await setup(JSON.stringify(csvState));let csv='';e.context.baixar=(_name,body)=>{csv=body;};await e.window.RodagemBusiness.loadCompany(backup.companies[0].id);await e.window.RodagemBusinessUI.refresh();
assert.equal(e.get('business-app').querySelectorAll('img').length,0);assert.match(e.get('business-app').textContent,/@Responsible/);
e.get('business-csv').dispatchEvent(e.event('click'));await flush();assert.match(csv,/"'=SUM\(1,1\)"/);assert.match(csv,/"'\+Vehicle"/);assert.match(csv,/"'@Responsible"/);assert.match(csv,/"-1,00"/);assert.match(csv,/<img src=x onerror=alert\(1\)>/);console.log('PASS business text stays inert in the DOM and CSV prefixes formula-like names while preserving numeric losses');
const f=await setup();const dialogInput=f.get('business-import-file');Object.defineProperty(dialogInput,'files',{configurable:true,value:[{size:1000,text:async()=>JSON.stringify(backup)}]});dialogInput.dispatchEvent(f.event('change'));await flush();assert.equal(f.get('confirmacao').open,true);
const committed=JSON.stringify({...backup,companies:[{...backup.companies[0],name:'Confirmed newer data'}]});f.store.set(KEY,committed);await f.confirm();assert.equal(f.store.get(KEY),committed);assert.match(f.get('business-notice').textContent,/mudaram/);console.log('PASS a raw replacement during confirmation is preserved exactly');
const unicodeState=JSON.parse(JSON.stringify(csvState));unicodeState.trips[0].title='🛵'.repeat(120);unicodeState.vehicles[0].name='🛵'.repeat(60);
const g=await setup(JSON.stringify(unicodeState));await g.window.RodagemBusiness.loadCompany(backup.companies[0].id);await g.window.RodagemBusinessUI.refresh();g.get('business-app').querySelector('[data-business-tab="trips"]').dispatchEvent(g.event('click'));await flush();
const titleField=g.get('business-trip-form').querySelector('[name="title"]');assert.equal(titleField.maxLength,240);let validity;titleField.setCustomValidity=message=>{validity=message;};titleField.value='🛵'.repeat(120);titleField.dispatchEvent(g.event('input'));assert.equal(validity,'');titleField.value='a'.repeat(121);titleField.dispatchEvent(g.event('input'));assert.match(validity,/120/);
g.get('business-app').querySelector('[data-business-tab="vehicles"]').dispatchEvent(g.event('click'));await flush();if(g.get('confirmacao').open)await g.confirm();const yearField=g.get('business-vehicle-form').querySelector('[name="year"]');assert.equal(yearField.maxLength,4);console.log('PASS Unicode titles accepted by PostgreSQL remain readable and editable while real code-point and numeric limits stay enforced');
