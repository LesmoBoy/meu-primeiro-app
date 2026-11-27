# Conflitos de revisão pelo HTTP — v3.2.3

Estado: correção implementada e testada localmente; quinta migração **não aplicada em produção**. Exige autorização explícita para qualquer aplicação no projeto real. Não houve mudança financeira nem uso de dados reais.

## Problema confirmado em homologação

As funções marcavam um conflito lógico de revisão com `40001`, o código PostgreSQL de falha de serialização transacional. No PostgREST 14.18 usado pela homologação, esse código provocou repetição da transação e falta de resposta até o timeout. Repetir a mesma revisão esperada não pode resolver o conflito. O PostgreSQL direto recusava corretamente e preservava o dado, por isso as suítes SQL anteriores não detectavam o problema do transporte HTTP.

O código `PT409` representa o conflito de aplicação com HTTP 409 e evita tratá-lo como serialização repetível. A documentação oficial permite códigos `PTxyz` para controlar a resposta HTTP. [PostgREST: erros personalizados](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes).

Há uma segunda camada: o SDK Supabase atual pode repetir respostas 409 em chamadas POST/RPC. A configuração do cliente da RC deve usar `db.retry: false` e reconhecer `error.code === 'PT409'`, além do `40001` legado. A homologação HTTP e os testes do cliente são evidências separadas da presente prova SQL. [Supabase: repetição automática](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js).

## Mudança mínima

| Função | Trocas de SQLSTATE | Comportamento preservado |
| --- | ---: | --- |
| `rodagem_save_snapshot(uuid,bigint,jsonb)` | 1 | UID, validação, RLS/FORCE, snapshot, revisão e timestamp |
| `business_save_entity(uuid,uuid,text,uuid,bigint,jsonb)` | 3 | Papel, referências, revisão, locks e atualização autorizada |
| `business_archive_entity(uuid,uuid,text,uuid,bigint)` | 1 | Empresa, papel, revisão, arquivamento e preservação histórica |
| `business_save_member(uuid,uuid,uuid,bigint,jsonb)` | 2 | Empresa, papel, último owner, revisão e locks |

São **sete literais** em quatro corpos; mensagens, assinaturas, regras financeiras e todas as verificações permanecem byte a byte iguais depois de normalizar o SQLSTATE. Falhas reais de serialização geradas pelo PostgreSQL continuam `40001`; a mudança atinge somente os `RAISE` usados como conflito lógico. Billing não contém esses `RAISE` e continua desativado.

As quatro migrações anteriores ficam intactas. A nova [20261127023748_rodagem_cas_http_conflict.sql](../../supabase/migrations/20261127023748_rodagem_cas_http_conflict.sql) foi criada com `supabase migration new` pelo CLI 3.4.0. Usa transação, limites de espera e quatro `CREATE OR REPLACE`, preservando owners/ACLs. Não executa DML sobre dados da aplicação nem altera tabelas, permissões ou políticas.

Antes de substituir, o guard exige os corpos baseline ou candidato conhecidos e os atributos definer, volatilidade e search_path esperados. Um corpo inesperado recusa toda a transação com `55000`. O guard não promete detectar todo metadado possível; comparar owner, ACLs e contrato com o catálogo atual continua parte da aprovação operacional.

## Provas SQL locais

Executar `python3 qa/migrations-chain-test.py`, `bash supabase/test-postgres.sh`, `bash supabase/test-enterprise.sh` e `python3 qa/v323/postgres-hml-races.py`.

A cadeia aplica as quatro migrações v3.2.2, cria snapshot financeiro e empresa inteiramente sintéticos e registra todas as linhas das cinco tabelas. Aplica a nova migração, reaplica, retorna pelo script de rollback e sobe novamente. Payloads, revisões, timestamps, referências, owners e ACLs permanecem iguais em cada transição. Um corpo sintético alterado é rejeitado pelo guard; a tentativa é revertida. O resultado compara ainda os 25 corpos com os schemas da RC e as diferenças esperadas com o catálogo v3.2.2 somente leitura.

As 15 corridas coordenadas continuam exigindo o lock observado no servidor antes de liberar o vencedor. Os perdedores CAS agora recebem `PT409`; autorização negada permanece `42501`. A suíte pessoal tem 26 marcadores PASS e a empresarial 210, incluindo os resumos. São marcadores de saída, não uma soma de cenários únicos.

Evidências: [migrations-chain-report.json](../../qa/migrations-chain-report.json), [manifesto](../../qa/v323/evidence/cas-sqlstate-manifest.json), [comparação de catálogo](../../qa/v323/evidence/catalog-comparison.json) e [resultados PostgreSQL](../../qa/v323/evidence/postgres-results.json). A prova HTTP real deve ser consultada separadamente em [auth-http-report.json](../../qa/v323/auth-http-report.json). Identidades de homologação são sintéticas e não comprovam a troca OIDC real com o Google.

## Publicação e rollback

Antes de qualquer aplicação real, revisar diff e fingerprints, confirmar estado de produção, concluir homologação da RC e obter autorização do proprietário. Esta etapa não aplicou nem registrou a quinta migração no Supabase real. Clientes antigos podem exibir erro genérico no conflito PT409 até atualizar o app; cópias e regras de revisão continuam preservadas.

O [rollback SQL](sql/rollback-cas-http-conflict.sql) restaura somente os quatro corpos baseline e foi executado exclusivamente no banco descartável. Não remove dados, ACLs, políticas ou tabelas. **Reintroduz a falha de repetição/timeout confirmada**; preferir reverter somente o frontend mantendo a correção SQL compatível, quando a análise do incidente permitir. Nunca executar o rollback automaticamente nem apagar o registro de migração de produção sem procedimento revisado. A eventual reversão real requer aprovação e novo registro de migração conforme a política operacional do projeto.

Não houve teste de carga nem conflito financeiro real em produção. A correção local e a comparação de catálogo não autorizam declarar o sistema pronto para operação comercial.
