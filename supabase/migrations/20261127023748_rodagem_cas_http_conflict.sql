-- v3.2.3: logical revision conflicts use PT409/HTTP409 instead of retryable serialization_failure.
-- Preserves all identities, authorization, RLS, locks, financial rules, payloads, revisions, owners and ACLs.
-- Production application requires explicit owner authorization; this file was tested locally only.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $rodagem_cas_contract$
declare expected record; actual record;
begin
  for expected in select * from (values
    ('public.rodagem_save_snapshot(uuid,bigint,jsonb)', 'a9597c8220b201d8228c0c8cb6e65ba7', '0bfd97a3c85f7d4e43518fbeead712bc', false),
    ('public.business_save_entity(uuid,uuid,text,uuid,bigint,jsonb)', 'ccbc7568a265637f4347fb30ef69068e', '5bbbc0e096cdd8172aca1bfdbaef6871', true),
    ('public.business_archive_entity(uuid,uuid,text,uuid,bigint)', '9e9de1d6a4b948bf98157b37cf936bad', '037e52b0f9a96bbf02b82cb789c41b58', true),
    ('public.business_save_member(uuid,uuid,uuid,bigint,jsonb)', '24930095c4370733a78c8ad17bf7988d', 'ac84103ef0ed0e2fc043940a01e01e0e', true)
  ) f(signature,baseline_body_md5,candidate_body_md5,is_definer) loop
    select p.prosrc,p.prosecdef,p.provolatile,p.proconfig into actual
      from pg_proc p where p.oid=to_regprocedure(expected.signature);
    if not found or md5(actual.prosrc) not in (expected.baseline_body_md5,expected.candidate_body_md5)
        or actual.prosecdef is distinct from expected.is_definer
        or actual.provolatile is distinct from 'v'::"char"
        or actual.proconfig is distinct from array['search_path=""']::text[] then
      raise exception using errcode='55000',message='Contrato CAS desconhecido em '||expected.signature||'. Revise antes de aplicar esta alteração.';
    end if;
  end loop;
end;
$rodagem_cas_contract$;

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
  if (previous.id is null and expected_revision<>0) or (previous.id is not null and previous.revision<>expected_revision) then raise exception using errcode='PT409',message='O registro mudou. Atualize a empresa antes de salvar.'; end if;
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
  if saved.id is null then raise exception using errcode='PT409',message='O registro mudou antes do salvamento.'; end if;
  return public.business_entity_json(saved);
exception when unique_violation then raise exception using errcode='PT409',message='O identificador já foi salvo. Atualize a empresa.';
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
  if expected_revision is null or previous.revision<>expected_revision then raise exception using errcode='PT409',message='O registro mudou. Atualize antes de arquivar.'; end if;
  update public.business_entities e set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=e.revision+1,
    data=case when entity_kind='vehicle' then jsonb_set(e.data,'{active}','false') else e.data end
    where e.id=entity_id returning * into saved;
  return public.business_entity_json(saved);
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
  if expected_revision is null or previous.revision<>expected_revision then raise exception using errcode='PT409',message='A pessoa mudou. Atualize a equipe antes de salvar.'; end if;
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
  if saved.id is null then raise exception using errcode='PT409',message='A pessoa mudou antes do salvamento.'; end if;
  return public.business_member_json(saved);
end; $$;

commit;
