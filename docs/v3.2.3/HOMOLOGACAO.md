# Checklist de homologação — Minha Rodagem v3.2.3

Referência v3.2.2: `8f4cae36367f667ca871bd2539891ad6d1a74599`, auditoria de 26/11/2026. Candidata preparada em branch dedicada. **Nenhum item pendente deve ser apresentado como aprovado.** O resultado executado de cada etapa está em [RESULTADOS.md](RESULTADOS.md).

## Critérios técnicos para a candidata

- [x] Trabalhar sobre a árvore auditada e preservar a identidade visual e as funcionalidades existentes.
- [x] Usar somente contas, empresas, veículos, jornadas e valores sintéticos nos testes de escrita.
- [x] Manter RLS, FORCE RLS, UID, vínculo, papéis e controle de revisão.
- [x] Revisar individualmente as 11 funções SECURITY DEFINER expostas e duas internas.
- [x] Implementar preservação de legados acima de 24h, com avisos e correção explícita.
- [x] Implementar orçamento conservador de envio JSONB sem restringir a leitura/restauração compatível.
- [x] Acrescentar regressões de sessão, logout, troca de contas, vínculo, upload, restauração, dados locais e GPS.
- [x] Preparar plano de rollback antes da publicação; ensaio local do cache executado separadamente.
- [x] Confirmar aprovação do CI da árvore candidata final, com todas as suítes existentes e novas: execução 45930835327, commit `bd8f927eede3f03df396d8d23f541fb8cd309692`.
- [ ] Aprovar a migração mínima do conflito HTTP e seu procedimento de retorno antes de aplicá-la no projeto de produção.

## Homologação externa de autenticação e sincronização

- [ ] Disponibilizar ambiente hospedado de homologação com origem/URLs próprias e provedor Google já autorizado, sem reutilizar dados reais de produção.
- [ ] Executar a candidata com duas contas Google sintéticas de homologação A/B, consentimento real, assinatura/audiência/nonce validados pelo Supabase e captura sanitizada do resultado de `getUser()`.
- [ ] Executar expiração, renovação, logout, cancelamento, conta A→B e A→B→A, inclusive duas abas e troca entre aparelhos.
- [ ] Vincular perfil A, enviar backup sintético, recuperar em outro aparelho e comparar campos, revisão e integridade. Provar que B não acessa A e que nenhum outro perfil local é substituído.
- [ ] Repetir conflitos, falha de rede, quota, recusa do servidor e restauração interrompida no ambiente hospedado. Preservar a última cópia válida em cada caso.
- [ ] Confirmar HTTP409/PT409 na infraestrutura hospedada após migração autorizada, sem repetição automática do conflito lógico.

HTTP real com GoTrue/PostgREST locais e identidades Google sintéticas não valida OIDC do Google. A sessão já conectada observada na produção v3.2.2 não é execução de ponta a ponta da candidata. Não usar contas ou lançamentos financeiros reais para fechar esses itens.

## Dispositivos e GPS

- [ ] Executar o [roteiro físico Android](GPS-ANDROID.md), incluindo Poco X7 Pro se disponível e outro aparelho.
- [ ] Definir antes da execução tolerância comercial de distância e consumo; medir em modos econômico/preciso, tela ligada/bloqueada e economia de bateria.
- [ ] Validar perda de sinal, suspensão, retorno, revogação e cancelamento de consentimento com evidências reais.
- [ ] Conferir instalação/atualização da PWA e offline em Chrome Android real, com dados sintéticos e cache preparado.
- [ ] Confirmar download efetivamente salvo em local privado e recuperação assistida da cópia técnica com suporte; o app não pode provar que o arquivo foi guardado.

## Preparação comercial e operação

- [ ] Homologar carga e volume esperado por empresa; definir limites, paginação, observabilidade e resposta a falhas.
- [ ] Validar política operacional de retenção, backup/recuperação, atendimento e exclusão manual com o responsável.
- [ ] Revisar política de privacidade, enquadramento jurídico e tratamento de dados de trabalhadores/empresas.
- [ ] Concluir requisitos externos do Google e decisão de hospedagem/cabeçalhos para uso comercial.
- [ ] Obter aprovação final da release, migração e janela de publicação, registrando SHA e responsável.
- [ ] Depois da publicação autorizada, conferir hashes de runtime, cache, sessão somente leitura e logs sanitizados. Não substituir dados reais para testar.

Facebook, cobrança, novos provedores e recursos pagos permanecem fora desta autorização. Só poderão ser habilitados em trabalho próprio com testes e aprovação correspondentes.

## Decisão de aceite

Responsável: ____________________ · Data: ____________________ · SHA: ____________________

Ambiente e evidências: ____________________

Pendências aceitas para teste restrito: ____________________

**Liberação comercial:** não concedida por esta auditoria. A aceitação de uma candidata para testes não autoriza sua venda ou publicação em produção automaticamente.
