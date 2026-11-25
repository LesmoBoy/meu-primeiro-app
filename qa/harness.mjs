// DOM integration tests. These simulate browser APIs; they do not validate
// rendering, installation, Service Worker execution, or actual offline access.
import {parseHTML} from 'linkedom';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const appCode = await fs.readFile(path.join(root, 'app.js'), 'utf8');
const profilesCode = await fs.readFile(path.join(root, 'profiles-core.js'), 'utf8');
const experienceCode = await fs.readFile(path.join(root, 'experience.js'), 'utf8');
const vehiclesCode = await fs.readFile(path.join(root, 'vehicle-catalog.js'), 'utf8');
export const recordKey = 'minha-rodagem-v1';
export const legacy = {id:'legacy',tipo:'dia',data:'2026-11-13',ganhos:18000,combustivel:2500,outros:500,entregas:20,horas:600,km:12000};
export const flush = async () => { for(let i=0;i<5;i++) await new Promise(resolve => setImmediate(resolve)); };

export function boot(store = new Map(), now = Date.parse('2026-11-13T12:00:00Z')) {
  const {window:domWindow,document} = parseHTML(html);
  const window={Event:domWindow.Event,CustomEvent:domWindow.CustomEvent,
    scrollTo(){},
    addEventListener:domWindow.addEventListener.bind(domWindow),
    removeEventListener:domWindow.removeEventListener.bind(domWindow),
    dispatchEvent:domWindow.dispatchEvent.bind(domWindow)};
  const intervals = [];
  const blobs = new Map();
  const localStorage = {
    getItem:key => store.has(key) ? store.get(key) : null,
    setItem:(key,value) => store.set(key,String(value)),
    removeItem:key => store.delete(key),
    clear:() => store.clear()
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class ObjectURL extends URL {
    static createObjectURL(blob) { const id='blob:test-'+blobs.size; blobs.set(id,blob); return id; }
    static revokeObjectURL() {}
  }
  for(const select of document.querySelectorAll('select')) {
    Object.defineProperty(select,'value',{
      configurable:true,
      get() { return (this.querySelector('option[selected]') || this.querySelector('option'))?.getAttribute('value') || ''; },
      set(value) { for(const option of this.querySelectorAll('option')) { if(option.getAttribute('value')===String(value)) option.setAttribute('selected',''); else option.removeAttribute('selected'); } }
    });
  }
  for(const button of document.querySelectorAll('button')) {
    Object.defineProperty(button,'value',{configurable:true,get(){return this.getAttribute('value')||'';},set(value){this.setAttribute('value',String(value));}});
  }
  for(const form of document.querySelectorAll('form')) {
    Object.defineProperty(form,'elements',{get() {
      const fields=[...this.querySelectorAll('[name]')];
      for(const field of fields) fields[field.name || field.getAttribute('name')]=field;
      return fields;
    }});
    form.reset = () => {
      for(const field of form.querySelectorAll('input')) field.value=field.getAttribute('data-default')||'';
      for(const field of form.querySelectorAll('select')) field.value=field.querySelector('option')?.getAttribute('value')||'';
    };
  }
  for(const element of document.querySelectorAll('*')) {
    element.focus=() => {};
    element.scrollIntoView=() => {};
  }
  const dialog=document.getElementById('confirmacao');
  dialog.open=false;
  dialog.showModal=()=>{dialog.open=true;dialog.setAttribute('open','');};
  dialog.close=value=>{dialog.returnValue=value||'';dialog.open=false;dialog.removeAttribute('open');dialog.dispatchEvent(new window.Event('close'));};
  const location={hash:'#inicio',protocol:'https:',pathname:'/meu-primeiro-app/',href:'https://example.test/meu-primeiro-app/#inicio'};
  const history={pushState(_a,_b,url){location.hash=String(url).split('#')[1] ? '#'+String(url).split('#')[1] : '';},replaceState(_a,_b,url){this.pushState(_a,_b,url);}};
  const navigator={onLine:true};
  Object.assign(window,{localStorage,location,history,navigator,document});
  const context=vm.createContext({document,window,location,history,navigator,localStorage,
    Event:window.Event,CustomEvent:window.CustomEvent,Date:ClockDate,Intl,Math,Number,String,Array,Map,Set,JSON,Promise,Error,Boolean,Object,RegExp,
    console,URL:ObjectURL,Blob,crypto:{randomUUID},matchMedia:()=>({matches:true}),setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){}});
  vm.runInContext(profilesCode,context,{filename:'profiles-core.js'});
  vm.runInContext(appCode,context,{filename:'app.js'});
  vm.runInContext(vehiclesCode,context,{filename:'vehicle-catalog.js'});
  vm.runInContext(experienceCode,context,{filename:'experience.js'});
  const get=id=>document.getElementById(id);
  const evaluate=code=>vm.runInContext(code,context);
  const event=(type,extra={})=>Object.assign(new window.Event(type,{bubbles:true,cancelable:true}),extra);
  const fill=(formId,values)=>{
    for(const [name,value] of Object.entries(values)) {
      const field=get(formId).elements[name];
      assert.ok(field,`${formId}.${name} exists`);
      field.value=String(value);
      field.dispatchEvent(event('input'));
      if(field.tagName==='SELECT') field.dispatchEvent(event('change'));
    }
  };
  const click=async selector=>{
    const target=document.querySelector(selector);
    assert.ok(target,`Click target ${selector} exists`);
    target.dispatchEvent(event('click'));
    await flush();
  };
  const submit=async (id,value='salvar')=>{
    const form=get(id);
    const button=form.querySelector(`button[value="${value}"]`)||form.querySelector('button[type="submit"]');
    form.dispatchEvent(event('submit',{submitter:button}));
    await flush();
  };
  return {store,window,document,get,context,evaluate,event,fill,click,submit,blobs,
    records:()=>JSON.parse(localStorage.getItem(recordKey)||'{"registros":[]}').registros,
    confirm:async(value=true)=>{assert.ok(dialog.open,'confirmation is open');dialog.close(value?'confirmar':'cancelar');await flush();},
    advance:async ms=>{now+=ms;for(const fn of intervals)fn();await flush();},
    now:()=>now,
    route:panel=>{evaluate(`abrir(${JSON.stringify(panel)})`);assert.equal(get(panel).hidden,false);}
  };
}

