# Backend do Minha Rodagem

O código está preparado para um projeto Supabase do proprietário do aplicativo. Nenhum projeto, banco externo ou aplicativo OAuth foi criado automaticamente.

1. Siga [a configuração de Google, Facebook e Supabase](../docs/SUPABASE.md).
2. Execute [schema.sql](schema.sql) no SQL Editor do projeto correto.
3. Preencha somente os valores públicos de `cloud-config.js`.

Teste reproduzível, com Docker e PostgreSQL 17:

```sh
sh supabase/test-postgres.sh
```

O script cria seu próprio contêiner, sem publicar portas ou acessar um banco externo, usa contas fictícias e remove o contêiner ao terminar. [test.sql](test.sql) não deve ser executado no projeto real: ele depende das simulações de `auth.users` e `auth.uid()` criadas pelo script.

Os testes cobrem isolamento entre dois usuários, acesso anônimo negado, vínculo entre o UID esperado e o JWT usado, revisão monotônica, conflito entre gravações simultâneas, dados inválidos, limite de tamanho e exclusão de conta. Eles não substituem a homologação do OAuth nos provedores reais.
