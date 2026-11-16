-- Disposable PostgreSQL fixtures from test-enterprise.sh, never a real project.
\set ON_ERROR_STOP on
grant usage on schema qa to service_role;
grant execute on all functions in schema qa to service_role;
select company_id as company_a from public.business_entities where id='10000000-0000-4000-8000-000000000001' \gset
select id as company_b from public.business_companies where created_by='22222222-2222-4222-8222-222222222222' order by created_at limit 1 \gset
select qa.check((select not enabled and not enforcement from public.business_billing_settings where singleton),'billing starts disabled without inventing an active subscription');
set role anon;
select qa.reject('select * from public.business_billing_settings',array['42501'],'anonymous clients cannot read server billing settings');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select qa.reject('update public.business_billing_settings set enabled=true',array['42501'],'a client cannot enable billing or remove enforcement');
select qa.reject(format('insert into public.business_entitlements(company_id,plan,status,vehicle_quantity) values(%L,''company'',''active'',999)',:'company_a'),array['42501'],'an owner cannot forge its paid entitlement');
select qa.reject('select * from public.business_billing_accounts',array['42501'],'private payment customer mapping is not readable by clients');
select qa.reject(format('select public.business_billing_acquire(%L,''evt_forged'')',:'company_a'),array['42501'],'clients cannot claim or acknowledge provider events');
reset role;
update public.business_billing_settings set enabled=true,enforcement=true;
select qa.reject(format('select public.business_assert_vehicle_entitlement(%L,1)',:'company_a'),array['P0001'],'enforcement refuses activation without a confirmed subscription');
select count(*) as expected_quantity from public.business_entities where company_id=:'company_a' and kind='vehicle' and archived_at is null and data->'active'='true'::jsonb \gset
set role service_role;
select qa.check((select count(*)=1 from public.business_companies where id=:'company_a'),'the payment service may verify the company in the database');
select qa.check((select count(*)>=1 from public.business_members where company_id=:'company_a' and active),'the payment service may verify the real owner membership');
insert into public.business_billing_accounts(company_id,stripe_customer_id) values(:'company_a','cus_test_company_a');
select public.business_billing_acquire(:'company_a','evt_test_confirmed')->>'token' as lease_token \gset
select qa.reject(format('select public.business_billing_apply(%L,%L,''evt_test_confirmed'',''cus_wrong'',''sub_test'',''vehicle'',''active'',2,now()+interval ''1 month'')',:'company_a',:'lease_token'),array['P0001'],'a provider event cannot grant another customer an entitlement');
select public.business_billing_apply(:'company_a',:'lease_token','evt_test_confirmed','cus_test_company_a','sub_test','vehicle','active',2,now()+interval '1 month');
select qa.check((select status='active' and plan='vehicle' and vehicle_quantity=2 from public.business_entitlements where company_id=:'company_a'),'only the service confirmation records the purchased vehicle quantity');
select qa.check(public.business_billing_acquire(:'company_a','evt_test_confirmed')->>'state'='processed','a provider event is acknowledged once');
insert into public.business_entitlements(company_id,plan,status,vehicle_quantity,period_end) values(:'company_b','company','active',1,now()+interval '1 month');
select public.business_assert_vehicle_entitlement(:'company_a',2);
select qa.reject(format('select public.business_assert_vehicle_entitlement(%L,3)',:'company_a'),array['P0001'],'a confirmed per-vehicle plan enforces its purchased quota');
select public.business_assert_vehicle_entitlement(:'company_b',9999);
select qa.check(true,'a per-company plan accepts multiple active vehicles');
select public.business_billing_acquire(:'company_a','evt_test_first')->>'token' as second_lease \gset
select qa.check(public.business_billing_acquire(:'company_a','evt_test_second')->>'state'='busy','simultaneous provider events serialize per company');
select public.business_billing_release(:'company_a',:'second_lease');
select qa.reject(format('select public.business_billing_apply(%L,%L,''evt_test_first'',''cus_test_company_a'',''sub_test'',''vehicle'',''active'',9,now()+interval ''1 month'')',:'company_a',:'second_lease'),array['P0001'],'a released confirmation lease cannot mutate entitlements');
select qa.check(public.business_billing_vehicle_count(:'company_a')=:'expected_quantity'::integer,'billable quantity counts active unarchived vehicles on the server');
reset role;
set role authenticated;
select qa.check((select count(*)=0 from public.business_entitlements where company_id=:'company_b'),'members cannot read another company paid state');
select qa.check((select count(*)=1 from public.business_entitlements where company_id=:'company_a'),'members may read their own company paid state');
reset role;
update public.business_entitlements set period_end=now()-interval '1 day' where company_id=:'company_a';
select qa.reject(format('select public.business_assert_vehicle_entitlement(%L,1)',:'company_a'),array['P0001'],'an expired subscription cannot keep activating vehicles');
update public.business_billing_settings set enabled=false,enforcement=false;
select public.business_assert_vehicle_entitlement(:'company_a',9999);
select qa.check(true,'turning enforcement off does not mark any subscription as paid');
