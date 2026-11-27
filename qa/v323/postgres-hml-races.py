#!/usr/bin/env python3
"""Synthetic PostgreSQL 17 RPC races. Own disposable Docker container only.

No DSN, network, Supabase project, real account, payment or provider is accepted.
The holder transaction remains open until pg_stat_activity proves the second
session is blocked. No timing-only assertion or long server sleep is used.
"""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'qa/v323/evidence/enterprise-races.json'
OWNER = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
MANAGER = '33333333-3333-4333-8333-333333333333'
FINANCE = '44444444-4444-4444-8444-444444444444'
DRIVER = '55555555-5555-4555-8555-555555555555'
PENDING = '99999999-9999-4999-8999-999999999999'
PENDING2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PENDING3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
CONTAINER = f'rodagem-v323-hml-{uuid.uuid4().hex[:12]}'
results = []
processes = []


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def shell(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs).stdout.strip()


def psql_args():
    return ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']


def sql(statement):
    return shell(psql_args(), input=statement)


def as_uid(uid, statement):
    return f"set request.jwt.claim.sub={lit(uid)}; set role authenticated; {statement};"


def rpc(uid, statement):
    return json.loads(sql(as_uid(uid, f'select {statement}')).splitlines()[-1])


def expect(condition, label):
    if not condition:
        raise AssertionError(label)


def activity(name, condition, process):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name={lit(name)} and {condition}") == '1':
            return
        if process.poll() is not None:
            out, err = process.communicate()
            raise AssertionError(f'{name} exited before observed lock: {process.returncode}; {err[-1000:]}')
        time.sleep(0.03)
    raise AssertionError(f'{name}: requested database state was not observed')


