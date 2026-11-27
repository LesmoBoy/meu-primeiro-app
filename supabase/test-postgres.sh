#!/usr/bin/env sh
# Runs only in a fresh, disposable PostgreSQL container. No external DB URL.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
container_name="rodagem-supabase-qa-$(date +%s)-$$"
image="postgres:17-alpine"
qa_tmpdir=$(mktemp -d)
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf -- "$qa_tmpdir"
}
trap cleanup EXIT HUP INT TERM
command -v docker >/dev/null 2>&1 || { echo 'Docker is required for isolated PostgreSQL tests.' >&2; exit 64; }
docker run -d --rm --network none --name "$container_name" -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$ready" = 1 ] || { echo 'PostgreSQL did not become ready.' >&2; exit 1; }
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres <<'SQL'
create schema auth;
create role anon nologin;
create role authenticated nologin;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SQL
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/schema.sql"
# Run the migration twice: reapplying it must preserve existing schema and data.
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/schema.sql"
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/test.sql"
cat > "$qa_tmpdir/concurrent.sql" <<'SQL'
\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.rodagem_save_snapshot(auth.uid(),2,(select payload from public.rodagem_sync where user_id=auth.uid()));
select pg_sleep(0.2);
commit;
SQL
# Both sessions send revision 2: exactly one must commit and the other conflict.
docker exec -i "$container_name" psql -q -U postgres < "$qa_tmpdir/concurrent.sql" > "$qa_tmpdir/first.log" 2>&1 &
first_pid=$!
docker exec -i "$container_name" psql -q -U postgres < "$qa_tmpdir/concurrent.sql" > "$qa_tmpdir/second.log" 2>&1 &
second_pid=$!
first_status=0; wait "$first_pid" || first_status=$?
second_status=0; wait "$second_pid" || second_status=$?
if { [ "$first_status" -eq 0 ] && [ "$second_status" -ne 0 ]; } ||
   { [ "$first_status" -ne 0 ] && [ "$second_status" -eq 0 ]; }; then
  grep -q 'PT409' "$qa_tmpdir/first.log" "$qa_tmpdir/second.log" || { cat "$qa_tmpdir/first.log" "$qa_tmpdir/second.log"; exit 1; }
else
  cat "$qa_tmpdir/first.log" "$qa_tmpdir/second.log"
  echo 'Concurrent CAS did not produce exactly one successful save.' >&2
  exit 1
fi
revision=$(docker exec "$container_name" psql -At -U postgres -c "select revision from public.rodagem_sync where user_id='11111111-1111-4111-8111-111111111111'")
[ "$revision" = 3 ] || { echo 'Concurrent CAS advanced the revision incorrectly.' >&2; exit 1; }
echo 'PASS two concurrent PostgreSQL sessions cannot both commit the same revision'
echo 'PASS PostgreSQL 17 schema, RLS, grants, CAS, UID binding, validation and account-deletion tests'
