# Revisão individual de SECURITY DEFINER — v3.2.3

Homologação local em 26/11/2026, revalidada em 27/11/2026, base `8f4cae36367f667ca871bd2539891ad6d1a74599`, branch `codex/desenvolvimento-v3.2.3`. Resultado: os cenários locais passaram. A homologação HTTP encontrou repetição de conflitos CAS marcados como falha de serialização; quatro funções receberam apenas a troca de sete SQLSTATE lógicos de `40001` para `PT409`. A quinta migração está preparada e **não aplicada em produção**. RLS, FORCE RLS, autorização, locks e regras financeiras foram preservados.

## Escopo e evidência

O arquivo contém **13** funções SECURITY DEFINER: **11 executáveis por `authenticated`** (9 RPCs empresariais e 2 helpers das políticas RLS), mais 2 internas (`business_guard` e o trigger de exclusão). A matriz abaixo trata individualmente as 11 expostas; as internas também foram revisadas.

Somente PostgreSQL 17.12 em Docker descartável, `--network none`, sem portas publicadas e com contas `example.test`, veículos, viagens, valores e perfis fictícios. Não houve conexão a projeto Supabase, autenticação Google/Meta, envio de mensagem/e-mail, cobrança, novo provedor ou alteração remota. O `auth.uid()` local lê uma claim sintética configurada pela fixture; esses testes não validam assinaturas JWT.

Comandos executados com saída zero:

```sh
sh supabase/test-postgres.sh
sh supabase/test-enterprise.sh
python3 qa/v323/postgres-hml-races.py
python3 qa/migrations-chain-test.py
python3 qa/v323/backup-budget-postgres.py
```

| Execução | Resultado observado | Evidência |
| --- | --- | --- |
| Baseline pessoal, antes das ampliações | 22 marcadores `PASS` | [postgres-baseline.log](../../qa/v323/evidence/postgres-baseline.log) |
| Baseline empresarial, antes das ampliações | 98 marcadores `PASS` | [enterprise-baseline.log](../../qa/v323/evidence/enterprise-baseline.log) |
| Pessoal ampliado | 26 marcadores `PASS`, sendo 4 novos `HML` | [personal-final.log](../../qa/v323/evidence/personal-final.log) |
| Empresarial ampliado | 210 marcadores `PASS`, sendo 112 novos `HML` | [enterprise-final.log](../../qa/v323/evidence/enterprise-final.log) |
| Concorrência ampliada | 15 cenários coordenados aprovados | [enterprise-races.json](../../qa/v323/evidence/enterprise-races.json), [log final](../../qa/v323/evidence/races-final.log) |

Marcadores `PASS` são linhas de asserção/resultado, não uma contagem de casos independentes: há laços com várias entradas inválidas e uma linha final de resumo nos runners. O runner empresarial já inclui os testes SQL locais de billing; estes usam somente estados fictícios e nenhum serviço de pagamento.

As ampliações SQL rodam dentro de transações com `ROLLBACK`, conservando a revisão e os vínculos esperados pelos testes de duas sessões existentes. O runner novo cria e remove seu próprio contêiner. A execução de baseline serviu de comparação; os testes ampliados foram repetidos após incluir os casos adicionais de criação por papel e IDs de outra empresa. A retomada em 27/11 repetiu as suítes solicitadas e comparou o catálogo local com a referência somente leitura de produção. O runner de concorrência passou a aguardar o servidor TCP final, evitando um falso pronto do socket temporário do initdb; somente as 15 corridas foram repetidas depois desse ajuste. Após o achado HTTP, as suítes pessoal/empresarial, as 15 corridas e a cadeia de migrações foram novamente executadas com o contrato `PT409`.

## Verificações comuns executadas

Para cada uma das 11 funções, o catálogo confirmou `prosecdef=true`, `search_path=''`, ausência de `LEAKPROOF`, `EXECUTE` para `authenticated`, ausência de `EXECUTE` para `anon` e ausência de concessão a `PUBLIC`. Cada chamada anônima também foi executada e negada com `42501`.

Cada uma das 9 RPCs foi chamada separadamente com UID esperado divergente e esperado nulo (`28000`) e com UID JWT ausente (`42501`), antes da avaliação dos demais argumentos. Para os 2 helpers, ausência de UID, usuário de outra empresa e vínculo revogado retornaram `NULL` sem expor o ID/papel alheio.

As quatro tabelas empresariais retiveram `relrowsecurity=true` e `relforcerowsecurity=true`. `authenticated` conserva somente SELECT nas tabelas de empresa, membros e entidades; nenhum privilégio direto de INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ou TRIGGER foi concedido nas quatro tabelas. Convites e hashes não são consultáveis diretamente pelo cliente. INSERT de vínculo e UPDATE direto de entidade foram de fato negados, além da inspeção de grants.

