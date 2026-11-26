# Backend do Minha Rodagem

Esta instalação usa o projeto Supabase MRB (`ivoszoawhknwbiszjvfv`), com autenticação Google e cinco tabelas do aplicativo protegidas por RLS. Facebook e cobranças permanecem desativados. Consulte o estado e as URLs em [SUPABASE.md](../docs/SUPABASE.md); não crie projetos duplicados para atualizar esta instalação.

1. Siga [a configuração de Google, Facebook e Supabase](../docs/SUPABASE.md).
2. Para uma instalação nova, aplique as migrações em `migrations/` na ordem dos nomes, ou os esquemas atuais [schema.sql](schema.sql) e [enterprise.sql](enterprise.sql). Para atualizar uma instalação existente, aplique somente as migrações ainda não registradas no projeto.
3. Preencha somente os valores públicos de `cloud-config.js`.

Teste reproduzível, com Docker e PostgreSQL 17:

```sh
sh supabase/test-postgres.sh
sh supabase/test-enterprise.sh
python qa/migrations-chain-test.py
```

O script cria seu próprio contêiner, sem publicar portas ou acessar um banco externo, usa contas fictícias e remove o contêiner ao terminar. [test.sql](test.sql) não deve ser executado no projeto real: ele depende das simulações de `auth.users` e `auth.uid()` criadas pelo script.

Os testes cobrem isolamento entre usuários e empresas, acesso anônimo negado, vínculo entre UID esperado e JWT, revisões, conflitos simultâneos, revogação de função durante espera, dados inválidos, percursos GPS, limite de tamanho, exclusão de conta e a cobrança preparada em ambiente descartável. A cadeia de migrações é comparada com as 25 funções dos esquemas revisados. Os testes PostgreSQL também são executados pelo CI; não substituem a homologação dos provedores reais.
