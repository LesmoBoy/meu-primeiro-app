-- Execute after schema.sql and enterprise.sql. No real billing is enabled here.
begin;
create table if not exists public.business_billing_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  enforcement boolean not null default false
);
insert into public.business_billing_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.business_entitlements (
  company_id uuid primary key references public.business_companies(id) on delete cascade,
  plan text check(plan in ('company','vehicle')),
  status text not null default 'none' check(status in ('none','active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  vehicle_quantity integer not null default 0 check(vehicle_quantity between 0 and 10000),
  period_end timestamptz,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now()
);
create table if not exists public.business_billing_accounts (
  company_id uuid primary key references public.business_companies(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  checkout_id text,
  checkout_url text,
  checkout_plan text check(checkout_plan in ('company','vehicle')),
  checkout_expires_at timestamptz
);
create table if not exists public.business_billing_events (
  id text primary key check(length(id) between 1 and 200),
  company_id uuid not null references public.business_companies(id) on delete cascade,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.business_billing_leases (
  company_id uuid primary key references public.business_companies(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.business_billing_settings enable row level security;
alter table public.business_entitlements enable row level security;
alter table public.business_billing_accounts enable row level security;
alter table public.business_billing_events enable row level security;
alter table public.business_billing_leases enable row level security;
drop policy if exists business_billing_settings_read on public.business_billing_settings;
create policy business_billing_settings_read on public.business_billing_settings for select to authenticated using(true);
drop policy if exists business_entitlement_read on public.business_entitlements;
create policy business_entitlement_read on public.business_entitlements for select to authenticated using(public.business_membership_role(company_id) is not null);
revoke all on public.business_billing_settings,public.business_entitlements,public.business_billing_accounts,public.business_billing_events,public.business_billing_leases from public,anon,authenticated;
grant select on public.business_billing_settings,public.business_entitlements to authenticated;

create or replace function public.business_assert_vehicle_entitlement(company_id uuid,projected_qty integer)
returns void language plpgsql security definer set search_path='' as $$
declare settings public.business_billing_settings; entitlement public.business_entitlements;
begin
  select * into settings from public.business_billing_settings where singleton;
  if not coalesce(settings.enforcement,false) then return; end if;
  select * into entitlement from public.business_entitlements e where e.company_id=business_assert_vehicle_entitlement.company_id;
  if not coalesce(settings.enabled,false) or entitlement.company_id is null or entitlement.plan is null or entitlement.plan not in ('company','vehicle') or entitlement.status not in ('active','trialing')
      or (entitlement.period_end is not null and entitlement.period_end<=now()) then
    raise exception using errcode='P0001',message='PLAN_LIMIT',detail='A assinatura precisa ser confirmada para ativar veículos.';
  end if;
  if projected_qty is null or projected_qty<0 or (entitlement.plan='vehicle' and projected_qty>entitlement.vehicle_quantity) then
    raise exception using errcode='P0001',message='PLAN_LIMIT',detail='A quantidade de veículos ultrapassa as vagas contratadas.';
  end if;
end; $$;

create or replace function public.business_billing_acquire(company_id uuid,event_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lease uuid:=gen_random_uuid(); acquired uuid;
begin
  if event_id is not null then
    insert into public.business_billing_events(id,company_id) values(event_id,company_id) on conflict do nothing;
    if exists(select 1 from public.business_billing_events e where e.id=event_id and e.processed_at is not null) then return jsonb_build_object('state','processed'); end if;
    if exists(select 1 from public.business_billing_events e where e.id=event_id and e.company_id<>business_billing_acquire.company_id) then raise exception 'Evento de outra empresa.'; end if;
  end if;
  insert into public.business_billing_leases(company_id,token,expires_at) values(company_id,lease,now()+interval '5 minutes')
    on conflict on constraint business_billing_leases_pkey do update set token=excluded.token,expires_at=excluded.expires_at
      where public.business_billing_leases.expires_at<now() returning token into acquired;
  if acquired is null then return jsonb_build_object('state','busy'); end if;
  return jsonb_build_object('state','claimed','token',lease);
end; $$;
create or replace function public.business_billing_vehicle_count(company_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.business_entities e where e.company_id=$1 and e.kind='vehicle' and e.archived_at is null and e.data->'active'='true'::jsonb;
$$;
create or replace function public.business_billing_release(company_id uuid,lease_token uuid)
returns void language sql security definer set search_path='' as $$
  delete from public.business_billing_leases l where l.company_id=$1 and l.token=$2;
$$;
create or replace function public.business_billing_apply(company_id uuid,lease_token uuid,event_id text,customer_id text,subscription_id text,plan_id text,subscription_status text,quantity integer,period_end_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.business_billing_leases l where l.company_id=business_billing_apply.company_id and l.token=lease_token and l.expires_at>now() for update;
  if not found then raise exception 'A confirmação perdeu a trava. Tente novamente.'; end if;
  if not exists(select 1 from public.business_billing_accounts a where a.company_id=business_billing_apply.company_id and a.stripe_customer_id=customer_id) then raise exception 'A confirmação pertence a outro cliente.'; end if;
  if not exists(select 1 from public.business_billing_events e where e.id=event_id and e.company_id=business_billing_apply.company_id and e.processed_at is null) then raise exception 'Evento indisponível.'; end if;
  if plan_id is null or plan_id not in ('company','vehicle') or subscription_status is null or subscription_status not in ('active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused') or quantity is null or quantity not between 1 and 10000 or subscription_id is null or customer_id is null then raise exception 'Assinatura inválida.'; end if;
  insert into public.business_entitlements(company_id,plan,status,vehicle_quantity,period_end) values(company_id,plan_id,subscription_status,quantity,period_end_at)
    on conflict on constraint business_entitlements_pkey do update set plan=excluded.plan,status=excluded.status,vehicle_quantity=excluded.vehicle_quantity,period_end=excluded.period_end,revision=public.business_entitlements.revision+1,updated_at=clock_timestamp();
  update public.business_billing_accounts a set stripe_subscription_id=subscription_id,checkout_id=null,checkout_url=null,checkout_plan=null,checkout_expires_at=null where a.company_id=business_billing_apply.company_id;
  update public.business_billing_events e set processed_at=clock_timestamp() where e.id=event_id and e.company_id=business_billing_apply.company_id;
  delete from public.business_billing_leases l where l.company_id=business_billing_apply.company_id and l.token=lease_token;
end; $$;
revoke all on function public.business_assert_vehicle_entitlement(uuid,integer),public.business_billing_acquire(uuid,text),public.business_billing_release(uuid,uuid),public.business_billing_apply(uuid,uuid,text,text,text,text,text,integer,timestamptz),public.business_billing_vehicle_count(uuid) from public,anon,authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select on public.business_companies,public.business_members to service_role;
    grant all on public.business_billing_settings,public.business_entitlements,public.business_billing_accounts,public.business_billing_events,public.business_billing_leases to service_role;
    grant execute on function public.business_assert_vehicle_entitlement(uuid,integer),public.business_billing_acquire(uuid,text),public.business_billing_release(uuid,uuid),public.business_billing_apply(uuid,uuid,text,text,text,text,text,integer,timestamptz),public.business_billing_vehicle_count(uuid) to service_role;
  end if;
end $$;
commit;