Todas as referências de aplicação nas funções revisadas são qualificadas (`public.*`, `auth.*`). Criar uma tabela temporária `business_members` com vínculo forjado e funções temporárias de mesmo nome, e usar `search_path=pg_temp,public`, não concedeu acesso à outra empresa nem alterou a identidade retornada pelo workspace. No contêiner, o proprietário das funções é `postgres`; o papel cliente continua `authenticated`. O definer pode contornar RLS pelo privilégio do proprietário: a autorização explícita de cada RPC continua obrigatória e foi exercitada.

## Matriz das 11 funções

Em todas as linhas, valem os testes comuns de ACL, search_path e UID descritos acima. `A`/`B` são contas fictícias independentes; suas empresas são A/B no runner SQL e X/Y no runner de concorrência.

| Função | Necessidade e limites do privilégio | Provas funcionais realmente executadas | Resultado e concorrência |
| --- | --- | --- | --- |
| `business_list_companies(uuid)` | Lê vínculos/empresas e filtra `user_id` pelo retorno do guard, com `active=true`. Não aceita escolher outro usuário. | A/B listam apenas os próprios vínculos; vínculo inativo some; owner, manager, finance e driver listam e criam empresa própria sem mudar o papel na empresa existente. | Aprovado. Após revogação do manager, a empresa revogada deixa a lista. Leitura STABLE, sem CAS. |
| `business_create_company(uuid,text)` | Insere empresa e primeiro owner em uma operação; usa UID autenticado. `raw_user_meta_data.full_name` serve apenas de nome, nunca de papel. | Nova empresa vincula o mesmo UID como owner; 4 papéis de outra empresa podem criar a sua; nome vazio e nome com 81 caracteres recusados. | Aprovado. UID divergente não cria empresa. Não há revisão anterior/CAS; corrida específica de duas criações por um UID não foi executada. |
| `business_load_workspace(uuid,uuid)` | Exige vínculo ativo. Owner/manager/finance recebem a empresa; driver recebe frota e somente suas viagens, alertas atribuídos e o próprio vínculo. | B não carrega A; owner/manager/finance/driver carregam o papel correto; driver é filtrado também por SELECT direto; vínculo revogado perde o acesso; search_path hostil não altera o resultado. | Aprovado. Novas leituras após revogação são negadas. Não foi alegado cancelamento de leitura já iniciada. A ramificação dinâmica de entitlement não recebeu uma nova prova de envelope aqui. |
| `business_save_entity(uuid,uuid,text,uuid,bigint,jsonb)` | Escrita somente pela RPC. Valida empresa/ID/kind, esquema, valores inteiros, referências da empresa e revisão. Owner/manager operam; finance altera só custos de viagem existente; driver altera só viagens próprias. Trava empresa e reconsulta papel/ID. | Referências veículo/pessoa da outra empresa, convite pendente, veículo arquivado para viagem nova, payload malformado, ID estrangeiro, receita alterada pelo finance e tomada de viagem alheia negados. Manager cria/restaura veículo; driver cria viagem própria; finance corrige custos históricos. | Aprovado. Save/save existente, save/archive e archive/save: apenas uma revisão vence (`PT409`). Revogação e demissão manager→finance durante espera negam escrita (`42501`) sem mutação. ID novo concorrente entre X/Y conserva empresa original. |
| `business_archive_entity(uuid,uuid,text,uuid,bigint)` | Valida empresa/kind/ID, papel e revisão. Owner/manager arquivam operação; driver só sua própria viagem; finance não arquiva. Não apaga histórico. Trava empresa e reconsulta papel. | Owner arquiva e preserva viagem/veículo; manager arquiva veículo e o restaura por save com CAS; driver arquiva viagem própria, mas não frota/viagem alheia; finance e IDs estrangeiros negados. | Aprovado. Corridas nos dois sentidos com save recebem `PT409` no perdedor. Manager revogado na espera recebe `42501`; estado preservado. |
| `business_save_member(uuid,uuid,uuid,bigint,jsonb)` | Somente owner/manager; permite apenas `{name,role,active}`. Manager só altera driver/finance. Não troca UID/e-mail. Protege último owner; trava empresa e membro, revalida papel e revisão. | Manager não promove a si nem altera owner; owner não desativa/rebaixa último owner; manager edita driver; CAS antigo falha; foreign member ID falha; finance/driver não editam equipe; desativação preserva vínculos de viagem. | Aprovado. Duas edições da mesma revisão: uma vence (`PT409`). Manager revogado durante espera recebe `42501`. Dois owners tentando se rebaixar deixam exatamente um owner ativo. |
| `business_invite_member(uuid,uuid,text,text,text)` | Owner convida manager/finance/driver; manager só finance/driver. Nunca convida owner. Valida e-mail/nome, membro ativo duplicado, serializa substituição de convite e retorna token completo uma vez; persiste hash. | Token tem 64 caracteres hexadecimais; hash negado ao cliente; manager não concede owner/manager; finance/driver não convidam; manager convida finance; issuer revogado perde autoridade no aceite. | Aprovado. Duas criações simultâneas para o mesmo e-mail terminam com exatamente um token ativo. Manager revogado na espera não cria convite (`42501`). |
| `business_revoke_invite(uuid,uuid,uuid)` | Owner/manager; manager não revoga convite de manager. Só convite da empresa e ainda não aceito. Trava empresa/convite e reconsulta papel. | Owner revoga token e impede aceite; manager não revoga convite de manager, mas revoga seu convite de finance; repetição autorizada é idempotente; B/finance/driver negados. | Aprovado. Revogar antes de aceitar cria zero vínculos; aceitar primeiro cria um vínculo e revogação perde com `42501`. Manager revogado na espera não revoga convite. |
| `business_accept_invite(uuid,text)` | Guard UID; formato/hash/token único; e-mail confirmado igual ao convite; prazo/revogação/uso e autorização atual do emissor. Trava empresa, relê convite com FOR UPDATE e cria só o papel prescrito. | E-mail incorreto, não confirmado, token expirado, revogado, repetido ou de emissor revogado negados; aceite válido vincula manager/finance/driver; convite pendente não é motorista válido. | Aprovado. Aceite duplo concorrente gera um vínculo; o segundo recebe `42501`. Corrida com revogação foi exercitada nos dois sentidos. |
| `business_membership_id(uuid)` | Helper de RLS sem escrita. Precisa ler `business_members` sem recursão da própria policy. Retorna somente ID do vínculo ativo de `auth.uid()` na empresa pedida. Não usa `expected_user_id` porque é predicado das policies. | owner/manager/finance/driver recebem seu ID, B não recebe ID de A, UID ausente e manager revogado recebem NULL; tabela/funções temporárias não forjam vínculo. | Aprovado. Reconsultado após a trava na RPC de save; revogação coordenada não retém ID/papel. O helper isolado não possui CAS. |
| `business_membership_role(uuid)` | Helper de RLS sem escrita. Leitura privilegiada evita recursão da policy de membros, limitada a `company_id`, `auth.uid()` e `active`. | Os quatro papéis vêm do vínculo correto; B, UID ausente e manager revogado recebem NULL; tentativa com search_path temporário não concede owner alheio. | Aprovado. Revalidação de papel após espera demonstrada individualmente nas 5 RPCs mutantes de entidade/equipe/convite, além da demissão manager→finance. O helper isolado não possui CAS. |

