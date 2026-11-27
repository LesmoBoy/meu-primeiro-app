# Homologação PostgreSQL sintética — v3.2.3

Executar na raiz do checkout com Docker e Python 3:

```sh
sh supabase/test-postgres.sh
sh supabase/test-enterprise.sh
python3 qa/v323/postgres-hml-races.py
python3 qa/migrations-chain-test.py
python3 qa/v323/backup-budget-postgres.py
```

Os cinco comandos criam contêineres descartáveis PostgreSQL 17 com `--network none`, sem portas expostas e sem aceitar DSN. Não apontar fixtures SQL para projeto real. Não são necessárias credenciais, providers ou serviços de pagamento.

`supabase/enterprise-test.sql` acrescenta 112 marcadores HML cobrindo individualmente as 11 funções SECURITY DEFINER expostas, ACL/search_path/RLS/FORCE, 27 rejeições de UID nas 9 RPCs, duas empresas, quatro papéis, revogação e round trip de entidade arquivada. `supabase/test.sql` acrescenta 4 marcadores de envio/restauração de snapshot pessoal e preserva a fixture CAS com rollback.

`postgres-hml-races.py` cria sua própria instância e coordena 15 corridas com duas sessões PostgreSQL reais. A primeira transação aguarda aberta; a segunda precisa aparecer em `pg_stat_activity` com `wait_event_type='Lock'` antes do commit da primeira. O runner verifica SQLSTATE e estado final, remove seu contêiner no `finally` e grava `evidence/enterprise-races.json` somente após todas as asserções passarem. O JSON contém resultados e metadados locais, sem tokens ou credenciais.

Provas completas e limites: [SECURITY-DEFINER.md](../../docs/v3.2.3/SECURITY-DEFINER.md). Resultados da execução e hashes dos arquivos de escopo: [postgres-results.json](evidence/postgres-results.json). Os logs `*-baseline.log` antecedem as ampliações; `*-hml.log` são a execução ampliada de 26/11; `*-final.log` registram a revalidação de 27/11. O teste de migrações compara offline a referência `production-catalog.json`: baseline de 25 definições iguais, RC de 21 inalteradas e 4 com apenas sete SQLSTATE diferentes, 24 ACLs authenticated iguais e uma diferença revisada no EXECUTE do trigger SECURITY INVOKER. A quinta migração foi criada pelo CLI e testada em upgrade/reaplicação/rollback/reupgrade com payloads e revisões preservados. Nada foi aplicado em produção. Quantidades de PASS representam marcadores, não casos independentes; os resumos finais também imprimem PASS.
