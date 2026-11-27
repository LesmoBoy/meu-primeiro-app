#!/usr/bin/env node
'use strict';
// Real local GoTrue + PostgREST HTTP. Synthetic Google identities are NOT OIDC proof.
// Never accepts a remote DB/project, and never prints credentials or raw service errors.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {isDeepStrictEqual} = require('node:util');
const {spawn, spawnSync} = require('node:child_process');
const {randomBytes, randomUUID, createHmac, webcrypto, createHash} = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const PROJECT = 'https://auth-http-hml.supabase.co';
const STORAGE_KEY = 'minha-rodagem-supabase-auth-v1';
const IMAGES = Object.freeze({
  postgres: 'postgres:17-alpine@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7',
  auth: 'supabase/gotrue:v2.199.0@sha256:85c8323c05854ba911a8b2968c513e7e1b4cf7ebf75a30124ae923e7127cf01f',
  rest: 'postgrest/postgrest:v14.18@sha256:c7cd7e265a85b05248abf53f4473fcec7e327c282d0bd0cf60f1551996d09fcf',
  transport: 'python:3.13-alpine@sha256:9ef1a599f863231c3d91e941389bfdc4a2d6070557243d54df1a4e57015b960e'
});
const PREFIX = 'rodagem-auth-http-' + randomBytes(6).toString('hex');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rodagem-auth-http-'));
fs.chmodSync(TEMP, 0o700);
const secret = randomBytes(48).toString('hex');
const databasePassword = randomBytes(32).toString('hex');
const zero = '00000000-0000-0000-0000-000000000000';
const A = randomUUID(), B = randomUUID();
const snapshot = {version: 1, settings: null, records: {versao: 1, registros: [{id:'hml-auth-day',tipo:'dia',data:'2026-11-26',ganhos:12345,combustivel:2300,outros:500,entregas:12,horas:800,km:9000}]}, routes: [], gpsPreferences: {enabled: false, mode: 'eco'}, journey: null};
const clients = [];
const resources = [];
const results = [];
const httpEvidence = [];
const residuals = [];
let authBase, restBase, currentTest = 'setup', cleaned = false;
function requireTrue(value, code) { if (!value) throw Object.assign(new Error(code), {safeCode: code}); }
function docker(args, input) {
  const result = spawnSync('docker', args, {input, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024});
  requireTrue(result.status === 0, 'DOCKER_COMMAND_FAILED');
  return result.stdout.trim();
}
function sql(statement) { return docker(['exec', '-i', PREFIX + '-db', 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], statement); }
function envFile(name, entries) {
  const filename = path.join(TEMP, name + '.env');
  fs.writeFileSync(filename, Object.entries(entries).map(([k, v]) => k + '=' + v).join('\n') + '\n', {mode: 0o600});
  return filename;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function jwt(payload, signingSecret = secret) {
  const body = [Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url')].join('.');
  return body + '.' + createHmac('sha256', signingSecret).update(body).digest('base64url');
}
const anonKey = jwt({role: 'anon', iss: PROJECT + '/auth/v1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7200});
function fixture(id, options = {}) {
  const sessionId = randomUUID();
  // GoTrue v2.199.0 accepts its legacy lowercase 12-character refresh token format.
  const refreshToken = randomBytes(6).toString('hex');
  sql(`insert into auth.sessions(id,user_id,aal,created_at,updated_at,refreshed_at) values ('${sessionId}','${id}','aal1',now(),now(),now());
    insert into auth.refresh_tokens(instance_id,token,user_id,revoked,session_id,created_at,updated_at) values ('${zero}','${refreshToken}','${id}',false,'${sessionId}',now(),now());`);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (options.expired ? -120 : 3600);
  const email = id === A ? 'a@synthetic.example.test' : 'b@synthetic.example.test';
  const accessToken = jwt({iss: PROJECT + '/auth/v1', sub: id, aud: 'authenticated', role: 'authenticated', email, iat: now - 180, exp: expiresAt, session_id: sessionId, aal: 'aal1', amr: [{method: 'oauth', timestamp: now - 180}], app_metadata: {provider: 'google', providers: ['google']}, user_metadata: {name: 'Synthetic Google account'}, is_anonymous: false});
  return {user: {id, email, role: 'authenticated', aud: 'authenticated', app_metadata: {provider: 'google', providers: ['google']}, user_metadata: {name: 'Synthetic Google account'}}, access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer', expires_in: options.expired ? 0 : 3600, expires_at: expiresAt, sessionId};
}
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const client of clients) { try { client.auth.stopAutoRefresh(); } catch {} }
  for (const name of resources.reverse()) spawnSync('docker', ['rm', '-f', name], {stdio: 'ignore', timeout: 15000});
  fs.rmSync(TEMP, {recursive: true, force: true});
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.exit(130); });
process.once('exit', cleanup);
// Docker networking in some managed runtimes cannot route an --internal bridge.
// All services instead share the DB's network=none namespace and speak loopback.
// Python only transports HTTP bytes; GoTrue, PostgREST and the vendored SDK are real.
const HTTP_TRANSPORT = `import sys,json,base64,http.client
q=json.load(sys.stdin)
c=http.client.HTTPConnection('127.0.0.1',q['port'],timeout=10)
try:
 c.request(q['method'],q['path'],body=base64.b64decode(q['body']) if q['body'] is not None else None,headers=q['headers'])
 r=c.getresponse()
 print('STATUS_'+str(r.status),file=sys.stderr,flush=True)
 print(json.dumps({'status':r.status,'headers':r.getheaders(),'body':base64.b64encode(r.read()).decode()}))
except Exception as e:
 print(type(e).__name__,file=sys.stderr,flush=True)
 sys.exit(1)
finally:
 c.close()
`;
async function localHttpFetch(input, init = {}) {
  const url = new URL(input);
  requireTrue(url.hostname === '127.0.0.1' && ['9999', '3000'].includes(url.port), 'LOCAL_LOOPBACK_REQUIRED');
  const request = {port: Number(url.port), method: init.method || 'GET', path: url.pathname + url.search, headers: Object.fromEntries(new Headers(init.headers)), body: init.body == null ? null : Buffer.from(init.body).toString('base64')};
  const raw = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', PREFIX + '-transport', 'python', '-c', HTTP_TRANSPORT], {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', diagnostic = '';
    const abort = () => child.kill('SIGKILL');
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort, {once: true});
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { diagnostic += chunk; });
    child.on('error', () => reject(Object.assign(new Error('HTTP_TRANSPORT_FAILED'), {safeCode: 'HTTP_TRANSPORT_FAILED'})));
    child.on('close', code => {
      init.signal?.removeEventListener('abort', abort);
      if (code === 0) resolve(stdout);
      else {
        const safe = diagnostic.split('\n').filter(line => /^(STATUS_[0-9]{3}|[A-Za-z]{1,30}Error)$/.test(line)).join('_');
        reject(Object.assign(new Error('HTTP_TRANSPORT_FAILED'), {safeCode: 'HTTP_TRANSPORT_FAILED' + (safe ? '_' + safe : '')}));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
  const reply = JSON.parse(raw);
  return new Response([204, 205, 304].includes(reply.status) ? null : Buffer.from(reply.body, 'base64'), {status: reply.status, headers: reply.headers});
}
async function ready(url) {
  for (let n = 0; n < 40; n++) {
    try { if ((await localHttpFetch(url, {signal: AbortSignal.timeout(1000)})).ok) return; } catch {}
    await delay(250);
  }
  throw Object.assign(new Error('HTTP_SERVICE_NOT_READY'), {safeCode: 'HTTP_SERVICE_NOT_READY'});
}
function runContainer(name, image, environment, command = []) {
  resources.push(name);
  const network = name === PREFIX + '-db' ? 'none' : 'container:' + PREFIX + '-db';
  docker(['run', '-d', '--rm', '--log-driver', 'none', '--network', network, '--name', name, '--env-file', envFile(name, environment), image, ...command]);
}
async function start() {
  docker(['version', '--format', '{{.Server.Version}}']);
  // Pull once per pinned image, never retry a broken daemon or contact any Supabase project.
  for (const image of Object.values(IMAGES)) {
    const cached = spawnSync('docker', ['image', 'inspect', image], {stdio: 'ignore', timeout: 10000});
    if (cached.status !== 0) docker(['pull', image]);
  }
  runContainer(PREFIX + '-db', IMAGES.postgres, {POSTGRES_PASSWORD: databasePassword, POSTGRES_INITDB_ARGS: '--auth-host=scram-sha-256'});
  let readyDB = false;
  for (let n = 0; n < 40; n++) {
    const probe = spawnSync('docker', ['exec', PREFIX + '-db', 'pg_isready', '-U', 'postgres'], {stdio: 'ignore', timeout: 2000});
    if (probe.status === 0) { readyDB = true; break; }
    await delay(250);
  }
  requireTrue(readyDB, 'POSTGRES_NOT_READY');
  runContainer(PREFIX + '-transport', IMAGES.transport, {}, ['sleep', '7200']);
  sql(`create schema if not exists auth; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit password '${databasePassword}'; grant anon,authenticated to authenticator;
    grant usage on schema public to anon,authenticated;`);
  runContainer(PREFIX + '-auth', IMAGES.auth, {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: 9999,
    API_EXTERNAL_URL: PROJECT + '/auth/v1', GOTRUE_SITE_URL: PROJECT,
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://postgres:${databasePassword}@127.0.0.1:5432/postgres?sslmode=disable&search_path=auth`,
    DB_NAMESPACE: 'auth', GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: 3600,
    GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_DISABLE_SIGNUP: true, GOTRUE_EXTERNAL_EMAIL_ENABLED: false, GOTRUE_EXTERNAL_PHONE_ENABLED: false,
    GOTRUE_EXTERNAL_GOOGLE_ENABLED: false, GOTRUE_EXTERNAL_FACEBOOK_ENABLED: false,
    GOTRUE_LOG_LEVEL: 'error', GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: true,
    GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 0
  });
  authBase = 'http://127.0.0.1:9999';
  await ready(authBase + '/health');
  // PostgREST v14 passes all claims as JSON. Restore official compatible helpers after Auth migrations.
  sql(`create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
    insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token)
    values ('${zero}','${A}','authenticated','authenticated','a@synthetic.example.test',now(),'{"provider":"google","providers":["google"]}','{"name":"Synthetic Google A","access_token":"redacted-fixture-field"}',false,now(),now(),'','','','','','','',''),
      ('${zero}','${B}','authenticated','authenticated','b@synthetic.example.test',now(),'{"provider":"google","providers":["google"]}','{"name":"Synthetic Google B"}',false,now(),now(),'','','','','','','','');
    insert into auth.identities(id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    values ('${randomUUID()}','synthetic-google-a','${A}','{"sub":"synthetic-google-a","email":"a@synthetic.example.test","email_verified":true}','google',now(),now(),now()),
      ('${randomUUID()}','synthetic-google-b','${B}','{"sub":"synthetic-google-b","email":"b@synthetic.example.test","email_verified":true}','google',now(),now(),now());`);
  sql(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
  sql(fs.readFileSync(path.join(ROOT, 'supabase/enterprise.sql'), 'utf8'));
  runContainer(PREFIX + '-rest', IMAGES.rest, {
    PGRST_DB_URI: `postgres://authenticator:${databasePassword}@127.0.0.1:5432/postgres`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
    PGRST_JWT_AUD: 'authenticated', PGRST_SERVER_PORT: 3000, PGRST_LOG_LEVEL: 'crit'
  });
  restBase = 'http://127.0.0.1:3000';
  await ready(restBase + '/');
}
function boot(initial, options = {}) {
  const storage = new Map();
  if (initial) storage.set(STORAGE_KEY, JSON.stringify(initial));
  const traffic = [];
  let client, profile = 'local-profile-a', hold;
  const localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)};
  const routedFetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    requireTrue(url.origin === PROJECT, 'REMOTE_NETWORK_BLOCKED');
    const auth = url.pathname.startsWith('/auth/v1/');
    const rest = url.pathname.startsWith('/rest/v1/');
    requireTrue(auth || rest, 'UNEXPECTED_HTTP_ROUTE');
    const route = url.pathname.replace(auth ? '/auth/v1' : '/rest/v1', '');
    let response;
    try { response = await localHttpFetch((auth ? authBase : restBase) + route + url.search, init); }
    catch (error) {
      const code = typeof error.safeCode === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(error.safeCode) ? error.safeCode : 'LOCAL_TRANSPORT_FAILURE';
      httpEvidence.push({route, method:init?.method || 'GET', status:null,code}); throw error;
    }
    let code = null;
    if (!response.ok) {
      try { const body = await response.clone().json(); if (/^[A-Za-z0-9_]{1,40}$/.test(body.code || '')) code = body.code; } catch {}
    }
    const event = {route, method: init?.method || 'GET', status: response.status, code};
    traffic.push(event); httpEvidence.push(event);
    if (hold && route === '/user') { const waiting = hold; hold = null; waiting.seen(); await waiting.promise; }
    return response;
  };
  const sandbox = {console: {log() {}, warn() {}, error() {}, debug() {}}, URL, TextEncoder, TextDecoder, AbortController, Headers, Request, Response,
    fetch: routedFetch, crypto: webcrypto, WebSocket, atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout, clearTimeout, setInterval: (...args) => { const timer = setInterval(...args); timer.unref(); return timer; }, clearInterval,
    queueMicrotask, localStorage, navigator: {}, document: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}}, addEventListener() {}, removeEventListener() {}};
  sandbox.window = sandbox;
  sandbox.location = {href: PROJECT + '/', hostname: new URL(PROJECT).hostname, protocol: 'https:', hash: '', search: ''};
  sandbox.RodagemProfiles = options.profiles || {current: () => ({id: profile}), assertCurrent() {}};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/supabase/supabase.js'), 'utf8'), context, {timeout: 5000});
  const realCreate = sandbox.supabase.createClient;
  // Capture the REAL SDK client only for session fixture installation and low-level RLS probes.
  sandbox.supabase = {createClient: (...args) => {
    try { client = realCreate(...args); clients.push(client); return client; }
    catch (error) { throw Object.assign(new Error('SDK_CONSTRUCTOR_FAILED'), {safeCode: 'SDK_CONSTRUCTOR_' + error.name}); }
  }};
  sandbox.RodagemCloudConfig = {url: PROJECT, publishableKey: anonKey, providers: ['google']};
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cloud-client.js'), 'utf8'), context, {timeout: 5000});
  return {api: sandbox.RodagemCloud, traffic, storage, get client() { return client; },
    switchProfile: () => { profile = 'local-profile-b'; },
    holdNextUser() { let release, seen; const promise = new Promise(resolve => { release = resolve; }); const arrived = new Promise(resolve => { seen = resolve; }); hold = {promise, seen}; return {release, arrived}; },
    async install(session) { await sandbox.RodagemCloud.getSession(); const result = await client.auth.setSession({access_token: session.access_token, refresh_token: session.refresh_token}); requireTrue(!result.error, 'SDK_SESSION_INSTALL_FAILED'); },
    cached() { const value = storage.get(STORAGE_KEY); return value ? JSON.parse(value) : null; }};
}
async function check(name, test) {
  currentTest = name;
  await test();
  results.push({test: name, passed: true});
  process.stdout.write('PASS ' + name + '\n');
}
async function rejectsCode(promise, accepted) {
  let error;
  try { await promise; } catch (cause) { error = cause; }
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(error.code) ? error.code : error ? 'UNCLASSIFIED' : 'NO_ERROR';
  requireTrue(error && accepted.includes(error.code), 'EXPECTED_PUBLIC_REJECTION_' + code);
}
function publicOnly(value) {
  const text = JSON.stringify(value);
  requireTrue(!text.includes('access_token') && !text.includes('refresh_token') && !text.includes(secret), 'PUBLIC_SESSION_LEAK');
}
async function directUser(token) { return localHttpFetch(authBase + '/user', {headers: token ? {Authorization: 'Bearer ' + token} : {}, signal: AbortSignal.timeout(5000)}); }
async function bootSync(session, rows) {
  const {boot:domBoot,flush} = await import('../harness.mjs');
  const store = new Map([['minha-rodagem-v1',JSON.stringify({versao:1,registros:rows})]]);
  const app = domBoot(store);
  const auth = boot(session,{profiles:app.window.RodagemProfiles});
  app.window.RodagemCloud = auth.api;
  app.window.RodagemCloudConfig = {url:PROJECT,providers:['google']};
  let confirmations = 0, reloads = 0;
  app.context.confirmar = async () => { confirmations++; return true; };
  app.context.location.reload = () => { reloads++; };
  vm.runInContext(fs.readFileSync(path.join(ROOT,'gps-core.js'),'utf8'),app.context);
  app.window.RodagemGeo = app.context.RodagemGeo;
  vm.runInContext(fs.readFileSync(path.join(ROOT,'backup-budget.js'),'utf8'),app.context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'cloud-sync.js'),'utf8'),app.context);
  await flush();
  await auth.api.getSession(); await flush();
  return {...app,auth,sync:app.window.RodagemSync,stats:()=>({confirmations,reloads})};
}
async function runCasProof() {
  await start();
  currentTest = 'controlled-cas-sqlstate-proof';
  const account = fixture(A);
  const beforeDefinition = sql("select pg_get_functiondef('public.rodagem_save_snapshot(uuid,bigint,jsonb)'::regprocedure)");
  const original = beforeDefinition.replaceAll("errcode = 'PT409'", "errcode = '40001'");
  requireTrue(original.includes("errcode = '40001'"), 'BASELINE_STATE_REQUIRED');
  sql(original);
  const body = revision => JSON.stringify({expected_user_id:A,expected_revision:revision,snapshot});
  const request = (revision, timeout) => localHttpFetch(restBase + '/rpc/rodagem_save_snapshot', {method:'POST',headers:{Authorization:'Bearer ' + account.access_token,'Content-Type':'application/json'},body:body(revision),signal:AbortSignal.timeout(timeout)});
  requireTrue((await request(0,5000)).status === 200, 'PROOF_SEED_FAILED');
  const stored = () => sql(`select revision || ':' || md5(payload::text) from public.rodagem_sync where user_id='${A}'`);
  const before = stored();
  let baselineFailed = false;
  const baselineStarted = Date.now();
  try { await request(0,2500); } catch { baselineFailed = true; }
  const baselineDurationMs = Date.now()-baselineStarted;
  requireTrue(baselineFailed, 'BASELINE_MUST_NOT_RETURN_CONFLICT');
  // Stop ONLY disposable authenticator connections whose request was aborted;
  // the Hasql serialization retry loop otherwise keeps consuming the local DB.
  sql("select pg_terminate_backend(pid) from pg_stat_activity where usename='authenticator' and pid<>pg_backend_pid()");
  requireTrue(stored() === before, 'BASELINE_CHANGED_BACKUP');
  const patched = original.replaceAll("errcode = '40001'", "errcode = 'PT409'");
  sql(patched);
  await ready(restBase + '/');
  const patchedStarted = Date.now();
  const reply = await request(0,5000), response = await reply.json();
  const patchedDurationMs = Date.now()-patchedStarted;
  requireTrue(reply.status === 409 && response.code === 'PT409' && patchedDurationMs < 5000, 'PATCHED_HTTP_CONFLICT_REQUIRED');
  requireTrue(stored() === before, 'PATCHED_CHANGED_BACKUP');
  // Restore the exact function definition from before the experiment.
  sql(beforeDefinition);
  requireTrue(sql("select pg_get_functiondef('public.rodagem_save_snapshot(uuid,bigint,jsonb)'::regprocedure)") === beforeDefinition, 'FUNCTION_RESTORE_FAILED');
  const loaded = await localHttpFetch(restBase + '/rpc/rodagem_load_snapshot', {method:'POST',headers:{Authorization:'Bearer ' + account.access_token,'Content-Type':'application/json'},body:JSON.stringify({expected_user_id:A}),signal:AbortSignal.timeout(5000)});
  const restored = await loaded.json();
  requireTrue(loaded.status === 200 && restored.revision === 1 && isDeepStrictEqual(restored.payload,snapshot), 'VALID_BACKUP_NOT_RESTORED');
  const [revision,payloadMd5] = before.split(':');
  const sha = value => createHash('sha256').update(value).digest('hex');
  const report = {suite:'v323-cas-http-controlled-proof',timestamp:new Date().toISOString(),classification:'authenticated-local-real-http-synthetic',
    productionMutation:false,syntheticOnly:true,googleOidcTested:false,images:IMAGES,
    baseline:{sqlstate:'40001',timeoutMs:2500,durationMs:baselineDurationMs,noHTTPConflictReturned:baselineFailed},
    patched:{sqlstate:'PT409',httpStatus:reply.status,responseCode:response.code,durationMs:patchedDurationMs},
    preserved:{beforeRevision:Number(revision),afterRevision:restored.revision,beforePayloadMd5:payloadMd5,afterPayloadMd5:stored().split(':')[1],syntheticRecordCount:restored.payload.records.registros.length,originalFunctionRestored:true},
    definitionSha256:{original:sha(beforeDefinition),baseline:sha(original),patched:sha(patched)},
    references:['https://github.com/PostgREST/postgrest/blob/v14.18/src/PostgREST/MainTx.hs#L101','https://github.com/nikita-volkov/hasql-transaction/blob/1.1.0.1/library/Hasql/Transaction/Private/Sessions.hs'],
    credentialsOrTokensIncluded:false};
  fs.writeFileSync(path.join(ROOT,'qa/v323/auth-http-cas-proof.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report)+'\n');
}
async function run() {
  fs.rmSync(path.join(ROOT,'qa/v323/auth-http-report.json'),{force:true});
  await start();
  const first = fixture(A), other = fixture(B);
  const a = boot(first), b = boot(other);
  await check('local-only-stack-and-providers-disabled', async () => {
    const settings = await (await localHttpFetch(authBase + '/settings')).json();
    requireTrue(settings.external?.google === false && settings.external?.facebook === false && settings.external?.email === false && settings.external?.phone === false, 'PROVIDERS_MUST_BE_DISABLED');
    requireTrue(docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', PREFIX + '-db']) === 'none', 'ISOLATED_NETWORK_REQUIRED');
    for (const name of ['auth', 'rest', 'transport']) requireTrue(docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', PREFIX + '-' + name]).startsWith('container:'), 'SHARED_LOOPBACK_REQUIRED');
  });
  await check('auth-user-rejects-missing-forged-and-expired-bearers', async () => {
    const expired = fixture(A, {expired: true});
    const wrong = jwt({sub: A, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600}, randomBytes(48).toString('hex'));
    for (const token of [null, wrong, expired.access_token]) requireTrue([401, 403].includes((await directUser(token)).status), 'INVALID_BEARER_ACCEPTED');
  });
  await check('real-client-verifySession-uses-real-sdk-and-authoritative-http-user', async () => {
    try { await a.api.getSession(); } catch {}
    requireTrue(a.client, 'REAL_SDK_CLIENT_REQUIRED');
    const cachedReply = await a.client.auth.getSession();
    requireTrue(!cachedReply.error, 'SDK_GET_SESSION_' + (cachedReply.error?.name || 'FAILED'));
    const userReply = await a.client.auth.getUser();
    requireTrue(!userReply.error, 'SDK_GET_USER_' + (userReply.error?.name || 'FAILED') + '_' + (userReply.error?.status || 0));
    const value = await a.api.verifySession(A);
    requireTrue(value.user.id === A && value.user.app_metadata.provider === 'google' && value.user.user_metadata.name === 'Synthetic Google A', 'AUTHORITATIVE_GOOGLE_FIXTURE_REQUIRED');
    publicOnly(value);
    requireTrue(a.traffic.some(row => row.route === '/user' && row.status === 200), 'GET_USER_HTTP_REQUIRED');
    requireTrue((await b.api.verifySession(B)).user.id === B, 'SECOND_ACCOUNT_REQUIRED');
  });
  await check('cached-account-forgery-fails-closed', async () => {
    const stored = {...first, user: {...first.user, id: B}};
    const forged = boot(stored);
    await rejectsCode(forged.api.verifySession(B), ['SESSION_CHANGED']);
    requireTrue(forged.traffic.some(row => row.route === '/user' && row.status === 200), 'AUTHORITATIVE_HTTP_REQUIRED');
  });
  await check('backup-rpc-cas-and-two-account-rls-over-http', async () => {
    requireTrue(await a.api.load(A) === null && await b.api.load(B) === null, 'EMPTY_BACKUP_REQUIRED');
    requireTrue((await a.api.save(0, snapshot, A)).revision === 1, 'FIRST_BACKUP_SAVE_FAILED');
    requireTrue((await b.api.save(0, snapshot, B)).revision === 1, 'SECOND_BACKUP_SAVE_FAILED');
    for (const [harness, id] of [[a, A], [b, B]]) {
      const reply = await harness.client.from('rodagem_sync').select('user_id,revision');
      requireTrue(!reply.error && reply.data.length === 1 && reply.data[0].user_id === id, 'CROSS_ACCOUNT_RLS_READ');
    }
    const stale = await localHttpFetch(restBase + '/rpc/rodagem_save_snapshot', {method:'POST',headers:{Authorization:'Bearer ' + first.access_token,'Content-Type':'application/json'},body:JSON.stringify({expected_user_id:A,expected_revision:0,snapshot})});
    const staleBody = await stale.json();
    requireTrue(stale.status === 409 && staleBody.code === 'PT409', 'SERVER_CAS_REJECTION_REQUIRED');
    await rejectsCode(a.api.save(0, snapshot, A), ['CONFLICT']);
  });
  await check('rls-denies-cross-account-insert-update-delete-and-rpc-uid', async () => {
    const insert = await a.client.from('rodagem_sync').insert({user_id: B, payload: snapshot});
    requireTrue(insert.error?.code === '42501', 'CROSS_INSERT_MUST_FAIL_RLS');
    const update = await a.client.from('rodagem_sync').update({payload: snapshot}).eq('user_id', B).select('user_id');
    const remove = await a.client.from('rodagem_sync').delete().eq('user_id', B).select('user_id');
    requireTrue(!update.error && update.data.length === 0 && !remove.error && remove.data.length === 0, 'CROSS_MUTATION_MUST_AFFECT_ZERO');
    const rpc = await b.client.rpc('rodagem_save_snapshot', {expected_user_id: A, expected_revision: 1, snapshot});
    requireTrue(rpc.error?.code === '28000', 'RPC_UID_GUARD_REQUIRED');
    requireTrue((await a.api.load(A)).revision === 1 && (await b.api.load(B)).revision === 1, 'CROSS_MUTATION_CHANGED_BACKUP');
  });
  await check('anonymous-expired-and-forged-rest-requests-cannot-read-backup', async () => {
    const expired = fixture(A, {expired: true});
    const forged = jwt({role: 'authenticated', sub: A, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 300}, randomBytes(48).toString('hex'));
    const anonymous = await localHttpFetch(restBase + '/rodagem_sync?select=user_id', {headers: {Authorization: 'Bearer ' + anonKey}});
    requireTrue([401, 403].includes(anonymous.status), 'ANONYMOUS_BACKUP_ACCESS');
    for (const token of [expired.access_token, forged]) requireTrue((await localHttpFetch(restBase + '/rodagem_sync?select=user_id', {headers: {Authorization: 'Bearer ' + token}})).status === 401, 'INVALID_REST_JWT_ACCEPTED');
  });
  await check('two-concurrent-http-saves-have-exactly-one-cas-winner', async () => {
    const replies = await Promise.all([1, 2].map(() => a.client.rpc('rodagem_save_snapshot', {expected_user_id: A, expected_revision: 1, snapshot})));
    requireTrue(replies.filter(row => !row.error && row.data.revision === 2).length === 1 && replies.filter(row => row.error?.code === 'PT409' && row.status === 409).length === 1, 'CONCURRENT_CAS_REQUIRED');
    requireTrue((await a.api.load(A)).revision === 2, 'CAS_FINAL_REVISION');
  });
  await check('business-http-company-isolation-and-four-cas-functions', async () => {
    const ownA = await a.api.call('business_create_company',{company_name:'Synthetic HML company A'},A);
    const ownB = await b.api.call('business_create_company',{company_name:'Synthetic HML company B'},B);
    requireTrue(ownA.company.id !== ownB.company.id && ownA.membership.role === 'owner' && ownB.membership.role === 'owner','SEPARATE_COMPANIES_REQUIRED');
    const entityId = randomUUID();
    const vehicle = {id:entityId,companyId:ownA.company.id,revision:1,archivedAt:null,category:'caminhao',name:'Synthetic HML truck',year:2020,fuel:'Diesel',plate:'HML1234',odometer:100000,active:true};
    const params = {company_id:ownA.company.id,entity_kind:'vehicle',entity_id:entityId,expected_revision:0,entity_data:vehicle};
    requireTrue((await a.api.call('business_save_entity',params,A)).revision === 1,'BUSINESS_SEED_FAILED');
    await rejectsCode(a.api.call('business_save_entity',params,A),['CONFLICT']);
    await rejectsCode(a.api.call('business_archive_entity',{company_id:ownA.company.id,entity_kind:'vehicle',entity_id:entityId,expected_revision:0},A),['CONFLICT']);
    await rejectsCode(a.api.call('business_save_member',{company_id:ownA.company.id,member_id:ownA.membership.memberId,expected_revision:0,member_data:{name:'Synthetic owner',role:'owner',active:true}},A),['CONFLICT']);
    const hidden = await b.client.from('business_entities').select('id').eq('company_id',ownA.company.id);
    requireTrue(!hidden.error && hidden.data.length === 0,'BUSINESS_CROSS_COMPANY_READ');
    const denied = await b.client.rpc('business_load_workspace',{company_id:ownA.company.id,expected_user_id:B});
    requireTrue(denied.error?.code === '42501','BUSINESS_CROSS_COMPANY_RPC');
    const raced = await Promise.all(['left','right'].map(name=>a.client.rpc('business_save_entity',{...params,expected_user_id:A,expected_revision:1,entity_data:{...vehicle,name:'Synthetic '+name}})));
    requireTrue(raced.filter(r=>!r.error&&r.data.revision===2).length===1 && raced.filter(r=>r.status===409&&r.error?.code==='PT409').length===1,'BUSINESS_CONCURRENT_CAS');
    const after = await a.api.call('business_load_workspace',{company_id:ownA.company.id},A);
    requireTrue(after.vehicles.length===1 && after.vehicles[0].revision===2 && after.vehicles[0].archivedAt===null && after.members[0].revision===1,'BUSINESS_CONFLICT_CHANGED_DATA');
    requireTrue(a.traffic.filter(row=>row.status===409&&row.code==='PT409').length>=4,'FOUR_CAS_HTTP_CONFLICTS_REQUIRED');
  });
  await check('expired-access-token-is-renewed-by-real-sdk-refresh-http', async () => {
    const expired = fixture(A, {expired: true}), refreshed = boot(expired);
    const value = await refreshed.api.verifySession(A);
    requireTrue(value.user.id === A && value.expires_at > Math.floor(Date.now() / 1000), 'EXPIRED_SESSION_REFRESH_FAILED');
    requireTrue(refreshed.traffic.some(row => row.route === '/token' && row.method === 'POST' && row.status === 200), 'REFRESH_HTTP_REQUIRED');
    const cached = refreshed.cached();
    requireTrue(cached.access_token !== expired.access_token && cached.refresh_token !== expired.refresh_token, 'TOKEN_ROTATION_REQUIRED');
    requireTrue(sql(`select count(*) from auth.refresh_tokens where token='${expired.refresh_token}' and revoked`) === '1', 'OLD_REFRESH_NOT_REVOKED');
    publicOnly(value);
  });
  await check('explicit-client-refresh-preserves-uid-and-hides-tokens', async () => {
    requireTrue(typeof a.api.refreshSession === 'function', 'PRODUCTION_REFRESH_API_REQUIRED');
    const before = a.cached(), value = await a.api.refreshSession(A), after = a.cached();
    requireTrue(value.user.id === A && before.refresh_token !== after.refresh_token, 'EXPLICIT_REFRESH_REQUIRED');
    publicOnly(value);
    requireTrue((await a.api.load(A)).revision === 2, 'REFRESH_CHANGED_BACKUP');
  });
  await check('revoked-session-and-expired-refresh-cannot-authorize-backup', async () => {
    const revoked = fixture(A), h = boot(revoked);
    await h.api.verifySession(A);
    sql(`delete from auth.sessions where id='${revoked.sessionId}';`);
    await rejectsCode(h.api.verifySession(A), ['AUTH_REQUIRED']);
    const restBefore = h.traffic.filter(row => row.route.includes('rodagem_')).length;
    await rejectsCode(h.api.load(A), ['AUTH_REQUIRED']);
    requireTrue(h.traffic.filter(row => row.route.includes('rodagem_')).length === restBefore, 'REVOKED_SESSION_SENT_RPC');
    const dead = fixture(A, {expired: true});
    sql(`delete from auth.sessions where id='${dead.sessionId}';`);
    await rejectsCode(boot(dead).api.verifySession(A), ['AUTH_REQUIRED']);
  });
  await check('logout-revokes-local-session-and-preserves-second-device', async () => {
    const local = fixture(A), second = fixture(A), h = boot(local);
    await h.api.verifySession(A);
    await h.api.signOut();
    requireTrue(await h.api.getSession() === null && !h.cached(), 'LOGOUT_STORAGE_NOT_CLEARED');
    requireTrue(h.traffic.some(row => row.route === '/logout' && row.status === 204), 'LOGOUT_HTTP_REQUIRED');
    requireTrue(sql(`select count(*) from auth.sessions where id='${local.sessionId}'`) === '0', 'LOCAL_SESSION_NOT_REVOKED');
    requireTrue((await directUser(local.access_token)).status === 403 && (await directUser(second.access_token)).status === 200, 'LOGOUT_SCOPE_LOCAL_REQUIRED');
    const oldBearer = await localHttpFetch(restBase + '/rodagem_sync?select=revision', {headers:{Authorization:'Bearer ' + local.access_token},signal:AbortSignal.timeout(5000)});
    requireTrue([200,401,403].includes(oldBearer.status),'UNEXPECTED_REVOKED_BEARER_STATUS');
    residuals.push({code:'STATELESS_ACCESS_JWT_AFTER_LOGOUT',authUserStatus:403,restStatus:oldBearer.status,
      accessJwtMayRemainUsableUntilExpiry:oldBearer.status===200,sessionRefreshRevoked:true,
      note:'GoTrue validates session_id; PostgREST validates signature/expiry and RLS, without consulting auth.sessions on each call.'});
    await rejectsCode(h.api.verifySession(A), ['AUTH_REQUIRED']);
  });
  await check('account-switch-rejects-stale-uid-and-reads-only-new-account', async () => {
    const h = boot(fixture(A));
    await h.api.verifySession(A);
    await h.install(fixture(B));
    const before = h.traffic.length;
    await rejectsCode(h.api.save(2, snapshot, A), ['SESSION_CHANGED']);
    requireTrue(h.traffic.slice(before).every(row => !row.route.includes('rodagem_')), 'STALE_ACCOUNT_SENT_RPC');
    requireTrue((await h.api.verifySession(B)).user.id === B && (await h.api.load(B)).revision === 1, 'NEW_ACCOUNT_READ_FAILED');
  });
  await check('profile-switch-while-http-user-waits-invalidates-verification', async () => {
    const h = boot(fixture(A));
    await h.api.getSession();
    const gate = h.holdNextUser();
    const pending = h.api.verifySession(A);
    await gate.arrived;
    h.switchProfile();
    gate.release();
    await rejectsCode(pending, ['SESSION_CHANGED']);
  });
  await check('real-sync-profile-binding-upload-and-restore-over-authenticated-http', async () => {
    const expected = [{...snapshot.records.registros[0],id:'hml-full-sync',ganhos:23456}];
    const sending = await bootSync(fixture(A),expected);
    const beforeData = sending.store.get('minha-rodagem-v1');
    const binding = await sending.sync.bind();
    requireTrue(binding.userId===A && binding.revision===2 && sending.store.get('minha-rodagem-v1')===beforeData,'BINDING_MUST_NOT_UPLOAD_OR_REPLACE');
    const sent = await sending.sync.upload();
    requireTrue(sent.revision===3 && isDeepStrictEqual(JSON.parse(JSON.stringify(sent.payload.records.registros)),expected),'FULL_SYNC_UPLOAD_FAILED');
    const restoring = await bootSync(fixture(A),[{...expected[0],id:'hml-local-before',ganhos:111}]);
    const extra = await restoring.window.RodagemProfiles.create('Synthetic other profile');
    const extraKey = 'minha-rodagem-usuario-v1:'+extra.id+':minha-rodagem-v1';
    restoring.store.set(extraKey,JSON.stringify({versao:1,registros:[{...expected[0],id:'hml-other-profile'}]}));
    const extraRaw = restoring.store.get(extraKey);
    await restoring.sync.bind();
    const restored = await restoring.sync.restore();
    requireTrue(restored.revision===3 && isDeepStrictEqual(restoring.records(),expected),'FULL_SYNC_RESTORE_FAILED');
    requireTrue(restoring.store.get(extraKey)===extraRaw && restoring.stats().reloads===1 && restoring.stats().confirmations===2,'FULL_SYNC_RESTORE_ISOLATION_FAILED');
    requireTrue(restoring.sync.readBinding().revision===3,'RESTORE_BINDING_REVISION');
  });
  const sourceHash = name => createHash('sha256').update(fs.readFileSync(path.join(ROOT, name))).digest('hex');
  const report = {suite:'v323-local-auth-http',timestamp:new Date().toISOString(),classification:'automated-local-real-auth-rest-http-with-synthetic-identities',
    passed:results.length,failed:0,results,syntheticGoogleFixtures:true,googleOidcTested:false,physicalDevice:false,
    productionMutation:false,realFinancialData:false,temporaryCredentialsOnly:true,externalProvidersDisabled:true,cloudStagingUsed:false,
    images:IMAGES,sourceSha256:Object.fromEntries(['cloud-client.js','vendor/supabase/supabase.js','supabase/schema.sql','supabase/enterprise.sql','cloud-sync.js','app.js','profiles-core.js','backup-budget.js','gps-core.js'].map(name=>[name,sourceHash(name)])),
    http:httpEvidence,residuals,
    limits:['Synthetic Google identities do not prove Google OIDC login, nonce or real provider consent.','UI integration uses a simulated DOM/confirmation/reload with real modules and real SDK/Auth/PostgREST HTTP.','No hosted staging or production mutation.','PostgREST gateway/API-key enforcement, TLS, mail, OAuth providers and physical Android are not part of this isolated stack.']};
  fs.writeFileSync(path.join(ROOT,'qa/v323/auth-http-report.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({suite:report.suite,passed:report.passed,failed:report.failed,residuals,googleOidcTested:false,productionMutation:false})+'\n');
}
(process.env.RODAGEM_HML_CAS_PROOF === '1' ? runCasProof() : run()).then(() => { cleanup(); }).catch(error => {
  // Raw errors, SQL, request bodies, session objects and container logs may contain credentials.
  const safeCode = error.safeCode || (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(error.code) ? error.code : 'CHECK_FAILED');
  const report = {suite:'v323-local-auth-http',timestamp:new Date().toISOString(),classification:'automated-local-real-auth-rest-http-with-synthetic-identities',
    passed:results.length,failed:1,results,test:currentTest,code:safeCode,lastHTTP:httpEvidence.slice(-3),
    syntheticGoogleFixtures:true,googleOidcTested:false,productionMutation:false,realFinancialData:false,images:IMAGES};
  if (process.env.RODAGEM_HML_CAS_PROOF !== '1') fs.writeFileSync(path.join(ROOT,'qa/v323/auth-http-report.json'),JSON.stringify(report,null,2)+'\n');
  process.stderr.write(JSON.stringify(report)+'\n');
  cleanup();
  process.exitCode = 1;
});
