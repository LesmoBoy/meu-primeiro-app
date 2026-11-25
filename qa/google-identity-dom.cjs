/* Simulated DOM lifecycle checks. No rendering, network or real credentials. */
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const CID='421909197196-td982abtadcdh70hesfc3ucp2fe0qqii.apps.googleusercontent.com';
const NONCE='a'.repeat(64),OTHER='b'.repeat(64);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let passed=0;
(async()=>{
  const {parseHTML}=await import('linkedom');const source=await fs.readFile(path.join(root,'google-identity.js'),'utf8');
  function boot(){
    const {document,window:domWindow}=parseHTML('<html><head></head><body><button id="start">Google</button></body></html>');
    const events=new Map(),timers=new Map(),scripts=[],configs=[],renders=[];let timerId=0,focused=document.getElementById('start');
    Object.defineProperty(document,'activeElement',{get:()=>focused});
    const originalCreate=document.createElement.bind(document);
    document.createElement=tag=>{
      const element=originalCreate(tag);element.focus=()=>{focused=element;};element.getBoundingClientRect=()=>({width:300});
      if(tag==='dialog'){element.open=false;element.showModal=()=>{element.open=true;};element.close=()=>{element.open=false;element.dispatchEvent(new domWindow.Event('close'));};}
      return element;
    };
    focused.focus=()=>{focused=document.getElementById('start');};
    const append=document.head.append.bind(document.head);
    document.head.append=(...nodes)=>{for(const node of nodes)if(node.tagName==='SCRIPT')scripts.push(node);append(...nodes);};
    const window={document,navigator:{onLine:true},innerWidth:390,atob:text=>Buffer.from(text,'base64').toString('binary'),
      HTMLDialogElement:{prototype:{showModal(){}}},
      setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
      addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},
      removeEventListener(type,fn){events.get(type)?.delete(fn);}};
    const context=vm.createContext({window});vm.runInContext(source,context);
    const good=()=>({initialize:c=>configs.push(c),renderButton:(host,opts)=>renders.push(opts)});
    const load=()=>{window.google={accounts:{id:good()}};scripts.at(-1).dispatchEvent(new domWindow.Event('load'));};
    const response=(cfg,overrides={})=>{
      const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
      const token=encode({alg:'FAKE_FOR_TEST_ONLY'})+'.'+encode({aud:cfg.client_id,nonce:cfg.nonce,...overrides.claims})+'.fake_signature';
      return {credential:token,clientId:cfg.client_id,...overrides.response};
    };
    const request=(overrides={})=>window.RodagemGoogleIdentity.requestCredential({clientId:CID,nonce:NONCE,...overrides});
    return{document,window,timers,scripts,configs,renders,request,load,response,api:good,
      cancel:()=>document.querySelector('dialog').dispatchEvent(new domWindow.Event('cancel',{cancelable:true})),
      failLoad:()=>scripts.at(-1).dispatchEvent(new domWindow.Event('error')),
      offline:()=>{for(const fn of events.get('offline')||[])fn();},
      tick:ms=>{for(const [id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}},
      clean:()=>{assert.equal(document.querySelector('dialog'),null);assert.equal(document.querySelector('script'),null);assert.equal(timers.size,0);assert.equal(events.get('offline')?.size||0,0);assert.equal(document.activeElement.id,'start');}
    };
  }
  async function check(name,fn){await fn();passed++;console.log('PASS',name);}
  await check('bootstrap and invalid arguments do not create auth DOM or load SDK',async()=>{
    const b=boot();assert.equal(b.scripts.length,0);assert.equal(b.document.querySelector('dialog'),null);
    await assert.rejects(b.request({clientId:'other.apps.googleusercontent.com'}),e=>e.code==='CONFIGURATION');
    await assert.rejects(b.request({nonce:'bad'}),e=>e.code==='INVALID_ARGUMENT');assert.equal(b.scripts.length,0);
  });
  await check('official API receives hashed nonce and one valid response resolves once',async()=>{
    const b=boot();let settlements=0;const p=b.request().then(value=>{settlements++;assert.ok(typeof value==='string');});
    assert.equal(b.scripts.length,1);b.load();assert.equal(b.configs.length,1);assert.equal(b.configs[0].nonce,NONCE);
    assert.equal(b.configs[0].auto_select,false);assert.equal(b.renders[0].locale,'pt-BR');
    b.configs[0].callback(b.response(b.configs[0]));await p;b.configs[0].callback(b.response(b.configs[0]));await flush();assert.equal(settlements,1);b.clean();
  });
  await check('concurrent request rejects BUSY without replacing the active attempt',async()=>{
    const b=boot();const p=b.request();await assert.rejects(b.request(),e=>e.code==='BUSY');b.load();b.configs[0].callback(b.response(b.configs[0]));await p;b.clean();
  });
  await check('cancel restores focus, clears loading timers and ignores its late load',async()=>{
    const b=boot();const p=b.request();b.cancel();await assert.rejects(p,e=>e.code==='CANCELLED');b.load();assert.equal(b.configs.length,0);b.clean();
  });
  await check('old callback and old nonce cannot consume a later attempt',async()=>{
    const b=boot();const first=b.request();b.load();const old=b.configs[0];b.cancel();await assert.rejects(first,e=>e.code==='CANCELLED');
    let done=false;const second=b.request({nonce:OTHER}).then(()=>{done=true;});const latest=b.configs[1];
    old.callback(b.response(old));latest.callback(b.response(old));await flush();assert.equal(done,false);
    latest.callback(b.response(latest));await second;assert.equal(done,true);b.clean();
  });
  await check('malformed response, mismatched client and audience are rejected safely',async()=>{
    for(const overrides of [{response:{credential:''}},{response:{clientId:'mismatch'}},{response:{client_id:'mismatch'}},{claims:{aud:'mismatch'}}]){
      const b=boot();const p=b.request();b.load();b.configs[0].callback(b.response(b.configs[0],overrides));await assert.rejects(p,e=>['INVALID_RESPONSE','CLIENT_MISMATCH'].includes(e.code));b.clean();
    }
  });
  await check('offline requests do not load SDK and connection loss cleans pending attempt',async()=>{
    const b=boot();b.window.navigator.onLine=false;await assert.rejects(b.request(),e=>e.code==='OFFLINE');assert.equal(b.scripts.length,0);
    b.window.navigator.onLine=true;const p=b.request();b.offline();await assert.rejects(p,e=>e.code==='OFFLINE');b.clean();
  });
  await check('SDK loading failure and retry create an independent successful attempt',async()=>{
    const b=boot();const failed=b.request();b.failLoad();await assert.rejects(failed,e=>e.code==='SDK_LOAD');b.clean();
    const retry=b.request();b.load();b.configs[0].callback(b.response(b.configs[0]));await retry;b.clean();
  });
  await check('bounded load and request timeouts release state and timers',async()=>{
    const b=boot();const failed=b.request();b.tick(12000);await assert.rejects(failed,e=>e.code==='SDK_TIMEOUT');b.clean();
    const timeout=b.request();b.load();b.tick(180000);await assert.rejects(timeout,e=>e.code==='TIMEOUT');b.clean();
    const retry=b.request();b.configs.at(-1).callback(b.response(b.configs.at(-1)));await retry;b.clean();
  });
  console.log('PASS '+passed+' Google Identity lifecycle suites (simulated DOM, no browser/network/auth).');
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
