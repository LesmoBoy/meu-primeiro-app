# Ativar Google, Facebook e sincronização

## Instalação 3.2.1 — Google Identity Services — 25/11/2026

O projeto **MRB** (`ivoszoawhknwbiszjvfv`) recebeu `schema.sql` e `enterprise.sql`, com cinco tabelas protegidas por RLS. A configuração pública aponta para esse projeto e oferece somente Google; Facebook permanece desativado enquanto seu cadastro na Meta está pendente.

O Google usa seu botão oficial **Google Identity Services (GIS)**. A credencial assinada pelo Google é trocada por uma sessão Supabase com `signInWithIdToken`. Este fluxo usa o Client ID público e **não depende de Client Secret**. O SDK do Google só é carregado quando a pessoa escolhe entrar. A entrada real na conta conectada foi confirmada em navegador remoto e persistiu após recarregar a página; a confirmação MFA foi feita pelo titular. Isso não equivale a um teste físico do aplicativo no Android. A revisão 3.2.1 também impede que uma gravação pendente seja sobrescrita ao confirmar um backup ou fechamento duplicado.

Projeto Google existente: `minha-rodagem-515711` (External / Testing). Cliente Web: **Minha Rodagem Web**. Client ID público:

```text
421909197196-td982abtadcdh70hesfc3ucp2fe0qqii.apps.googleusercontent.com
```

