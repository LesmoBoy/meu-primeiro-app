# Changelog

## 3.2.3 — candidata para homologação — 27/11/2026

Base: auditoria de 26/11/2026 e commit `8f4cae36367f667ca871bd2539891ad6d1a74599`. Desenvolvimento em branch dedicada; publicação e alterações sensíveis de produção dependem de autorização final.

- Endurece a verificação de sessão no servidor, revalida identidade depois de esperas, trata expiração/renovação e impede que uma troca de conta ou perfil valide uma resposta antiga.
- Serializa a saída com a troca Google ID token já iniciada, evitando que uma resposta atrasada restabeleça a sessão depois de logout confirmado. A área da conta oferece diagnóstico manual seguro da sessão.
- Preserva fechamentos e jornadas legados acima de 24 horas, com avisos, exportação íntegra e correção apenas explícita. A taxa por hora fica indisponível para fechamentos fora do limite diário; ganhos, gastos, saldo e demais cálculos não mudam. O envio incompatível para a conta é interrompido antes de substituir a cópia válida.
- Confere conservadoramente o tamanho JSONB de novos backups, incluindo espaços, UTF-8, escapes e expoentes. Recusas preservam dados, vínculo e cópia remota. Leitura e restauração não recebem essa nova barreira de envio.
- Retoma GPS preso após suspensão, ignora callbacks antigos e interrompe captura na revogação de permissão, inclusive quando o navegador volta a perguntar. Não soma trechos desconhecidos nem promete captura contínua em segundo plano.
- Acrescenta exportação técnica e remoção explícita dos dados locais de um perfil, com confirmação, logout, locks, controle de geração e recuperação de interrupções. Outros perfis e cópias na conta permanecem preservados.
- Amplia testes de contas, empresas, quatro papéis, permissões, revogações e concorrência. Revisa individualmente as 11 funções SECURITY DEFINER expostas e duas internas, mantendo privilégios necessários, RLS e FORCE RLS.
- Prepara migração incremental mínima para retornar conflito HTTP409/PT409 sem repetição transacional de CAS lógico; o cliente reconhece o código sem depender do status dentro do erro e desativa repetição automática de RPCs. Preserva revisão, locks, autorizações e última cópia válida. A migração permanece pendente de aprovação em produção.
- Atualiza cache offline, políticas de dados, testes, documentação, roteiro físico Android e procedimento de rollback.

Não ativa cobranças, Facebook, novos provedores ou recursos pagos. Não executa migrações em produção nem reescreve a arquitetura. Resultados e cenários pendentes estão separados na [auditoria técnica](docs/v3.2.3/AUDITORIA.md); esta entrada não certifica prontidão comercial.

## 3.2.2 — referência auditada — 26/11/2026

Corrigiu consentimento GPS durante esperas, restauração empresarial de armazenamento corrompido, limites Unicode, convites, iniciais e validação de percursos no SQL. Incorporou migrações verificadas e testes PostgreSQL no CI. Google foi observado com conta real; Facebook e cobranças permaneceram desativados. A auditoria deixou documentadas as pendências de horas legadas, tamanho JSON/JSONB, testes físicos e homologação comercial.
