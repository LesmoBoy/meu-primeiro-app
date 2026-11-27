# Minha Rodagem

PWA de jornadas, fechamentos, abastecimentos, percursos e operação empresarial. A candidata **3.2.3** desenvolve estabilidade, segurança e preservação de dados sobre a referência auditada 3.2.2. Sua publicação e a migração de conflito HTTP dependem de aprovação; testes locais não significam liberação comercial.

- [Auditoria técnica e comparação](docs/v3.2.3/AUDITORIA.md)
- [Resultados e evidências por categoria](docs/v3.2.3/RESULTADOS.md)
- [Checklist de homologação](docs/v3.2.3/HOMOLOGACAO.md)
- [Plano de rollback](docs/v3.2.3/ROLLBACK.md)
- [Changelog](CHANGELOG.md)
- [Configuração Supabase e Google](docs/SUPABASE.md)

Para desenvolvimento, instale a árvore fixa com `npm ci`. Execute `npm run test:local`, os seis comandos de navegador existentes, `npm run test:v323-browser`, os runners PostgreSQL e `npm run test:auth-http`, conforme o workflow e o relatório. Dados e contas dos testes são sintéticos; runners locais usam bancos descartáveis. O GPS físico Android tem roteiro próprio e permanece pendente até execução real.

Entrar na conta não envia backups automaticamente. Logout conserva dados locais. Perfis locais não são contas com senha; cópias na nuvem e empresas conectadas dependem da autorização no servidor. Facebook e cobranças permanecem desativados.
