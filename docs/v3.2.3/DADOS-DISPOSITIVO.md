# Dados do dispositivo — Minha Rodagem v3.2.3

## Política e comportamento

Os perfis locais continuam separados por namespace fixado ao abrir a aba. O perfil principal conserva as chaves antigas; os demais usam `minha-rodagem-usuario-v1:<id>:`. Entrar, sair ou trocar a conta Google não transfere nem apaga lançamentos automaticamente. O logout mantém os dados locais, e a sessão de autenticação do navegador é compartilhada pelos perfis desse mesmo aplicativo. Perfis locais não possuem senha nem constituem a barreira de autorização empresarial do servidor.

Em **Ajustes → Dados deste aparelho**, a versão 3.2.3 acrescenta uma cópia técnica e a remoção explícita dos dados do perfil ativo. A identidade visual e os fluxos de backup existentes são preservados. Nenhuma limpeza acontece durante a inicialização, publicação, logout ou troca de conta.

O módulo `device-data.js` deve ser carregado imediatamente depois de `profiles-core.js`, antes dos módulos que gravam dados. `RodagemProfiles.assertCurrent()` chama `RodagemDeviceData.assertWritable()` antes de suas próprias verificações. O guard não depende do DOM, do SDK de autenticação ou dos módulos carregados depois e não chama o núcleo de perfis recursivamente.

## Cópia técnica

O arquivo tem `format: "minha-rodagem-device-profile"`, `version: 1`, versão do aplicativo, data, identificador/nome do perfil e pares `entries` com chave lógica e conteúdo bruto. Ele preserva strings originais, inclusive JSON ilegível ou histórico que precise de revisão. Não normaliza valores financeiros, não corrige jornadas e não limita silenciosamente os dados históricos.

A exportação lê exclusivamente a allowlist do perfil aberto:

- lançamentos, ajustes/veículo, jornada e preferências GPS;
- índice e todos os percursos encontrados no namespace desse perfil, inclusive percursos fora do índice;
- empresas mantidas no modo local.

Ela não lê valores das chaves de sessão do Supabase/SDK, tokens, vínculo da conta ou namespace de outro perfil. A enumeração das chaves do armazenamento serve apenas para encontrar os percursos do perfil ativo; não é uma exportação de todo o `localStorage`. O lease temporário do GPS não é incluído no arquivo de recuperação do usuário.

O arquivo pode conter localização, nomes e valores. Deve ser guardado em local privado. O navegador não informa de forma confiável que o usuário terminou de salvar um download: a remoção exige confirmação explícita de que a cópia foi guardada. Não há envio automático do arquivo para serviços externos.

A cópia técnica serve para **recuperação assistida** e não é aceita pelo importador comum do Histórico. O backup JSON do Histórico continua sendo a opção de restauração de lançamentos pela interface; ele não recompõe sozinho todos os ajustes, empresas locais e percursos da cópia técnica. Não foi implementado um novo importador de conteúdo bruto nem restauração automática de arquivos técnicos.

## Condições para remover

O usuário precisa baixar uma cópia técnica atual nesta aba, confirmar que a guardou e digitar exatamente o nome do perfil. A ação deixa explícito que atinge somente este navegador e que a recuperação completa do arquivo técnico requer suporte. Cancelar a confirmação não modifica dados.

A remoção exige ainda:

1. Conta desconectada. `getSession()` deve retornar `null` antes de adquirir as travas e novamente dentro delas. Sessão presente, falha de leitura ou configuração de conexão presente com módulo indisponível bloqueiam a ação. `verifySession()` confirma uma identidade autenticada; não comprova a ausência de sessão e por isso não é usado para autorizar uma limpeza local.
2. Nenhuma jornada existente, inclusive pausada, pendente ou ilegível. O usuário deve resolvê-la pelo fluxo normal.
3. Nenhum rascunho, edição ou operação conhecida em andamento. São verificados os formulários, estados de gravação e cartões de sincronização/empresa ocupados.
4. Nenhuma recuperação de sincronização pendente nem confirmação modal aberta.
5. Web Locks disponíveis e todas as travas necessárias livres. A remoção usa `ifAvailable`; não fica na fila aguardando para apagar dados depois de o usuário perder o contexto.
6. Identidade, nome, registro de perfis, geração e todos os bytes locais iguais aos da cópia exportada. Editar registros, adicionar percursos, renomear ou trocar o perfil exige uma nova cópia.

Uma instalação exclusivamente local e sem configuração de conta pode usar a ação. Sem Web Locks a exportação técnica continua disponível com comparação dos dados, mas a remoção fica indisponível. O código não enfraquece a proteção para atender navegadores incompatíveis.

