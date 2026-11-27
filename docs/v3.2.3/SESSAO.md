# Sessão Google e autorização — v3.2.3

Referência: auditoria v3.2.2 de 26/11/2026, commit `8f4cae36367f667ca871bd2539891ad6d1a74599`. Esta etapa altera o cliente e acrescenta testes; não modifica configuração Auth, provedores, usuários ou dados do projeto de produção.

## Validação autoritativa

`RodagemCloud.getSession()` lê a sessão do SDK e serve à apresentação e à identificação do UID esperado. A identidade em cache não autoriza a sincronização. `verifySession(expectedUserId)` exige perfil válido, compara o UID esperado, consulta `auth.getUser()` no servidor e faz nova leitura da sessão antes de retornar. O usuário retornado vem da resposta autoritativa, com uma lista limitada de campos públicos; tokens de acesso/renovação e metadados arbitrários do SDK não fazem parte da API pública.

Cada verificação mantém a versão de autenticação observada e o perfil inicial. Troca de usuário, saída solicitada, nova tentativa de entrada ou mudança de perfil invalidam a operação. Uma mudança observada A → B → A também invalida a resposta anterior, mesmo quando o UID final coincide. As respostas das RPCs pessoais, empresariais e da função preparada de cobrança são revalidadas antes de chegar ao chamador. O servidor mantém sua própria comparação com `auth.uid()`; o cliente não substitui autorização SQL, RLS ou papéis empresariais.

Uma sessão ausente, usuário inválido no retorno, expiração remanescente após a leitura do SDK ou erro conhecido de renovação não produz confirmação positiva. Erros e respostas externas são traduzidos para códigos e mensagens públicos sem incluir o corpo da resposta nem credenciais. A ausência de `expires_at` em um formato compatível não é usada como prova de validade: a confirmação depende sempre de `getUser()`.

## Expiração e renovação

O SDK continua responsável pela renovação automática ao ler a sessão expirada. O novo método `refreshSession(expectedUserId)` permite renovação explícita, bloqueia renovações paralelas e volta a executar a verificação autoritativa do mesmo UID. Ele retorna somente a sessão pública sanitizada. Mudança de conta/perfil ou saída durante a espera cancela a resposta. Não foi criado um novo provedor de entrada nem um mecanismo próprio de armazenamento de tokens.

O diagnóstico visual não força renovação manual: a verificação já permite ao SDK renovar quando necessário. O retorno positivo vale para o instante da consulta e não promete que operações futuras terão autorização. Perda de rede, revogação posterior e mudança de papel precisam continuar sendo verificadas por operação.

## Saída e troca de conta

`signOut()` mantém `scope: 'local'`. O aplicativo preserva lançamentos, preferências, percursos, registro de perfis, vínculo de cópia e dados empresariais locais. Sair da conta não remove dados do dispositivo; essa ação pertence ao fluxo explícito documentado em `DADOS-DISPOSITIVO.md`.

Foi confirmada uma corrida adicional no SDK fixado: `signInWithIdToken()` salva a sessão depois do HTTP, sem usar o mesmo lock da saída. Apenas descartar o resultado da tentativa não bastava: um exchange atrasado podia reinstalar a sessão depois de um logout já confirmado. A v3.2.3 cancela a tentativa imediatamente e, se o HTTP já tiver sido iniciado, aguarda seu término antes de executar a saída local. A saída não espera uma janela Google ainda aberta; uma credencial recebida depois do cancelamento nem chega ao exchange.

Enquanto a saída está pendente, novas entradas, renovações, verificações autorizadoras e RPCs pelo wrapper são recusadas com `AUTH_PENDING`. Solicitações repetidas de saída compartilham a operação em andamento. Não há limpeza posterior indiscriminada em segundo plano. Se outra identidade for observada após o exchange e antes da saída final, o wrapper retorna `SESSION_CHANGED` e preserva essa nova conta, exigindo conferência do usuário.

A sessão do SDK é compartilhada entre abas e perfis locais do mesmo site. A proteção acima serializa ações iniciadas por este wrapper na mesma página; não constitui uma transação atômica entre abas. Uma troca externa imediatamente após a última leitura ainda pode concorrer com o SDK, e a própria conclusão de um exchange em outra aba pode substituir a sessão compartilhada. Recomenda-se concluir a saída e conferir a conta antes de entrar novamente, fechando outras abas em dispositivo compartilhado. Não se promete revogação instantânea de todo JWT: a saída local revoga a renovação dessa sessão conforme o servidor, e tokens já emitidos seguem a política de expiração do Supabase. Operações já concluídas no servidor não são revertidas pelo logout.

## Diagnóstico acessível

`session-diagnostics.js`, carregado depois de `cloud-sync.js`, acrescenta ao cartão de conta o botão **Verificar sessão no servidor**. A consulta é voluntária e não vincula perfis, não lê lançamentos e não envia ou recupera backups. O resultado apresenta mensagem pública e horário, sem UID, e-mail ou tokens no texto de diagnóstico.