## Funções internas e preservação do desenho

- `business_guard(uuid)`: SECURITY DEFINER com search_path vazio, sem EXECUTE para `PUBLIC`, `anon` ou `authenticated`. As 9 RPCs chamam o guard qualificado antes dos argumentos/operações; os 27 cenários de UID das ampliações comprovaram essa ordem. A função não concede identidade a partir de metadados editáveis.
- `business_archive_deleted_user()`: trigger SECURITY DEFINER com search_path vazio e sem EXECUTE para os papéis cliente. Trava empresas em ordem de ID, impede excluir o último owner ativo, anonimiza/desativa vínculos e preserva IDs históricos. A exclusão fictícia de um motorista preservou sua viagem; excluir o último owner falhou e foi revertido. Concorrência de exclusão de conta com outras mutações não foi executada nesta ampliação.

Os 11 endpoints não foram convertidos apenas para reduzir avisos de Advisor. As mutações dependem do privilégio controlado da RPC porque o cliente não recebe DML nas tabelas; as helpers evitam recursão de RLS. Uma futura redução de definers exige redesenho e prova do contrato completo, sem remover RLS/FORCE. Esta etapa local não consultou o Advisor remoto. A leitura separada feita pelo agente principal está em [production-catalog.json](../../qa/v323/production-catalog.json): 11 WARN de definers autenticados, 1 WARN de proteção de senha vazada, 1 INFO de RLS sem policy direta em convites, 4 INFO de índices sem uso e nenhum alerta de health. São 12 WARN de segurança e 1 INFO de segurança, não 13 WARN. Os avisos não foram eliminados por remoção de controles.

