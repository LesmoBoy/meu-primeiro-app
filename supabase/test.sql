-- Somente fixtures sintéticas no contêiner descartável de test-postgres.sh.
-- Não execute este arquivo em um projeto Supabase ou banco com dados reais.
\set ON_ERROR_STOP on
set client_min_messages = notice;
select set_config('rodagem.qa_snapshot', '{"version":1,"settings":null,"records":{"versao":1,"registros":[]},"routes":[],"gpsPreferences":{"enabled":false,"mode":"eco"},"journey":null}',false);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare s jsonb := current_setting('rodagem.qa_snapshot')::jsonb; result jsonb;
begin
  if public.rodagem_load_snapshot(auth.uid()) is not null then raise exception 'First load must be null'; end if;
  raise notice 'PASS first authenticated load is empty';
  result := public.rodagem_save_snapshot(auth.uid(),0,s);
  if result->>'revision' <> '1' or result->'payload' <> s or result->>'updated_at' is null then raise exception 'Bad creation envelope'; end if;
  raise notice 'PASS authenticated creation returns revision and server timestamp';
  result := public.rodagem_save_snapshot(auth.uid(),1,s);
  if result->>'revision' <> '2' then raise exception 'Revision did not increase'; end if;
  raise notice 'PASS matching revision advances atomically';
  begin
    perform public.rodagem_save_snapshot(auth.uid(),1,s);
    raise exception 'Stale write should conflict';
  exception when serialization_failure then null; end;
  if public.rodagem_load_snapshot(auth.uid())->>'revision' <> '2' then raise exception 'Stale write mutated stored row'; end if;
  raise notice 'PASS stale CAS cannot overwrite a newer revision';
  begin
    perform public.rodagem_save_snapshot(auth.uid(),0,s);
    raise exception 'Duplicate creation should conflict';
  exception when serialization_failure then null; end;
  raise notice 'PASS duplicate first save cannot replace an existing snapshot';
  begin
    update public.rodagem_sync set revision = 99;
    raise exception 'Direct revision mutation should be denied';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS column grants prevent client-chosen revisions';
  begin
    update public.rodagem_sync set user_id = '22222222-2222-4222-8222-222222222222';
    raise exception 'Owner transfer should be denied';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS clients cannot transfer ownership';
end;
$$;

do $$
declare
  s jsonb := current_setting('rodagem.qa_snapshot')::jsonb;
  bad jsonb;
  original jsonb := public.rodagem_load_snapshot(auth.uid());
  day jsonb := '{"tipo":"dia","id":"fixture-day","data":"2026-11-15","ganhos":18000,"combustivel":2000,"outros":1000,"entregas":20,"horas":600,"km":10000}';
  cases jsonb[];
begin
  cases := array[
    'null'::jsonb,
    '{}'::jsonb,
    jsonb_set(s,'{version}','2'),
    jsonb_set(s,'{records,registros}','[1]'),
    jsonb_set(s,'{records,registros}',jsonb_build_array(day,day)),
    jsonb_set(s,'{records,registros}',jsonb_build_array(jsonb_set(day,'{ganhos}','0.1'))),
    jsonb_set(s,'{records,registros}',jsonb_build_array(jsonb_set(day,'{data}','"2026-02-30"'))),
    jsonb_set(s,'{gpsPreferences,mode}','"invalid"'),
    jsonb_set(s,'{journey}','{"versao":1,"id":"j","estado":"running","data":"2026-11-15","iniciadaEm":1,"acumulado":0,"rodandoDesde":1}'),
    jsonb_set(s,'{routes}','[{"id":"route","track":{}}]'),
    s || '{"access_token":"must-not-be-in-snapshot"}'::jsonb,
    jsonb_set(s,'{settings}',jsonb_build_object('versao',2,'nome','A','modelo',repeat('x',5242880),'meta',0,'jornada',0,'configurado',true))
  ];
  foreach bad in array cases loop
    if public.rodagem_snapshot_valid(bad) then raise exception 'Invalid snapshot accepted by validator'; end if;
    begin
      perform public.rodagem_save_snapshot(auth.uid(),2,bad);
      raise exception 'Invalid snapshot saved';
    exception when invalid_parameter_value then null; end;
    if public.rodagem_load_snapshot(auth.uid()) <> original then raise exception 'Invalid snapshot changed original'; end if;
  end loop;
  raise notice 'PASS malformed, duplicate, fractional, impossible-date, running and oversized data retain existing records (12 cases)';
  if not public.rodagem_snapshot_valid(jsonb_set(s,'{records,registros}',jsonb_build_array(day))) then raise exception 'Valid daily record rejected'; end if;
  if not public.rodagem_snapshot_valid(jsonb_set(s,'{journey}','{"versao":1,"id":"j","estado":"paused","data":"2026-11-15","iniciadaEm":1,"acumulado":1000,"rodandoDesde":null}')) then raise exception 'Valid paused journey rejected'; end if;
  raise notice 'PASS valid financial records and paused journeys are accepted';
end;
$$;

