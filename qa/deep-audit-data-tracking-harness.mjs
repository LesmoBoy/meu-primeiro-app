// Integrates the real GPS module and engine with simulated browser APIs.
import {parseHTML} from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root = new URL('../',import.meta.url);
const html = await fs.readFile(new URL('index.html',root),'utf8');
const core = await fs.readFile(new URL('gps-core.js',root),'utf8');
const source = await fs.readFile(new URL('tracking.js',root),'utf8');
const flush = async () => { for(let i=0;i<6;i++) await new Promise(r=>setImmediate(r)); };
export function bootTracking(store = new Map()) {
  const {document,window:dom} = parseHTML(html);
  const requests = [], timers = new Map(), warnings = [];
  let now = Date.parse('2026-11-13T16:00:00Z'), counter = 0;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  for(const select of document.querySelectorAll('select')) {
    let value=select.querySelector('option')?.getAttribute('value')||'';
    Object.defineProperty(select,'value',{configurable:true,get:()=>value,set:v=>value=String(v)});
  }
  const navigator = {permissions:{query:async()=>({state:'granted'})},geolocation:{getCurrentPosition(success,error,options){requests.push({success,error,options});}}};
  const window = {navigator,addEventListener:dom.addEventListener.bind(dom),dispatchEvent:dom.dispatchEvent.bind(dom)};
  const storage = {getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const context=vm.createContext({window,document,navigator,localStorage:storage,Date:Clock,Intl,console,crypto:{randomUUID},
    setTimeout(fn){const id=++counter;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    aviso:text=>warnings.push(text),confirmar:async()=>true,baixar(){},abrir(id){for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==id;document.dispatchEvent(new dom.CustomEvent('rodagem:route',{detail:{panel:id}}));}});
  vm.runInContext(core,context);vm.runInContext(source,context);
  return {api:window.RodagemGPS,requests,timers,warnings,store,document,navigator,
    journey:{id:randomUUID(),estado:'running'},
    advance(ms){now+=ms;},
    next(){const first=timers.entries().next().value;if(first){timers.delete(first[0]);first[1]();}},
    fix(lat=-23.55,lng=-46.63){const request=requests.shift();assert.ok(request,'GPS request exists');request.success({timestamp:now,coords:{latitude:lat,longitude:lng,accuracy:5,speed:5}});},
    deny(){const request=requests.shift();assert.ok(request);request.error({code:1});},
    event:(name)=>new dom.Event(name,{bubbles:true})};
}
