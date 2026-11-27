# Resultados e evidências — v3.2.3

Dados de teste: exclusivamente sintéticos. Escritas remotas de produção: **zero**. Execução em 26–27/11/2026, sobre a referência auditada v3.2.2. Esta tabela não soma linhas de log a cenários de navegador.

| Categoria | Resultado executado | Evidência | Limite |
|---|---|---|---|
| Automatizados locais Node/DOM | 30/30 suítes aprovadas, incluindo todas as existentes e oito novas | `qa/v323/local-suite-report.json`, logs individuais no artefato do CI | APIs/DOM parcialmente simulados; não prova renderização nem provedores externos |
| Sessão focada | 25 regressões de cliente e 11 de diagnóstico aprovadas | `safeauth-local-result.json` | SDK simulado, exceto probe de repetição com SDK real e HTTP sintético |
| Legados | 12/12 cenários aprovados, bytes locais e valores preservados | `legacy-hours-report.json` | Sem migração automática de histórico |
| Orçamento JSONB | 10 verificações JS e 8 conjuntos PostgreSQL aprovados | `backup-budget-*-result.json` | Preflight conservador; servidor continua autoridade |
| Vínculo, upload e restauração | 23/23 cenários de integração local aprovados | `sync-integration-report.json` | Servidor simulado nessa suíte; HTTP real abaixo é separado |
| Dados do dispositivo | 28/28 suítes locais aprovadas | `device-data-report.json` | Salvar arquivo e recuperação assistida em aparelho real ainda pendentes |
| GPS simulado | 7 lifecycle + 4 permissão/revisão aprovados, além das suítes anteriores | `gps-lifecycle-report.json`, `gps-review-report.json` | Sem localização real, distância ou bateria física |
| PostgreSQL isolado | 26 marcadores pessoais, 210 empresariais, 15 corridas coordenadas aprovadas | `qa/v323/evidence/postgres-results.json` e logs | Marcadores não são casos únicos; claims Auth sintéticas |
| Migrações | 5 migrações locais; 25 funções; 5 tabelas RLS/FORCE; upgrade, reaplicação, rollback e reupgrade preservam linhas/revisões/timestamps/ACL | `qa/migrations-chain-report.json`, revisão independente | Quinta migração preparada, não aplicada em produção |
| HTTP autenticado local real | 16/16 grupos, 82 eventos HTTP; Auth/SDK/REST/PostgreSQL reais | `auth-http-report.json`, [detalhes](HOMOLOGACAO-AUTENTICADA.md) | Identidades Google sintéticas; DOM/confirm/reload simulados no round trip |
| Prova controlada CAS HTTP | 40001 sem resposta até 2.500 ms; PT409/HTTP409 em 157 ms; revisão e hash preservados | `auth-http-cas-proof.json` | Stack local PostgREST14.18; não requisição conflitante de produção |
| Rollback local | Reconstrução da referência, 40 arquivos runtime e 10 suítes de cache simuladas aprovadas | `rollback-dry-run-report.json` | Não é rollback publicado; backend tem plano próprio |
| Dependências | `npm audit`: zero avisos conhecidos na árvore de ferramentas da consulta | `npm-audit.json` | Não certifica todo fornecedor/serviço externo |
| Chromium real | Execução final no CI em consolidação | Relatório CI será anexado antes da entrega final | Fixtures de Google/GPS/Auth continuam sintéticas |
| Produção — somente leitura | Main preservada na referência; catálogo de cinco tabelas/25 funções/quatro migrações e Advisor consultados | `production-catalog.json` | Nenhuma linha financeira lida nem escrita |
| Google existente em produção v3.2.2 | Conta conectada correspondeu; modo “Na minha conta” ativou fluxo protegido e retornou a “Neste aparelho” | `production-readonly-session.json` | Confirmação pela interface; sem captura independente HTTP/getUser e sem executar a candidata |
| Físicos Android/GPS/bateria | **NÃO EXECUTADOS** | [Roteiro pendente](GPS-ANDROID.md) | Não aprovados por simulação |
| Google OIDC externo da v3.2.3 / duas contas e aparelhos | **NÃO EXECUTADO** | [Checklist pendente](HOMOLOGACAO.md) | HTTP local não substitui assinatura/nonce/consentimento reais do provedor |
| Produção — candidata/migração/carga | **NÃO EXECUTADO / NÃO AUTORIZADO** | [Plano e autorização](ROLLBACK.md) | Sem declaração de prontidão comercial |

Os caminhos sem prefixo referem-se a `qa/v323/` na raiz do repositório. Os relatórios incluem classificação e hashes, quando aplicável. Artefatos do CI podem ter retenção curta; evidências resumidas e código de reprodução fazem parte da entrega.

## Cobertura existente preservada

O runner executa motor GPS, perfis, catálogo/integração de veículos, cliente/sincronização cloud, GIS/DOM, DOM pessoal, conexão, cache, core/cliente empresarial, cobrança simulada, controlador GPS, cálculo e todas as suítes de auditoria anteriores. Os seis runners Chromium existentes cobrem pessoal, GPS, perfis, frota, Google e empresas. O novo runner de navegador acrescenta nove fluxos da candidata. Os runners SQL existentes e a cadeia de migrações também integram o CI.

## Interpretação de autenticação e logout

A stack HTTP local usa segredos efêmeros, contêineres sem rede externa e provedores externos desativados. JWTs, usuários Google e sessões são fixtures sintéticas; assinatura e expiração são verificadas pelos serviços locais reais. O teste cobre transporte e autorização, sem provar OIDC Google externo, API gateway hospedado ou TLS.

Na prova de logout, GoTrue `/user` negou a sessão antiga e sua renovação foi revogada, enquanto o bearer JWT já emitido ainda obteve resposta REST antes de expirar. Isso é uma limitação de autenticação stateless, registrada separadamente. O wrapper exige `getUser()` nas operações; não se promete revogação instantânea de todo acesso feito diretamente com JWT anterior.

## Comandos reproduzíveis

```sh
npm ci --no-audit --no-fund
npm run test:local
npm run test:browser
npm run test:gps
npm run test:profiles
npm run test:fleet
npm run test:google-identity
npm run test:business
npm run test:v323-browser
bash supabase/test-postgres.sh
bash supabase/test-enterprise.sh
python qa/migrations-chain-test.py
python qa/v323/postgres-hml-races.py
python qa/v323/backup-budget-postgres.py
npm run test:auth-http
npm run test:rollback
```

Chromium com navegação local foi executado no CI, onde esse acesso é permitido. Não se contornam restrições do navegador do ambiente de desenvolvimento. Os comandos locais não recebem credenciais ou endereços de produção para escrever no banco.