def launch(statement, keep_open=False):
    p = subprocess.Popen(psql_args(), text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    processes.append(p)
    p.stdin.write(statement + '\n')
    p.stdin.flush()
    if not keep_open:
        p.stdin.close()
        p.stdin = None
    return p


def race(label, holder_uid, holder_statement, waiter_uid, waiter_statement, expected_state=None):
    tag = f'hml_{len(results)+1}'
    holder = launch(f"set application_name={lit(tag+'_holder')}; begin; " + as_uid(holder_uid, 'select ' + holder_statement), keep_open=True)
    activity(tag+'_holder', "state='idle in transaction' and query like '%select public.business_%'", holder)
    waiter = launch(f"set application_name={lit(tag+'_waiter')}; begin; " + as_uid(waiter_uid, 'select ' + waiter_statement) + ' commit;')
    activity(tag+'_waiter', "wait_event_type='Lock'", waiter)
    holder.stdin.write('commit;\n')
    holder.stdin.close()
    holder.stdin = None
    holder_out, holder_err = holder.communicate(timeout=10)
    waiter_out, waiter_err = waiter.communicate(timeout=10)
    expect(holder.returncode == 0, f'{label}: holder did not commit: {holder_err[-500:]}')
    if expected_state:
        expect(waiter.returncode != 0 and f' {expected_state}: ' in waiter_err, f'{label}: expected {expected_state}; got {waiter_err[-800:]}')
    else:
        expect(waiter.returncode == 0, f'{label}: waiter did not commit: {waiter_err[-800:]}')
    results.append({'scenario': label, 'holder': 'COMMIT', 'waiter': expected_state or 'COMMIT', 'lockObserved': True})
    print(f'PASS {label}: lock observed; holder COMMIT; waiter {expected_state or "COMMIT"}', flush=True)
    return holder_out, waiter_out


def vehicle(company, entity, name='Veículo fictício HML'):
    return {'id': entity, 'companyId': company, 'revision': 1, 'archivedAt': None, 'category': 'caminhao', 'name': name, 'year': 2020, 'fuel': 'Diesel', 'plate': 'HML-TESTE', 'odometer': 100000, 'active': True}


def save_entity(company, entity, revision, data):
    return f"public.business_save_entity(auth.uid(),{lit(company)},'vehicle',{lit(entity)},{revision},{lit(json.dumps(data, ensure_ascii=False))}::jsonb)"


def entity_state(entity):
    return json.loads(sql(f"select jsonb_build_object('revision',revision,'companyId',company_id,'archivedAt',archived_at,'data',data) from public.business_entities where id={lit(entity)}"))


def save_member(company, member, revision, role, active=True, name='Pessoa fictícia HML'):
    data = {'name': name, 'role': role, 'active': active}
    return f"public.business_save_member(auth.uid(),{lit(company)},{lit(member)},{revision},{lit(json.dumps(data))}::jsonb)"


def member_revision(member):
    return int(sql(f'select revision from public.business_members where id={lit(member)}'))


def invite(company, email, role='driver'):
    return f"public.business_invite_member(auth.uid(),{lit(company)},{lit(email)},'Pessoa fictícia HML',{lit(role)})"


def accept(token):
    return f'public.business_accept_invite(auth.uid(),{lit(token)})'


def revoke(company, invite_id):
    return f'public.business_revoke_invite(auth.uid(),{lit(company)},{lit(invite_id)})'


try:
    EVIDENCE.unlink(missing_ok=True)
    shell(['docker', 'run', '-d', '--rm', '--network', 'none', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    inspected = json.loads(shell(['docker', 'inspect', CONTAINER]))[0]
    expect(inspected['HostConfig']['NetworkMode'] == 'none' and not inspected['HostConfig']['PortBindings'], 'Container must have no network and no published ports')
    for attempt in range(100):
        # Wait for the final TCP server, not initdb's temporary Unix socket.
        if subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(0.05)
    else:
        raise AssertionError('Disposable PostgreSQL did not become ready')
    version = sql('select version()')
    expect('PostgreSQL 17.' in version, 'PostgreSQL 17 is required')
    sql("""create schema auth;
      create role anon nologin; create role authenticated nologin;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    """)
    emails = {OWNER: 'owner-a@example.test', OTHER: 'owner-b@example.test', MANAGER: 'manager@example.test', FINANCE: 'finance@example.test', DRIVER: 'driver@example.test', PENDING: 'pending@example.test', PENDING2: 'pending2@example.test', PENDING3: 'pending3@example.test'}
    sql('insert into auth.users(id,email,email_confirmed_at) values ' + ','.join(f'({lit(uid)},{lit(email)},now())' for uid,email in emails.items()))
    sql((ROOT/'supabase/schema.sql').read_text())
    sql((ROOT/'supabase/enterprise.sql').read_text())
    x = rpc(OWNER, "public.business_create_company(auth.uid(),'Empresa X fictícia HML')")
    y = rpc(OTHER, "public.business_create_company(auth.uid(),'Empresa Y fictícia HML')")
    company = x['company']['id']
    other_company = y['company']['id']
    members = {}
    for uid, role in [(MANAGER, 'manager'), (FINANCE, 'finance'), (DRIVER, 'driver')]:
        issued = rpc(OWNER, invite(company, emails[uid], role))
        joined = rpc(uid, accept(issued['token']))
        members[role] = joined['membership']['memberId']

    # Different operations competing for the same entity revision.
    for idx, holder_archives in [(1, False), (2, True)]:
        entity = f'10000000-0000-4000-8000-{idx:012d}'
        data = vehicle(company, entity)
        rpc(OWNER, save_entity(company, entity, 0, data))
        archive = f"public.business_archive_entity(auth.uid(),{lit(company)},'vehicle',{lit(entity)},1)"
        save = save_entity(company, entity, 1, dict(data, name='Edição vencedora HML'))
        race('archive versus save' if holder_archives else 'save versus archive', OWNER, archive if holder_archives else save, OWNER, save if holder_archives else archive, 'PT409')
        state = entity_state(entity)
        expect(state['revision'] == 2 and bool(state['archivedAt']) == holder_archives, 'Entity CAS or archive result changed')
        results[-1]['finalRevision'] = state['revision']
        results[-1]['archived'] = bool(state['archivedAt'])

    finance = members['finance']
    race('two member edits with one expected revision', OWNER, save_member(company, finance, 1, 'finance', name='Edição vencedora HML'), OWNER, save_member(company, finance, 1, 'finance', name='Edição perdedora HML'), 'PT409')
    expect(sql(f"select revision=2 and display_name='Edição vencedora HML' from public.business_members where id={lit(finance)}") == 't', 'Member CAS overwrote winner')
    results[-1]['finalRevision'] = 2

    issued = rpc(OWNER, invite(company, emails[PENDING]))
    race('two acceptances of one token', PENDING, accept(issued['token']), PENDING, accept(issued['token']), '42501')
    expect(sql(f"select count(*) from public.business_members where company_id={lit(company)} and user_id={lit(PENDING)}") == '1', 'Duplicate token acceptance created duplicate membership')
    results[-1]['membershipsCreated'] = 1

    issued = rpc(OWNER, invite(company, emails[PENDING2]))
    race('revocation wins against in-flight acceptance', OWNER, revoke(company, issued['member']['id']), PENDING2, accept(issued['token']), '42501')
    expect(sql(f"select count(*) from public.business_members where company_id={lit(company)} and user_id={lit(PENDING2)}") == '0', 'Revoked token created a membership')
    results[-1]['membershipsCreated'] = 0

    issued = rpc(OWNER, invite(company, emails[PENDING3]))
    race('acceptance wins against in-flight revocation', PENDING3, accept(issued['token']), OWNER, revoke(company, issued['member']['id']), '42501')
    expect(sql(f"select count(*) from public.business_members where company_id={lit(company)} and user_id={lit(PENDING3)}") == '1', 'Winning acceptance was lost')
    results[-1]['membershipsCreated'] = 1

    _, second_out = race('two invitations replace the same email serially', OWNER, invite(company, 'replace@example.test'), OWNER, invite(company, 'replace@example.test'))
    second = json.loads(next(line for line in second_out.splitlines() if line.startswith('{')))
    token_hash = hashlib.sha256(second['token'].encode()).hexdigest()
    expect(sql(f"select count(*)=2 and count(*) filter(where revoked_at is null)=1 and bool_or(token_hash={lit(token_hash)} and revoked_at is null) from public.business_invites where company_id={lit(company)} and email='replace@example.test'") == 't', 'Invitation replacement left more than one active token')
    results[-1]['activeTokens'] = 1

    # Each RPC has its own authorization code after the shared company lock.
    entity = '10000000-0000-4000-8000-000000000003'
    data = vehicle(company, entity)
    rpc(OWNER, save_entity(company, entity, 0, data))
    pending_revoke = rpc(OWNER, invite(company, 'manager-revoke@example.test'))
    targets = [
        ('save_entity', lambda: save_entity(company, entity, 1, data)),
        ('archive_entity', lambda: f"public.business_archive_entity(auth.uid(),{lit(company)},'vehicle',{lit(entity)},1)"),
        ('save_member', lambda: save_member(company, finance, member_revision(finance), 'finance')),
        ('invite_member', lambda: invite(company, 'stale-manager@example.test')),
        ('revoke_invite', lambda: revoke(company, pending_revoke['member']['id'])),
    ]
    manager = members['manager']
    def actor_state():
        return sql(f"""select md5(jsonb_build_array(
          (select jsonb_agg(to_jsonb(e) order by id) from public.business_entities e),
          (select jsonb_agg(to_jsonb(m) order by id) from public.business_members m where id<>{lit(manager)}),
          (select jsonb_agg(to_jsonb(i) order by id) from public.business_invites i))::text)""")
    for name, waiter in targets:
        rpc(OWNER, save_member(company, manager, member_revision(manager), 'manager', True))
        before = actor_state()
        race(f'revoked manager waits then {name} is denied', OWNER, save_member(company, manager, member_revision(manager), 'manager', False), MANAGER, waiter(), '42501')
        expect(actor_state() == before, f'{name}: denied manager mutated protected state')
        results[-1]['actorMutation'] = False
    rpc(OWNER, save_member(company, manager, member_revision(manager), 'manager', True))
    before = actor_state()
    race('manager demoted to finance waits then fleet write is denied', OWNER, save_member(company, manager, member_revision(manager), 'finance', True), MANAGER, save_entity(company, entity, 1, data), '42501')
    expect(actor_state() == before, 'Demoted manager changed protected state')
    results[-1]['actorMutation'] = False

    # Last-owner checks must remain true across two self-demotions.
    z = rpc(OWNER, "public.business_create_company(auth.uid(),'Empresa Z fictícia HML')")
    z_company = z['company']['id']
    z_owner = z['membership']['memberId']
    issued = rpc(OWNER, invite(z_company, emails[MANAGER], 'manager'))
    z_manager = rpc(MANAGER, accept(issued['token']))['membership']['memberId']
    rpc(OWNER, save_member(z_company, z_manager, 1, 'owner'))
    race('concurrent owners cannot both demote the last owners', OWNER, save_member(z_company, z_owner, 1, 'finance'), MANAGER, save_member(z_company, z_manager, 2, 'finance'), '42501')
    expect(sql(f"select count(*) from public.business_members where company_id={lit(z_company)} and role='owner' and active and user_id is not null") == '1', 'Concurrent demotion left no owner')
    results[-1]['activeOwners'] = 1

    entity = '10000000-0000-4000-8000-000000000099'
    race('same new entity ID across companies cannot be overwritten', OWNER, save_entity(company, entity, 0, vehicle(company, entity)), OTHER, save_entity(other_company, entity, 0, vehicle(other_company, entity)), 'PT409')
    state = entity_state(entity)
    expect(state['companyId'] == company and state['revision'] == 1, 'Cross-company duplicate create moved ownership')
    results[-1]['finalRevision'] = 1
    results[-1]['originalCompanyPreserved'] = True
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps({'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'postgres': version, 'image': 'postgres:17-alpine', 'network': 'none', 'publishedPorts': False, 'syntheticOnly': True, 'scenarios': results, 'passed': len(results)}, ensure_ascii=False, indent=2) + '\n')
    print(f'PASS {len(results)} coordinated PostgreSQL 17 races; synthetic data only; {EVIDENCE.relative_to(ROOT)}', flush=True)
finally:
    for p in processes:
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                p.kill()
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
