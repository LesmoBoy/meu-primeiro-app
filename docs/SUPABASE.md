# Ativar Google, Facebook e sincronização

## Instalação do Minha Rodagem — 24/11/2026

O projeto **MRB** (`ivoszoawhknwbiszjvfv`) já recebeu `schema.sql` e `enterprise.sql`, com as cinco tabelas protegidas por RLS. As verificações de acesso anônimo, UID esperado e associação à empresa passaram no projeto real, usando transações de teste sem gravar dados de pessoas.

`cloud-config.js` contém a URL e a chave pública do projeto. A lista `providers` está vazia porque Google e Facebook ainda estão desativados no Supabase e seus aplicativos OAuth ainda não foram criados. O app mantém os perfis locais funcionando até essa configuração terminar.

Ainda é necessário conferir as [URLs do Auth](https://supabase.com/dashboard/project/ivoszoawhknwbiszjvfv/auth/url-configuration), cadastrar os aplicativos nas contas Google/Meta e configurar os [provedores do projeto](https://supabase.com/dashboard/project/ivoszoawhknwbiszjvfv/auth/providers). A conexão de administração do Supabase não fornece acesso às contas Google Cloud ou Meta for Developers.

Valores desta instalação:

```text
Nome: Minha Rodagem
Site URL e Redirect URL do Supabase:
https://lesmoboy.github.io/meu-primeiro-app/

Origem JavaScript no Google:
https://lesmoboy.github.io

Callback OAuth no Google e na Meta:
https://ivoszoawhknwbiszjvfv.supabase.co/auth/v1/callback
```

Os segredos dos provedores devem ser preenchidos diretamente no Supabase. Depois de configurar e homologar cada provedor, inclua somente o nome correspondente em `providers` e publique a atualização do app.

O código empresarial inclui RPCs privilegiadas com verificação de UID e papel na empresa. O aviso do [Advisor sobre funções SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) exige manter essas verificações; o acesso é intencional e restrito ao papel `authenticated`. A tabela de convites mantém RLS sem leitura direta, acessível somente pelas operações autorizadas do servidor.

## Guia de configuração

O Minha Rodagem continua funcionando com perfis locais. Esta versão inclui o código de conexão e o esquema do banco, mas a entrada social permanece indisponível até o proprietário criar e configurar seu projeto Supabase e os aplicativos dos provedores. Um botão visível não significa que a autenticação esteja ativa.

Entrar com Google usa uma conta Google, inclusive um endereço Gmail. O app não precisa acessar mensagens do Gmail ou publicações do Facebook. Configure apenas a identificação básica e o e-mail necessários ao login.

## 1. Criar o projeto

1. Acesse [Supabase](https://supabase.com/dashboard), crie uma organização e um projeto para o Minha Rodagem.
2. Guarde a senha do banco em um gerenciador de senhas. Ela não entra no código do site.
3. Em **Project Settings → API** ou **Connect**, copie a **Project URL** e a chave pública **Publishable**. Projetos antigos podem exibir a chave pública **anon** em **Legacy API Keys**.
4. Execute o conteúdo de [supabase/schema.sql](../supabase/schema.sql) no **SQL Editor** desse projeto.
5. Confirme que existe `public.rodagem_sync`, com **RLS ativado**, e as funções `rodagem_load_snapshot(expected_user_id)` e `rodagem_save_snapshot(expected_user_id, expected_revision, snapshot)`.

A chave pública identifica o projeto e pode fazer parte do JavaScript. A autenticação e as políticas de acesso decidem quais dados ela consegue ler. **Não coloque a chave `service_role`, uma chave `sb_secret_…`, a senha do banco ou o segredo OAuth no GitHub, no ZIP ou em `cloud-config.js`.**

## 2. Definir o endereço de retorno

Em **Authentication → URL Configuration**, use:

```text
Site URL:
https://lesmoboy.github.io/meu-primeiro-app/

Redirect URLs:
https://lesmoboy.github.io/meu-primeiro-app/
```

Adicione apenas os endereços exatos usados em produção. O retorno do app remove a consulta e o fragmento da URL antes de iniciar OAuth. Um ambiente de desenvolvimento precisa de uma entrada própria e de um projeto de teste; evite curingas amplos em produção.

O endereço do aplicativo é diferente do endereço de retorno do provedor. No Google e no Facebook, o callback é o mostrado pelo Supabase, normalmente:

```text
https://SEU-PROJECT-REF.supabase.co/auth/v1/callback
```

Copie esse endereço da tela do provedor no Supabase. Trocar o domínio do app exige atualizar as URLs permitidas e a configuração dos provedores.

## 3. Configurar Google

1. Abra [Google Cloud Console](https://console.cloud.google.com/), selecione ou crie um projeto e entre na configuração de **Google Auth Platform / OAuth consent screen**.
2. Informe o nome do app, um e-mail real de suporte e os domínios/links solicitados pelo Google. Em fase de testes, inclua as contas que vão participar em **Test users**.
3. Crie um **OAuth client ID** do tipo **Web application**.
4. Em **Authorized JavaScript origins**, informe a origem do site: `https://lesmoboy.github.io`.
5. Em **Authorized redirect URIs**, informe o callback exato copiado do Supabase, terminado em `/auth/v1/callback`.
6. Em **Supabase → Authentication → Sign In / Providers → Google**, ative o provedor, cole **Client ID** e **Client secret** e salve.
7. Antes de abrir para clientes, conclua os requisitos de publicação e verificação que o Google mostrar para esse aplicativo. O modo de testes pode restringir quem consegue entrar.

O **Client secret** fica nas configurações do provedor no Supabase. Ele não é o `publishableKey` do site.

Referência: [Google Login no Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 4. Configurar Facebook

1. Acesse [Meta for Developers](https://developers.facebook.com/), crie um aplicativo apropriado para **Facebook Login** e adicione a plataforma **Website**.
2. Configure a URL do site e, nas configurações de Facebook Login, cadastre o callback exato do Supabase em **Valid OAuth Redirect URIs**.
3. Cadastre os domínios exigidos pelo painel da Meta e mantenha HTTPS ativo.
4. Em **Supabase → Authentication → Sign In / Providers → Facebook**, ative o provedor, cole o **App ID** e o **App secret** da Meta e salve.
5. Use uma conta com papel de administrador/testador enquanto o aplicativo estiver em desenvolvimento. Para aceitar clientes, conclua os requisitos apresentados pela Meta e coloque o app em modo público quando estiver elegível.
6. Publique uma política de privacidade e instruções reais de exclusão de dados, com um canal de atendimento definido pelo proprietário, e cadastre essas URLs no painel da Meta. Não use um contato fictício ou uma página inacessível.

O **App secret** fica no Supabase. A sincronização depende do UID autenticado do Supabase e não do texto do e-mail recebido do Facebook.

Referência: [Facebook Login no Supabase](https://supabase.com/docs/guides/auth/social-login/auth-facebook).

## 5. Preencher o arquivo público

Edite `cloud-config.js` na raiz do repositório:

```js
window.RodagemCloudConfig = Object.freeze({
  url: 'https://SEU-PROJECT-REF.supabase.co',
  publishableKey: 'SUA_CHAVE_PUBLICA_PUBLISHABLE_OU_ANON',
  providers: Object.freeze(['google', 'facebook'])
});
```

Use a chave pública verdadeira copiada do projeto. Se apenas Google estiver configurado e homologado, publique `providers: Object.freeze(['google'])` até terminar Facebook. Não habilite um provedor no arquivo antes de configurá-lo no Supabase.

Envie a alteração ao GitHub, espere o Pages terminar e reabra o app com internet. O SDK Supabase está incluído nos arquivos do aplicativo; o login e a transferência de dados precisam de conexão com o Supabase e com o provedor.

## 6. Como os dados são sincronizados

O envio e o recebimento são ações explícitas da pessoa. Entrar na conta não deve enviar todos os perfis do aparelho nem restaurar uma cópia sobre campos ainda não salvos.

O snapshot reúne os lançamentos, as preferências do veículo, as preferências de GPS, até dez percursos e uma jornada pausada/pendente do perfil vinculado. A sessão e seus tokens não fazem parte desse snapshot. Uma jornada em andamento não é transportada como se continuasse ativa em dois aparelhos.

A tabela guarda uma cópia por `auth.users.id`. O limite é **5 MiB por snapshot**, medido na representação JSON do PostgreSQL. O servidor aplica validações de estrutura, campos financeiros, perfil, limites de rotas e estado da jornada; o app também valida os percursos e os valores antes de importar.

As funções RPC usam este contrato:

```text
rodagem_load_snapshot(expected_user_id uuid)
  → null, se a conta ainda não tiver cópia
  → { revision, payload, updated_at }, se houver

rodagem_save_snapshot(expected_user_id uuid, expected_revision bigint, snapshot jsonb)
  → { revision, payload, updated_at }
```

`expected_user_id` deve vir da sessão Google/Facebook verificada pelo SDK. O banco compara esse valor com o UID do JWT antes de ler ou gravar. Passar o UID de outra pessoa não concede acesso; uma troca de sessão durante o envio é recusada com código `28000`.

Na primeira gravação, `expected_revision` é `0`. Depois disso, o app envia a revisão lida do servidor. Uma revisão antiga causa `40001`, preservando a cópia mais recente. O cliente deve apresentar o conflito e permitir conferir a nuvem; repetir automaticamente com uma nova revisão apagaria a proteção.

Formato do payload:

```json
{
  "version": 1,
  "settings": null,
  "records": { "versao": 1, "registros": [] },
  "routes": [],
  "gpsPreferences": { "enabled": false, "mode": "eco" },
  "journey": null
}
```

Quando presentes, `settings` contém o perfil validado versão 1 ou 2 e cada rota usa `{ id, track, updatedAt, finished }`, com `track` no formato canônico do GPS do app.

## 7. Homologar antes de oferecer aos clientes

Use dados fictícios e duas contas distintas, A e B:

1. Entre por Google com A, envie um perfil e confirme que ele reaparece depois de sair e entrar novamente.
2. No segundo aparelho, entre com A e confira os dados na nuvem antes de recebê-los. Confirme que os perfis locais de outras pessoas não foram transferidos.
3. Entre com B e confirme que a cópia de A não aparece. No Table Editor, cada linha deve usar o UID correto.
4. Tente uma requisição autenticada com B e `expected_user_id` de A: deve receber `28000` e nenhum dado de A. Sem sessão, as RPCs e a tabela devem negar o acesso.
5. Abra A em dois aparelhos. Depois que um enviar uma nova revisão, um envio com a revisão antiga do outro deve gerar conflito e preservar os dados do primeiro.
6. Verifique saída, cancelamento da tela do provedor, bloqueio de pop-ups/retorno OAuth, sessão expirada e perda de conexão durante envio e recebimento.
7. Repita a entrada com Facebook fora da conta de administrador/testador quando a Meta permitir o aplicativo público.

Os testes locais reproduzíveis ficam em [supabase/test-postgres.sh](../supabase/test-postgres.sh). Eles executam PostgreSQL 17 real em um contêiner sem portas externas, simulando somente o contexto Auth necessário para testar as políticas. Não testam a aceitação dos provedores Google/Meta nem a configuração do seu projeto remoto.

## Próxima etapa para vender a empresas

Este esquema sincroniza uma conta pessoal. Uma operação empresarial com gestores e vários motoristas precisa de empresas, membros, convites, papéis e veículos individualizados, além de políticas de banco que verifiquem a associação à empresa em cada acesso. Um e-mail com determinado domínio ou uma seleção de “empresa” no formulário não concede esse acesso.

Evoluções úteis: painel do gestor, custos por veículo e motorista, manutenção preventiva, vencimento de documentos, centros de custo, comprovantes de despesas, trilha de alterações, controle de assinaturas e restauração de backups. Essas funções precisam ser implementadas e testadas antes de serem anunciadas como disponíveis.

Para excluir uma conta, o proprietário pode usar **Authentication → Users → Delete user** no projeto; a chave estrangeira remove o snapshot dessa conta. Dados locais e tokens já guardados em um aparelho precisam ser removidos/encerrados nesse aparelho também. Defina o atendimento e o fluxo de exclusão da conta antes da operação comercial.
