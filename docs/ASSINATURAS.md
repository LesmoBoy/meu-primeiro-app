# Assinaturas da empresa

A versão 3.0 contém a integração para assinatura recorrente com Stripe, por empresa ou por vagas para veículos ativos. A instalação entregue está **desativada**, sem preços publicados, sem plano pago fictício e sem cobranças. Ela não cria uma conta Stripe ou Supabase automaticamente.

Os recursos locais continuam disponíveis. Para cobrar clientes, o proprietário precisa configurar os projetos, os produtos, o retorno do pagamento e o webhook, testar o fluxo completo e só então ativar os controles descritos abaixo.

## 1. Projetos e banco

Primeiro configure a autenticação conforme [SUPABASE.md](SUPABASE.md), e as empresas conforme [EMPRESAS.md](EMPRESAS.md). Execute no SQL Editor, nesta ordem:

1. `supabase/schema.sql`
2. `supabase/enterprise.sql`
3. `supabase/billing.sql`

O esquema de cobrança cria:

- `business_billing_settings`: chaves administrativas de ativação e controle de vagas.
- `business_entitlements`: plano, situação, quantidade de vagas e fim do período confirmado. Membros da empresa podem ler esses dados; não podem alterá-los.
- `business_billing_accounts`: identificação privada do cliente e da assinatura na Stripe.
- `business_billing_events` e `business_billing_leases`: confirmação idempotente e coordenação de eventos simultâneos.

Dados privados da cobrança só são acessados pela função do servidor com a credencial administrativa do Supabase. Essa credencial nunca deve ir para `cloud-config.js`, `billing-config.js` ou qualquer arquivo entregue ao navegador.

## 2. Produtos na Stripe

No modo de testes da sua conta Stripe, crie dois produtos com preços recorrentes em **reais (BRL)**:

- **Por empresa:** quantidade um por assinatura. O preço cobre a empresa; não há limite de vagas de veículos definido por este tipo de plano.
- **Por veículo ativo:** o preço corresponde a uma vaga de veículo. O primeiro checkout usa a quantidade de veículos ativos cadastrados no servidor, com mínimo de uma vaga para uma empresa nova.

Escolha preços mensais ou anuais com intervalo um. O aplicativo não inventa valores, não aceita preços enviados pelo navegador e não apresenta um preço sem consultá-lo no provedor. O proprietário define os valores reais na Stripe.

Copie os identificadores `price_…` para os segredos de servidor `STRIPE_PRICE_COMPANY` e `STRIPE_PRICE_VEHICLE`. Eles devem ser distintos, ativos e recorrentes.

## 3. Segredos e publicação da função

A função fica em `supabase/functions/rodagem-billing/index.ts`, com as regras compartilhadas em `supabase/functions/_shared/billing.mjs`. O arquivo `.env.example` contém apenas nomes e exemplos sem credenciais reais.

Configure no painel de Edge Functions/Secrets do Supabase:

```text
BILLING_ENABLED=false
APP_URL=https://lesmoboy.github.io/meu-primeiro-app/
STRIPE_SECRET_KEY=<chave privada do modo de testes>
STRIPE_WEBHOOK_SECRET=<segredo do endpoint de webhook>
STRIPE_PRICE_COMPANY=<price recorrente por empresa>
STRIPE_PRICE_VEHICLE=<price recorrente por vaga de veículo>
```

