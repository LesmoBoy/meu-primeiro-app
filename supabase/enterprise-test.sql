-- Synthetic fixtures for test-enterprise.sh only. Never run in a real project.
\set ON_ERROR_STOP on
set client_min_messages=notice;
create schema qa;
create function qa.check(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS %',label; end; $$;
create function qa.reject(command text,states text[],label text) returns void language plpgsql as $$
declare rejected boolean:=false; actual text;
begin
  begin execute command; exception when others then
    get stacked diagnostics actual=returned_sqlstate;
    if actual<>all(states) then raise exception 'FAIL %: expected %, got % (%)',label,states,actual,sqlerrm; end if;
    rejected:=true;
  end;
  perform qa.check(rejected,label);
end; $$;
create function qa.company(which text) returns uuid language sql stable as $$ select (current_setting('qa.'||which)::jsonb->'company'->>'id')::uuid $$;
create function qa.member(which text) returns uuid language sql stable as $$ select (current_setting('qa.'||which)::jsonb->'membership'->>'memberId')::uuid $$;
create function qa.entity(entity_id uuid) returns jsonb language sql stable as $$ select data || jsonb_build_object('id',id,'companyId',company_id,'revision',revision,'archivedAt',archived_at) || case when kind='trip' then jsonb_build_object('createdAt',created_at) else '{}'::jsonb end from public.business_entities where id=entity_id $$;
create function qa.vehicle(company_id uuid,entity_id uuid) returns jsonb language sql as $$ select jsonb_build_object('id',entity_id,'companyId',company_id,'revision',1,'archivedAt',null,'category','caminhao','name','Caminhão de teste','year',2020,'fuel','Diesel','plate','TESTE1','odometer',1000000,'active',true) $$;
create function qa.trip(company_id uuid,entity_id uuid,vehicle_id uuid,driver_id uuid) returns jsonb language sql as $$ select jsonb_build_object('id',entity_id,'companyId',company_id,'revision',1,'archivedAt',null,'createdAt','2026-11-16T12:00:00.000Z','vehicleId',vehicle_id,'driverId',driver_id,'date','2026-11-16','title','Entrega de teste','customer','Cliente de teste','status','completed','revenue',20000,'distance',12500,'costs',jsonb_build_object('fuel',3000,'tolls',500,'parking',200,'commission',1000,'helper',0,'maintenance',250,'other',50)) $$;
grant usage on schema qa to authenticated,anon;
grant execute on all functions in schema qa to authenticated,anon;

set role anon;
select qa.reject($q$select public.business_list_companies('11111111-1111-4111-8111-111111111111')$q$,array['42501'],'anonymous RPC access is denied');
select qa.reject('select * from public.business_companies',array['42501'],'anonymous table access is denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select set_config('qa.a',public.business_create_company(auth.uid(),'Empresa A')::text,false);
select qa.check(public.business_list_companies(auth.uid())->0->>'name'='Empresa A','new company creates its authenticated owner');
select qa.reject($q$select public.business_list_companies('22222222-2222-4222-8222-222222222222')$q$,array['28000'],'expected UID mismatch is rejected before reading');
select qa.reject($q$select public.business_create_company('22222222-2222-4222-8222-222222222222','Forbidden')$q$,array['28000'],'expected UID mismatch is rejected before mutation');
select qa.check(jsonb_array_length(public.business_list_companies(auth.uid()))=1,'UID rejection does not create another company');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select set_config('qa.b',public.business_create_company(auth.uid(),'Empresa B')::text,false);
select qa.check(jsonb_array_length(public.business_list_companies(auth.uid()))=1 and (select count(*)=1 from public.business_companies),'company lists and direct SELECT are isolated by membership');
select qa.reject(format('select public.business_load_workspace(auth.uid(),%L)',qa.company('a')),array['42501'],'another company cannot be loaded by RPC');
select public.business_save_entity(auth.uid(),qa.company('b'),'vehicle','20000000-0000-4000-8000-000000000001',0,qa.vehicle(qa.company('b'),'20000000-0000-4000-8000-000000000001'));

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select qa.check((select count(*)=0 from public.business_entities),'another company vehicles are not visible through direct SELECT');
select qa.reject(format('insert into public.business_members(company_id,user_id,role,display_name) values(%L,auth.uid(),''owner'',''Forged'')',qa.company('b')),array['42501'],'clients cannot directly create or escalate membership');
select set_config('qa.manager_invite',public.business_invite_member(auth.uid(),qa.company('a'),'manager@example.test','Gerente','manager')::text,false);
select set_config('qa.restricted_invite',public.business_invite_member(auth.uid(),qa.company('a'),'other-manager@example.test','Outro gerente','manager')::text,false);
select set_config('qa.finance_invite',public.business_invite_member(auth.uid(),qa.company('a'),'finance@example.test','Financeiro','finance')::text,false);
select set_config('qa.driver_invite',public.business_invite_member(auth.uid(),qa.company('a'),'driver@example.test','Motorista','driver')::text,false);
select set_config('qa.unverified_invite',public.business_invite_member(auth.uid(),qa.company('a'),'unverified@example.test','Sem confirmação','driver')::text,false);
select set_config('qa.expired_invite',public.business_invite_member(auth.uid(),qa.company('a'),'expired@example.test','Expirado','driver')::text,false);
select set_config('qa.revoked_invite',public.business_invite_member(auth.uid(),qa.company('a'),'revoked@example.test','Revogado','driver')::text,false);
select set_config('qa.pending_invite',public.business_invite_member(auth.uid(),qa.company('a'),'pending@example.test','Pendente','driver')::text,false);
select qa.check((current_setting('qa.driver_invite')::jsonb->>'token') ~ '^[0-9a-f]{64}$','invitation returns a one-time random token');
select qa.reject('select token_hash from public.business_invites',array['42501'],'invitation hashes are not readable by clients');
select public.business_revoke_invite(auth.uid(),qa.company('a'),(current_setting('qa.revoked_invite')::jsonb->'member'->>'id')::uuid);
reset role;
update public.business_invites set expires_at=now()-interval '1 hour' where id=(current_setting('qa.expired_invite')::jsonb->'member'->>'id')::uuid;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select qa.reject(format('select public.business_accept_invite(auth.uid(),%L)',current_setting('qa.driver_invite')::jsonb->>'token'),array['42501'],'an invitation cannot be accepted by the wrong email');
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
select qa.reject(format('select public.business_accept_invite(auth.uid(),%L)',current_setting('qa.unverified_invite')::jsonb->>'token'),array['42501'],'unverified email cannot accept an invitation');
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false);
select qa.reject(format('select public.business_accept_invite(auth.uid(),%L)',current_setting('qa.expired_invite')::jsonb->>'token'),array['42501'],'expired invitations are refused');
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',false);
select qa.reject(format('select public.business_accept_invite(auth.uid(),%L)',current_setting('qa.revoked_invite')::jsonb->>'token'),array['42501'],'revoked invitations are refused');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select set_config('qa.manager',public.business_accept_invite(auth.uid(),current_setting('qa.manager_invite')::jsonb->>'token')::text,false);
select qa.check(current_setting('qa.manager')::jsonb->'membership'->>'role'='manager','verified manager invitation grants only its prescribed role');
select qa.reject(format('select public.business_accept_invite(auth.uid(),%L)',current_setting('qa.manager_invite')::jsonb->>'token'),array['42501'],'used invitations cannot be replayed');
select qa.reject(format('select public.business_invite_member(auth.uid(),%L,''newmanager@example.test'',''Escalation'',''manager'')',qa.company('a')),array['42501'],'a manager cannot invite another manager');
select qa.reject(format('select public.business_invite_member(auth.uid(),%L,''newowner@example.test'',''Escalation'',''owner'')',qa.company('a')),array['42501'],'an owner role cannot be obtained through an invitation');
select qa.reject(format('select public.business_revoke_invite(auth.uid(),%L,%L)',qa.company('a'),current_setting('qa.restricted_invite')::jsonb->'member'->>'id'),array['42501'],'a manager cannot revoke an owner-authorized manager invitation');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select set_config('qa.finance',public.business_accept_invite(auth.uid(),current_setting('qa.finance_invite')::jsonb->>'token')::text,false);
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select set_config('qa.driver',public.business_accept_invite(auth.uid(),current_setting('qa.driver_invite')::jsonb->>'token')::text,false);

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_save_entity(auth.uid(),qa.company('a'),'vehicle','10000000-0000-4000-8000-000000000001',0,qa.vehicle(qa.company('a'),'10000000-0000-4000-8000-000000000001'));
select public.business_save_entity(auth.uid(),qa.company('a'),'vehicle','10000000-0000-4000-8000-000000000002',0,qa.vehicle(qa.company('a'),'10000000-0000-4000-8000-000000000002'));
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000001',0,qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',qa.member('driver')));
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000002',0,qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',qa.member('a')));
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000003'',0,%L::jsonb)',qa.company('a'),qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',qa.member('driver'))),array['22023'],'a trip cannot reference a vehicle from another company');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000003'',0,%L::jsonb)',qa.company('a'),qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',qa.member('b'))),array['22023'],'a trip cannot reference a person from another company');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000003'',0,%L::jsonb)',qa.company('a'),qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',(current_setting('qa.pending_invite')::jsonb->'member'->>'id')::uuid)),array['22023'],'an unaccepted invitation cannot be assigned a trip');

