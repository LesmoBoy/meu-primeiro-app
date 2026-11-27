# GPS Android — roteiro físico de homologação v3.2.3

Estado: **NÃO EXECUTADO EM APARELHO FÍSICO.** Os testes de APIs simuladas não medem localização real, consumo, suspensão do sistema nem precisão de quilometragem. Não há promessa de rastreamento contínuo em segundo plano em uma PWA.

## Preparação

Usar perfil e jornada sintéticos, Android/Chrome atualizados, aplicativo instalado e também aba comum. Registrar modelo, Android, Chrome, versão do app, modo econômico/preciso, permissões, economia de bateria, carga inicial e horários. Não coletar localização residencial nem nomes, placas ou valores financeiros reais. Guardar evidências em área restrita e usar relatório público sem coordenadas identificáveis.

Separar um trajeto conhecido e seguro, com distância de referência independente. Somente um passageiro ou observador pode operar o celular em movimento. Definir antes da execução tolerância comercial de distância e orçamento de bateria; não ajustar os critérios após ver o resultado. Repetir pelo menos três vezes em ambos os modos e em mais de um aparelho, incluindo o Poco X7 Pro se disponível.

## Casos a executar e registrar

| Caso | Procedimento | Critério e evidência |
|---|---|---|
| Primeiro uso | Iniciar jornada, conceder localização e percorrer rota conhecida | Cronômetro e pontos ativos; comparar km com referência e registrar diferença |
| Recusa | Negar a solicitação inicial | Cronômetro funciona, localização não capturada; mensagem e km manual disponíveis |
| Cancelar consentimento | Desmarcar GPS com uma solicitação pendente | Nenhum novo ponto após cancelamento; valores e percurso anterior preservados |
| Revogação Android | Revogar localização nas configurações do navegador durante a jornada | Captura para, cronômetro continua; nova autorização e ação explícita retomam sem unir trecho desconhecido |
| Baixa precisão | Desativar localização precisa e passar por área de sinal fraco | Amostras imprecisas ignoradas e aviso; sem distância estimada pelo salto |
| Retorno de precisão | Recuperar sinal depois de mais de 90 segundos | Novo segmento; trecho sem sinal não é somado |
| Suspensão | Bloquear tela, alternar aplicativo e ativar economia de bateria por 2/10/30 minutos | Registrar quanto foi realmente capturado; retorno não fica preso em “atualizando”; sem fabricar km ausentes |
| Retorno rápido | Alternar telas e voltar antes de 25 segundos | Sem duplicação de solicitações/pontos |
| Pausar e encerrar | Pausar jornada, deslocar-se e retomar; depois encerrar | Deslocamento na pausa não contado; km sugeridos no fechamento conferíveis manualmente |
| Abas e perfis | Abrir segunda aba, tentar GPS simultâneo e trocar perfil | Uma captura por vez; nenhum percurso gravado em outro perfil |
| Offline | Desconectar rede após preparar PWA e repetir percurso | GPS local continua se o aparelho fornecer posição; mapa pode perder ruas; dados locais preservados |
| Falha e retorno | Fechar processo/reabrir, reiniciar aparelho, limpar permissão | Percurso anterior legível, sem união de lacuna; retomada respeita permissão e consentimento |
| Exportação | Exportar GPX e backup sintéticos | Pontos e quebras de segmento coerentes com histórico, sem valores alterados |
| Bateria | Rodar cenário repetível por pelo menos 60 minutos em cada modo | Registrar carga inicial/final, tela ligada/desligada, rede e temperatura; comparar com referência sem GPS |

## Registro da aprovação

Para cada execução: identificador sintético, responsável, data, evidências, resultado esperado/observado, distância de referência/app, consumo e falhas. Aprovação comercial exige assinatura do responsável e critérios definidos acima. Até lá, todos os casos físicos permanecem **pendentes**.

## Alterações de código e limites

O controlador invalida solicitações pendentes por mais de 25 segundos ao retornar ao app e reinicia um segmento após verificação de permissão. Respostas atrasadas não alteram a rota. Revogação da permissão para bloqueado ou de permitido para perguntar interrompe captura e libera o lease; não religa automaticamente ao conceder permissão. A solicitação inicial em estado perguntar continua disponível. Falha síncrona da API libera captura e permite nova ação explícita. O modo econômico mantém amostragem de 15 segundos e timeout de 20 segundos.

O motor mantém filtros de precisão, idade, saltos, oscilação e lacunas. Nenhum cálculo financeiro foi alterado pelo GPS. A distância continua sujeita à revisão do usuário; trechos sem sinal podem resultar em subcontagem. Limitações reais de bateria, navegador e fabricantes só serão determinadas pelos testes acima.
