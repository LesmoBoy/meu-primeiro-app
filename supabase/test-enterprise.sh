#!/usr/bin/env sh
# Isolated fixtures only. Never accepts a connection string or a real project.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
container_name="rodagem-enterprise-qa-$(date +%s)-$$"
qa_tmpdir=$(mktemp -d)
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf -- "$qa_tmpdir"
}
trap cleanup EXIT HUP INT TERM
command -v docker >/dev/null 2>&1 || { echo 'Docker is required for isolated PostgreSQL tests.' >&2; exit 64; }
docker run -d --rm --network none --name "$container_name" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
attempt=0
until docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
  attempt=$((attempt+1)); [ "$attempt" -lt 30 ] || { echo 'PostgreSQL did not start.' >&2; exit 1; }
  sleep 1
done
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres <<'SQL'
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','owner-a@example.test',now()),
 ('22222222-2222-4222-8222-222222222222','owner-b@example.test',now()),
 ('33333333-3333-4333-8333-333333333333','manager@example.test',now()),
 ('44444444-4444-4444-8444-444444444444','finance@example.test',now()),
 ('55555555-5555-4555-8555-555555555555','driver@example.test',now()),
 ('66666666-6666-4666-8666-666666666666','unverified@example.test',null),
 ('77777777-7777-4777-8777-777777777777','expired@example.test',now()),
 ('88888888-8888-4888-8888-888888888888','revoked@example.test',now()),
 ('99999999-9999-4999-8999-999999999999','pending@example.test',now());
SQL
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/schema.sql"
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/enterprise.sql"
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/enterprise.sql"
docker exec -i "$container_name" psql -q -o /dev/null -v ON_ERROR_STOP=1 -U postgres < "$script_dir/enterprise-test.sql"
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/billing.sql"
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/billing.sql"
docker exec -i "$container_name" psql -q -o /dev/null -v ON_ERROR_STOP=1 -U postgres < "$script_dir/billing-test.sql"
docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres < "$script_dir/enterprise.sql"

# A current, owner-visible entity is used for the independent-session CAS test.
company=$(docker exec "$container_name" psql -At -U postgres -c "select company_id from public.business_entities where id='10000000-0000-4000-8000-000000000001'")
revision=$(docker exec "$container_name" psql -At -U postgres -c "select revision from public.business_entities where id='10000000-0000-4000-8000-000000000001'")
cat > "$qa_tmpdir/concurrent.sql" <<SQL
\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_save_entity(auth.uid(),'$company','vehicle','10000000-0000-4000-8000-000000000001',$revision,
 (select data || jsonb_build_object('id',id,'companyId',company_id,'revision',revision,'archivedAt',archived_at)
  from public.business_entities where id='10000000-0000-4000-8000-000000000001'));
select pg_sleep(0.2);
commit;
SQL
docker exec -i "$container_name" psql -q -U postgres < "$qa_tmpdir/concurrent.sql" > "$qa_tmpdir/first.log" 2>&1 &
first_pid=$!
docker exec -i "$container_name" psql -q -U postgres < "$qa_tmpdir/concurrent.sql" > "$qa_tmpdir/second.log" 2>&1 &
second_pid=$!
first_status=0; wait "$first_pid" || first_status=$?
second_status=0; wait "$second_pid" || second_status=$?
if { [ "$first_status" -eq 0 ] && [ "$second_status" -ne 0 ]; } || { [ "$first_status" -ne 0 ] && [ "$second_status" -eq 0 ]; }; then
  if ! grep -q '40001' "$qa_tmpdir/first.log" "$qa_tmpdir/second.log"; then
    cat "$qa_tmpdir/first.log" "$qa_tmpdir/second.log"; exit 1
  fi
else
  cat "$qa_tmpdir/first.log" "$qa_tmpdir/second.log"; echo 'Concurrent CAS must have exactly one commit.' >&2; exit 1
fi
actual_revision=$(docker exec "$container_name" psql -At -U postgres -c "select revision from public.business_entities where id='10000000-0000-4000-8000-000000000001'")
[ "$actual_revision" = "$((revision+1))" ] || { echo 'Concurrent CAS produced the wrong revision.' >&2; exit 1; }
echo 'PASS independent PostgreSQL sessions cannot both save the same entity revision'

# The manager reads its membership while an owner holds an uncommitted change.
# It must be denied after acquiring the company lock, rather than using stale roles.
manager=$(docker exec "$container_name" psql -At -U postgres -c "select id from public.business_members where company_id='$company' and user_id='33333333-3333-4333-8333-333333333333'")
manager_revision=$(docker exec "$container_name" psql -At -U postgres -c "select revision from public.business_members where id='$manager'")
cat > "$qa_tmpdir/revoke-manager.sql" <<SQL
\set ON_ERROR_STOP on
set application_name='rodagem-qa-revoke';
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_save_member(auth.uid(),'$company','$manager',$manager_revision,'{"name":"Gerente","role":"manager","active":false}'::jsonb);
select pg_sleep(5);
commit;
SQL
cat > "$qa_tmpdir/stale-role.sql" <<SQL
\set ON_ERROR_STOP on
\set VERBOSITY verbose
set application_name='rodagem-qa-stale-role';
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select public.business_save_entity(auth.uid(),'$company','vehicle','10000000-0000-4000-8000-000000000001',$actual_revision,
 (select data || jsonb_build_object('id',id,'companyId',company_id,'revision',revision,'archivedAt',archived_at)
  from public.business_entities where id='10000000-0000-4000-8000-000000000001'));
SQL
docker exec -i "$container_name" psql -q -U postgres < "$qa_tmpdir/revoke-manager.sql" > "$qa_tmpdir/revoke.log" 2>&1 &
revoke_pid=$!
attempt=0
until [ "$(docker exec "$container_name" psql -At -U postgres -c "select count(*) from pg_stat_activity where application_name='rodagem-qa-revoke' and wait_event='PgSleep'")" = 1 ]; do
  attempt=$((attempt+1)); [ "$attempt" -lt 25 ] || { cat "$qa_tmpdir/revoke.log"; echo 'Owner did not reach the locked test phase.' >&2; exit 1; }
  sleep 0.1
done
docker exec -i "$container_name" psql -q -U postgres < "$qa_tmpdir/stale-role.sql" > "$qa_tmpdir/stale-role.log" 2>&1 &
stale_role_pid=$!
attempt=0
until [ "$(docker exec "$container_name" psql -At -U postgres -c "select count(*) from pg_stat_activity where application_name='rodagem-qa-stale-role' and wait_event_type='Lock'")" = 1 ]; do
  attempt=$((attempt+1)); [ "$attempt" -lt 25 ] || { cat "$qa_tmpdir/stale-role.log"; echo 'Manager did not wait on the company lock.' >&2; exit 1; }
  sleep 0.1
done
wait "$revoke_pid"
stale_role_status=0; wait "$stale_role_pid" || stale_role_status=$?
[ "$stale_role_status" -ne 0 ] && grep -q '42501' "$qa_tmpdir/stale-role.log" || { cat "$qa_tmpdir/stale-role.log"; echo 'Revoked role retained write authority.' >&2; exit 1; }
after_revocation=$(docker exec "$container_name" psql -At -U postgres -c "select revision from public.business_entities where id='10000000-0000-4000-8000-000000000001'")
[ "$after_revocation" = "$actual_revision" ] || { echo 'Revoked manager changed the entity.' >&2; exit 1; }
echo 'PASS a revoked role cannot write after waiting on an owner transaction'
echo 'PASS PostgreSQL 17 enterprise schema, company isolation, roles, invitations and CAS'
