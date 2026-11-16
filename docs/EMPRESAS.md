# Empresas, equipe e frota

O módulo empresarial reúne empresas, equipe, veículos, viagens com custos e alertas de manutenção/documentos. Os lançamentos pessoais anteriores continuam no Histórico pessoal; criar uma empresa não os importa nem os desconta novamente.

## Local e conectado

**Empresa neste aparelho:** os dados ficam no navegador, separados pelo perfil local. Quem usa esse navegador pode acessar esses dados. Os nomes e funções cadastrados organizam a equipe, mas não são contas autenticadas nem um controle de acesso entre pessoas. O backup empresarial próprio guarda esse conjunto local.

**Empresa da conta:** usa a sessão Google/Facebook do Supabase e os vínculos de equipe registrados no servidor. Uma conta pode participar de várias empresas e uma empresa pode ter várias contas. O servidor valida o UID autenticado, a empresa, o papel e a revisão de cada alteração. Dados de empresas conectadas não são copiados automaticamente para uma empresa local.

O projeto Supabase, os provedores Google/Meta e a cobrança precisam ser ativados pelo proprietário. Sem essa configuração, o modo local continua disponível e nenhuma autenticação ou assinatura ativa é simulada.

## Configuração do servidor

1. Conclua [a configuração de autenticação e Supabase](SUPABASE.md).
2. No SQL Editor do projeto correto, aplique `supabase/schema.sql` e depois [supabase/enterprise.sql](../supabase/enterprise.sql).
3. Para cobrança, aplique `supabase/billing.sql` e siga `docs/ASSINATURAS.md`. Não coloque chaves secretas de pagamento no site.
4. Entre com a conta responsável, selecione o modo conectado e crie a empresa. A conta que cria a empresa recebe o papel de responsável.
5. Homologue com duas empresas e contas de papéis diferentes antes de cadastrar dados de clientes.

Reaplicar a migração preserva registros existentes. Faça backup antes de atualizar um projeto que já contém dados reais. Os arquivos `*-test.sql` são fixtures para contêineres descartáveis e não devem ser executados no projeto real.

## Papéis na empresa conectada

| Papel | Acesso |
| --- | --- |
| Responsável (`owner`) | Gerencia frota, viagens, alertas e equipe; pode conceder funções de gestão e acessar a contratação da empresa. |
| Gestor (`manager`) | Gerencia a operação e convida/edita motoristas e financeiro. Não concede nem altera funções de responsável ou gestor. |
| Financeiro (`finance`) | Consulta os relatórios da empresa e corrige os custos de viagens existentes. Não altera receita, veículo, motorista, equipe ou frota. |
| Motorista (`driver`) | Consulta a frota disponível, suas próprias viagens e os alertas atribuídos a si. Registra e altera suas próprias viagens. |

A empresa precisa manter pelo menos um responsável ativo. Desativar alguém interrompe novas operações da conta nessa empresa, preservando os vínculos históricos das viagens. O papel apresentado pela interface vem do vínculo do servidor; editar o formulário ou o JavaScript não concede um novo papel.

## Convites

O responsável ou gestor cria um convite para o e-mail de quem vai entrar. O aplicativo mostra um token/link para copiar e compartilhar manualmente; ele não envia e-mails por conta própria. O token completo aparece uma vez e o banco guarda somente seu hash.

O convite expira após sete dias e pode ser revogado antes da aceitação. Quem o aceita precisa entrar com o e-mail confirmado correspondente. Contas com outro e-mail, tokens expirados/revogados, tokens já usados e convites cujo emissor perdeu autorização são recusados. Um convite pendente não pode ser escolhido como motorista de uma nova viagem até ser aceito.

## Frota e histórico

Cada veículo tem um identificador permanente, categoria, nome/modelo livre, ano opcional, energia, identificação/placa e hodômetro. Cada viagem aponta para um veículo e, quando informado, para uma pessoa da mesma empresa.

Arquivar um veículo ou desativar uma pessoa não apaga viagens. Referências arquivadas ficam disponíveis para os relatórios, mas não podem ser escolhidas para novos vínculos. Uma correção de custos de uma viagem antiga pode manter seu veículo ou motorista já arquivado. Trocar a referência exige um veículo/pessoa ativo da própria empresa.

Quando uma conta é excluída do Auth, seus vínculos empresariais são arquivados e anonimizados, preservando os identificadores usados no histórico financeiro. A exclusão do último responsável é recusada até a transferência da responsabilidade para outra conta ativa.

## Valores e alertas

Receita e custos são guardados em centavos inteiros; distância e hodômetro, em centésimos de quilômetro. As categorias de custo são combustível/energia, pedágios, estacionamento, comissão, ajudante, manutenção e outros gastos. O lucro de uma viagem é a receita menos a soma desses custos. Os totais de resultado consideram viagens concluídas e não arquivadas; viagens planejadas/em andamento continuam na operação, mas não entram como receita realizada.

Alertas podem vencer por data, hodômetro ou ambos. Registrar a conclusão mantém o alerta no histórico; reabri-lo remove a conclusão. Um hodômetro de vencimento exige um veículo. Alertas de documentos podem ser associados a uma pessoa da equipe.

## API e concorrência

As operações empresariais recebem `expected_user_id`, que precisa ser igual ao UID do JWT. Identificadores fornecidos pelo cliente não substituem essa verificação. Alterações de entidades e membros usam uma revisão esperada; uma revisão antiga recebe `40001` em vez de sobrescrever outra edição.

As mutações serializam os vínculos da empresa e conferem a autorização novamente depois de aguardar a trava. Isso impede continuar uma operação com um papel revogado durante a espera. Referências de veículos e pessoas são validadas pelo servidor, impedindo ligar uma viagem a outra empresa.

RPCs públicas autenticadas:

- `business_list_companies(expected_user_id)`
- `business_create_company(expected_user_id, company_name)`
- `business_load_workspace(expected_user_id, company_id)`
- `business_save_entity(expected_user_id, company_id, entity_kind, entity_id, expected_revision, entity_data)`
- `business_archive_entity(expected_user_id, company_id, entity_kind, entity_id, expected_revision)`
- `business_save_member(expected_user_id, company_id, member_id, expected_revision, member_data)`
- `business_invite_member(expected_user_id, company_id, invite_email, invite_name, invite_role)`
- `business_revoke_invite(expected_user_id, company_id, invite_id)`
- `business_accept_invite(expected_user_id, invite_token)`

`member_data` contém somente `{name, role, active}`. E-mail e conta de um vínculo existente não são substituídos pelo formulário. As tabelas têm RLS e as gravações diretas pelo papel `authenticated` são negadas; as RPCs aplicam as permissões de cada operação.

## Testes reproduzíveis

```sh
sh supabase/test-enterprise.sh
```

O runner cria PostgreSQL 17 em contêiner próprio, sem portas externas, usa contas fictícias e remove o contêiner ao terminar. Ele não aceita uma URL de banco remoto nem requer as chaves do seu projeto. Os testes cobrem duas empresas, papéis, referências, valores inválidos, convites, revisão/CAS, arquivamento e exclusão de conta. Eles não substituem a homologação dos provedores reais e das configurações do seu projeto.
