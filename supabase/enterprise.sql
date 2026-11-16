-- Apply after schema.sql in the Supabase SQL Editor, using the project owner.
-- Business RPCs validate JWT UID, membership, role, references and revisions.
begin;
create table if not exists public.business_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.business_companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('owner','manager','finance','driver')),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  email text not null default '',
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(company_id,user_id)
);
create index if not exists business_members_user on public.business_members(user_id,company_id) where active;
create table if not exists public.business_entities (
  id uuid primary key,
  company_id uuid not null references public.business_companies(id) on delete cascade,
  kind text not null check (kind in ('vehicle','trip','reminder')),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  data jsonb not null check (jsonb_typeof(data)='object' and octet_length(data::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists business_entities_company on public.business_entities(company_id,kind);
create table if not exists public.business_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.business_companies(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null check (role in ('manager','finance','driver')),
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists business_invites_company on public.business_invites(company_id,email);

-- Preserve staff and vehicle history when a former team member deletes an account.
-- These ALTERs also repair an earlier, partially applied draft of this migration.
alter table public.business_companies alter column created_by drop not null;
alter table public.business_companies drop constraint if exists business_companies_created_by_fkey;
alter table public.business_companies add constraint business_companies_created_by_fkey foreign key(created_by) references auth.users(id) on delete set null;
alter table public.business_members alter column user_id drop not null;
alter table public.business_members drop constraint if exists business_members_user_id_fkey;
alter table public.business_members add constraint business_members_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
alter table public.business_invites alter column invited_by drop not null;
alter table public.business_invites drop constraint if exists business_invites_invited_by_fkey;
alter table public.business_invites add constraint business_invites_invited_by_fkey foreign key(invited_by) references auth.users(id) on delete set null;

create or replace function public.business_guard(expected_user_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare who uuid := auth.uid();
begin
  if who is null then raise exception using errcode='42501',message='Entre na sua conta para acessar a empresa.'; end if;
  if expected_user_id is null or who is distinct from expected_user_id then
    raise exception using errcode='28000',message='A conta mudou. Entre novamente antes de continuar.';
  end if;
  return who;
end; $$;
create or replace function public.business_membership_role(company_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select m.role from public.business_members m where m.company_id=$1 and m.user_id=auth.uid() and m.active;
$$;
create or replace function public.business_membership_id(company_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select m.id from public.business_members m where m.company_id=$1 and m.user_id=auth.uid() and m.active;
$$;
create or replace function public.business_entity_json(entity public.business_entities)
returns jsonb language sql stable set search_path='' as $$
  select entity.data || jsonb_build_object('id',entity.id,'companyId',entity.company_id,'revision',entity.revision,'archivedAt',entity.archived_at)
    || case when entity.kind='trip' then jsonb_build_object('createdAt',entity.created_at) else '{}'::jsonb end;
$$;
create or replace function public.business_member_json(member public.business_members)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',member.id,'companyId',member.company_id,'userId',member.user_id,'name',member.display_name,
    'email',member.email,'role',member.role,'status','active','revision',member.revision,'archivedAt',member.archived_at);
$$;
create or replace function public.business_valid_text(value jsonb, maximum integer, optional boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(value)='string' and length(btrim(value#>>'{}')) between case when optional then 0 else 1 end and maximum
    and (value#>>'{}') !~ '[[:cntrl:]]',false);
$$;
create or replace function public.business_valid_date(value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare day text := value#>>'{}';
begin
  return coalesce(jsonb_typeof(value)='string' and day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and day not like '0000-%' and to_char(day::date,'YYYY-MM-DD')=day,false);
exception when others then return false;
end; $$;
create or replace function public.business_valid_timestamp(value jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare stamp text := value#>>'{}';
begin
  if value='null'::jsonb then return true; end if;
  if jsonb_typeof(value) is distinct from 'string' or stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or stamp like '0000-%' then return false; end if;
  perform stamp::timestamptz;
  return true;
exception when others then return false;
end; $$;
create or replace function public.business_validate_entity(entity_kind text, entity_data jsonb)
returns void language plpgsql stable set search_path='' as $$
declare key text; value jsonb; number numeric;
begin
  if jsonb_typeof(entity_data) is distinct from 'object' or octet_length(entity_data::text)>65536 then raise exception using errcode='22023',message='Dados da empresa inválidos.'; end if;
  if entity_data ? 'archivedAt' and not public.business_valid_timestamp(entity_data->'archivedAt') then raise exception using errcode='22023',message='A data de arquivamento é inválida.'; end if;
  if entity_kind='vehicle' then
    if exists(select 1 from jsonb_object_keys(entity_data) k where k<>all(array['id','companyId','revision','archivedAt','name','category','fuel','plate','odometer','active','year'])) then raise exception using errcode='22023',message='Campo de veículo desconhecido.'; end if;
    if entity_data->'archivedAt'<>'null'::jsonb and entity_data->'active'='true'::jsonb then raise exception using errcode='22023',message='Um veículo arquivado precisa estar inativo.'; end if;
    if not public.business_valid_text(entity_data->'name',60)
      or coalesce(entity_data->>'category','') not in ('moto','bicicleta','bicicleta-eletrica','carro','utilitario','van','caminhao','onibus','trator','barco','outro')
      or coalesce(entity_data->>'fuel','') not in ('Gasolina','Etanol','Flex / alternado','Diesel','GNV','Elétrico','Híbrido','Sem combustível','Outro')
      or not public.business_valid_text(entity_data->'plate',20,true)
      or not public.rodagem_json_uint(entity_data->'odometer')
      or jsonb_typeof(entity_data->'active') is distinct from 'boolean'
      or not (entity_data ? 'year') then raise exception using errcode='22023',message='Confira a categoria, o nome e os dados do veículo.'; end if;
    if entity_data->'year'<>'null'::jsonb and (not public.rodagem_json_uint(entity_data->'year',9999) or (entity_data->>'year')::numeric<1900 or (entity_data->>'year')::numeric>extract(year from current_date)+1) then raise exception using errcode='22023',message='Confira o ano do veículo.'; end if;
    if (entity_data->>'category'='bicicleta' and entity_data->>'fuel'<>'Sem combustível') or (entity_data->>'category'='bicicleta-eletrica' and entity_data->>'fuel'<>'Elétrico') then raise exception using errcode='22023',message='Confira a energia da bicicleta.'; end if;
  elsif entity_kind='trip' then
    if exists(select 1 from jsonb_object_keys(entity_data) k where k<>all(array['id','companyId','revision','archivedAt','createdAt','vehicleId','driverId','date','title','customer','status','revenue','distance','costs'])) then raise exception using errcode='22023',message='Campo de viagem desconhecido.'; end if;
    if not public.business_valid_text(entity_data->'title',120) or not public.business_valid_text(entity_data->'customer',120,true)
      or not public.business_valid_date(entity_data->'date') or not public.rodagem_json_uint(entity_data->'revenue') or not public.rodagem_json_uint(entity_data->'distance')
      or coalesce(entity_data->>'status','') not in ('planned','in_progress','completed') or jsonb_typeof(entity_data->'costs') is distinct from 'object'
      or not (entity_data ? 'driverId') then raise exception using errcode='22023',message='Confira a viagem, os valores e o motorista.'; end if;
    foreach key in array array['fuel','tolls','parking','commission','helper','maintenance','other'] loop
      if not public.rodagem_json_uint(entity_data->'costs'->key) then raise exception using errcode='22023',message='Os custos devem ser valores inteiros em centavos.'; end if;
    end loop;
    if exists(select 1 from jsonb_object_keys(entity_data->'costs') k where k<>all(array['fuel','tolls','parking','commission','helper','maintenance','other'])) then raise exception using errcode='22023',message='Categoria de custo inválida.'; end if;
    perform (entity_data->>'vehicleId')::uuid;
    if entity_data->'driverId'<>'null'::jsonb then perform (entity_data->>'driverId')::uuid; end if;
  elsif entity_kind='reminder' then
    if exists(select 1 from jsonb_object_keys(entity_data) k where k<>all(array['id','companyId','revision','archivedAt','vehicleId','memberId','kind','title','dueDate','dueOdometer','completedAt'])) then raise exception using errcode='22023',message='Campo de alerta desconhecido.'; end if;
    if not public.business_valid_text(entity_data->'title',120) or coalesce(entity_data->>'kind','') not in ('maintenance','document')
      or not (entity_data ?& array['vehicleId','memberId','dueDate','dueOdometer','completedAt'])
      or (entity_data->'dueDate'='null'::jsonb and entity_data->'dueOdometer'='null'::jsonb)
      or not public.business_valid_timestamp(entity_data->'completedAt') then raise exception using errcode='22023',message='Confira o alerta e o vencimento.'; end if;
    if entity_data->'dueDate'<>'null'::jsonb and not public.business_valid_date(entity_data->'dueDate') then raise exception using errcode='22023',message='Data de vencimento inválida.'; end if;
    if entity_data->'dueOdometer'<>'null'::jsonb and (not public.rodagem_json_uint(entity_data->'dueOdometer') or entity_data->'vehicleId'='null'::jsonb) then raise exception using errcode='22023',message='O alerta por quilometragem exige um veículo e um valor válido.'; end if;
    if entity_data->'vehicleId'<>'null'::jsonb then perform (entity_data->>'vehicleId')::uuid; end if;
    if entity_data->'memberId'<>'null'::jsonb then perform (entity_data->>'memberId')::uuid; end if;
  else raise exception using errcode='22023',message='Tipo de registro desconhecido.';
  end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='Identificador ou valor inválido.';
end; $$;

alter table public.business_companies enable row level security;
alter table public.business_companies force row level security;
alter table public.business_members enable row level security;
alter table public.business_members force row level security;
alter table public.business_entities enable row level security;
alter table public.business_entities force row level security;
alter table public.business_invites enable row level security;
alter table public.business_invites force row level security;
drop policy if exists business_company_read on public.business_companies;
create policy business_company_read on public.business_companies for select to authenticated using(public.business_membership_role(id) is not null);
drop policy if exists business_member_read on public.business_members;
create policy business_member_read on public.business_members for select to authenticated using(public.business_membership_role(company_id) in ('owner','manager','finance') or (active and user_id=(select auth.uid())));
drop policy if exists business_entity_read on public.business_entities;
create policy business_entity_read on public.business_entities for select to authenticated using(
  public.business_membership_role(company_id) in ('owner','manager','finance') or
  (public.business_membership_role(company_id)='driver' and (kind='vehicle' or (kind='trip' and data->>'driverId'=public.business_membership_id(company_id)::text) or (kind='reminder' and data->>'memberId'=public.business_membership_id(company_id)::text))));
revoke all on public.business_companies,public.business_members,public.business_entities,public.business_invites from public,anon,authenticated;
grant select on public.business_companies,public.business_members,public.business_entities to authenticated;

create or replace function public.business_list_companies(expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare who uuid := public.business_guard(expected_user_id); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'createdAt',c.created_at,'revision',c.revision,'role',m.role) order by c.created_at),'[]'::jsonb)
    into result from public.business_companies c join public.business_members m on m.company_id=c.id where m.user_id=who and m.active;
  return result;
end; $$;
create or replace function public.business_load_workspace(expected_user_id uuid,company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
<<workspace_context>>
declare who uuid := public.business_guard(expected_user_id); role text; member_id uuid; company jsonb; members jsonb; vehicles jsonb; trips jsonb; reminders jsonb; entitlement jsonb;
begin
  role := public.business_membership_role(company_id); member_id := public.business_membership_id(company_id);
  if role is null then raise exception using errcode='42501',message='Você não tem acesso a esta empresa.'; end if;
  select jsonb_build_object('id',c.id,'name',c.name,'createdAt',c.created_at,'revision',c.revision) into company from public.business_companies c where c.id=company_id;
  select coalesce(jsonb_agg(public.business_member_json(m) order by m.created_at),'[]'::jsonb) into members from public.business_members m where m.company_id=business_load_workspace.company_id and (workspace_context.role<>'driver' or m.id=member_id);
  if role in ('owner','manager','finance') then
    select members || coalesce(jsonb_agg(jsonb_build_object('id',i.id,'companyId',i.company_id,'userId',null,'name',i.display_name,'email',i.email,'role',i.role,'status','invited','revision',1,'archivedAt',null)),'[]'::jsonb)
      into members from public.business_invites i where i.company_id=business_load_workspace.company_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>now();
  end if;
  select coalesce(jsonb_agg(public.business_entity_json(e) order by e.created_at),'[]'::jsonb) into vehicles from public.business_entities e where e.company_id=business_load_workspace.company_id and e.kind='vehicle';
  select coalesce(jsonb_agg(public.business_entity_json(e) order by e.created_at),'[]'::jsonb) into trips from public.business_entities e where e.company_id=business_load_workspace.company_id and e.kind='trip' and (workspace_context.role<>'driver' or e.data->>'driverId'=member_id::text);
  select coalesce(jsonb_agg(public.business_entity_json(e) order by e.created_at),'[]'::jsonb) into reminders from public.business_entities e where e.company_id=business_load_workspace.company_id and e.kind='reminder' and (workspace_context.role<>'driver' or e.data->>'memberId'=member_id::text);
  if to_regclass('public.business_entitlements') is not null then
    execute 'select to_jsonb(e) from public.business_entitlements e where company_id=$1' into entitlement using company_id;
  end if;
  return jsonb_build_object('company',company,'membership',jsonb_build_object('userId',who,'memberId',member_id,'role',role),
    'members',members,'vehicles',vehicles,'trips',trips,'reminders',reminders,'entitlement',entitlement);
end; $$;
create or replace function public.business_create_company(expected_user_id uuid,company_name text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare who uuid := public.business_guard(expected_user_id); company_id uuid; email text; name text;
begin
  if company_name is null or length(btrim(company_name)) not between 1 and 80 or company_name ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='Informe um nome de empresa com até 80 caracteres.'; end if;
  select coalesce(u.email,''),coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.email,''),'Responsável') into email,name from auth.users u where u.id=who;
  insert into public.business_companies(name,created_by) values(btrim(company_name),who) returning id into company_id;
  insert into public.business_members(company_id,user_id,role,display_name,email) values(company_id,who,'owner',left(name,80),email);
  return public.business_load_workspace(who,company_id);
end; $$;

create or replace function public.business_save_entity(expected_user_id uuid,company_id uuid,entity_kind text,entity_id uuid,expected_revision bigint,entity_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
<<entity_context>>
declare who uuid := public.business_guard(expected_user_id); role text; member_id uuid; previous public.business_entities%rowtype; saved public.business_entities%rowtype; data jsonb; reference_id uuid; projected integer;
begin
  role := public.business_membership_role(company_id); member_id:=public.business_membership_id(company_id);
  if role is null then raise exception using errcode='42501',message='Você não tem acesso a esta empresa.'; end if;
  perform 1 from public.business_companies c where c.id=company_id for update;
  role:=public.business_membership_role(company_id);
  if role is null then raise exception using errcode='42501',message='O acesso à empresa mudou. Atualize antes de continuar.'; end if;
  member_id:=public.business_membership_id(company_id);
  if entity_id is null or expected_revision is null or expected_revision<0 or expected_revision>9007199254740990 then raise exception using errcode='22023',message='Identificador ou revisão inválidos.'; end if;
  if entity_data->>'id' is distinct from entity_id::text or entity_data->>'companyId' is distinct from company_id::text then raise exception using errcode='22023',message='O registro pertence a outra empresa ou identificador.'; end if;
  perform public.business_validate_entity(entity_kind,entity_data);
  select * into previous from public.business_entities e where e.id=entity_id for update;
  if previous.id is not null and (previous.company_id<>company_id or previous.kind<>entity_kind) then raise exception using errcode='42501',message='Registro indisponível nesta empresa.'; end if;
  if (previous.id is null and expected_revision<>0) or (previous.id is not null and previous.revision<>expected_revision) then raise exception using errcode='40001',message='O registro mudou. Atualize a empresa antes de salvar.'; end if;
  if role='finance' and (entity_kind<>'trip' or previous.id is null or (entity_data-array['id','companyId','revision','archivedAt','createdAt','costs'])<>(previous.data-array['id','companyId','revision','archivedAt','createdAt','costs'])) then raise exception using errcode='42501',message='O financeiro pode atualizar somente os custos de viagens existentes.'; end if;
  if role='driver' and (entity_kind<>'trip' or entity_data->>'driverId' is distinct from member_id::text or (previous.id is not null and previous.data->>'driverId' is distinct from member_id::text)) then raise exception using errcode='42501',message='O motorista pode alterar somente as próprias viagens.'; end if;
  if entity_kind='vehicle' and role not in ('owner','manager') then raise exception using errcode='42501',message='Seu papel não permite alterar a frota.'; end if;
  if entity_kind='reminder' and role not in ('owner','manager') then raise exception using errcode='42501',message='Seu papel não permite alterar os alertas.'; end if;
  if entity_kind in ('trip','reminder') and entity_data->'vehicleId'<>'null'::jsonb then
    reference_id:=(entity_data->>'vehicleId')::uuid;
    if not exists(select 1 from public.business_entities e where e.id=reference_id and e.company_id=business_save_entity.company_id and e.kind='vehicle'
      and ((e.archived_at is null and e.data->'active'='true'::jsonb) or (previous.id is not null and previous.data->>'vehicleId'=reference_id::text))) then raise exception using errcode='22023',message='Selecione um veículo ativo desta empresa.'; end if;
  elsif entity_kind='trip' then raise exception using errcode='22023',message='A viagem exige um veículo desta empresa.';
  end if;
  if entity_kind in ('trip','reminder') then
    reference_id:=case when entity_kind='trip' then (entity_data->>'driverId')::uuid else (entity_data->>'memberId')::uuid end;
    if reference_id is not null and not exists(select 1 from public.business_members m where m.id=reference_id and m.company_id=business_save_entity.company_id
      and (m.active or (previous.id is not null and coalesce(previous.data->>'driverId',previous.data->>'memberId')=reference_id::text))) then raise exception using errcode='22023',message='Selecione uma pessoa ativa desta empresa.'; end if;
  end if;
  data:=entity_data-array['id','companyId','revision','archivedAt','createdAt'];
  if entity_kind='vehicle' and entity_data->'active'='true'::jsonb and to_regprocedure('public.business_assert_vehicle_entitlement(uuid,integer)') is not null then
    select count(*)+1 into projected from public.business_entities e where e.company_id=business_save_entity.company_id and e.kind='vehicle' and e.archived_at is null and e.data->'active'='true'::jsonb and e.id<>entity_id;
    execute 'select public.business_assert_vehicle_entitlement($1,$2)' using company_id,projected;
  end if;
  if previous.id is null then
    insert into public.business_entities(id,company_id,kind,data) values(entity_id,company_id,entity_kind,data) returning * into saved;
  else
    update public.business_entities e set data=entity_context.data,revision=e.revision+1,updated_at=clock_timestamp(),
      archived_at=case when role='finance' then e.archived_at when entity_data->'archivedAt'='null'::jsonb then null else e.archived_at end
      where e.id=entity_id and e.revision=expected_revision returning * into saved;
  end if;
  if saved.id is null then raise exception using errcode='40001',message='O registro mudou antes do salvamento.'; end if;
  return public.business_entity_json(saved);
exception when unique_violation then raise exception using errcode='40001',message='O identificador já foi salvo. Atualize a empresa.';
end; $$;
create or replace function public.business_archive_entity(expected_user_id uuid,company_id uuid,entity_kind text,entity_id uuid,expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare who uuid := public.business_guard(expected_user_id); role text; previous public.business_entities%rowtype; saved public.business_entities%rowtype;
begin
  role:=public.business_membership_role(company_id);
  if role is null then raise exception using errcode='42501',message='Você não tem acesso a esta empresa.'; end if;
  perform 1 from public.business_companies c where c.id=company_id for update;
  role:=public.business_membership_role(company_id);
  if role is null then raise exception using errcode='42501',message='O acesso à empresa mudou. Atualize antes de continuar.'; end if;
  select * into previous from public.business_entities e where e.id=entity_id and e.company_id=business_archive_entity.company_id and e.kind=entity_kind for update;
  if previous.id is null then raise exception using errcode='42501',message='Registro indisponível nesta empresa.'; end if;
  if role not in ('owner','manager') and not (role='driver' and entity_kind='trip' and previous.data->>'driverId'=public.business_membership_id(company_id)::text) then raise exception using errcode='42501',message='Seu papel não permite arquivar este registro.'; end if;
  if expected_revision is null or previous.revision<>expected_revision then raise exception using errcode='40001',message='O registro mudou. Atualize antes de arquivar.'; end if;
  update public.business_entities e set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=e.revision+1,
    data=case when entity_kind='vehicle' then jsonb_set(e.data,'{active}','false') else e.data end
    where e.id=entity_id returning * into saved;
  return public.business_entity_json(saved);
end; $$;
create or replace function public.business_invite_member(expected_user_id uuid,company_id uuid,invite_email text,invite_name text,invite_role text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
<<invite_context>>
declare who uuid:=public.business_guard(expected_user_id); role text; email text:=lower(btrim(invite_email)); name text:=btrim(invite_name); token text; saved public.business_invites%rowtype;
begin
  role:=public.business_membership_role(company_id);
  if role not in ('owner','manager') or role is null or invite_role not in ('manager','finance','driver') or (role='manager' and invite_role='manager') then raise exception using errcode='42501',message='Seu papel não permite conceder essa função.'; end if;
  perform 1 from public.business_companies c where c.id=company_id for update;
  role:=public.business_membership_role(company_id);
  if role is null or role not in ('owner','manager') or (role='manager' and invite_role='manager') then raise exception using errcode='42501',message='O acesso à equipe mudou. Atualize antes de continuar.'; end if;
  if email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or email ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='Informe um e-mail válido para o convite.'; end if;
  name:=coalesce(nullif(name,''),email);
  if length(name)>80 or name ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='O nome deve ter até 80 caracteres.'; end if;
  if exists(select 1 from public.business_members m where m.company_id=business_invite_member.company_id and lower(m.email)=invite_context.email and m.active) then raise exception using errcode='22023',message='Esta pessoa já participa da empresa.'; end if;
  update public.business_invites i set revoked_at=clock_timestamp() where i.company_id=business_invite_member.company_id and i.email=invite_context.email and i.accepted_at is null and i.revoked_at is null;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.business_invites(company_id,email,display_name,role,token_hash,invited_by) values(company_id,email,name,invite_role,encode(sha256(convert_to(token,'UTF8')),'hex'),who) returning * into saved;
  return jsonb_build_object('token',token,'expiresAt',saved.expires_at,'member',jsonb_build_object('id',saved.id,'companyId',saved.company_id,'userId',null,'name',saved.display_name,'email',saved.email,'role',saved.role,'status','invited','revision',1,'archivedAt',null));
end; $$;
create or replace function public.business_accept_invite(expected_user_id uuid,invite_token text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare who uuid:=public.business_guard(expected_user_id); invitation public.business_invites%rowtype; email text; confirmed timestamptz; inviter_role text;
begin
  if invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='Convite inválido.'; end if;
  select * into invitation from public.business_invites i where i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex');
  if invitation.id is null or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception using errcode='42501',message='O convite está inválido, expirado ou já foi usado.'; end if;
  perform 1 from public.business_companies c where c.id=invitation.company_id for update;
  select * into invitation from public.business_invites i where i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') for update;
  if invitation.id is null or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception using errcode='42501',message='O convite está inválido, expirado ou já foi usado.'; end if;
  select lower(u.email),u.email_confirmed_at into email,confirmed from auth.users u where u.id=who;
  if confirmed is null or email is distinct from invitation.email then raise exception using errcode='42501',message='Entre com o e-mail verificado que recebeu o convite.'; end if;
  select m.role into inviter_role from public.business_members m where m.company_id=invitation.company_id and m.user_id=invitation.invited_by and m.active;
  if inviter_role is null or inviter_role not in ('owner','manager') or (inviter_role='manager' and invitation.role='manager') then raise exception using errcode='42501',message='O convite não tem mais uma autorização válida.'; end if;
  if exists(select 1 from public.business_members m where m.company_id=invitation.company_id and m.user_id=who) then raise exception using errcode='22023',message='Esta conta já possui um vínculo com a empresa.'; end if;
  insert into public.business_members(id,company_id,user_id,role,display_name,email) values(invitation.id,invitation.company_id,who,invitation.role,invitation.display_name,invitation.email);
  update public.business_invites i set accepted_at=clock_timestamp() where i.id=invitation.id;
  return public.business_load_workspace(who,invitation.company_id);
end; $$;


create or replace function public.business_save_member(expected_user_id uuid,company_id uuid,member_id uuid,expected_revision bigint,member_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare who uuid:=public.business_guard(expected_user_id); actor_role text; previous public.business_members%rowtype; saved public.business_members%rowtype; new_role text; enabled boolean;
begin
  actor_role:=public.business_membership_role(company_id);
  if actor_role is null or actor_role not in ('owner','manager') then raise exception using errcode='42501',message='Seu papel não permite alterar a equipe.'; end if;
  perform 1 from public.business_companies c where c.id=company_id for update;
  actor_role:=public.business_membership_role(company_id);
  if actor_role is null or actor_role not in ('owner','manager') then raise exception using errcode='42501',message='O acesso à empresa mudou. Atualize antes de continuar.'; end if;
  select * into previous from public.business_members m where m.id=member_id and m.company_id=business_save_member.company_id for update;
  if previous.id is null then raise exception using errcode='42501',message='Pessoa indisponível nesta empresa.'; end if;
  if expected_revision is null or previous.revision<>expected_revision then raise exception using errcode='40001',message='A pessoa mudou. Atualize a equipe antes de salvar.'; end if;
  if jsonb_typeof(member_data) is distinct from 'object' or not public.business_valid_text(member_data->'name',80)
      or coalesce(member_data->>'role','') not in ('owner','manager','finance','driver')
      or jsonb_typeof(member_data->'active') is distinct from 'boolean'
      or exists(select 1 from jsonb_object_keys(member_data) k where k<>all(array['name','role','active'])) then
    raise exception using errcode='22023',message='Confira o nome, a função e a situação da pessoa.';
  end if;
  new_role:=member_data->>'role'; enabled:=(member_data->>'active')::boolean;
  if actor_role='manager' and (previous.role not in ('driver','finance') or new_role not in ('driver','finance')) then
    raise exception using errcode='42501',message='Somente um responsável pode conceder ou alterar funções de gestão.';
  end if;
  if previous.role='owner' and previous.active and (new_role<>'owner' or not enabled) and not exists(
    select 1 from public.business_members m where m.company_id=business_save_member.company_id and m.id<>previous.id and m.role='owner' and m.active and m.user_id is not null
  ) then raise exception using errcode='42501',message='Mantenha pelo menos um responsável ativo na empresa.'; end if;
  update public.business_members m set display_name=btrim(member_data->>'name'),role=new_role,active=enabled,
    archived_at=case when enabled then null else coalesce(m.archived_at,clock_timestamp()) end,revision=m.revision+1
    where m.id=member_id and m.revision=expected_revision returning * into saved;
  if saved.id is null then raise exception using errcode='40001',message='A pessoa mudou antes do salvamento.'; end if;
  return public.business_member_json(saved);
end; $$;

create or replace function public.business_revoke_invite(expected_user_id uuid,company_id uuid,invite_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare who uuid:=public.business_guard(expected_user_id); actor_role text; invitation public.business_invites%rowtype;
begin
  actor_role:=public.business_membership_role(company_id);
  if actor_role is null or actor_role not in ('owner','manager') then raise exception using errcode='42501',message='Seu papel não permite revogar convites.'; end if;
  perform 1 from public.business_companies c where c.id=company_id for update;
  actor_role:=public.business_membership_role(company_id);
  if actor_role is null or actor_role not in ('owner','manager') then raise exception using errcode='42501',message='O acesso à empresa mudou. Atualize antes de continuar.'; end if;
  select * into invitation from public.business_invites i where i.id=invite_id and i.company_id=business_revoke_invite.company_id for update;
  if invitation.id is null or invitation.accepted_at is not null or (actor_role='manager' and invitation.role='manager') then raise exception using errcode='42501',message='Este convite não está disponível para revogação.'; end if;
  update public.business_invites i set revoked_at=coalesce(i.revoked_at,clock_timestamp()) where i.id=invite_id;
  return jsonb_build_object('id',invite_id,'revoked',true);
end; $$;

create or replace function public.business_archive_deleted_user()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Serializes deletion with role changes and invitation acceptance in each company.
  perform c.id from public.business_companies c where c.id in (
    select m.company_id from public.business_members m where m.user_id=old.id
  ) order by c.id for update;
  if exists(
    select 1 from public.business_members mine where mine.user_id=old.id and mine.active and mine.role='owner'
      and not exists(select 1 from public.business_members other where other.company_id=mine.company_id and other.user_id is not null and other.user_id<>old.id and other.active and other.role='owner')
  ) then raise exception using errcode='42501',message='Transfira a responsabilidade da empresa antes de excluir esta conta.'; end if;
  update public.business_members m set user_id=null,display_name='Conta excluída',email='',active=false,archived_at=coalesce(m.archived_at,clock_timestamp()),revision=m.revision+1 where m.user_id=old.id;
  update public.business_invites i set revoked_at=coalesce(i.revoked_at,clock_timestamp()) where (i.invited_by=old.id or lower(i.email)=lower(old.email)) and i.accepted_at is null;
  return old;
end; $$;
drop trigger if exists business_archive_deleted_user on auth.users;
create trigger business_archive_deleted_user before delete on auth.users for each row execute function public.business_archive_deleted_user();
revoke all on function public.business_archive_deleted_user() from public,anon,authenticated;
revoke all on function public.business_save_member(uuid,uuid,uuid,bigint,jsonb),public.business_revoke_invite(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.business_save_member(uuid,uuid,uuid,bigint,jsonb),public.business_revoke_invite(uuid,uuid,uuid) to authenticated;

revoke all on function public.business_guard(uuid),public.business_membership_role(uuid),public.business_membership_id(uuid),public.business_entity_json(public.business_entities),public.business_member_json(public.business_members),public.business_valid_text(jsonb,integer,boolean),public.business_valid_date(jsonb),public.business_valid_timestamp(jsonb),public.business_validate_entity(text,jsonb) from public,anon,authenticated;
grant execute on function public.business_membership_role(uuid),public.business_membership_id(uuid) to authenticated;
revoke all on function public.business_list_companies(uuid),public.business_load_workspace(uuid,uuid),public.business_create_company(uuid,text),public.business_save_entity(uuid,uuid,text,uuid,bigint,jsonb),public.business_archive_entity(uuid,uuid,text,uuid,bigint),public.business_invite_member(uuid,uuid,text,text,text),public.business_accept_invite(uuid,text) from public,anon,authenticated;
grant execute on function public.business_list_companies(uuid),public.business_load_workspace(uuid,uuid),public.business_create_company(uuid,text),public.business_save_entity(uuid,uuid,text,uuid,bigint,jsonb),public.business_archive_entity(uuid,uuid,text,uuid,bigint),public.business_invite_member(uuid,uuid,text,text,text),public.business_accept_invite(uuid,text) to authenticated;
commit;