do $$
declare v jsonb:=qa.vehicle(qa.company('a'),'10000000-0000-4000-8000-000000000003'); t jsonb:=qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',qa.member('driver')); bad jsonb; cases jsonb[]; total integer:=0;
begin
 cases:=array[jsonb_set(v,'{year}','1899'),jsonb_set(v,'{year}','2020.5'),v-'year',jsonb_set(v,'{category}','"plane"'),jsonb_set(v,'{odometer}','-1'),jsonb_set(v,'{odometer}','1.5'),jsonb_set(v,'{name}','""'),jsonb_set(v,'{active}','"true"'),jsonb_set(jsonb_set(v,'{category}','"bicicleta"'),'{fuel}','"Diesel"')];
 foreach bad in array cases loop
   perform qa.reject(format('select public.business_save_entity(auth.uid(),%L,''vehicle'',''10000000-0000-4000-8000-000000000003'',0,%L::jsonb)',qa.company('a'),bad),array['22023'],'malformed vehicle is refused'); total:=total+1;
 end loop;
 cases:=array[jsonb_set(t,'{date}','"2026-02-30"'),jsonb_set(t,'{revenue}','0.1'),jsonb_set(t,'{distance}','-1'),jsonb_set(t,'{status}','"paid"'),jsonb_set(t,'{costs,fuel}','10.5'),jsonb_set(t,'{costs}','{}'),jsonb_set(t,'{costs,hidden}','500'),jsonb_set(t,'{companyId}',to_jsonb(qa.company('b')::text)),jsonb_set(t,'{vehicleId}','null')];
 foreach bad in array cases loop
   perform qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000003'',0,%L::jsonb)',qa.company('a'),bad),array['22023'],'malformed financial trip is refused'); total:=total+1;
 end loop;
 perform qa.check(total=18,'all malformed vehicle and financial snapshots preserve existing rows');