No [provedor Google do MRB](https://supabase.com/dashboard/project/ivoszoawhknwbiszjvfv/auth/providers), o Client ID deve corresponder ao arquivo público, Google deve estar habilitado e **Skip nonce checks deve permanecer desligado**. A assinatura, o emissor e a audiência são verificados pelo Supabase. Por tentativa, o app gera 32 bytes aleatórios; envia ao Google o hash SHA-256 hexadecimal do nonce e ao Supabase o nonce original. O callback é consumido uma vez e nenhuma credencial é incluída nos backups.

As [URLs do Auth](https://supabase.com/dashboard/project/ivoszoawhknwbiszjvfv/auth/url-configuration) foram salvas e verificadas com Site URL e Redirect URL `https://lesmoboy.github.io/meu-primeiro-app/`. O login GIS retorna a credencial ao app por callback JavaScript, sem colocar o ID token na URL. O callback OAuth `https://ivoszoawhknwbiszjvfv.supabase.co/auth/v1/callback` continua cadastrado no cliente para os fluxos de redirecionamento, que exigem configuração própria.

Páginas públicas e contato aprovados:

- Privacidade: https://lesmoboy.github.io/meu-primeiro-app/privacidade.html
- Exclusão de dados: https://lesmoboy.github.io/meu-primeiro-app/exclusao-dados.html
- Atendimento: rodadiaempresas@gmail.com

Antes de oferecer uma nova versão, confirme a configuração do provedor, a origem JavaScript autorizada e o login real no domínio publicado. Os testes automatizados usam contas e SDK simulados; não iniciam uma autorização real nem enviam registros ao projeto. Facebook não deve ser anunciado como ativo até sua configuração e verificação próprias.

O código empresarial inclui RPCs privilegiadas com verificação de UID e papel na empresa. O aviso do [Advisor sobre funções SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) exige manter essas verificações; a execução por `authenticated` é intencional. Convites mantêm RLS sem leitura direta e usam somente as operações autorizadas do servidor.

## Guia para configuração e instalações futuras

O Minha Rodagem continua funcionando com perfis locais. Os passos abaixo também servem para novas instalações; no MRB, não recrie o projeto Supabase nem o projeto Google já informados acima. Cada provedor só deve ser publicado após sua configuração e homologação. Um botão visível não comprova que a autenticação esteja ativa.

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

Adicione apenas os endereços exatos usados em produção. O fluxo Google GIS desta versão usa callback JavaScript. Nos fluxos OAuth de redirecionamento, o app remove a consulta e o fragmento antes de iniciar a autorização. Um ambiente de desenvolvimento precisa de uma entrada própria e de um projeto de teste; evite curingas amplos em produção.

O endereço do aplicativo é diferente do endereço de retorno do provedor. No Google e no Facebook, o callback é o mostrado pelo Supabase, normalmente:

```text
https://SEU-PROJECT-REF.supabase.co/auth/v1/callback
```

Copie esse endereço da tela do provedor no Supabase. Trocar o domínio do app exige atualizar as URLs permitidas e a configuração dos provedores.

## 3. Configurar Google

1. Abra [Google Cloud Console](https://console.cloud.google.com/) e use o projeto existente desta instalação; não crie um projeto duplicado.
2. Em **Google Auth Platform**, configure o nome do app, suporte e contato reais, público External e somente a identificação básica. No modo Testing, o Google documenta uma exceção às restrições de testadores para somente `openid`, e-mail e perfil; escopos adicionais têm requisitos próprios. Nome/logo públicos e domínio podem exigir verificação de marca.
3. Use o cliente do tipo **Web application**. Para este app, **Authorized JavaScript origins** deve conter `https://lesmoboy.github.io`, sem o caminho `/meu-primeiro-app/`.
4. Copie o **Client ID público** para `googleClientId` no arquivo público e para **Supabase → Authentication → Sign In / Providers → Google → Client IDs**. Ative Google e mantenha **Skip nonce checks desligado**.
5. O campo **Client Secret (for OAuth)** pode ficar vazio para o fluxo GIS/ID token. Não use um valor fictício. O fluxo legado `signInWithOAuth` é diferente e precisa de um segredo verdadeiro no servidor.
6. Confira o botão no site publicado, cancelamento, entrada, recarga e saída. Entrar não vincula nem envia automaticamente os perfis locais.

O app exige Web Crypto: nonce aleatório novo a cada tentativa, hash SHA-256 hexadecimal entregue ao GIS e nonce original entregue ao `signInWithIdToken`. Não altere essa combinação nem pule a validação de nonce para resolver um erro. Os dados do JWT não concedem permissões pela simples leitura no navegador; a autenticação ocorre no Supabase, e as operações verificam a identidade no servidor.

Referências: [Google Login no Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [botão Google Identity Services](https://developers.google.com/identity/gsi/web/guides/display-button).

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

A configuração desta versão usa somente os identificadores públicos:

```js
window.RodagemCloudConfig = Object.freeze({
  url: 'https://SEU-PROJECT-REF.supabase.co',
  publishableKey: 'SUA_CHAVE_PUBLICA_PUBLISHABLE_OU_ANON',
  providers: Object.freeze(['google']),
  googleAuthMode: 'id_token',
  googleClientId: 'SEU_CLIENT_ID_WEB.apps.googleusercontent.com'
});
```

Use a chave pública verdadeira e o Client ID da mesma instalação. `google-identity.js` deve ser carregado antes do cliente de nuvem. Não inclua Client Secret, chave de serviço, senha do banco, ID token ou sessão nesse arquivo, no ZIP ou no GitHub.

A lista `providers` controla quais entradas ficam disponíveis. Facebook só deve ser incluído depois de configurar o aplicativo da Meta e o segredo do provedor no Supabase. O driver mantém OAuth/PKCE para os fluxos legados; `googleAuthMode: 'id_token'` seleciona o botão GIS nesta instalação.

Depois de publicar, reabra o app com internet. O SDK Supabase está incluído no pacote; o botão oficial Google é carregado pela internet sob demanda. O funcionamento local continua disponível sem login, e as páginas de privacidade e exclusão fazem parte do cache offline.

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

## Operação empresarial e cobrança

O esquema pessoal sincroniza uma conta. `enterprise.sql`, aplicado depois de `schema.sql`, acrescenta empresas, membros, convites, papéis, frota, viagens e alertas com verificação de associação em cada acesso. Ambos já foram instalados no MRB. Um domínio de e-mail ou a seleção de empresa no formulário não concede acesso.

A cobrança permanece desativada. `billing.sql` e as funções de pagamento precisam de configuração e validação próprias antes de qualquer contratação real. Empresas locais e cópias pessoais usam armazenamentos e operações diferentes; não envie os dados empresariais como se fossem parte do snapshot pessoal.

Para excluir uma conta, o proprietário pode usar **Authentication → Users → Delete user** no projeto; a chave estrangeira remove o snapshot dessa conta. Dados locais e tokens já guardados em um aparelho precisam ser removidos/encerrados nesse aparelho também. Defina o atendimento e o fluxo de exclusão da conta antes da operação comercial.
