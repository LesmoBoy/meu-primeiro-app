-- Minha Rodagem: sincronização pessoal autenticada, com revisão otimista.
-- Execute uma vez no SQL Editor de um projeto Supabase dedicado ao app.
-- O aplicativo usa somente a chave pública (publishable/anon), nunca service_role.
begin;

create or replace function public.rodagem_json_uint(value jsonb, maximum numeric default 10000000000)
returns boolean language plpgsql immutable parallel safe set search_path = '' as $$
declare n numeric;
begin
  if jsonb_typeof(value) is distinct from 'number' then return false; end if;
  n := value::text::numeric;
  return n >= 0 and n <= maximum and n = trunc(n);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Matches the persisted GPS shape read by RodagemGeo.validate(). The optional
-- lastSeenAt field keeps routes from earlier app versions readable.
create or replace function public.rodagem_track_valid(track jsonb)
returns boolean language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare
  route_id text;
  id_units integer;
  i integer;
  point_count integer;
  candidates jsonb;
  candidate jsonb;
  last_point jsonb;
  last_seen jsonb;
  previous_time numeric := null;
  sample_time numeric;
  whitespace text := E' \t\n\f\r' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194)
    || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
    || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  if track is null or jsonb_typeof(track) is distinct from 'object'
      or track->'version' is distinct from '1'::jsonb
      or jsonb_typeof(track->'id') is distinct from 'string'
      or coalesce(track->>'mode','') not in ('eco','precise')
      or jsonb_typeof(track->'enabled') is distinct from 'boolean'
      or jsonb_typeof(track->'totalMeters') is distinct from 'number'
      or (track->>'totalMeters')::numeric < 0 or (track->>'totalMeters')::numeric > 100000000
      or jsonb_typeof(track->'points') is distinct from 'array'
      or not public.rodagem_json_uint(track->'gaps',1000000)
      or not public.rodagem_json_uint(track->'createdAt',8640000000000000)
      or not public.rodagem_json_uint(track->'updatedAt',8640000000000000)
      or not public.rodagem_json_uint(track->'lastSampleAt',8640000000000000)
      or (track->>'updatedAt')::numeric < (track->>'createdAt')::numeric
      or (track->>'lastSampleAt')::numeric > (track->>'updatedAt')::numeric
      or not (track ? 'lastFix') then return false; end if;
  route_id := track->>'id';
  id_units := length(route_id);
  if id_units not between 1 and 100 or btrim(route_id,whitespace)='' then return false; end if;
  -- JavaScript bounds this identifier by UTF-16 units, not Unicode code points.
  for i in 1..length(route_id) loop
    if ascii(substr(route_id,i,1)) > 65535 then id_units := id_units + 1; end if;
  end loop;
  if id_units > 100 then return false; end if;
  last_seen := case when track ? 'lastSeenAt' then track->'lastSeenAt' else track->'lastSampleAt' end;
  if not public.rodagem_json_uint(last_seen,8640000000000000)
      or (last_seen#>>'{}')::numeric < (track->>'lastSampleAt')::numeric
      or (last_seen#>>'{}')::numeric > (track->>'updatedAt')::numeric then return false; end if;
  point_count := jsonb_array_length(track->'points');
  if point_count > 4000 then return false; end if;
  candidates := track->'points';
  if track->'lastFix' <> 'null'::jsonb then
    if jsonb_typeof(track->'lastFix') is distinct from 'object' or point_count=0 then return false; end if;
    candidates := candidates || jsonb_build_array(track->'lastFix');
  end if;
  last_point := case when point_count>0 then track->'points'->(point_count-1) else null end;
  for i in 0..jsonb_array_length(candidates)-1 loop
    candidate := candidates->i;
    if jsonb_typeof(candidate) is distinct from 'object'
        or jsonb_typeof(candidate->'lat') is distinct from 'number'
        or (candidate->>'lat')::numeric < -90 or (candidate->>'lat')::numeric > 90
        or jsonb_typeof(candidate->'lng') is distinct from 'number'
        or (candidate->>'lng')::numeric < -180 or (candidate->>'lng')::numeric > 180
        or not public.rodagem_json_uint(candidate->'t',8640000000000000)
        or jsonb_typeof(candidate->'accuracy') is distinct from 'number'
        or (candidate->>'accuracy')::numeric < 0 or (candidate->>'accuracy')::numeric > 10000000
        or jsonb_typeof(candidate->'break') is distinct from 'boolean' then return false; end if;
    sample_time := (candidate->>'t')::numeric;
    if i < point_count then
      if sample_time < (track->>'createdAt')::numeric or sample_time > (track->>'updatedAt')::numeric
          or (previous_time is not null and sample_time <= previous_time) then return false; end if;
      previous_time := sample_time;
    else
      if candidate->'t' is distinct from track->'lastSampleAt'
          or candidate->'t' is distinct from last_point->'t'
          or candidate->'lat' is distinct from last_point->'lat'
          or candidate->'lng' is distinct from last_point->'lng' then return false; end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.rodagem_snapshot_valid(snapshot jsonb)
returns boolean language plpgsql stable parallel safe set search_path = '' as $$
declare
  entry jsonb;
  field text;
  settings jsonb;
  journey jsonb;
  day text;
begin
  if snapshot is null or jsonb_typeof(snapshot) is distinct from 'object'
      or octet_length(snapshot::text) > 5242880
      or snapshot->'version' is distinct from '1'::jsonb
      or not (snapshot ?& array['version','settings','records','routes','gpsPreferences','journey'])
      or exists (select 1 from jsonb_object_keys(snapshot) key where key <> all(array['version','settings','records','routes','gpsPreferences','journey']))
      then return false; end if;
  settings := snapshot->'settings';
  if settings <> 'null'::jsonb then
    if jsonb_typeof(settings) is distinct from 'object'
        or settings->'versao' not in ('1'::jsonb,'2'::jsonb)
        or settings->'versao' is null
        or jsonb_typeof(settings->'nome') is distinct from 'string'
        or length(settings->>'nome') > 32
        or jsonb_typeof(settings->'modelo') is distinct from 'string'
        or length(settings->>'modelo') > 60
        or not public.rodagem_json_uint(settings->'meta')
        or jsonb_typeof(settings->'jornada') is distinct from 'number'
        or (settings->>'jornada')::numeric < 0 or (settings->>'jornada')::numeric > 24
        or jsonb_typeof(settings->'configurado') is distinct from 'boolean'
        then return false; end if;
    if coalesce(settings->>'trabalho','') not in ('apps','restaurante','encomendas','taxi','passageiros-app','frete','logistica','transporte-escolar','fretamento','coletivo','servicos-campo','mobilidade-corporativa','misto')
        or coalesce(settings->>'combustivel','') not in ('Gasolina','Etanol','Flex / alternado','Diesel','GNV','Elétrico','Híbrido','Sem combustível','Outro')
        then return false; end if;
    if settings->>'versao' = '1' then
      if length(settings->>'modelo') > 40
          or coalesce(settings->>'moto','') not in ('110–160 cc','200–300 cc','Scooter','Outra moto')
          or settings->>'trabalho' not in ('apps','restaurante','encomendas','misto')
          or settings->>'combustivel' not in ('Gasolina','Etanol','Flex / alternado')
          then return false; end if;
    else
      if coalesce(settings->>'categoria','') not in ('moto','bicicleta','bicicleta-eletrica','carro','utilitario','van','caminhao','onibus','trator','barco','outro')
          or not (settings ? 'ano') then return false; end if;
      if settings->'ano' <> 'null'::jsonb and
          (not public.rodagem_json_uint(settings->'ano',9999)
          or (settings->>'ano')::numeric < 1900
          or (settings->>'ano')::numeric > extract(year from current_date) + 1)
          then return false; end if;
      if (settings->>'categoria' = 'bicicleta' and settings->>'combustivel' <> 'Sem combustível')
          or (settings->>'categoria' = 'bicicleta-eletrica' and settings->>'combustivel' <> 'Elétrico')
          then return false; end if;
    end if;
  end if;
  if jsonb_typeof(snapshot->'records') is distinct from 'object'
      or snapshot->'records'->'versao' is distinct from '1'::jsonb
      or jsonb_typeof(snapshot->'records'->'registros') is distinct from 'array'
      then return false; end if;
  for entry in select value from jsonb_array_elements(snapshot->'records'->'registros') loop
    if jsonb_typeof(entry) is distinct from 'object'
        or jsonb_typeof(entry->'id') is distinct from 'string'
        or length(entry->>'id') not between 1 and 100
        or coalesce(entry->>'tipo','') not in ('dia','posto')
        or jsonb_typeof(entry->'data') is distinct from 'string'
        then return false; end if;
    day := entry->>'data';
    if day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or day like '0000-%'
        or to_char(day::date,'YYYY-MM-DD') <> day then return false; end if;
    if entry->>'tipo' = 'dia' then
      foreach field in array array['ganhos','combustivel','outros','entregas','horas','km'] loop
        if not public.rodagem_json_uint(entry->field) then return false; end if;
      end loop;
      if entry ? 'jornadaId' and (jsonb_typeof(entry->'jornadaId') is distinct from 'string'
          or length(entry->>'jornadaId') not between 1 and 100) then return false; end if;
    else
      foreach field in array array['odometro','litros','valor'] loop
        if not public.rodagem_json_uint(entry->field) then return false; end if;
      end loop;
      if (entry->>'litros')::numeric < 1 or coalesce(entry->>'tanque','') not in ('cheio','parcial')
          then return false; end if;
    end if;
  end loop;
  if (select count(*) <> count(distinct r->>'id') from jsonb_array_elements(snapshot->'records'->'registros') r)
      or (select count(*) <> count(distinct r->>'jornadaId') from jsonb_array_elements(snapshot->'records'->'registros') r where r->>'tipo' = 'dia' and r ? 'jornadaId')
      or (select count(*) <> count(distinct (r->>'odometro')::numeric) from jsonb_array_elements(snapshot->'records'->'registros') r where r->>'tipo' = 'posto')
      then return false; end if;
  if jsonb_typeof(snapshot->'routes') is distinct from 'array'
      or jsonb_array_length(snapshot->'routes') > 10 then return false; end if;
  for entry in select value from jsonb_array_elements(snapshot->'routes') loop
    if jsonb_typeof(entry) is distinct from 'object'
        or jsonb_typeof(entry->'id') is distinct from 'string'
        or length(entry->>'id') not between 1 and 100
        or not public.rodagem_track_valid(entry->'track')
        or entry->'track'->'id' is distinct from entry->'id'
        or not public.rodagem_json_uint(entry->'updatedAt',8640000000000000)
        or entry->'track'->'updatedAt' is distinct from entry->'updatedAt'
        or jsonb_typeof(entry->'finished') is distinct from 'boolean'
        then return false; end if;
  end loop;
  if (select count(*) <> count(distinct r->>'id') from jsonb_array_elements(snapshot->'routes') r)
      then return false; end if;
  if jsonb_typeof(snapshot->'gpsPreferences') is distinct from 'object'
      or jsonb_typeof(snapshot->'gpsPreferences'->'enabled') is distinct from 'boolean'
      or coalesce(snapshot->'gpsPreferences'->>'mode','') not in ('eco','precise')
      then return false; end if;
  journey := snapshot->'journey';
  if journey <> 'null'::jsonb then
    if jsonb_typeof(journey) is distinct from 'object'
        or journey->'versao' is distinct from '1'::jsonb
        or jsonb_typeof(journey->'id') is distinct from 'string'
        or length(journey->>'id') not between 1 and 100
        or coalesce(journey->>'estado','') not in ('paused','pending')
        or jsonb_typeof(journey->'data') is distinct from 'string'
        or journey->'rodandoDesde' is distinct from 'null'::jsonb
        or not public.rodagem_json_uint(journey->'iniciadaEm',8640000000000000)
        or not public.rodagem_json_uint(journey->'acumulado',9007199254740991)
        then return false; end if;
    day := journey->>'data';
    if day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or day like '0000-%'
        or to_char(day::date,'YYYY-MM-DD') <> day then return false; end if;
  end if;
  return true;
exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then return false;
end;
$$;

create table if not exists public.rodagem_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  payload jsonb not null check (public.rodagem_snapshot_valid(payload)),
  updated_at timestamptz not null default now()
);

create or replace function public.rodagem_sync_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.revision := 1;
  else
    if new.user_id is distinct from old.user_id then
      raise exception using errcode = '42501', message = 'Não é permitido transferir os dados para outra conta.';
    end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists rodagem_sync_stamp on public.rodagem_sync;
create trigger rodagem_sync_stamp before insert or update on public.rodagem_sync
for each row execute function public.rodagem_sync_stamp();

alter table public.rodagem_sync enable row level security;
alter table public.rodagem_sync force row level security;
drop policy if exists rodagem_sync_select on public.rodagem_sync;
drop policy if exists rodagem_sync_insert on public.rodagem_sync;
drop policy if exists rodagem_sync_update on public.rodagem_sync;
drop policy if exists rodagem_sync_delete on public.rodagem_sync;
create policy rodagem_sync_select on public.rodagem_sync for select to authenticated
using (user_id = (select auth.uid()));
create policy rodagem_sync_insert on public.rodagem_sync for insert to authenticated
with check (user_id = (select auth.uid()));
create policy rodagem_sync_update on public.rodagem_sync for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy rodagem_sync_delete on public.rodagem_sync for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.rodagem_sync from public, anon, authenticated;
grant select, delete on table public.rodagem_sync to authenticated;
grant insert (user_id,payload), update (payload) on table public.rodagem_sync to authenticated;

-- Remove endpoints antigos sem vínculo de UID, caso a migração seja reaplicada.
drop function if exists public.rodagem_load_snapshot();
drop function if exists public.rodagem_save_snapshot(bigint,jsonb);

create or replace function public.rodagem_load_snapshot(expected_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare owner_id uuid := auth.uid(); result jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'Entre na sua conta para sincronizar.';
  end if;
  if expected_user_id is null or owner_id is distinct from expected_user_id then
    raise exception using errcode = '28000', message = 'A conta mudou durante a sincronização. Entre novamente antes de continuar.';
  end if;
  select jsonb_build_object('revision',s.revision,'payload',s.payload,'updated_at',s.updated_at)
  into result from public.rodagem_sync s where s.user_id = owner_id;
  return result;
end;
$$;

create or replace function public.rodagem_save_snapshot(expected_user_id uuid, expected_revision bigint, snapshot jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare owner_id uuid := auth.uid(); saved public.rodagem_sync%rowtype;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'Entre na sua conta para sincronizar.';
  end if;
  if expected_user_id is null or owner_id is distinct from expected_user_id then
    raise exception using errcode = '28000', message = 'A conta mudou durante a sincronização. Entre novamente antes de continuar.';
  end if;
  if expected_revision is null or expected_revision < 0 or expected_revision > 9007199254740991
      or not public.rodagem_snapshot_valid(snapshot) then
    raise exception using errcode = '22023', message = 'A cópia de sincronização é inválida ou excede 5 MiB.';
  end if;
  if expected_revision = 0 then
    insert into public.rodagem_sync(user_id,payload) values (owner_id,snapshot)
    on conflict (user_id) do nothing returning * into saved;
  else
    update public.rodagem_sync set payload = snapshot
    where user_id = owner_id and revision = expected_revision returning * into saved;
  end if;
  if saved.user_id is null then
    raise exception using errcode = 'PT409', message = 'Os dados mudaram na nuvem. Confira a versão mais recente antes de enviar novamente.';
  end if;
  return jsonb_build_object('revision',saved.revision,'payload',saved.payload,'updated_at',saved.updated_at);
end;
$$;

revoke all on function public.rodagem_json_uint(jsonb,numeric) from public, anon;
revoke all on function public.rodagem_track_valid(jsonb) from public, anon;
revoke all on function public.rodagem_snapshot_valid(jsonb) from public, anon;
revoke all on function public.rodagem_sync_stamp() from public, anon;
revoke all on function public.rodagem_load_snapshot(uuid) from public, anon;
revoke all on function public.rodagem_save_snapshot(uuid,bigint,jsonb) from public, anon;
grant execute on function public.rodagem_json_uint(jsonb,numeric) to authenticated;
grant execute on function public.rodagem_track_valid(jsonb) to authenticated;
grant execute on function public.rodagem_snapshot_valid(jsonb) to authenticated;
grant execute on function public.rodagem_load_snapshot(uuid) to authenticated;
grant execute on function public.rodagem_save_snapshot(uuid,bigint,jsonb) to authenticated;
commit;
