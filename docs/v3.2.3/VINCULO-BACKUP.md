# Vínculo de perfil, envio e restauração — homologação v3.2.3

Este documento descreve testes locais com contas, dados financeiros e serviço remoto inteiramente sintéticos. Nenhuma credencial, conta real, chamada de rede ou operação em produção participa da suíte. Os módulos reais de perfis, aplicação, GPS, orçamento de backup e sincronização são carregados em um DOM simulado; `RodagemCloud` é um driver controlado de teste.

## Contrato de integridade verificado

Entrar em uma conta não vincula o perfil nem transfere dados automaticamente. Vincular exige confirmação e uma identidade retornada pela verificação do servidor. Uma conta que já pertence a outro perfil local não pode ser vinculada silenciosamente de novo. A revisão observada na conta passa a compor o vínculo local.

O envio valida o snapshot local e, antes de chamar `cloud.load` ou `cloud.save`, impede cópias contendo fechamentos históricos acima de 24 horas (`BACKUP_LEGACY_HOURS`) ou cujo orçamento conservador de JSONB excede o limite (`BACKUP_TOO_LARGE`). A ausência do módulo de orçamento também bloqueia o envio. Esses bloqueios conservam os registros locais, o vínculo e a última cópia remota válida. A autenticação pode ser verificada antes do preflight; “nenhum RPC” nesta evidência significa nenhuma leitura/gravação de dados do backup, distinguindo essa verificação de sessão.

O limite de envio considera que PostgreSQL JSONB pode ocupar mais bytes que o JSON compacto. Um fixture de 36.000 registros sintéticos fica abaixo de 5 MiB em JSON compacto e acima de 5 MiB no orçamento JSONB. Ele é rejeitado sem leitura ou gravação remota. Os tamanhos efetivos calculados são registrados no relatório, sem conteúdo financeiro real.

Restauração e `validateSnapshot` preservam sua compatibilidade de leitura: não aplicam o novo orçamento JSONB nem o bloqueio de horas legado, mantendo as validações estruturais e o limite já existente do JSON compacto. A suíte restaura exatamente os campos de um histórico de 25,01 horas, inclusive valores inteiros em centavos, vínculo `jornadaId` e marcador pendente do cronômetro. Os dados de outros perfis permanecem intactos. O fixture que ultrapassa o novo orçamento JSONB também é aceito na restauração simulada; isso demonstra compatibilidade do cliente, sem afirmar que o banco atual permitiria criar essa cópia.

Cancelamentos, mudança de conta/perfil/vínculo e recusa da identidade pelo servidor interrompem operações antes de mutações pessoais indevidas. A revisão do servidor continua sendo comparada durante a gravação: conflito detectado no envio preserva a cópia vencedora e não avança o vínculo local. Uma recusa de autorização ao salvar mantém a última cópia válida e a revisão local. A identidade é revalidada após confirmação; a restauração também a verifica dentro da seção protegida antes de gravar dados e journal.

## Execução e evidência

Executar `node qa/v323/sync-integration-test.mjs`. O relatório fica em `qa/v323/sync-integration-report.json`, com cenários aprovados/falhas, categoria da execução, hashes dos módulos executados, tamanhos do fixture e prova dos campos restaurados. A suíte existente `node qa/cloud-sync-test.mjs` continua sendo uma verificação separada.

Resultado nesta revisão: **23 cenários aprovados e nenhuma falha**. Os registros pessoais restaurados são comparados como bytes canônicos, e o marcador de jornada é comparado campo a campo: o validador existente pode reordenar as chaves JSON sem alterar duração, estado ou demais valores históricos. A suíte não exige preservar a ordenação das chaves de um arquivo importado.

## Validação ainda necessária

Estes testes não são autenticados contra Supabase e não comprovam OAuth real, renovação real de tokens, RLS aplicada pelo banco, isolamento empresarial em produção, comportamento de Android ou GPS físico. A homologação autenticada deve usar duas contas descartáveis, uma terceira conta sem vínculo, pelo menos dois perfis locais e dados sintéticos, em ambiente isolado. Verificar vínculo, conta expirada/revogada, logout, troca de conta, envio, conflito entre aparelhos, restauração e interrupção por falta de espaço. Registrar ambiente, revisão, identidade sintética, resultados e evidências sem tokens.

Antes de publicação, executar também as suítes restantes, revisar os resultados autenticados e preparar o rollback. A aprovação destas simulações, isoladamente, não declara o sistema pronto para comercialização.
