"""Validate five migrations, upgrade/rollback and a read-only production reference.

Own disposable PostgreSQL only. No remote URL, real account or financial data.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

root = Path(__file__).resolve().parent.parent
name = f'rodagem-migration-chain-{os.getpid()}-{time.time_ns()}'
CHANGED = {'rodagem_save_snapshot': 1, 'business_save_entity': 3,
           'business_archive_entity': 1, 'business_save_member': 2}
MIGRATION = '20261127023748_rodagem_cas_http_conflict.sql'
FUNCTION = re.compile(r'create\s+or\s+replace\s+function\s+public\.(\w+)\b[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;', re.I)


def command(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)


def sql(source):
    return command(['docker', 'exec', '-i', name, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres'], input=source).stdout.strip()


def catalog():
    return json.loads(sql("""select coalesce(json_agg(row_to_json(x)),'[]'::json) from (
      select p.proname as name,pg_get_userbyid(p.proowner) as owner,p.prosecdef as definer,
        p.proconfig as settings,pg_get_function_identity_arguments(p.oid) as arguments,
        has_function_privilege('anon',p.oid,'EXECUTE') as "anonExecute",
        md5(pg_get_functiondef(p.oid)) as "definitionMd5",
        has_function_privilege('authenticated',p.oid,'EXECUTE') as "authenticatedExecute"
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'business\\_%' escape '\\' or p.proname like 'rodagem\\_%' escape '\\')
      order by p.proname) x;"""))


def bodies():
    return json.loads(sql("""select json_object_agg(p.proname,p.prosrc) from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and (p.proname like 'business\\_%' escape '\\' or p.proname like 'rodagem\\_%' escape '\\');"""))


def metadata_without_body():
    return json.loads(sql("""select jsonb_object_agg(p.proname,to_jsonb(p)-'prosrc')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and (p.proname like 'business\\_%' escape '\\' or p.proname like 'rodagem\\_%' escape '\\');"""))


def state():
    # Include complete synthetic payloads, revisions, timestamps and references.
    tables = ['rodagem_sync', 'business_companies', 'business_members', 'business_entities', 'business_invites']
    expressions = []
    for table in tables:
        pk = 'user_id' if table == 'rodagem_sync' else 'id'
        expressions += [f"'{table}'", f"(select coalesce(jsonb_agg(to_jsonb(t) order by {pk}),'[]') from public.{table} t)"]
    return sql('select jsonb_build_object(' + ','.join(expressions) + ')::text;')


def rpc(uid, expression):
    return json.loads(sql(f"set request.jwt.claim.sub='{uid}'; set role authenticated; select {expression};"))


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


command(['docker', 'run', '-d', '--rm', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
try:
    for attempt in range(100):
        ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('Disposable PostgreSQL did not become ready')
    fixture_script = (root / 'supabase/test-enterprise.sh').read_text()
    sql(fixture_script.split("<<'SQL'", 1)[1].split('\nSQL\n', 1)[0])
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    assert len(files) == 5 and files[-1].name == MIGRATION, 'Expected four recorded migrations and the incremental CAS SQLSTATE correction'
    for file in files[:-1]:
        sql(file.read_text())
    baseline_catalog, baseline_bodies = catalog(), bodies()
    baseline_metadata = metadata_without_body()
    assert len(baseline_catalog) == 25

    # Seed an old-version account snapshot and company using existing RPCs.
    a, manager = '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'
    company = rpc(a, f"public.business_create_company('{a}','Empresa fictícia upgrade HML')")['company']['id']
    invitation = rpc(a, f"public.business_invite_member('{a}','{company}','manager@example.test','Pessoa sintética','manager')")
    rpc(manager, f"public.business_accept_invite('{manager}',{literal(invitation['token'])})")
    vehicle_id = '10000000-0000-4000-8000-000000000111'
    vehicle = {'id':vehicle_id,'companyId':company,'revision':1,'archivedAt':None,'category':'caminhao','name':'Veículo sintético upgrade','year':2020,'fuel':'Diesel','plate':'HML-TESTE','odometer':100000,'active':True}
    rpc(a, f"public.business_save_entity('{a}','{company}','vehicle','{vehicle_id}',0,{literal(json.dumps(vehicle))}::jsonb)")
    snapshot = {'version':1,'settings':None,'records':{'versao':1,'registros':[{'id':'synthetic-upgrade-day','tipo':'dia','data':'2026-11-27','ganhos':18000,'combustivel':2500,'outros':500,'entregas':20,'horas':600,'km':12000}]},'routes':[],'gpsPreferences':{'enabled':False,'mode':'eco'},'journey':None}
    rpc(a, f"public.rodagem_save_snapshot('{a}',0,{literal(json.dumps(snapshot))}::jsonb)")
    original_state = state()
    migration = files[-1].read_text()
    rollback = (root / 'docs/v3.2.3/sql/rollback-cas-http-conflict.sql').read_text()
    for script in (migration, rollback):
        assert len(list(FUNCTION.finditer(script))) == 4
        # DML inside the unchanged function definitions is not executed by DDL.
        top_level = FUNCTION.sub('', script)
        assert not re.search(r'^\s*(?:insert|update|delete|truncate|drop|alter|grant|revoke)\b', top_level, re.I | re.M), 'CAS contract scripts must not mutate rows or permissions'
    sql(migration)
    candidate_catalog, candidate_bodies = catalog(), bodies()
    assert metadata_without_body() == baseline_metadata, 'Upgrade changed pg_proc metadata, owners, complete ACLs or OIDs'
    assert state() == original_state, 'Upgrade modified synthetic rows, payloads, revisions or timestamps'
    for function, original in baseline_bodies.items():
        candidate = candidate_bodies[function]
        if function in CHANGED:
            assert candidate.count("'PT409'") == CHANGED[function]
            assert candidate.replace("'PT409'", "'40001'") == original, 'CAS migration changed more than SQLSTATE'
        else:
            assert candidate == original
    assert sum(CHANGED.values()) == 7
    sql(migration)
    assert catalog() == candidate_catalog and state() == original_state, 'Migration reapply changed definitions or data'
    assert metadata_without_body() == baseline_metadata
    sql(rollback)
    assert catalog() == baseline_catalog and state() == original_state, 'Rollback failed to restore definitions/ACL or changed data'
    assert metadata_without_body() == baseline_metadata
    sql(migration)
    assert catalog() == candidate_catalog and state() == original_state

    # An unknown function body must fail the fingerprint guard before replacement.
    definition = next(m[0] for m in FUNCTION.finditer(migration) if m[1] == 'rodagem_save_snapshot')
    tampered = definition.replace('declare owner_id', '-- synthetic unexpected drift\ndeclare owner_id', 1)
    guard = re.search(r'do \$rodagem_cas_contract\$[\s\S]*?\$rodagem_cas_contract\$;', migration)[0]
    try:
        sql('begin;\n' + tampered + '\n' + guard + '\nrollback;')
    except subprocess.CalledProcessError as error:
        assert '55000:' in error.stderr and 'Contrato CAS desconhecido' in error.stderr
    else:
        raise AssertionError('Unrecognized function drift was accepted')
    assert catalog() == candidate_catalog and state() == original_state, 'Rejected drift proof left modifications'

    expected_bodies = {}
    for filename in ['supabase/schema.sql', 'supabase/enterprise.sql']:
        expected_bodies.update({m[1]:m[2] for m in FUNCTION.finditer((root / filename).read_text())})
    assert len(candidate_bodies) == len(expected_bodies) == 25 and candidate_bodies == expected_bodies, 'Migrated functions differ from reviewed schema'
    table_catalog = json.loads(sql("""select json_agg(row_to_json(x)) from (
      select c.relrowsecurity as rls,c.relname as name,c.relforcerowsecurity as "forceRls"
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' order by c.relname) x;"""))
    assert len(table_catalog) == 5 and all(t['rls'] and t['forceRls'] for t in table_catalog)
    report = {'postgres':17,'disposable':True,'network':'none','migrationsApplied':[p.name for p in files],
      'functionsMatched':25,'tables':5,'rlsAndForce':5,'incrementalReapplied':True,
      'localFunctionCatalog':candidate_catalog,'localTableCatalog':table_catalog,
      'upgradeCompatibility':{'seededTableCounts':{'rodagem_sync':1,'business_companies':1,'business_members':2,'business_entities':1,'business_invites':1},
        'completeRowsSha256':hashlib.sha256(original_state.encode()).hexdigest(),'payloadRevisionsTimestampsUnchanged':True,
        'fourFunctionBodiesChangedOnlySqlstate':True,'logicalRaisesChanged':7,'ownersAndAclPreserved':True,'allPgProcMetadataExceptBodyPreserved':True,
        'rollbackRestoredBaselineDefinitionsAndRows':True,'reupgradeSucceeded':True,'unexpectedBodyRejected55000':True},'passed':True}
    production_file = root / 'qa/v323/production-catalog.json'
    if production_file.exists():
        production = json.loads(production_file.read_text())
        assert production['classification'] == 'production-read-only-catalog-and-advisors'
        assert production['productionWrites'] is False and production['financialRowsRead'] is False
        reference = {item['name']:item for item in production['functions']}
        assert len(reference) == len(candidate_catalog) == 25
        baseline_differences = [{'name':item['name'],'fields':{key:{'local':value,'reference':reference[item['name']].get(key)}
          for key,value in item.items() if value != reference[item['name']].get(key)}}
          for item in baseline_catalog if item != reference[item['name']]]
        reviewed = [{'name':'rodagem_sync_stamp','fields':{'authenticatedExecute':{'local':False,'reference':True}}}]
        assert all(item in reviewed for item in baseline_differences), 'Unreviewed baseline catalog difference'
        differences = [{'name':item['name'],'fields':{key:{'local':value,'reference':reference[item['name']].get(key)}
          for key,value in item.items() if value != reference[item['name']].get(key)}}
          for item in candidate_catalog if item != reference[item['name']]]
        changed_definitions = [item['name'] for item in differences if 'definitionMd5' in item['fields']]
        assert set(changed_definitions) == set(CHANGED)
        assert all(set(item['fields']) == ({'definitionMd5'} if item['name'] in CHANGED else {'authenticatedExecute'}) for item in differences)
        assert table_catalog == sorted(production['tables'],key=lambda item:item['name'])
        assert [{'version':p.name.split('_',1)[0],'name':p.stem.split('_',1)[1]} for p in files[:-1]] == production['migrations']
        sql("""begin; grant execute on function public.rodagem_sync_stamp() to authenticated;
          set local role authenticated;
          do $$ begin perform public.rodagem_sync_stamp();
            raise exception 'Ordinary invocation unexpectedly returned';
          exception when feature_not_supported then null; end; $$; rollback;""")
        assert state() == original_state
        comparison = {'referenceObservedAt':production['observedAt'],'referenceSha256':hashlib.sha256(production_file.read_bytes()).hexdigest(),
          'baselineDefinitionsMatched':25,'candidateDefinitionsUnchanged':21,'candidateDefinitionsChangedOnlySqlstate':4,
          'definitionsMatchedAfterSqlstateNormalization':25,'ownersSignaturesAnonAclAndSettingsMatched':25,
          'authenticatedAclMatched':25-len(baseline_differences),'reviewedAclDifferences':baseline_differences,
          'grantedTriggerOrdinaryInvocationRejected':True,'tablesRlsAndForceMatched':5,
          'baselineMigrationsMatched':4,'candidateMigrationPendingProductionAuthorization':MIGRATION,'newRemoteCalls':False,'passed':True}
        report['productionReferenceComparison'] = comparison
        output = root / 'qa/v323/evidence/catalog-comparison.json'; output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps({'classification':'local-candidate-vs-read-only-v322-production-reference',
          'localFunctionCatalog':candidate_catalog,'differences':differences,'comparison':comparison,'remoteCalls':False},indent=2)+'\n')
    (root / 'qa/migrations-chain-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('MIGRATIONS_CHAIN_REPORT '+json.dumps({k:v for k,v in report.items() if k not in ('localFunctionCatalog','localTableCatalog')}))
finally:
    subprocess.run(['docker','rm','-f',name],capture_output=True)