## Concorrência, recuperação e preservação

As travas seguem a ordem compartilhada com a sincronização: registro de perfis, lançamentos, ajustes, jornada, vínculo, índice e preferências, seguidas dos recursos exclusivos do gerenciamento e das rotas ordenadas. Uma comparação final dos bytes ocorre depois das esperas de autenticação.

Antes de remover qualquer dado, o módulo grava um journal próprio com os valores brutos anteriores e as gerações anterior/próxima. Se não houver espaço para essa proteção, a ação termina sem suspender o GPS nem remover dados. Depois da preparação, a geração muda, o GPS é suspenso e apenas a allowlist do perfil é removida. O registro global de perfis, outros perfis, vínculo da conta, sessão do SDK, cópias remotas e chaves de outros aplicativos são preservados. Nunca se chama `localStorage.clear()`.

O marcador de geração impede que uma aba antiga grave por cima do perfil limpo, inclusive no caso em que a chave de lançamentos originalmente não existia. A aba que conclui ou desfaz uma remoção fica congelada para escrita e precisa recarregar; os demais componentes recebem os eventos de estado desatualizado.

Uma falha após o início da remoção tenta repor exatamente os bytes anteriores. Se a reposição não puder terminar, o journal permanece e bloqueia novas gravações. Na próxima abertura, uma recuperação validada obtém as mesmas travas e desfaz a remoção interrompida; não é uma importação de arquivo. Se encontrar alteração posterior, geração incompatível, chave fora da allowlist ou outro conflito, preserva dados e journal para suporte, sem sobrescrever o conteúdo encontrado. Depois de recuperar, força recarregamento porque outros módulos podem ter lido um estado intermediário.

As proteções coordenam as versões que respeitam esse protocolo. Antes da remoção, a interface orienta fechar outras abas. Uma aba de uma versão antiga sem o guard de geração, extensões, ferramentas do navegador ou código externo que grave diretamente no armazenamento não participam das mesmas garantias. Esse limite não pode ser corrigido prometendo isolamento local equivalente ao PostgreSQL/RLS.

## Limites e rollback

A exportação é limitada a 1.000 chaves de dados, aproximadamente 16 Mi unidades de armazenamento capturadas e 32 MiB no arquivo serializado. Estruturas maiores ou chaves de rota incompatíveis são preservadas e exigem suporte; não são truncadas para liberar a limpeza. Um journal existente sem Web Locks ou que não possa ser validado mantém o perfil bloqueado para escrita até recuperação segura.

Uma remoção **concluída e confirmada pelo titular** não é desfeita publicando a versão anterior do app. Recuperação exige a cópia escolhida pelo usuário ou uma cópia remota válida; dados financeiros não são restaurados automaticamente. O rollback automático descrito acima é apenas para uma operação interrompida antes de sua conclusão, com journal íntegro e ausência de conflito.

O armazenamento local não é criptografado pelo aplicativo. Quem controla o navegador/dispositivo pode acessar seus dados. Limpeza das configurações do navegador, modo privado, perda do aparelho, falta de espaço e eventual descarte de armazenamento pelo sistema podem causar perda independentemente do fluxo de remoção. Os backups continuam necessários. A política preexistente de retenção de até dez percursos GPS concluídos, além dos ativos, não foi alterada; essa cópia técnica inclui o que ainda está armazenado no perfil.

## Evidências

Executar na raiz: `node qa/v323/device-data-test.mjs`.

Resultado desta revisão: **28/28 suítes automatizadas locais**, com o módulo real e DOM/APIs simulados. O relatório reproduzível está em `qa/v323/device-data-report.json`. As provas cobrem leitura inicial, exportação exata, exclusão de Auth/outros perfis/vínculo, perfil secundário, ausência de Web Locks, confirmação explícita, falhas de Auth e mudança de conta entre verificações, CAS, jornadas, rascunhos, operações ocupadas, locks concorrentes, limpeza confirmada, geração contra aba antiga, quota, rollback exato, falha de rollback, recuperação ao reabrir, conflito posterior, journals incompatíveis, geração inválida, duas limpezas simultâneas, cancelamento, falha do download e limite de tamanho.

Todos os dados são sintéticos. Esses testes não provam armazenamento físico do download, comportamento de Android real, login OAuth real, recuperação assistida operacional ou execução em produção. A homologação real do fluxo deve registrar o arquivo salvo, o recarregamento e a conferência dos perfis no navegador alvo. Nenhuma operação de produção foi executada por essa suíte.
