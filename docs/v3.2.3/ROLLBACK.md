# Rollback e autorização — v3.2.3

Estado antes do desenvolvimento: produção e referência auditada no commit `8f4cae36367f667ca871bd2539891ad6d1a74599` (v3.2.2). Branch de trabalho: `codex/desenvolvimento-v3.2.3`. Nenhuma publicação em main ou alteração sensível em produção está autorizada por esta etapa de desenvolvimento.

## Antes de qualquer publicação

1. Confirmar SHA atual da produção e guardar manifesto de arquivos, ZIP 3.2.2, estado de provedores, migrações e hashes de funções; nenhum token é incluído no registro.
2. Fechar testes, diferenças e classificação das evidências; registrar falhas/pendências.
3. Revisar eventuais migrações de subida e retorno. Não executar DDL de produção sem autorização explícita. Não ativar cobranças, provedores ou recursos pagos.
4. Entregar release candidata, changelog, análise de risco e este plano para aprovação final do proprietário.

## Se for necessário retornar o frontend após publicação autorizada

1. Pausar novos envios/recuperações do usuário durante a manutenção e registrar o commit implantado.
2. Criar commit de reversão da publicação aprovada usando a árvore da v3.2.2; não forçar branch nem sobrescrever mudanças posteriores. Manter a proteção de comparação do SHA esperado. Se a quinta migração já tiver sido aplicada, preferir conservar a correção SQL: assinaturas, payload e CAS continuam compatíveis. O cliente antigo pode repetir o HTTP409 e mostrar erro genérico; registrar esse limite e preparar correção pontual do cliente antes de retomar envios concorrentes.
3. Incrementar o identificador do cache do service worker de rollback, mantendo arquivos compatíveis da versão antiga; aguardar o GitHub Pages publicar. Não reutilizar um nome de cache já ocupado com conteúdo diferente.
4. Conferir o manifesto de runtime correspondente à árvore restaurada (40 arquivos na referência v3.2.2; 43 na candidata v3.2.3, incluindo o service worker) e verificar a sessão de forma somente leitura. Não restaurar backups financeiros automaticamente.
5. Solicitar recarregamento online e conferir dados locais antes de retomar a operação.

## Banco, autenticação e dados do dispositivo

- A candidata não migra valores financeiros históricos. A quinta migração troca somente códigos de conflito em quatro funções, preservando assinaturas, tabelas, dados, regras, locks e ACLs. Um retorno do frontend não exige automaticamente desfazer essa correção.
- O [rollback SQL específico](sql/rollback-cas-http-conflict.sql) restaura os quatro corpos conhecidos e possui guard de contrato. Foi testado em banco descartável, junto com reaplicação e novo upgrade, preservando todas as linhas e metadados exceto o corpo previsto. Ele **reintroduz o problema de repetição/timeout**; somente considerar após análise do incidente e autorização explícita. Registrar uma migração de retorno conforme a operação do projeto, sem apagar silenciosamente a quinta migração do histórico.
- Se um fingerprint ou estado atual for desconhecido, interromper o procedimento e revisar a divergência; não remover o guard para forçar a execução. Nunca excluir tabelas/colunas/dados como procedimento de retorno.
- Valores históricos superiores a 24h e backups existentes devem continuar íntegros; correções de valor dependem de edição explícita do usuário.
- Apagar dados do dispositivo é uma ação explícita do usuário e exige backup/confirmação; deploy/rollback nunca a executam. Uma remoção já confirmada não é revertida publicando código antigo: recuperação requer a cópia local escolhida pelo titular.
- Logout é limitado à sessão local, preservando lançamentos. Não revogar sessões de terceiros para testar.
- Guards de geração só existem nas abas que carregaram a candidata. Fechar abas antigas antes do gerenciamento de dados e do rollback; código já carregado não é atualizado retroativamente. Publicar a referência antiga também retira os novos controles de dispositivo e os diagnósticos desta versão.

## Situação desta etapa

Plano preparado antes da publicação. Nenhum rollback de produção foi executado ou declarado homologado. O ensaio `qa/v323/rollback-dry-run.py` reconstruiu a referência com novo identificador de cache e aprovou dez suítes de cache simulado; não executou navegador físico nem backend remoto. A prova SQL de upgrade/reaplicação/rollback/reupgrade está em `qa/migrations-chain-report.json`. A janela operacional, a publicação Pages e o aceite físico continuam pendentes.