O botão tem estado ocupado, impede reentrada, mantém região de status acessível e descarta respostas após troca de conta/perfil ou logout. Não restaura foco para um controle removido, oculto ou desabilitado. O estilo reutiliza os cartões e botões existentes; a identidade visual e as formas de entrada atuais permanecem.

## Conflitos de revisão e tentativas automáticas

A homologação HTTP local identificou outra diferença que testes de SQL isolados não demonstravam: usar `40001` para conflito lógico de revisão faz o PostgREST repetir a transação, embora uma revisão esperada desatualizada não possa se corrigir por repetição. O backend candidato passa a representar esses conflitos com `PT409`, entregue como HTTP 409; a migração correspondente é local e permanece pendente de autorização para produção.

O SDK fixado também tem uma política própria de novas tentativas. Desde `supabase-js` 2.102.0, o padrão repete respostas HTTP 409 inclusive em RPCs POST. A v3.2.3 configura `db: {retry: false}` no cliente real, conforme a [documentação atual do Supabase](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js), e não repete automaticamente um conflito de revisão. O usuário deve conferir a cópia remota antes de tentar novamente. A consequência conservadora é que falhas transitórias de rede/Data API também não recebem repetição automática do cliente; a renovação automática de Auth permanece habilitada.

O mapeamento público reconhece `error.code === 'PT409'` tanto na sincronização pessoal quanto nas RPCs empresariais. Ele mantém suporte a `40001` para compatibilidade com o backend anterior e ao status 409 quando fornecido. O SDK pode devolver o status no envelope da resposta, sem colocá-lo dentro de `error`; portanto o código SQLSTATE precisa ser reconhecido diretamente. Nenhuma resposta bruta é mostrada e os dados locais não são alterados pelo erro. Este ajuste do cliente não elimina a repetição interna do PostgREST do backend antigo; a melhora completa depende da migração aprovada do servidor.

## Evidências e classificação

Todos os dados dos testes abaixo são sintéticos. Executar na raiz do repositório:

| Comando | Resultado local | Classificação |
|---|---:|---|
| `node qa/cloud-client-test.cjs` | 22 suítes aprovadas | API do SDK simulada |
| `node qa/deep-audit-integrations-auth.cjs` | 5 testes aprovados | Fronteiras de autorização simuladas |
| `node qa/v323/session-client-test.cjs` | 25 suítes aprovadas | Fronteira Auth simulada; uma prova com SDK fixado real e fetch sintético |
| `node qa/v323/session-diagnostics-test.mjs` | 11 suítes aprovadas | DOM simulado |
| `node qa/google-identity-dom.cjs` | 9 suítes aprovadas | Ciclo GIS em DOM simulado |

`qa/v323/safeauth-local-result.json` registra comandos, resumos, hashes dos arquivos e hashes das saídas. As linhas `PASS` incluem resumos: não devem ser somadas como cenários independentes.

As cinco regressões da corrida de saída verificam: exchange pendente termina antes da saída; chamadas autorizadoras são bloqueadas enquanto se sai; falha do exchange ainda permite sair e liberar o guard; falha de leitura da sessão antiga não pula a espera pelo exchange; outra identidade observada no retorno não é removida. Também se verificam cache sem servidor, metadados autoritativos, ausência de credenciais públicas, expiração, falhas de renovação, UID divergente, perfil inválido, logout em diferentes esperas e mudança observada A → B → A.

As três regressões de conflito verificam a configuração `db.retry`, o mapeamento pessoal/empresarial de `PT409` sem campo `status` preservando `40001`, e a execução do SDK fixado real sobre um fetch que retorna HTTP 409 sintético. Nesta última, uma única chamada foi observada; o envelope continha `status: 409`, enquanto `error` continha `code: PT409` sem propriedade `status`. Essa prova não usa rede real nem substitui a evidência HTTP da stack local.

Esses testes não são login Google real, nem evidência de HTTP autêntico, renderização Chromium ou produção v3.2.3. A stack local com Auth/PostgREST reais é registrada separadamente em `HOMOLOGACAO-AUTENTICADA.md`; identidades Google sintéticas não comprovam OIDC. A observação da conta já conectada em produção v3.2.2 também tem relatório separado, `qa/v323/production-readonly-session.json`: sucesso pela interface, sem captura HTTP independente e sem publicação desta versão. Homologação Google de ponta a ponta da candidata e troca real entre aparelhos continuam condicionadas a ambiente apropriado e execução registrada.

## Retorno e limites

Nenhuma migração de dados ou Auth é necessária. Reverter estes módulos para a árvore compatível anterior e publicar com novo identificador de cache reverte o cliente; não altera os dados salvos. O procedimento geral de rollback está em `ROLLBACK.md` e a publicação depende da aprovação final do proprietário.

Não se declara o aplicativo livre de vulnerabilidades nem pronto para operação comercial. Permanecem a homologação externa do Google, a natureza compartilhada da sessão em abas, a expiração dos JWTs já emitidos e a necessidade de autenticação, autorização e revisão por operação no servidor.
