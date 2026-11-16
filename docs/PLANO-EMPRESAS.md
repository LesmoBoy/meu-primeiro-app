# Minha Rodagem 3.0: módulos empresariais

## Implementado

- Empresas e equipe com responsável, gestor, financeiro e motorista. O acesso por conta é validado no banco; o modo local organiza apenas os dados do aparelho.
- Frota com vários veículos por empresa, categoria, nome/modelo livre, ano, identificação e hodômetro. Arquivar um veículo ou pessoa mantém os vínculos das viagens anteriores.
- Viagens com receita, sete categorias de gastos e distância. Relatórios por data, veículo e motorista, com resultado calculado em centavos e exportação CSV.
- Manutenção e documentos com vencimento por data ou quilometragem, conclusão e reativação. Os alertas são mostrados no app; esta versão não envia notificações em segundo plano.
- Integração de assinatura Stripe por empresa ou por vaga de veículo ativo, checkout e portal do responsável, confirmação por webhook e cotas opcionais no servidor.
- Backup empresarial próprio dos dados locais, separado do backup dos lançamentos pessoais. Abrir uma empresa não envia os dados pessoais nem os importa automaticamente.

## Para usar online e contratar

O modo local funciona sem contratar serviços. Login, convites autenticados entre pessoas, dados empresariais compartilhados e cobrança precisam da ativação de um projeto Supabase e de contas Google/Meta/Stripe do proprietário.

1. [Ativar autenticação e Supabase](SUPABASE.md).
2. [Ativar empresas, funções e frota](EMPRESAS.md).
3. [Configurar preços, checkout, webhook e portal Stripe](ASSINATURAS.md).

A configuração distribuída mantém nuvem e cobrança desativadas, sem preços fictícios, período de teste inventado ou indicação de assinatura paga. Somente a confirmação verificada do provedor altera a assinatura. Os testes usam dados fictícios; não foram efetuadas cobranças reais.

## Validação para colocar empresas em produção

Depois de configurar os serviços, homologue duas empresas com contas de funções diferentes, confirme o isolamento e a recuperação dos dados e teste a cobrança no ambiente de testes da Stripe. Defina os preços e os canais de suporte, privacidade e exclusão de conta antes de receber clientes reais.

A implantação do código no GitHub Pages não cria automaticamente o projeto Supabase, os aplicativos OAuth ou a conta de pagamentos. As instruções e funções de servidor estão incluídas no repositório para essa ativação.