end; $$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000001',1,jsonb_set(qa.entity('11000000-0000-4000-8000-000000000001'),'{costs,tolls}','600'));
select qa.check(qa.entity('11000000-0000-4000-8000-000000000001')->'costs'->>'tolls'='600','finance may update existing trip costs with exact cents');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000001'',2,%L::jsonb)',qa.company('a'),jsonb_set(qa.entity('11000000-0000-4000-8000-000000000001'),'{revenue}','1')),array['42501'],'finance cannot change trip revenue');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''vehicle'',''10000000-0000-4000-8000-000000000001'',1,%L::jsonb)',qa.company('a'),qa.entity('10000000-0000-4000-8000-000000000001')),array['42501'],'finance cannot change fleet');
select qa.reject(format('select public.business_invite_member(auth.uid(),%L,''forged@example.test'',''Forged'',''driver'')',qa.company('a')),array['42501'],'finance cannot grant membership');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select qa.check((select count(*)=1 from public.business_entities where kind='trip'),'driver direct SELECT sees only its assigned trips');
select qa.check(jsonb_array_length(public.business_load_workspace(auth.uid(),qa.company('a'))->'trips')=1 and jsonb_array_length(public.business_load_workspace(auth.uid(),qa.company('a'))->'members')=1,'driver workspace contains only its trips and personal membership');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000002'',1,%L::jsonb)',qa.company('a'),qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',qa.member('driver'))),array['42501'],'driver cannot take over another driver trip');
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000001',2,jsonb_set(qa.entity('11000000-0000-4000-8000-000000000001'),'{customer}','"Updated by assigned driver"'));
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000001'',2,%L::jsonb)',qa.company('a'),qa.entity('11000000-0000-4000-8000-000000000001')),array['PT409'],'a stale entity revision cannot overwrite the latest trip');
select qa.reject('update public.business_entities set revision=99',array['42501'],'direct entity mutation is denied even for assigned drivers');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_save_entity(auth.uid(),qa.company('a'),'reminder','12000000-0000-4000-8000-000000000001',0,jsonb_build_object('id','12000000-0000-4000-8000-000000000001','companyId',qa.company('a'),'revision',1,'archivedAt',null,'kind','maintenance','title','Revisão por km','vehicleId','10000000-0000-4000-8000-000000000001','memberId',qa.member('driver'),'dueDate',null,'dueOdometer',1100000,'completedAt',null));
select public.business_save_entity(auth.uid(),qa.company('a'),'reminder','12000000-0000-4000-8000-000000000002',0,jsonb_build_object('id','12000000-0000-4000-8000-000000000002','companyId',qa.company('a'),'revision',1,'archivedAt',null,'kind','document','title','Documento do responsável','vehicleId',null,'memberId',qa.member('a'),'dueDate','2026-12-01','dueOdometer',null,'completedAt',null));
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select qa.check((select count(*)=1 from public.business_entities where kind='reminder'),'driver sees only reminders assigned to its membership');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,1,''{"name":"Sem dono","role":"finance","active":true}''::jsonb)',qa.company('a'),qa.member('a')),array['42501','22023'],'the last owner cannot be demoted');
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,1,''{"name":"Sem dono","role":"owner","active":false}''::jsonb)',qa.company('a'),qa.member('a')),array['42501','22023'],'the last owner cannot be deactivated');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,1,''{"name":"Escalation","role":"owner","active":true}''::jsonb)',qa.company('a'),qa.member('manager')),array['42501'],'a manager cannot promote itself to owner');
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,1,''{"name":"Other owner","role":"finance","active":true}''::jsonb)',qa.company('a'),qa.member('a')),array['42501'],'a manager cannot alter the owner');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_archive_entity(auth.uid(),qa.company('a'),'vehicle','10000000-0000-4000-8000-000000000002',1);
select qa.check((select count(*)=1 from public.business_entities where id='10000000-0000-4000-8000-000000000002' and archived_at is not null) and (select count(*)=1 from public.business_entities where id='11000000-0000-4000-8000-000000000002'),'archiving a vehicle preserves the vehicle and its financial history');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000003'',0,%L::jsonb)',qa.company('a'),qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',qa.member('driver'))),array['22023'],'new trips cannot choose an archived vehicle');
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000002',1,jsonb_set(qa.entity('11000000-0000-4000-8000-000000000002'),'{costs,other}','51'));
select qa.check(jsonb_array_length(public.business_load_workspace(auth.uid(),qa.company('a'))->'vehicles')=2,'archived references remain in workspaces for historical reports');
select public.business_save_member(auth.uid(),qa.company('a'),qa.member('driver'),1,'{"name":"Motorista arquivado","role":"driver","active":false}'::jsonb);
select qa.check((select archived_at is not null from public.business_members where id=qa.member('driver')),'deactivated membership preserves historical identity');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select qa.check(public.business_list_companies(auth.uid())='[]'::jsonb,'inactive membership immediately loses company access');
select qa.reject(format('select public.business_load_workspace(auth.uid(),%L)',qa.company('a')),array['42501'],'inactive member cannot keep loading the company');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select qa.check((select count(*)=2 from public.business_entities where kind='trip'),'member deactivation never removes its recorded trips');
select qa.reject(format('select public.business_save_entity(''22222222-2222-4222-8222-222222222222'',%L,''vehicle'',''10000000-0000-4000-8000-000000000001'',1,%L::jsonb)',qa.company('a'),qa.entity('10000000-0000-4000-8000-000000000001')),array['28000'],'expected UID mismatch is rejected before an entity write');
select qa.check((select revision=1 from public.business_entities where id='10000000-0000-4000-8000-000000000001'),'rejected identity change leaves the entity untouched');
select public.business_archive_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000001',3);
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000001',4,jsonb_set(qa.entity('11000000-0000-4000-8000-000000000001'),'{costs,other}','123'));
select qa.check((select archived_at is not null and data->>'driverId'=qa.member('driver')::text and data->'costs'->>'other'='123' from public.business_entities where id='11000000-0000-4000-8000-000000000001'),'finance may correct historical costs without reactivating an archived trip or changing its inactive driver');
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000002',2,jsonb_set(qa.entity('11000000-0000-4000-8000-000000000002'),'{costs,tolls}','501'));
select qa.check((select data->>'vehicleId'='10000000-0000-4000-8000-000000000002' from public.business_entities where id='11000000-0000-4000-8000-000000000002'),'finance may correct a historical trip linked to an archived vehicle');
reset role;
insert into auth.users(id,email,email_confirmed_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','deletion@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select set_config('qa.deletion_invite',public.business_invite_member(auth.uid(),qa.company('a'),'deletion@example.test','Pessoa removida','driver')::text,false);
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select set_config('qa.deletion',public.business_accept_invite(auth.uid(),current_setting('qa.deletion_invite')::jsonb->>'token')::text,false);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000004',0,qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',qa.member('deletion')));
reset role;
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select qa.check((select user_id is null and not active and archived_at is not null from public.business_members where id=qa.member('deletion')) and (select data->>'driverId'=qa.member('deletion')::text from public.business_entities where id='11000000-0000-4000-8000-000000000004'),'account deletion archives membership and preserves historical trip references');
select qa.reject('delete from auth.users where id=''11111111-1111-4111-8111-111111111111''',array['42501','22023'],'account deletion cannot leave a company without an active owner');
select qa.check((select count(*)=1 from auth.users where id='11111111-1111-4111-8111-111111111111'),'rejected owner account deletion is rolled back');