O ambiente da Edge Function fornece `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. Confirme esses nomes no seu projeto; a implementação usa Auth e PostgREST por HTTPS. Não registre os valores em logs nem publique um arquivo com eles.

Com o Supabase CLI autenticado no projeto correto, publique:

```sh
supabase functions deploy rodagem-billing --no-verify-jwt
```

`supabase/config.toml` já declara `verify_jwt = false` **para esta função apenas** porque o webhook da Stripe não usa o JWT do cliente. As ações `status`, `checkout` e `portal` validam o token no Auth antes de consultar a empresa; comparam o UID autenticado com o UID esperado e verificam a associação à empresa. Checkout e portal exigem o papel de responsável (`owner`). Desativar a verificação automática não transforma essas ações em endpoints anônimos.

## 4. Webhook obrigatório

Cadastre na Stripe o endpoint HTTPS da função com `?webhook=1`:

```text
https://SEU-PROJECT-REF.supabase.co/functions/v1/rodagem-billing?webhook=1
```

Assine os eventos:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Copie o segredo desse endpoint para `STRIPE_WEBHOOK_SECRET`. A função verifica o HMAC do corpo original e a tolerância de cinco minutos. Eventos repetidos são reconhecidos no banco. A função obtém novamente a assinatura pela API da Stripe e confere o cliente, a empresa, o preço autorizado, a quantidade e o ambiente de testes/produção antes de atualizar o plano.

A atualização usa uma trava por empresa e um registro de evento. Duas confirmações não podem sobrescrever a assinatura corrente com informações antigas. Se uma confirmação já estiver sendo processada, o endpoint responde com erro temporário para a Stripe tentar novamente. Falhas não são marcadas como confirmação concluída.

Voltar para a página de sucesso do checkout **não ativa** o plano. O estado só muda após o servidor receber e validar a confirmação do provedor. Durante essa espera a interface pode continuar mostrando a situação anterior.

## 5. Portal e vagas

Ative e configure o **Stripe Billing Customer Portal**. Ele permite ao responsável conferir faturas, regularizar pagamentos, cancelar e alterar a assinatura com a confirmação da Stripe.

Para preços por veículo, habilite a edição de quantidade no portal e defina os limites comerciais que deseja oferecer. Para o plano por empresa, mantenha a quantidade fixa em um. A mudança de quantidade e qualquer prorrata precisam ficar claras na tela de confirmação do provedor.

Aumentar a frota não inicia uma cobrança automática. Quando o controle de vagas estiver ativo e a empresa atingir o limite confirmado, o responsável deve contratar mais vagas em **Gerenciar plano**, aguardar o webhook e depois ativar o veículo. Se reduzir as vagas abaixo da frota já ativa, nenhum registro é apagado ou veículo arquivado automaticamente; o responsável deve ajustar a frota ou o plano.

## 6. Testes completos antes de ativar

No modo de testes, use duas contas e duas empresas diferentes:

1. Um responsável consulta os preços e abre o checkout; motorista, financeiro e gestor não podem iniciar ou alterar cobrança.
2. Troque a empresa, a conta, o preço, o cliente e a quantidade no corpo da requisição: o servidor deve ignorar preço/quantidade/cliente do navegador e negar empresa sem autorização.
3. Confirme uma assinatura de cada tipo. Confira o webhook e a linha correspondente em `business_entitlements`.
4. Reenvie o mesmo evento; a revisão não deve avançar novamente. Tente um evento com corpo ou assinatura alterados; nada deve ser confirmado.
5. Abra duas contratações simultâneas. O servidor deve reutilizar um checkout aberto e não criar uma segunda assinatura para a mesma empresa já contratada.
6. No portal, aumente e reduza quantidade, regularize um pagamento e cancele a assinatura. Confirme que os eventos refletem a situação atual, inclusive quando chegam fora de ordem.
7. Confira que o navegador nunca consegue escrever diretamente na tabela de planos ou ler os identificadores privados de cobrança.

Os testes isolados executam:

```sh
node qa/billing-test.mjs
sh supabase/test-enterprise.sh
```

O primeiro usa assinaturas HMAC reais com contas, provedor e banco simulados. Os testes de PostgreSQL usam um banco temporário, sem contas ou cobranças reais. Eles não substituem o checkout em modo de testes nem a implantação do webhook na sua conta.

## 7. Ativação

Depois de homologar, ative os três pontos:

1. Servidor: segredo `BILLING_ENABLED=true` com todas as credenciais e preços do ambiente escolhido.
2. Banco: `update public.business_billing_settings set enabled=true where singleton;` pelo SQL Editor administrativo.
3. Site: `window.RodagemBillingConfig = Object.freeze({enabled:true});` em `billing-config.js`, publicado no GitHub Pages.

Para exigir vagas pagas ao ativar veículos, habilite separadamente:

```sql
update public.business_billing_settings set enforcement=true where singleton;
```

Não habilite esse controle antes de conferir as assinaturas das empresas existentes. O padrão é `false`; isso significa que o controle de vagas está desativado, **não** que uma empresa recebeu um plano pago.

Antes de mudar para produção, substitua chaves, preços e segredo do webhook pelos do ambiente de produção e repita a conferência. Credenciais de testes não devem processar eventos de produção e vice-versa.

Desativar botões, a função ou a configuração do site não cancela uma assinatura já existente na Stripe. Cancelamento e alteração de contrato devem ser realizados pelo portal ou pelo painel do provedor, com a confirmação registrada pelo webhook.
