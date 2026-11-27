# Arquivos e justificativas — v3.2.3

Comparação com `8f4cae36367f667ca871bd2539891ad6d1a74599`. O manifesto `qa/v323/release-inventory.json` registra SHA-256 dos 43 arquivos de runtime e distingue os recursos preservados da referência. A árvore de dependências não mudou. Capturas e logs locais volumosos são artefatos de teste; não são código do aplicativo.

| Arquivo | Estado | Justificativa |
|---|---|---|
| `.gitattributes` | novo | Preserva bytes de logs capturados sem tratá-los como formatação de código. |
| `.github/workflows/browser-tests.yml` | modificado | Todas as suítes, novos fluxos Chromium, HTTP local real e artefatos sanitizados. |
| `.gitignore` | novo | Evita dependências e capturas/logs volumosos no versionamento. |
| `CHANGELOG.md` | novo | Comportamento final e restrições da versão. |
| `README.md` | modificado | Entrada para documentação, execução e limites da candidata. |
| `app.js` | modificado | Diagnóstico legado, avisos, taxa por hora e edição explícita, sem normalização histórica. |
| `backup-budget.js` | novo | Orçamento conservador UTF-8/JSONB, sem mutação ou acesso a armazenamento. |
| `cloud-client.js` | modificado | Sessão autoritativa, renovação, logout concorrente, PT409 e repetição automática desativada. |
| `cloud-sync.js` | modificado | Preflight JSONB/legados antes do upload e estado ocupado acessível. |
| `device-data.js` | novo | Exportação técnica e remoção explícita protegida dos dados do perfil ativo. |
| `docs/SUPABASE.md` | modificado | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/ARQUIVOS.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/AUDITORIA.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/CAS-HTTP.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/DADOS-DISPOSITIVO.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/GPS-ANDROID.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/HOMOLOGACAO-AUTENTICADA.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/HOMOLOGACAO.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/LEGADOS.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/RESULTADOS.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/ROLLBACK.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/SECURITY-DEFINER.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/SESSAO.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/TAMANHO-BACKUP.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/VINCULO-BACKUP.md` | novo | Documentação de comportamento, evidências, riscos, homologação ou rollback. |
| `docs/v3.2.3/sql/rollback-cas-http-conflict.sql` | novo | Rollback SQL revisável com guard; nenhum uso em produção. |
| `exclusao-dados.html` | modificado | Distingue remoção do perfil, limpeza do navegador e exclusão da conta. |
| `experience.js` | modificado | Aviso e preservação de cronômetros legados acima de 24 horas. |
| `index.html` | modificado | Carga dos três módulos novos e identificação da candidata 3.2.3. |
| `package-lock.json` | modificado | Metadados da versão; versões e integridades de dependências preservadas. |
| `package.json` | modificado | Versão e comandos de validação reproduzíveis, sem mudança de dependências. |
| `privacidade.html` | modificado | Explica gerenciamento e cópia técnica dos dados locais. |
| `profiles-core.js` | modificado | Guard de geração/journal para impedir gravação antiga após remoção local. |
| `qa/cloud-sync-test.mjs` | modificado | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/deep-audit-ui-probes-result.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/dom-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/migrations-chain-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/migrations-chain-test.py` | modificado | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/sw-test.cjs` | modificado | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/POSTGRES-HML.md` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/audit-pdf-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/auth-http-cas-proof.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/auth-http-hml.cjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/auth-http-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/backup-budget-postgres-result.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/backup-budget-postgres.py` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/backup-budget-test.cjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/backup-budget-unit-result.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/browser-regressions.cjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/browser-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/build-audit-pdf.py` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/ci-final-summary.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/ci-initial-summary.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/device-data-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/device-data-test.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/evidence/budget-final.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/cas-sqlstate-manifest.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/catalog-comparison.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-auth-http-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-business-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-fleet-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-google-identity-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-gps-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-migrations-chain-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-postgres-enterprise-ci.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-postgres-personal-ci.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-profiles-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-final-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-initial-business-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-initial-fleet-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-initial-google-identity-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-initial-gps-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-initial-profiles-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/ci-initial-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/enterprise-baseline.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/enterprise-final.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/enterprise-hml.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/enterprise-races.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/enterprise-races.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/migrations-final.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/personal-final.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/postgres-baseline.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/postgres-hml.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/postgres-results.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/evidence/races-final.log` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/gps-lifecycle-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/gps-lifecycle-test.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/gps-review-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/gps-review-test.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/legacy-baseline-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/legacy-hours-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/legacy-hours-test.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/local-suite-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/migration-review.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/npm-audit.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/postgres-hml-races.py` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/production-catalog.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/production-readonly-runtime.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/production-readonly-runtime.py` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/production-readonly-session.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/release-inventory.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/release-inventory.py` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/rollback-dry-run-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/rollback-dry-run.py` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/run-local-tests.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/safeauth-local-result.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/secret-pattern-review.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/session-client-test.cjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/session-diagnostics-test.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `qa/v323/sync-integration-report.json` | novo | Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita. |
| `qa/v323/sync-integration-test.mjs` | novo | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `session-diagnostics.js` | novo | Diagnóstico manual seguro e acessível, sem leitura de lançamentos. |
| `supabase/enterprise-test.sql` | modificado | Arquivo de suporte à candidata; revisar no diff da branch. |
| `supabase/enterprise.sql` | modificado | Somente seis SQLSTATEs de conflito em três RPCs; preserva autorização/locks/CAS. |
| `supabase/migrations/20261127023748_rodagem_cas_http_conflict.sql` | novo | Quinta migração incremental mínima; aplicação remota pendente de autorização. |
| `supabase/schema.sql` | modificado | Somente SQLSTATE de conflito CAS pessoal: PT409. |
| `supabase/test-enterprise.sh` | modificado | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `supabase/test-postgres.sh` | modificado | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `supabase/test.sql` | modificado | Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível. |
| `sw.js` | modificado | Cache 3.2.3 com módulos completos e escopo existente preservado. |
| `tracking.js` | modificado | Retorno de suspensão, callbacks antigos, revogação de permissão e falhas síncronas. |

As quatro migrações históricas, estilos, arte original, modelos de dados e módulos sem mudança permanecem na árvore da referência. A quinta migração altera somente SQLSTATEs de conflitos, com prova de preservação. Nenhum arquivo listado autoriza uma operação em produção.