-- v3.2.3: one catalog assertion per exposed SECURITY DEFINER function.
-- The following transaction rolls back its synthetic extra writes so the runner's
-- independent-session fixtures keep their original revisions and memberships.
reset role;
begin;
do $$
declare f record; expected text[]:=array[
 'business_list_companies','business_create_company','business_load_workspace',
 'business_save_entity','business_archive_entity','business_save_member',
 'business_invite_member','business_revoke_invite','business_accept_invite',
 'business_membership_id','business_membership_role']; count_exposed integer:=0;
begin
 for f in select p.*,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=any(expected) order by p.proname loop
  perform qa.check(f.prosecdef and f.proconfig @> array['search_path=""'] and not f.proleakproof,
    'HML catalog definer, empty search_path and non-leakproof: '||f.proname);
  perform qa.check(has_function_privilege('authenticated',f.oid,'EXECUTE')
    and not has_function_privilege('anon',f.oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
    'HML authenticated-only EXECUTE: '||f.proname);
  count_exposed:=count_exposed+1;
 end loop;
 perform qa.check(count_exposed=11,'HML exactly 11 exposed SECURITY DEFINER functions reviewed');
 perform qa.check((select count(*)=2 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
   and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('business_guard','business_archive_deleted_user')),'HML guard and deletion trigger remain private definers');
 perform qa.check((select count(*)=4 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('business_companies','business_members','business_entities','business_invites')),'HML all four enterprise tables retain RLS and FORCE RLS');
 perform qa.check((select bool_and(not has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  and c.relname in ('business_companies','business_members','business_entities','business_invites')),'HML no direct enterprise write privilege is granted');
end; $$;
create function qa.rpc_probes(expected text) returns table(name text,command text) language sql as $$
 select * from (values
 ('business_list_companies',format('select public.business_list_companies(%s)',expected)),
 ('business_create_company',format('select public.business_create_company(%s,''HML synthetic'')',expected)),
 ('business_load_workspace',format('select public.business_load_workspace(%s,%L)',expected,qa.company('a'))),
 ('business_save_entity',format('select public.business_save_entity(%s,%L,''vehicle'',''10000000-0000-4000-8000-000000000001'',1,''{}''::jsonb)',expected,qa.company('a'))),
 ('business_archive_entity',format('select public.business_archive_entity(%s,%L,''vehicle'',''10000000-0000-4000-8000-000000000001'',1)',expected,qa.company('a'))),
 ('business_save_member',format('select public.business_save_member(%s,%L,%L,1,''{}''::jsonb)',expected,qa.company('a'),qa.member('a'))),
 ('business_invite_member',format('select public.business_invite_member(%s,%L,''probe@example.test'',''Probe'',''driver'')',expected,qa.company('a'))),
 ('business_revoke_invite',format('select public.business_revoke_invite(%s,%L,%L)',expected,qa.company('a'),current_setting('qa.pending_invite')::jsonb->'member'->>'id')),
 ('business_accept_invite',format('select public.business_accept_invite(%s,''invalid'')',expected))
 ) p(name,command);
$$;
grant execute on function qa.rpc_probes(text) to anon,authenticated;
set role anon;
do $$ declare f record; begin
 for f in select * from qa.rpc_probes('''11111111-1111-4111-8111-111111111111''') loop
  perform qa.reject(f.command,array['42501'],'HML anonymous call denied: '||f.name);
 end loop;
 perform qa.reject(format('select public.business_membership_id(%L)',qa.company('a')),array['42501'],'HML anonymous membership_id denied');
 perform qa.reject(format('select public.business_membership_role(%L)',qa.company('a')),array['42501'],'HML anonymous membership_role denied');
end; $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ declare f record; expected text; begin
 foreach expected in array array['''22222222-2222-4222-8222-222222222222''','null'] loop
  for f in select * from qa.rpc_probes(expected) loop
   perform qa.reject(f.command,array['28000'],'HML expected UID is checked before arguments: '||f.name||' ('||expected||')');
  end loop;
 end loop;
end; $$;
select set_config('request.jwt.claim.sub','',false);
do $$ declare f record; begin
 for f in select * from qa.rpc_probes('''11111111-1111-4111-8111-111111111111''') loop
  perform qa.reject(f.command,array['42501'],'HML absent JWT UID denied: '||f.name);
 end loop;
 perform qa.check(public.business_membership_id(qa.company('a')) is null and public.business_membership_role(qa.company('a')) is null,'HML both RLS helpers return NULL without JWT UID');
 perform qa.check((select count(*)=0 from public.business_companies) and (select count(*)=0 from public.business_members) and (select count(*)=0 from public.business_entities),'HML authenticated without UID sees no enterprise rows');
end; $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select qa.check(public.business_membership_id(qa.company('a')) is null and public.business_membership_role(qa.company('a')) is null,'HML B cannot obtain A membership through either helper');
do $$ declare f record; begin
 for f in select * from qa.rpc_probes('auth.uid()') where name in ('business_load_workspace','business_save_entity','business_archive_entity','business_save_member','business_invite_member','business_revoke_invite') loop
  perform qa.reject(f.command,array['42501'],'HML B cannot access company A: '||f.name);
 end loop;
end; $$;

-- Caller-controlled search_path and temp objects cannot shadow qualified lookups.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
create temporary table business_members(company_id uuid,user_id uuid,role text,active boolean,id uuid);
insert into pg_temp.business_members values(qa.company('b'),auth.uid(),'owner',true,qa.member('a'));
create function pg_temp.business_guard(uuid) returns uuid language sql as $$ select '22222222-2222-4222-8222-222222222222'::uuid $$;
create function pg_temp.business_membership_role(uuid) returns text language sql as $$ select 'owner'::text $$;
set search_path=pg_temp,public;
select qa.check(public.business_membership_role(qa.company('b')) is null and public.business_membership_id(qa.company('b')) is null,'HML temporary membership table/functions cannot forge a foreign-company role');
select qa.reject(format('select public.business_load_workspace(auth.uid(),%L)',qa.company('b')),array['42501'],'HML qualified workspace lookup resists caller search_path');
select qa.check(public.business_load_workspace(auth.uid(),qa.company('a'))->'membership'->>'userId'=auth.uid()::text,'HML own workspace keeps the actual JWT UID under hostile search_path');
set search_path=public;

-- Restore the fictional driver's membership only inside this rollback transaction.
select public.business_save_member(auth.uid(),qa.company('a'),qa.member('driver'),2,'{"name":"Motorista HML","role":"driver","active":true}'::jsonb);
select qa.check(public.business_membership_role(qa.company('a'))='owner' and public.business_membership_id(qa.company('a'))=qa.member('a'),'HML owner helpers identify only the active JWT membership');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select qa.check(public.business_membership_role(qa.company('a'))='manager' and public.business_membership_id(qa.company('a'))=qa.member('manager'),'HML manager helpers identify the active JWT membership');
select qa.check(public.business_load_workspace(auth.uid(),qa.company('a'))->'membership'->>'role'='manager','HML manager loads its company workspace');
select public.business_save_entity(auth.uid(),qa.company('a'),'vehicle','10000000-0000-4000-8000-000000000010',0,qa.vehicle(qa.company('a'),'10000000-0000-4000-8000-000000000010'));
select qa.check(qa.entity('10000000-0000-4000-8000-000000000010')->>'revision'='1','HML manager creates an operational vehicle');
select public.business_archive_entity(auth.uid(),qa.company('a'),'vehicle','10000000-0000-4000-8000-000000000010',1);
select qa.check(qa.entity('10000000-0000-4000-8000-000000000010')->'archivedAt'<>'null'::jsonb,'HML manager archives its company vehicle');
select public.business_save_entity(auth.uid(),qa.company('a'),'vehicle','10000000-0000-4000-8000-000000000010',2,jsonb_set(jsonb_set(qa.entity('10000000-0000-4000-8000-000000000010'),'{archivedAt}','null'),'{active}','true'));
select qa.check(qa.entity('10000000-0000-4000-8000-000000000010')->'archivedAt'='null'::jsonb and qa.entity('10000000-0000-4000-8000-000000000010')->'active'='true'::jsonb,'HML manager restores an archived vehicle by CAS');
select public.business_save_member(auth.uid(),qa.company('a'),qa.member('driver'),3,'{"name":"Motorista editado HML","role":"driver","active":true}'::jsonb);
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,3,''{"name":"Stale","role":"driver","active":true}''::jsonb)',qa.company('a'),qa.member('driver')),array['PT409'],'HML member stale CAS cannot replace a manager edit');
select set_config('qa.hml_manager_invite',public.business_invite_member(auth.uid(),qa.company('a'),'hml-manager-grant@example.test','HML','finance')::text,false);
select qa.check(public.business_revoke_invite(auth.uid(),qa.company('a'),(current_setting('qa.hml_manager_invite')::jsonb->'member'->>'id')::uuid)->>'revoked'='true','HML manager creates and revokes a finance invitation');
select qa.check(public.business_revoke_invite(auth.uid(),qa.company('a'),(current_setting('qa.hml_manager_invite')::jsonb->'member'->>'id')::uuid)->>'revoked'='true','HML authorized repeated revocation is idempotent');

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select qa.check(public.business_membership_role(qa.company('a'))='finance' and public.business_membership_id(qa.company('a'))=qa.member('finance'),'HML finance helpers identify the active JWT membership');
select qa.check(public.business_load_workspace(auth.uid(),qa.company('a'))->'membership'->>'role'='finance','HML finance loads reporting workspace');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000010'',0,%L::jsonb)',qa.company('a'),qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010',qa.member('driver'))),array['42501'],'HML finance cannot create new trips');
select qa.reject(format('select public.business_archive_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000002'',3)',qa.company('a')),array['42501'],'HML finance cannot archive trips');
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,4,''{"name":"Forge","role":"owner","active":true}''::jsonb)',qa.company('a'),qa.member('driver')),array['42501'],'HML finance cannot edit memberships');
select qa.reject(format('select public.business_revoke_invite(auth.uid(),%L,%L)',qa.company('a'),current_setting('qa.pending_invite')::jsonb->'member'->>'id'),array['42501'],'HML finance cannot revoke invitations');

