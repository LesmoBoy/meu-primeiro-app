# Caminho para um produto para empresas

## O que esta versão entrega

O Minha Rodagem 2.3 cadastra um veículo por perfil: categoria, nome ou modelo livre, ano opcional, atividade e fonte de energia. Há jornadas, histórico financeiro, GPS e backup local. O login com Google/Facebook e a cópia manual por conta estão preparados para um projeto Supabase próprio; ficam indisponíveis até a configuração do proprietário.

A cópia na nuvem usa conta individual, revisão e confirmação antes de substituir dados. Entrar não importa lançamentos, nem transforma os perfis locais em contas protegidas por senha. Esta versão ainda não oferece um painel de empresa ou uma frota com vários veículos dentro da mesma conta.

## Próximas entregas que mais ajudam a vender

1. **Empresa, equipe e permissões.** Criar empresas e convites; separar gestor, financeiro e motorista; aplicar isolamento por empresa no banco e nos arquivos. Testar sempre duas empresas sem acesso cruzado.
2. **Frota com veículos identificados.** Vincular cada jornada, abastecimento, manutenção e viagem a um veículo permanente. Permitir troca de motorista e veículo sem misturar hodômetros ou consumo.
3. **Custo e margem por serviço.** Pedágios, estacionamento, comissões, ajudante, pneus, manutenção e depreciação. Comparar receita, custo e margem por veículo, cliente e rota.
4. **Manutenção e documentos.** Alertas por data ou hodômetro para revisão, pneus, seguro, licenciamento e habilitação. Registrar quem resolveu cada pendência.
5. **Operação do dia.** Agenda de serviços, responsáveis e estados (agendado, em andamento, concluído). Comprovantes opcionais com foto e assinatura, enviados apenas quando solicitados.
6. **Relatórios e cobrança.** Resumos por período e exportação contábil; assinatura por empresa ou veículo ativo, limites claros e cobrança recorrente. Recursos comerciais dependem de implementação específica.

## Ordem recomendada

Validar primeiro com algumas empresas de um segmento, por exemplo entregas urbanas ou fretes leves. Ativar autenticação e backups reais, medir uso e recuperação e, depois, implementar empresa/equipe e veículos individualizados. Adicionar custos e manutenção antes de ampliar o painel e a cobrança.

Para sincronização automática futura, usar uma fila offline durável por usuário e registro, identificadores e revisões próprios, resolução de conflitos e indicação do que ainda não foi enviado. A cópia manual atual não deve ser apresentada como sincronização automática em tempo real.
