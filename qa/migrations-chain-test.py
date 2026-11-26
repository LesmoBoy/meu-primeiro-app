"""Validate only the repository migrations in disposable PostgreSQL; no remote URL."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

root = Path(__file__).resolve().parent.parent
name = f'rodagem-migration-chain-{os.getpid()}-{time.time_ns()}'

def command(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)

def sql(source):
    return command(['docker', 'exec', '-i', name, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], input=source).stdout.strip()

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
    fixture = fixture_script.split("<<'SQL'", 1)[1].split('\nSQL\n', 1)[0]
    sql(fixture)
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    assert len(files) == 4, 'Expected three recorded migrations and the incremental GPS validation'
    for file in files:
        sql(file.read_text())
    rows = json.loads(sql("select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select p.proname as name,md5(p.prosrc) as body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'business\\_%' escape '\\' or p.proname like 'rodagem\\_%' escape '\\')) x;"))
    expected = {}
    for file in ['supabase/schema.sql', 'supabase/enterprise.sql']:
        for match in re.finditer(r'create\s+or\s+replace\s+function\s+public\.(\w+)\b[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$', (root / file).read_text(), re.I):
            expected[match.group(1)] = hashlib.md5(match.group(2).encode()).hexdigest()
    assert len(rows) == len(expected) == 25
    assert all(expected[row['name']] == row['body'] for row in rows), 'Migrated functions differ from reviewed schema'
    protections = json.loads(sql("select json_build_object('tables',count(*),'rlsAndForce',count(*)filter(where c.relrowsecurity and c.relforcerowsecurity))from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';"))
    assert protections == {'tables': 5, 'rlsAndForce': 5}
    assert sql("select not has_function_privilege('anon','public.rodagem_track_valid(jsonb)','execute');") == 't'
    # The incremental file is safe to reapply without changing final definitions.
    sql(files[-1].read_text())
    report = {'postgres': 17, 'disposable': True, 'network': 'none', 'migrationsApplied': [p.name for p in files], 'functionsMatched': len(rows), **protections, 'incrementalReapplied': True, 'passed': True}
    (root / 'qa/migrations-chain-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('MIGRATIONS_CHAIN_REPORT ' + json.dumps(report))
finally:
    subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