select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select qa.check(public.business_membership_role(qa.company('a'))='driver' and public.business_membership_id(qa.company('a'))=qa.member('driver'),'HML driver helpers identify the active JWT membership');
select public.business_save_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000010',0,qa.trip(qa.company('a'),'11000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010',qa.member('driver')));
select qa.check(qa.entity('11000000-0000-4000-8000-000000000010')->>'driverId'=qa.member('driver')::text,'HML driver creates only a self-assigned trip');
select public.business_archive_entity(auth.uid(),qa.company('a'),'trip','11000000-0000-4000-8000-000000000010',1);
select qa.check(qa.entity('11000000-0000-4000-8000-000000000010')->'archivedAt'<>'null'::jsonb,'HML driver archives own trip');
select qa.reject(format('select public.business_archive_entity(auth.uid(),%L,''trip'',''11000000-0000-4000-8000-000000000002'',3)',qa.company('a')),array['42501'],'HML driver cannot archive another membership trip');
select qa.reject(format('select public.business_archive_entity(auth.uid(),%L,''vehicle'',''10000000-0000-4000-8000-000000000010'',3)',qa.company('a')),array['42501'],'HML driver cannot archive fleet');
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,4,''{"name":"Forge","role":"owner","active":true}''::jsonb)',qa.company('a'),qa.member('driver')),array['42501'],'HML driver cannot edit membership');
select qa.reject(format('select public.business_invite_member(auth.uid(),%L,''hml-forge@example.test'',''Forge'',''driver'')',qa.company('a')),array['42501'],'HML driver cannot invite a member');
select qa.reject(format('select public.business_revoke_invite(auth.uid(),%L,%L)',qa.company('a'),current_setting('qa.pending_invite')::jsonb->'member'->>'id'),array['42501'],'HML driver cannot revoke an invitation');

