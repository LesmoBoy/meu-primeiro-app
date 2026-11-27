# Registros e jornadas legados acima de 24 horas — v3.2.3

Dados usados nos testes: exclusivamente sintéticos. Não houve acesso ou alteração do banco de produção.

## Regra de compatibilidade e preservação

O formato de backup permanece `versao: 1`. O campo `horas` de um fechamento é um inteiro em centésimos de hora: `2400` corresponde a 24 horas. O validador de leitura/importação continua aceitando os inteiros históricos até o limite já existente (`1e10`). Abrir o aplicativo, filtrar o histórico ou exportar um arquivo não reduz, divide, exclui nem grava novamente esses registros. Valores financeiros, identificadores e vínculo `jornadaId` permanecem preservados.

Fechamentos com `horas > 2400` recebem diagnóstico separado da validação. Há aviso persistente ao carregar o perfil, aviso na confirmação da importação e indicação individual da duração original no Histórico. A importação requer confirmação e conserva o controle de versão de origem: uma gravação concorrente impede a restauração de um snapshot antigo. Cancelar não altera o armazenamento, inclusive quando o conteúdo local anterior está danificado.

Formulários novos continuam aceitando no máximo 24 horas. Ao editar um fechamento legado, o campo mostra as horas originais. Salvar exige informar uma duração diária válida e confirmar explicitamente a correção; cancelar mantém o original. O usuário pode baixar uma cópia antes de corrigir. A confirmação não desativa a proteção contra gravações concorrentes.

Os marcadores do cronômetro (`running`, `paused`, `pending`) acima de 24 horas também continuam íntegros. A interface informa a necessidade de revisão. Levar uma jornada ao fechamento mantém o tempo original no formulário; o aplicativo não o limita automaticamente a 24 horas e impede salvar um fechamento diário fora do limite. Distribuir jornadas entre datas exige revisão humana; divisão automática não foi implementada.

## Indicadores financeiros

Ganhos, gastos, saldo, resultados por serviço e por quilômetro mantêm as regras anteriores. A única mudança de apresentação é retirar a taxa por hora de um registro com duração superior ao limite diário: usar uma duração sem revisão produziria um indicador potencialmente enganoso. O aplicativo mostra a razão da indisponibilidade; não substitui a duração por 24 horas nem calcula uma taxa artificial. Após correção explícita para uma duração válida, a taxa volta a ser calculada normalmente. A taxa para exatamente 24 horas permanece disponível. Não há cálculo agregado de taxa por hora no Histórico atual.

JSON e CSV exportam os valores históricos originais. A serialização JSON mantém o formato de exportação já existente; identidade byte a byte do arquivo originalmente importado não é prometida. O armazenamento local existente não é reserializado no carregamento nem durante exportações. Os testes verificam separadamente identidade dos bytes locais e igualdade dos campos exportados.

## API de diagnóstico

`window.RodagemLegacyHours.inspect(registrosOuBackupV1)` retorna `{ count, recordIds }`, congelado e sem modificar a entrada. `window.RodagemLegacyHours.message(diagnostico)` retorna o aviso de preservação (ou texto vazio). A API diagnostica duração; não substitui validação de formato, autorização ou regras do servidor. Pode ser reutilizada no preflight de sincronização para avisar antes de um envio incompatível com o limite do banco.

## Evidências e limites

Executar `node qa/v323/legacy-hours-test.mjs`; resultado em `qa/v323/legacy-hours-report.json`. A suíte cobre limites de duração, entradas congeladas, preservação byte a byte do armazenamento, totais financeiros, filtros, taxa por hora, importação confirmada/cancelada/concorrente/superada, exportação JSON/CSV, correção explícita e concorrente, e marcadores do cronômetro em três estados.

Resultado local deste trabalho: 12/12 cenários novos aprovados; `node qa/dom-smoke.mjs` com 15/15 cenários anteriores aprovados; `node qa/math-audit.cjs` com 6/6 suítes aprovadas, incluindo 50.000 casos decimais gerados. Evidência resumida e hashes dos arquivos executados: `qa/v323/legacy-baseline-report.json`. A integração executará também as demais suítes do projeto.

Essas evidências são locais e de DOM simulado. Não comprovam restauração autenticada na nuvem, execução em aparelho Android, GPS real nem homologação comercial. A incompatibilidade entre a política histórica de leitura local e o limite de duração do servidor exige tratamento conservador na sincronização; não deve ser resolvida apagando ou normalizando o histórico silenciosamente.