## Vínculo, envio e restauração sintéticos

No PostgreSQL empresarial, contas confirmadas fictícias receberam convites, aceitaram-nos, carregaram workspace e enviaram somente as alterações do papel obtido. O round trip de arquivamento/restauração de veículo foi validado com revisão crescente. Desativar vínculo bloqueou novo workspace sem apagar viagens.

No PostgreSQL pessoal, a conta A enviou perfil, registro diário e jornada pausada fictícios e recuperou exatamente o mesmo payload, revisão e timestamp do servidor. Trocar a sessão para B impediu envio de A para B (`28000`); B começou sem cópia e gravou somente a própria. Retornar a A restaurou o envelope original intacto. Os testes extras fazem rollback e conservam A na revisão 2 para a corrida CAS existente, cujo vencedor avança para 3.

## Comparação com o catálogo de produção somente leitura

O teste de migrações reproduz primeiro a v3.2.2 e compara **offline** a evidência coletada pelo agente principal em 27/11: **25/25 definições** (`md5(pg_get_functiondef)`) iguais à referência, com proprietários, assinaturas, flags de definer, search_path e ACL de `anon` correspondentes; **5/5 tabelas** com RLS/FORCE e as **4 migrações já aplicadas**. Para `authenticated`, **24/25 ACLs** coincidem.

Após a quinta migração local, **21 definições permanecem idênticas** e **4 diferem somente em sete literais de SQLSTATE CAS**. Normalizar `PT409` para `40001` produz exatamente os corpos da referência nas 25 funções. Owners/ACLs e demais metadados comparados não mudam. A quinta migração `20261127023748_rodagem_cas_http_conflict.sql` continua pendente de autorização de produção; não há alegação de igualdade total entre RC e servidor atual.

O upgrade com snapshot financeiro e empresa fictícios preservou todas as linhas das cinco tabelas, incluindo payloads, revisões, timestamps e referências. Reaplicação preservou dados e definições. O rollback local restaurou o catálogo v3.2.2 com as mesmas linhas; novo upgrade restaurou a RC. Uma alteração sintética desconhecida no corpo fez o guard rejeitar com `55000` antes de substituições e foi revertida. O guard verifica corpo, definer, volatilidade e search_path; não deve ser descrito como verificação de todo metadado possível. A troca somente de SQLSTATE e o rollback são detalhados em [CAS-HTTP.md](CAS-HTTP.md).

Há uma divergência explícita e revisada: o trigger `rodagem_sync_stamp()` tem EXECUTE para `authenticated` na produção e não no banco descartável. A definição é igual e continua SECURITY INVOKER. O schema revoga EXECUTE de PUBLIC/anon, mas não revoga a concessão explícita que pode ter sido criada pelos privilégios padrão do Supabase. O runner concedeu esse EXECUTE **somente em transação local com rollback** e comprovou que a chamada como função comum é rejeitada (`0A000`, função de trigger fora de um trigger). Não houve alteração remota nem alegação de ACLs integralmente iguais. Uma futura normalização de privilégios deve ser revisada e autorizada separadamente; não é necessária para apagar avisos de Advisor.

A comparação aceita apenas essa diferença de ACL e as quatro diferenças de definição justificadas acima; falha diante de alterações inesperadas. A evidência completa está em [migrations-chain-report.json](../../qa/migrations-chain-report.json) e [catalog-comparison.json](../../qa/v323/evidence/catalog-comparison.json). Os hashes vinculam esta comparação à referência coletada; não substituem teste de gateway/assinatura JWT nem acompanhamento de mudanças futuras.

## Limites e decisão

Aprovado para os cenários locais registrados. Não constitui homologação de produção, PostgREST, Gateway/Auth, provedores reais, SMTP, cobrança, configuração de grants já existente no projeto remoto ou navegador. O `service_role` de produção e extensões/configurações específicas não foram reproduzidos integralmente. As provas de concorrência usam o isolamento padrão READ COMMITTED e demonstram interleavings coordenados concretos, sem afirmar cobertura de todos os escalonamentos, isolamento SERIALIZABLE ou desempenho sob carga.

A trava por empresa serializa as mutações autorizadas e protege rechecagem de papel, referências e último owner. Esse desenho pode limitar concorrência dentro de uma empresa; não houve benchmark. Leituras STABLE usam o snapshot da instrução e não prometem interromper uma resposta já em andamento quando a revogação é confirmada. Nenhuma dessas limitações foi resolvida removendo controles; a migração CAS corrige o transporte do erro e não altera essas garantias. Nenhuma alteração foi executada no banco de produção.
