import {createBillingHandler,createStripeClient,createSupabaseStore,serverConfig} from '../_shared/billing.mjs';

const read=(name:string)=>Deno.env.get(name)||'';
const config=serverConfig(read);
const db=createSupabaseStore({url:read('SUPABASE_URL'),serviceKey:read('SUPABASE_SERVICE_ROLE_KEY'),anonKey:read('SUPABASE_ANON_KEY')});
const stripe=createStripeClient({key:config.key});
Deno.serve(createBillingHandler({config,db,stripe}));
