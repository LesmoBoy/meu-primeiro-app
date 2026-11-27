# Orçamento de backups — Minha Rodagem v3.2.3

## Divergência confirmada

O navegador transmite JSON compacto, mas a restrição existente do PostgreSQL usa `octet_length(snapshot::text)` sobre um valor `jsonb`. Não são os mesmos bytes. O PostgreSQL acrescenta espaços depois de `:` e `,`, e expande números em notação exponencial ao imprimir `jsonb::text`. Strings também precisam considerar UTF-8 e escapes JSON, em vez de contar caracteres JavaScript.

Exemplo: `{"a":1,"b":2}` ocupa 13 bytes no envio e 16 bytes como `{"a": 1, "b": 2}`. O número `5e-324` ocupa 6 bytes no envio e 326 bytes quando expandido pelo PostgreSQL. Ordenar as chaves de um objeto não altera seu comprimento total.

A regressão com **36.000 registros inteiramente sintéticos** reproduz a diferença observada na auditoria:

| Medida | Bytes | MB decimais aproximados |
| --- | ---: | ---: |
| JSON compacto enviado pelo navegador | 4.633.030 | 4,63 |
| `jsonb::text` medido no PostgreSQL 17.12 local | 5.281.046 | 5,28 |
| Limite existente do servidor: 5 MiB | 5.242.880 | 5,24 |

O arquivo compacto fica abaixo do limite; a representação validada pelo servidor fica acima. O envio deve ser recusado antes da RPC, com os registros locais e a última cópia remota preservados. O módulo não muda o limite, a validação SQL, os registros financeiros ou a arquitetura de armazenamento.

## Implementação e contrato

`backup-budget.js` exporta uma API sem dependências:

```js
const budget = RodagemBackupBudget.inspect(canonicalSnapshot);
RodagemBackupBudget.assertFits(canonicalSnapshot); // lança se não for seguro enviar
```

| Campo | Significado |
| --- | --- |
| `wireBytes` | Bytes do JSON compacto canônico, ou `null` quando o cálculo não é seguro/completo. |
| `serverBytesUpperBound` | Cota superior em bytes para o texto JSONB no PostgreSQL 17, ou `null`. |
| `limitBytes` | 5.242.880. |
| `fits` | Verdadeiro somente se a entrada for processável e ambos os tamanhos couberem. |
| `reason` | `ok`, `server-limit`, `invalid-unicode`, `invalid-json`, `circular`, `depth` ou `complexity`. |
| `complete` | Indica se os tamanhos foram calculados até o fim. |

`assertFits` retorna o mesmo orçamento quando permitido. Caso contrário, lança `RodagemBackupBudgetError` com código estável `BACKUP_TOO_LARGE` ou `BACKUP_INVALID_DATA` e mensagem em português, sem incluir conteúdo dos registros, tokens ou dados pessoais. A mensagem de tamanho explica que JSONB pode ocupar mais espaço que o arquivo JSON e informa a preservação das cópias.

O algoritmo percorre a estrutura de forma iterativa. Conta chaves e valores, espaços de separação, escapes, bytes UTF-8 e a expansão decimal dos números finitos serializados pelo JavaScript. Não constrói um segundo JSON completo, não executa `toJSON` nem getters da aplicação e não acessa armazenamento, DOM, sessão ou rede. A cota coincidiu com o tamanho medido nos oito conjuntos locais; continua sendo um preflight conservador, e o servidor permanece a autoridade.

São aceitos valores JSON canônicos: objetos simples, arrays densos, strings Unicode válidas, números finitos, booleanos e `null`. A entrada com ciclos, caracteres NUL, substitutos UTF-16 isolados, getters, hooks de serialização, tipos não JSON ou estruturas excessivas é recusada sem conversão silenciosa. Há guardas de 128 níveis de contêiner, quatro milhões de valores e orçamento de processamento de aproximadamente 20 MiB; exceder uma guarda não prova corrupção do histórico e nunca autoriza apagá-lo.

## Integração segura

