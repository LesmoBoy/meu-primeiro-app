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
  exception when sqlstate 'PT409' then null; end;
  if public.rodagem_load_snapshot(auth.uid())->>'revision' <> '2' then raise exception 'Stale write mutated stored row'; end if;
  raise notice 'PASS stale CAS cannot overwrite a newer revision';
  begin
    perform public.rodagem_save_snapshot(auth.uid(),0,s);
    raise exception 'Duplicate creation should conflict';
  exception when sqlstate 'PT409' then null; end;
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
  track jsonb := '{"version":1,"id":"route-valid","mode":"eco","enabled":true,"totalMeters":100,"points":[{"lat":-23.55,"lng":-46.63,"t":1000,"accuracy":5,"break":true},{"lat":-23.5491,"lng":-46.63,"t":16000,"accuracy":5,"break":false}],"gaps":0,"lastFix":{"lat":-23.5491,"lng":-46.63,"t":16000,"accuracy":5,"break":false,"speed":5},"lastSampleAt":16000,"lastSeenAt":25000,"createdAt":1000,"updatedAt":25000}';
  entry jsonb;
  bad_track jsonb;
  bad jsonb;
  original jsonb := public.rodagem_load_snapshot(auth.uid());
  saved jsonb;
  variants jsonb[];
begin
  entry := jsonb_build_object('id','route-valid','updatedAt',25000,'finished',true,'track',track);
  if not public.rodagem_track_valid(track) or not public.rodagem_snapshot_valid(jsonb_set(s,'{routes}',jsonb_build_array(entry))) then raise exception 'Valid GPS route rejected'; end if;
  -- Exercise the actual CHECK/RPC, then roll back only this synthetic save so
  -- the later two-session CAS fixture still starts at revision 2.
  begin
    saved := public.rodagem_save_snapshot(auth.uid(),2,jsonb_set(s,'{routes}',jsonb_build_array(entry)));
    if saved->>'revision'<>'3' then raise exception 'Valid route was not saved'; end if;
    raise exception using errcode='PZ001',message='Rollback successful GPS fixture';
  exception when sqlstate 'PZ001' then null; end;
  if public.rodagem_load_snapshot(auth.uid())<>original then raise exception 'Successful GPS fixture rollback failed'; end if;
  if not public.rodagem_track_valid(track-'lastSeenAt') then raise exception 'Legacy route without lastSeenAt rejected'; end if;
  if not public.rodagem_track_valid(jsonb_set(jsonb_set(jsonb_set(track,'{lastFix}','null'),'{lastSampleAt}','25000'),'{lastSeenAt}','25000')) then raise exception 'Valid paused GPS route rejected'; end if;
  if not public.rodagem_track_valid(jsonb_set(track,'{id}','"v"')) then raise exception 'Valid ASCII route identifier rejected'; end if;
  if not public.rodagem_track_valid(track || '{"points":[],"lastFix":null,"totalMeters":0,"lastSampleAt":0,"lastSeenAt":0}') then raise exception 'Valid empty baseline route rejected'; end if;
  raise notice 'PASS normal and paused GPS routes save; legacy lastSeenAt remains compatible';
  variants := array[
    jsonb_build_object('version',1,'id','route-valid','points',jsonb_build_array(jsonb_build_object('lat',999))),
    track-'mode',jsonb_set(track,'{mode}','"invalid"'),track-'enabled',jsonb_set(track,'{enabled}','"true"'),
    track-'totalMeters',jsonb_set(track,'{totalMeters}','-1'),jsonb_set(track,'{totalMeters}','100000001'),
    jsonb_set(track,'{gaps}','1000001'),jsonb_set(track,'{gaps}','0.5'),
    jsonb_set(track,'{points,0,lat}','91'),jsonb_set(track,'{points,0,lng}','181'),
    jsonb_set(track,'{points,0,accuracy}','-1'),jsonb_set(track,'{points,0,accuracy}','10000001'),
    (track#-'{points,0,break}'),jsonb_set(track,'{points,0,t}','999'),jsonb_set(track,'{points,1,t}','1000'),
    jsonb_set(track,'{updatedAt}','999'),jsonb_set(track,'{lastSampleAt}','25001'),jsonb_set(track,'{lastSeenAt}','15999'),
    jsonb_set(track,'{lastSeenAt}','25001'),jsonb_set(track,'{lastSeenAt}','null'),
    track-'lastFix',jsonb_set(track,'{lastFix,lat}','0'),jsonb_set(track,'{lastFix,t}','16001'),
    jsonb_set(track,'{points}','[]'),jsonb_set(track,'{id}','" "')
  ];
  foreach bad_track in array variants loop
    if public.rodagem_track_valid(bad_track) then raise exception 'Unreadable GPS track accepted'; end if;
    bad := jsonb_set(s,'{routes}',jsonb_build_array(entry||jsonb_build_object('track',bad_track)));
    if public.rodagem_snapshot_valid(bad) then raise exception 'Unreadable GPS snapshot accepted'; end if;
    begin
      perform public.rodagem_save_snapshot(auth.uid(),2,bad);
      raise exception 'Unreadable GPS snapshot saved';
    exception when invalid_parameter_value then null; end;
    if public.rodagem_load_snapshot(auth.uid())<>original then raise exception 'Rejected GPS snapshot changed original'; end if;
  end loop;
  if public.rodagem_snapshot_valid(jsonb_set(s,'{routes}',jsonb_build_array(jsonb_set(entry,'{updatedAt}','24999')))) then raise exception 'Inconsistent route timestamp accepted'; end if;
  if public.rodagem_snapshot_valid(jsonb_set(s,'{routes}',jsonb_build_array(jsonb_set(entry,'{id}','"other-route"')))) then raise exception 'Inconsistent route identifier accepted'; end if;
  raise notice 'PASS GPS shape, numeric bounds, timestamps and lastFix reject unreadable snapshots (27 track cases plus entry correlations)';
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
  begin
    perform public.rodagem_track_valid('{}'::jsonb);
    raise exception 'Anonymous GPS validator should be denied';
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

-- v3.2.3 round trip with a fictional local profile, daily record and paused journey.
-- Roll back so the two-session CAS runner still begins with A at revision 2.
begin;
insert into auth.users values('22222222-2222-4222-8222-222222222222');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare
 s jsonb:=current_setting('rodagem.qa_snapshot')::jsonb;
 sent jsonb; loaded jsonb;
begin
 s:=jsonb_set(s,'{settings}','{"versao":2,"nome":"Perfil sintético HML","modelo":"Veículo fictício","trabalho":"taxi","jornada":8,"meta":20000,"categoria":"carro","ano":2020,"combustivel":"Gasolina","configurado":true}');
 s:=jsonb_set(s,'{records,registros}','[{"tipo":"dia","id":"hml-fictional-day","data":"2026-11-25","ganhos":20000,"combustivel":3000,"outros":500,"entregas":10,"horas":480,"km":12500,"jornadaId":"hml-paused"}]');
 s:=jsonb_set(s,'{journey}','{"versao":1,"id":"hml-paused","estado":"paused","data":"2026-11-25","iniciadaEm":1000,"acumulado":120000,"rodandoDesde":null}');
 sent:=public.rodagem_save_snapshot(auth.uid(),2,s);
 loaded:=public.rodagem_load_snapshot(auth.uid());
 if sent<>loaded or loaded->'payload'<>s or loaded->>'revision'<>'3' then raise exception 'HML synthetic upload/restore did not preserve exact payload'; end if;
 perform set_config('rodagem.qa_hml_saved',loaded::text,false);
 raise notice 'PASS HML linked UID A uploads and restores exact fictional profile, record and paused journey';
end; $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$
declare s jsonb:=current_setting('rodagem.qa_snapshot')::jsonb;
begin
 if public.rodagem_load_snapshot(auth.uid()) is not null then raise exception 'HML clean B restored A payload'; end if;
 begin
  perform public.rodagem_save_snapshot('11111111-1111-4111-8111-111111111111',3,s);
  raise exception 'HML token-switch upload should fail';
 exception when invalid_authorization_specification then null; end;
 if public.rodagem_load_snapshot(auth.uid()) is not null then raise exception 'HML token switch populated B'; end if;
 if public.rodagem_save_snapshot(auth.uid(),0,s)->'payload'<>s then raise exception 'HML B upload failed'; end if;
 raise notice 'PASS HML UID switch blocks A upload into B and B restores only its own fictional snapshot';
end; $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ begin
 if public.rodagem_load_snapshot(auth.uid())<>current_setting('rodagem.qa_hml_saved')::jsonb then raise exception 'HML B activity changed restored A payload'; end if;
 raise notice 'PASS HML returning to UID A restores the original exact server envelope';
end; $$;
reset role;
do $$ begin
 if (select count(*)<>2 or bool_or(prosecdef) or not bool_and(proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('rodagem_load_snapshot','rodagem_save_snapshot'))
 then raise exception 'HML personal RPC privilege model changed'; end if;
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.rodagem_sync'::regclass) then raise exception 'HML personal RLS/FORCE changed'; end if;
 raise notice 'PASS HML personal upload/load remain SECURITY INVOKER with empty search_path and RLS/FORCE';
end; $$;
rollback;