-- Creation is available to an authenticated account independently of its
-- role in another company, and always binds a fresh owner to the same UID.
do $$
declare uid uuid; created jsonb; previous_count integer; source_role text;
begin
 foreach uid in array array['11111111-1111-4111-8111-111111111111'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,'44444444-4444-4444-8444-444444444444'::uuid,'55555555-5555-4555-8555-555555555555'::uuid] loop
  perform set_config('request.jwt.claim.sub',uid::text,false);
  source_role:=public.business_membership_role(qa.company('a'));
  previous_count:=jsonb_array_length(public.business_list_companies(uid));
  created:=public.business_create_company(uid,'Nova empresa fictícia HML');
  perform qa.check(created->'membership'->>'userId'=uid::text and created->'membership'->>'role'='owner'
    and jsonb_array_length(public.business_list_companies(uid))=previous_count+1
    and public.business_membership_role(qa.company('a'))=source_role,
    'HML '||source_role||' may create its own company without altering its existing role');
 end loop;
end; $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select qa.reject($q$select public.business_create_company(auth.uid(),'')$q$,array['22023'],'HML company name cannot be empty');
select qa.reject($q$select public.business_create_company(auth.uid(),repeat('x',81))$q$,array['22023'],'HML company name cannot exceed 80 characters');
select qa.reject(format('select public.business_save_member(auth.uid(),%L,%L,1,''{"name":"Foreign","role":"driver","active":true}''::jsonb)',qa.company('a'),qa.member('b')),array['42501'],'HML own-company owner cannot edit a foreign membership ID');
select qa.reject(format('select public.business_archive_entity(auth.uid(),%L,''vehicle'',''20000000-0000-4000-8000-000000000001'',1)',qa.company('a')),array['42501'],'HML own-company owner cannot archive a foreign entity ID');
select qa.reject(format('select public.business_save_entity(auth.uid(),%L,''vehicle'',''20000000-0000-4000-8000-000000000001'',1,%L::jsonb)',qa.company('a'),qa.vehicle(qa.company('a'),'20000000-0000-4000-8000-000000000001')),array['42501'],'HML own-company owner cannot overwrite a foreign entity ID');

-- An invitation's issuer must retain permission when it is redeemed.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select set_config('qa.hml_stale_issuer',public.business_invite_member(auth.uid(),qa.company('a'),'pending@example.test','Pendente HML','driver')::text,false);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.business_save_member(auth.uid(),qa.company('a'),qa.member('manager'),1,'{"name":"Gestor revogado HML","role":"manager","active":false}'::jsonb);
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
select qa.reject(format('select public.business_accept_invite(auth.uid(),%L)',current_setting('qa.hml_stale_issuer')::jsonb->>'token'),array['42501'],'HML invitation loses authority after issuer revocation');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select qa.check(public.business_membership_id(qa.company('a')) is null and public.business_membership_role(qa.company('a')) is null,'HML revoked manager loses both helper values immediately');
select qa.check(not exists(select 1 from jsonb_array_elements(public.business_list_companies(auth.uid())) c where c->>'id'=qa.company('a')::text),'HML revoked manager no longer lists the revoked company');
select qa.reject(format('select public.business_load_workspace(auth.uid(),%L)',qa.company('a')),array['42501'],'HML revoked manager cannot restore connected workspace');
reset role;
rollback;