1. Validar a sessão autenticada e obter o snapshot canônico pelos validadores existentes.
2. Executar `assertFits` **antes** de qualquer RPC que grave o novo backup. Nenhum estado local ou marcador de revisão deve ser antecipado nesse caminho.
3. Se houver erro, mostrar a mensagem e manter os dados locais, a revisão conhecida e a última cópia válida do servidor. Não enviar uma cópia vazia, resumida ou sem jornadas para fazê-la caber.
4. Se o preflight passar, continuar usando a RPC existente, autorização, RLS e controle de revisão. Atualizar os marcadores de sincronização somente após confirmação válida do servidor.

O orçamento é uma barreira para **novos envios**, não um validador de migração. Não deve bloquear a leitura, exportação ou restauração de backups legados. A compatibilidade e a quarentena de jornadas antigas são tratadas pelos validadores próprios; não se deve aparar registros para satisfazer o tamanho. A ausência do módulo durante um envio deve falhar antes da gravação; não deve impedir que o usuário acesse seus dados locais.

## Evidências e limites

Comandos reproduzíveis na raiz do repositório:

```sh
node qa/v323/backup-budget-test.cjs
python3 qa/v323/backup-budget-postgres.py
```

O primeiro comando executa dez regressões automatizadas locais: comparação com o transporte JSON, separadores, expoentes, fronteira exata de tamanho, ledger de 36.000 linhas, Unicode inválido, tipos não JSON, ciclos e referências compartilhadas, getters/hooks, guardas de profundidade/processamento e ausência de mutação/uso de estado do navegador. Os casos relacionados são agrupados nas dez verificações. A evidência é `qa/v323/backup-budget-unit-result.json`.

O segundo executa oito comparações com PostgreSQL **17.12** real em contêiner Docker descartável, sem rede externa, portas publicadas ou volume persistente. Reutiliza exatamente os tokens JSON produzidos pelo JavaScript, inclusive mais de mil valores numéricos determinísticos, Unicode, escapes, chaves especiais e o ledger grande. A evidência é `qa/v323/backup-budget-postgres-result.json`; nenhum caso subestimou o servidor e os oito coincidiram byte a byte. O contêiner é removido ao final.

São testes automatizados de unidade e de PostgreSQL local com dados sintéticos. Não constituem testes autenticados de Google, de homologação remota, de produção, de Android físico ou de contas reais. O comportamento final de preservar a cópia válida também precisa da regressão de integração do fluxo de sincronização. Falhas de rede, concorrência e expiração de sessão continuam exigindo os controles existentes. Outros formatos de serialização ou versões futuras do servidor devem repetir esta comparação antes de alterar o contrato.

## Proposta futura: sincronização incremental

O limite de um único documento continua existindo. Dividir silenciosamente o histórico ou simplesmente aumentar o limite não resolve crescimento, concorrência e restauração. Uma versão futura pode migrar gradualmente para entidades e segmentos, mantendo leitura do snapshot atual:

- Dar identificador estável e revisão a registros, perfis, jornadas e segmentos de percurso. Operações precisam de chave idempotente; remoções devem gerar tombstones, com retenção definida.
- Enviar lotes pequenos e limitados por bytes, com tenant/usuário verificados no servidor e RLS em todas as tabelas. Papéis empresariais devem ser revalidados por operação, sem confiar no tenant recebido do navegador.
- Armazenar trajetos em segmentos separados, sem reescrever todo o histórico a cada ponto. Um manifesto versionado reúne entidades, contagens, checksums e a revisão esperada.
- Confirmar a revisão do manifesto de forma atômica somente depois de validar todos os segmentos. Conflitos usam comparação da revisão esperada; lotes incompletos não substituem a última versão restaurável.
- Permitir retomar lotes idempotentes após perda de rede e restaurar a partir de um manifesto consistente. A coleta de segmentos órfãos deve ser posterior, conservadora e auditável.
- Executar migração em homologação com dados sintéticos, provar isolamento de empresa/usuário, exportar e restaurar o legado e preparar rollback para leitura do snapshot anterior antes de publicar.

Essa proposta não foi implementada em v3.2.3. Não há novas tabelas, provedores, migrações remotas, cobranças ou alterações em produção decorrentes deste módulo.
