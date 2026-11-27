# Minha Rodagem v3.2.3 — auditoria técnica e candidata de homologação

Referência: auditoria completa v3.2.2 de **26/11/2026**, commit [`8f4cae36367f667ca871bd2539891ad6d1a74599`](https://github.com/LesmoBoy/meu-primeiro-app/commit/8f4cae36367f667ca871bd2539891ad6d1a74599). Desenvolvimento e revalidação: 26–27/11/2026. Branch: `codex/desenvolvimento-v3.2.3`.

**Estado: candidata com validação automatizada concluída; publicação não autorizada e homologação comercial incompleta.** Este documento separa implementação, testes executados e cenários pendentes. Não certifica ausência de vulnerabilidades. O [CI final](https://github.com/LesmoBoy/meu-primeiro-app/actions/runs/45930835327) aprovou os três jobs no commit `bd8f927eede3f03df396d8d23f541fb8cd309692`: 96 cenários Chromium, 30 suítes locais, PostgreSQL e 16 grupos HTTP autenticados. O registro consolidado está em [RESULTADOS.md](RESULTADOS.md), com evidências reproduzíveis.

## Resumo executivo

A v3.2.3 mantém a aplicação PWA, a identidade visual e os formatos de dados. O trabalho se concentrou em impedir resultados de autenticação antigos, preservar históricos e cópias válidas, retomar GPS interrompido e permitir gerenciamento explícito dos dados do dispositivo.

Foram confirmadas e tratadas as pendências de duração legada e contagem JSON/JSONB. A revisão também identificou corridas na conclusão do login durante logout e na revogação da permissão GPS. O teste HTTP autêntico revelou tratamento inadequado do conflito lógico no PostgREST; a correção mínima de quatro funções foi preparada em migração incremental local, sem alterar regras de autorização nem aplicar mudanças em produção.

As 11 funções SECURITY DEFINER expostas foram revisadas individualmente, junto com duas internas. Os testes ampliados cobrem contas independentes, empresas, quatro papéis, permissões, revisão e revogação durante esperas. RLS e FORCE RLS permanecem nas cinco tabelas. Os avisos intencionais do Advisor não foram eliminados retirando controles necessários.

Não houve leitura de lançamentos financeiros reais, DDL ou limpeza de dados em produção, ativação de cobranças ou novos provedores. A observação autenticada da conta Google já conectada na v3.2.2 foi somente leitura e limitada à interface. A candidata exige sua própria homologação externa e aprovação da migração antes de ser considerada comercialmente pronta.

## Comparação v3.2.2 → v3.2.3

| Área | v3.2.2 | v3.2.3 | Evidência e limite |
|---|---|---|---|
| Sessão no servidor | `getUser()` e UID já exigidos nas operações | Releitura autoritativa, versão de autenticação/perfil, rejeição A→B→A, renovação sanitizada e diagnóstico manual | [SESSAO.md](SESSAO.md); SDK simulado e HTTP local têm classificações separadas |
| Logout durante Google | Exchange atrasado podia reinstalar sessão | Logout espera exchange já enviado e bloqueia novas operações até concluir | Regressões locais; sessão compartilhada entre abas continua sujeita a concorrência |
| Duração histórica | Importação aceita >24h; formulário novo limita 24h, sem diagnóstico específico | Aviso persistente/individual, exportação intacta e edição explícita; upload incompatível interrompido | [LEGADOS.md](LEGADOS.md), [VINCULO-BACKUP.md](VINCULO-BACKUP.md) |
| Taxa por hora | Calculada mesmo em duração diária acima do limite | Indicador indisponível até revisão; horas e dinheiro preservados | Justificativa e testes de cálculo no documento de legados |
| Limite de backup | JSON compacto podia passar e JSONB exceder 5 MiB | Preflight conservador antes da RPC; erro claro, sem substituir a cópia anterior | [TAMANHO-BACKUP.md](TAMANHO-BACKUP.md), comparação PostgreSQL real |
| Conflito HTTP | CAS lógico usava SQLSTATE de falha de serialização | SQLSTATE PT409, mapeamento público CONFLICT e repetição automática desativada | Prova HTTP local e migração preparada; produção ainda não alterada |
| GPS após suspensão | Solicitação pendente podia bloquear retomada | Invalida solicitação antiga após 25s no retorno, retoma novo segmento e ignora callback atrasado | APIs simuladas; medição física pendente |
| Permissão GPS | Revogação dependia do retorno da API | Observa bloqueio e transição permitido→perguntar; para sem religar automaticamente | 11 regressões focais de lifecycle/permissão |
| Dados do aparelho | Logout preservava dados; limpeza integral pelo navegador | Exportação técnica e remoção explícita do perfil com geração, locks, CAS e recuperação | [DADOS-DISPOSITIVO.md](DADOS-DISPOSITIVO.md); não é exclusão de conta |
| Banco empresarial | Controles e testes existentes | Mesmos controles; matriz individual, mais isolamento e 15 corridas coordenadas | [SECURITY-DEFINER.md](SECURITY-DEFINER.md) |
| Operação | Pendências documentadas | Checklist, roteiro físico, evidências por categoria e ensaio local de rollback | [HOMOLOGACAO.md](HOMOLOGACAO.md), [ROLLBACK.md](ROLLBACK.md) |

## Escopo e método

O ponto de partida é exatamente a árvore auditada. Os módulos sem alterações conservam os hashes da referência; o inventário da candidata distingue arquivos novos, modificados e preservados. A revisão desta versão combina leitura das diferenças, regressões de todas as suítes existentes, novos testes focais, PostgreSQL descartável, consulta de metadados remotos e classificação explícita de autenticação simulada ou real.

Foram abrangidos:

- **Frontend pessoal:** app, experiência, formulários, cálculos, importação/exportação, perfis, veículos, navegação e interações.
- **PWA/GPS:** motor, controlador, permissões, suspensão, limites de percurso, consentimento, mapa, manifesto, service worker e recursos offline.
- **Identidade e sincronização:** configuração pública, GIS/nonce, sessão, renovação, logout, vínculo, upload, restauração, revisão e recuperação de interrupções.
- **Empresarial:** entidades, equipe, convites, quatro papéis, frota, viagens, custos, referências e isolamento.
- **Backend:** cinco tabelas, grants, policies, FORCE RLS, 25 funções, quatro migrações históricas, quinta migração candidata, concorrência e módulos de cobrança preparados.
- **Operação:** dependências, segredos, hospedagem, privacidade, armazenamento local, rollback, testes e limites de homologação.

Os fornecedores fixados, Supabase JS e Leaflet, não foram reescritos nem submetidos a uma nova revisão manual de cada linha. O `npm audit` da árvore de ferramentas é uma consulta de avisos conhecidos, não uma prova sobre todo código fornecido por terceiros ou serviços externos.

## Achados e tratamento

### AUTH-01 — resultado antigo após troca de sessão ou perfil

**Risco:** uma resposta assíncrona pertencer a um contexto diferente daquele que recebe o resultado. **Tratamento:** guard de perfil, versão da autenticação observada e releitura após `getUser()`/RPC. O retorno público contém campos limitados e não expõe tokens. Alterações A→B→A observadas invalidam a operação anterior. RLS e comparação com `auth.uid()` continuam sendo a autoridade de acesso; os controles do cliente são adicionais.

**Validação:** casos locais de cache forjado, servidor divergente, sessão ausente/expirada, renovação, troca durante cada espera e logout. HTTP autêntico local e Google externo são relatados separadamente. Operações já confirmadas no servidor não são revertidas pelo descarte da resposta no cliente.

### AUTH-02 — exchange Google concluía depois da saída

**Risco confirmado, gravidade média no dispositivo compartilhado:** `signInWithIdToken()` do SDK salva sessão após o HTTP sem compartilhar o lock da saída. Cancelar apenas a apresentação não impedia reentrada atrasada. **Correção:** marcar tentativa cancelada imediatamente; se o exchange já começou, aguardar sua conclusão e depois executar logout local. Novos logins/verificações/renovações pelo wrapper ficam bloqueados nesse intervalo. Outra identidade observada impede a saída indiscriminada.

**Limite:** não há transação atômica de todos os logins de todas as abas. Fechar outras abas e conferir a identidade continua necessário. JWTs emitidos podem permanecer válidos até expirar; a saída revoga renovação conforme o servidor e não apaga registros locais.

### DATA-01 — duração legada acima de 24 horas

**Pendência da auditoria confirmada.** O leitor legado aceita até o limite histórico, enquanto novos formulários/SQL usam o limite diário. Rejeitar a leitura bloquearia dados anteriores; truncar a duração alteraria o histórico. A candidata separa diagnóstico e validação, mantém bytes locais durante leitura/exportação, avisa no Histórico/importação e exige revisão explícita para editar.

**Regra financeira documentada:** somente a apresentação da taxa por hora é suspensa para registros fora do limite diário. Ganhos, gastos, saldo, valores em centavos, identificadores, duração original e demais indicadores permanecem. Há regressões de limites, totais, exportação, cancelamento e CAS. Nenhuma divisão automática por dias foi implementada.

O upload detecta o legado antes da RPC e conserva a última cópia remota. Leitura e restauração compatíveis continuam disponíveis. Isso constitui tratamento conservador, não uma migração automática para sincronizar todos os históricos incompatíveis.

### DATA-02 — JSON compacto e JSONB ocupam tamanhos diferentes

**Pendência confirmada:** o exemplo de 36.000 registros ocupa **4.633.030 bytes** como JSON compacto e **5.281.046 bytes** como texto JSONB, acima dos **5.242.880 bytes** permitidos. O orçamento considera espaços de separação, UTF-8, escapes e expansão decimal de expoentes. A comparação com PostgreSQL local não subestimou o servidor nos conjuntos executados.

O preflight é obrigatório para novos envios e falha de forma conservadora. Não aparar o histórico, não enviar cópia vazia, não atualizar revisão antes da confirmação e não aplicar a nova barreira de envio à restauração. O servidor continua validando tamanho/formato. Há limite de profundidade/processamento para não travar a página; uma recusa não autoriza apagar dados.

A proposta de sincronização incremental está documentada para versão futura, com entidades/segmentos, revisões, operações idempotentes, tombstones e manifesto atômico. Ela não foi implementada nesta versão.

### API-01 — conflito lógico repetido pela camada HTTP

**Achado confirmado em homologação HTTP local, gravidade média de disponibilidade:** as RPCs usavam `40001`, reservado a falhas de serialização, para sinalizar revisão antiga. Na stack PostgREST 14.18, o tratamento transacional repetiu a operação; o probe não recebeu conflito HTTP dentro de 2.500 ms. Com o mesmo payload e revisão, alterando somente o SQLSTATE para `PT409`, recebeu HTTP409/código PT409 em 157 ms. Revisão e hash da última cópia válida permaneceram idênticos. O código original foi restaurado no banco descartável depois dessa prova.

Há duas camadas adicionais: o SDK retorna o status HTTP no envelope, sem necessariamente incluí-lo em `error`; o cliente precisa reconhecer o código PT409 diretamente. Além disso, o SDK fixado repete HTTP409 por padrão. A candidata mapeia PT409 para CONFLICT e configura `db.retry:false`, conservando compatibilidade com 40001 e sem repetir automaticamente uma tentativa de revisão sabidamente antiga.

A quinta migração substitui somente sete SQLSTATEs em quatro funções existentes. UID, papéis, locks, CAS, validações, payload, grants e RLS não mudam. Há precondições, teste de upgrade/idempotência, revisão independente e retorno documentado. Migrações históricas permanecem imutáveis. **A migração não foi aplicada em produção.** A reprodução local não afirma que uma requisição conflitante tenha sido executada no projeto real nem mede sua versão/configuração PostgREST.

Evidência controlada: `qa/v323/auth-http-cas-proof.json`. Referências: [repetição automática do SDK](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js), [PostgREST MainTx v14.18](https://github.com/PostgREST/postgrest/blob/v14.18/src/PostgREST/MainTx.hs#L101). O limite e o resultado do teste final da fonte candidata estão em RESULTADOS.md.

### GPS-01 — suspensão e revogação de permissão

**Riscos confirmados:** solicitação suspensa sem callback prendia a captura; mudar a permissão de permitido para perguntar não era tratado como revogação. **Correções:** invalidar a tentativa pendente antiga na volta, revalidar permissão, reiniciar segmento e ignorar respostas atrasadas; observar as duas formas de retirada de permissão. O prompt inicial continua permitido em ativação explícita.

A recusa não para o cronômetro. Falhas síncronas liberam captura/lease; perda de precisão, amostras antigas, saltos, oscilação e lacunas seguem os filtros existentes. Trechos sem sinal não são estimados. O modo econômico conserva os intervalos existentes; consumo e precisão reais não foram medidos.

### DEVICE-01 — gerenciamento explícito dos dados locais

Foi adicionado um fluxo com allowlist do perfil ativo, sem `localStorage.clear()`. A cópia técnica não inclui sessão, tokens, binding nem dados de outros perfis. Remover exige cópia atual, confirmação de que foi guardada, nome exato, conta desconectada, ausência de jornada/rascunho/recuperação/gravação e locks disponíveis.

Journal, comparação dos bytes e geração impedem que módulos da candidata gravem a memória antiga após remoção. Falha parcial tenta recuperar exatamente os dados anteriores; divergência posterior mantém estado pendente para suporte. Não há importação automática da cópia técnica, exclusão automática no logout ou limpeza de dados do servidor.

**Limites:** o app confirma a geração do download, não pode provar que o usuário guardou o arquivo. A recuperação técnica é assistida. Abas carregadas com código anterior não conhecem a nova geração; o usuário deve fechar outras abas antes de remover dados. Perfis locais continuam sem senha/criptografia independente e não isolam pessoas que controlam o mesmo navegador.

## Backend, tenant e privilégios

As 11 funções executáveis por `authenticated` são 9 RPCs e 2 helpers de RLS. As duas internas são guard e trigger. A [matriz individual](SECURITY-DEFINER.md) registra necessidade, ACL, `search_path`, UID, empresa, papéis, revisão e concorrência de cada uma. Nenhuma foi removida ou convertida apenas para reduzir avisos.

As novas provas incluem UID divergente/nulo/ausente, contas A/B, empresas X/Y, owner/manager/finance/driver, revogação, demissão, último owner, convites, referências cruzadas, escrita direta negada, search_path temporário hostil e quinze interleavings com espera confirmada por lock. O proprietário privilegiado pode contornar RLS: por isso a autorização explícita dentro de cada RPC permanece essencial.

O catálogo remoto consultado somente em leitura confirmou cinco tabelas com RLS/FORCE. As 25 definições conferiram com a base v3.2.2; a candidata altera explicitamente apenas os SQLSTATEs das quatro funções do conflito HTTP. Assinaturas, owners, search_path, flags de definer e ACL anônimas permanecem. Há **uma diferença revisada de EXECUTE para authenticated** em `rodagem_sync_stamp()`, trigger SECURITY INVOKER: permitido no projeto e negado na fixture local. A chamada comum de trigger é recusada; não foi feita alteração remota para ocultar a diferença.

As leituras STABLE usam o snapshot da instrução: revogar um vínculo não cancela necessariamente uma resposta já iniciada. Mutações revalidam o vínculo depois da espera pela trava. A serialização por empresa pode limitar vazão; não houve benchmark ou prova de todos os escalonamentos possíveis.

## Frontend, finanças, PWA e dependências

Não há mudança no modelo de centavos, arredondamento, saldos, consumo ou sete custos empresariais. As suítes existentes, incluindo 50.000 casos decimais gerados, permanecem no runner. A exceção de exibição da taxa por hora está justificada e testada separadamente.

Nomes e descrições continuam inseridos como texto. A inspeção estática dos módulos próprios não encontrou uso de `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function` ou limpeza integral de localStorage nesses módulos. Isso não equivale a uma garantia geral contra XSS.

O service worker inclui os três novos módulos e usa cache v3.2.3. Preserva escopos vizinhos e não armazena respostas personalizadas de Auth/REST como arquivos do app. Offline exige preparação anterior com internet; Google, sincronização e ruas do mapa dependem da rede. A simulação de cache e a execução Chromium real são registradas separadamente.

O `npm audit` de 27/11/2026 não apontou avisos conhecidos na árvore de ferramentas fixa. Não houve atualização de bibliotecas. Chave pública Supabase e Client ID Google são identificadores públicos intencionais; chaves de serviço, senhas, segredos OAuth e tokens não devem entrar em código, backup ou evidências. As fixtures HTTP usam segredos efêmeros e recursos locais descartáveis.

## Avisos e limitações remanescentes

Leitura do Advisor em 27/11/2026: **12 WARN de segurança** (11 definers intencionais e 1 proteção de senha vazada desligada), **1 INFO de RLS sem policy direta** em convites; desempenho com **4 INFO de índices ainda sem uso**; health sem avisos na consulta. Isso não é “zero alertas”.

- [SECURITY DEFINER executável](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable): justificativas e testes individuais registrados; manter revisão de privilégios.
- [RLS sem policy direta](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): convites negados por padrão; acesso por RPC autorizada, sem leitura de hashes pelo cliente.
- [Proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection): aviso permanece; entrada Email/senha está desativada na instalação. Não ativá-la sem homologação e configuração próprias.
- [Índices ainda sem uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index): ausência de uso não justifica remover índices de FK/isolamento sem carga representativa.

Google permanece External/Testing; Facebook e cobrança permanecem desativados. A aprovação externa da marca/domínio e os requisitos comerciais do provedor não foram concluídos por esta auditoria. Não houve teste de carga, homologação de grandes frotas, revisão jurídica ou medição física de dispositivos.

GitHub Pages limita controle de cabeçalhos de resposta. CSP/anti-enquadramento, paginação/quotas de workspaces completos, observabilidade operacional, política de retenção e atendimento de exclusão são pontos de preparação comercial. Exclusão de conta/nuvem continua manual; o novo botão trata somente dados locais.

## Validação, arquivos e entrega

- [RESULTADOS.md](RESULTADOS.md): testes automatizados, simulados, locais, autenticados, físicos e de produção, sem somar contagens incompatíveis.
- [ARQUIVOS.md](ARQUIVOS.md): inventário das mudanças e justificativas, com hashes do runtime em evidência própria.
- [HOMOLOGACAO.md](HOMOLOGACAO.md): checklist de aceite e cenários ainda não verificados.
- [GPS-ANDROID.md](GPS-ANDROID.md): roteiro físico com critérios definidos antes da execução.
- [ROLLBACK.md](ROLLBACK.md): plano preparado antes de qualquer publicação; ensaio local não é rollback em produção.
- [CHANGELOG.md](../../CHANGELOG.md): comportamento final da candidata.

O próximo passo comercial exige concluir os itens pendentes, registrar execução real onde necessária e obter aprovação final para publicação. A aprovação de testes locais não autoriza alterar produção nem declarar o sistema pronto para venda.