do $$
declare
  s jsonb := current_setting('rodagem.qa_snapshot')::jsonb;
  profile jsonb := '{"versao":2,"nome":"Ana","modelo":"Meu veículo","trabalho":"taxi","jornada":8,"meta":20000,"categoria":"carro","ano":2020,"combustivel":"Gasolina","configurado":true}';
  invalid_profile jsonb;
begin
  if not public.rodagem_snapshot_valid(jsonb_set(s,'{settings}',profile)) then raise exception 'Valid vehicle profile rejected'; end if;
  foreach invalid_profile in array array[
    jsonb_set(profile,'{categoria}','"spaceship"'),
    jsonb_set(profile,'{trabalho}','"invalid"'),
    jsonb_set(profile,'{combustivel}','"invalid"'),
    jsonb_set(profile,'{ano}','1899'),
    jsonb_set(profile,'{ano}',to_jsonb(extract(year from current_date)::integer+2)),
    jsonb_set(profile,'{ano}','2020.5'),
    jsonb_set(profile,'{ano}','"2020"'),
    profile - 'ano',
    jsonb_set(profile,'{categoria}','"bicicleta"')
  ] loop
    if public.rodagem_snapshot_valid(jsonb_set(s,'{settings}',invalid_profile)) then raise exception 'Invalid vehicle profile accepted'; end if;
  end loop;
  raise notice 'PASS vehicle category, activity, fuel, year and bicycle-energy validation (9 invalid cases)';
end;
$$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$
declare n integer; s jsonb := current_setting('rodagem.qa_snapshot')::jsonb;
begin
  if public.rodagem_load_snapshot(auth.uid()) is not null then raise exception 'B saw A through load RPC'; end if;
  select count(*) into n from public.rodagem_sync;
  if n <> 0 then raise exception 'B saw A through table SELECT'; end if;
  raise notice 'PASS a second UID cannot read the first UID through RPC or table API';
  update public.rodagem_sync set payload = s where user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B updated A'; end if;
  delete from public.rodagem_sync where user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B deleted A'; end if;
  begin
    insert into public.rodagem_sync(user_id,payload) values ('11111111-1111-4111-8111-111111111111',s);
    raise exception 'B inserted for A';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS a second UID cannot insert, update or delete another UID';
  if public.rodagem_save_snapshot(auth.uid(),0,s)->>'revision' <> '1' then raise exception 'B cannot create own row'; end if;
  select count(*) into n from public.rodagem_sync;
  if n <> 1 then raise exception 'B sees more than its own row'; end if;
  raise notice 'PASS the second account saves independently';
  begin
    perform public.rodagem_load_snapshot('11111111-1111-4111-8111-111111111111');
    raise exception 'B JWT with expected A should be rejected';
  exception when invalid_authorization_specification then null; end;
  begin
    perform public.rodagem_save_snapshot('11111111-1111-4111-8111-111111111111',1,jsonb_set(s,'{gpsPreferences,enabled}','true'));
    raise exception 'A payload must not be written to B after token changes';
  exception when invalid_authorization_specification then null; end;
  if public.rodagem_load_snapshot(auth.uid())->>'revision' <> '1'
      or public.rodagem_load_snapshot(auth.uid())->'payload' <> s then raise exception 'Mismatched UID changed B snapshot'; end if;
  raise notice 'PASS expected UID rejects a token switch before either read or write';
end;
$$;

select set_config('request.jwt.claim.sub','',false);
do $$
begin
  begin
    perform public.rodagem_load_snapshot(auth.uid());
    raise exception 'Missing UID should fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.rodagem_save_snapshot(auth.uid(),0,current_setting('rodagem.qa_snapshot')::jsonb);
    raise exception 'Missing UID should fail';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.rodagem_sync) then raise exception 'Missing UID can see data'; end if;
  raise notice 'PASS authenticated role without JWT UID cannot read or save';
end;
$$;
reset role;
set role anon;
do $$
begin
  begin
    perform public.rodagem_load_snapshot('11111111-1111-4111-8111-111111111111');
    raise exception 'Anonymous RPC should be denied';
  exception when insufficient_privilege then null; end;
  begin
    perform count(*) from public.rodagem_sync;
    raise exception 'Anonymous table SELECT should be denied';
  exception when insufficient_privilege then null; end;
  begin
    perform public.rodagem_save_snapshot('11111111-1111-4111-8111-111111111111',0,current_setting('rodagem.qa_snapshot')::jsonb);
    raise exception 'Anonymous save should be denied';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS anonymous role has neither table nor RPC access';
end;
$$;
reset role;
do $$
begin
  delete from auth.users where id = '22222222-2222-4222-8222-222222222222';
  if exists(select 1 from public.rodagem_sync where user_id = '22222222-2222-4222-8222-222222222222') then raise exception 'Account deletion did not cascade'; end if;
  if (select count(*) from public.rodagem_sync) <> 1 then raise exception 'Account deletion removed another account'; end if;
  raise notice 'PASS deleting an Auth user removes only that account snapshot';
  if to_regprocedure('public.rodagem_load_snapshot()') is not null
      or to_regprocedure('public.rodagem_save_snapshot(bigint,jsonb)') is not null then
    raise exception 'Old endpoints without expected UID still exist';
  end if;
  raise notice 'PASS insecure legacy RPC overloads are absent';
end;
$$;
