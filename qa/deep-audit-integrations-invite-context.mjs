import {boot,flush} from './harness.mjs';
import vm from 'node:vm';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const a=boot();const A='11111111-1111-4111-8111-111111111111';let account=A,auth;
a.window.crypto=a.context.crypto;const workspaces=new Map();
a.window.RodagemCloud={configured:()=>true,verifySession:async()=>({user:{id:account,email:'owner@example.test'}}),onAuth:fn=>{auth=fn;return()=>{};},call:async(name,args)=>{
 if(name==='business_list_companies')return[...workspaces.values()].map(w=>({...w.company,role:'owner'}));
 if(name==='business_load_workspace')return workspaces.get(args.company_id);
 if(name==='business_invite_member')return{token:'cd'.repeat(32),expiresAt:'2026-11-30T00:00:00.000Z',member:{id:'55555555-5555-4555-8555-555555555555',companyId:args.company_id,userId:null,name:args.invite_name,email:args.invite_email,role:args.invite_role,status:'invited',revision:1,archivedAt:null}};
 throw Error(name);
}};
for(const file of ['business-core.js','business-client.js'])vm.runInContext(await fs.readFile(new URL('../'+file,import.meta.url),'utf8'),a.context);
const ra=a.window.RodagemBusiness,first=await ra.createCompany('A'),second=await ra.createCompany('B');for(const w of[first,second]){w.members[0].userId=A;w.membership.userId=A;workspaces.set(w.company.id,w);}
await ra.selectMode('cloud');await ra.loadCompany(first.company.id);
const create=a.document.createElement.bind(a.document);a.document.createElement=tag=>{const node=create(tag);if(tag==='form')Object.defineProperty(node,'elements',{get(){const fields=[...node.querySelectorAll('[name]')];fields.namedItem=name=>fields.find(field=>field.name===name);return fields;}});if(tag==='select')Object.defineProperty(node,'value',{configurable:true,get(){const options=[...node.querySelectorAll('option')];return(options.find(option=>option.selected)||options[0])?.value||'';},set(value){for(const option of node.querySelectorAll('option'))option.selected=option.value===String(value);}});return node;};
vm.runInContext(await fs.readFile(new URL('../business-ui.js',import.meta.url),'utf8'),a.context);await flush();
async function members(){a.get('business-app').querySelector('[data-business-tab="members"]').dispatchEvent(a.event('click'));await flush();}
await members();const form=a.get('business-member-form');form.elements.namedItem('name').value='Invitee';form.elements.namedItem('email').value='invitee@example.test';form.elements.namedItem('role').value='driver';form.dispatchEvent(a.event('submit'));await flush();
assert.ok(a.get('business-app').querySelector('input[aria-label="Link do convite"]'));
a.get('business-company').value=second.company.id;a.get('business-company').dispatchEvent(a.event('change'));await flush();await members();
const leaked=a.get('business-app').querySelector('input[aria-label="Link do convite"]');console.log('INVITE_CONTEXT_RESULT',JSON.stringify({newCompanyIsB:ra.getCurrentWorkspace().company.id===second.company.id,oldInviteVisible:!!leaked}));
assert.equal(leaked,null);console.log('PASS a link generated in company A is not displayed after selecting company B');
async function invite(){const f=a.get('business-member-form');f.elements.namedItem('name').value='Other invitee';f.elements.namedItem('email').value='other@example.test';f.elements.namedItem('role').value='driver';f.dispatchEvent(a.event('submit'));await flush();assert.ok(a.get('business-app').querySelector('input[aria-label="Link do convite"]'));}
await invite();account='66666666-6666-4666-8666-666666666666';auth('SIGNED_IN',{user:{id:account}});for(const w of workspaces.values()){w.members[0].userId=account;w.membership.userId=account;}
await ra.selectMode('cloud');await ra.loadCompany(second.company.id);await a.window.RodagemBusinessUI.refresh();await members();assert.equal(a.get('business-app').querySelector('input[aria-label="Link do convite"]'),null);console.log('PASS a link generated for the prior account is not displayed after switching accounts');
await invite();await ra.selectMode('local');await ra.selectMode('cloud');await ra.loadCompany(second.company.id);await a.window.RodagemBusinessUI.refresh();await members();assert.equal(a.get('business-app').querySelector('input[aria-label="Link do convite"]'),null);console.log('PASS mode changes discard cached invitation links while newly generated links remain visible in their current context');
