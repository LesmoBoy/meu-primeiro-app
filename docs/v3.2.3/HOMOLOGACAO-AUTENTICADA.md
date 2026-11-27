# Homologação autenticada local — v3.2.3

Esta evidência usa **Supabase Auth/GoTrue, PostgREST, PostgreSQL e o SDK reais**, com duas identidades Google e registros financeiros inteiramente sintéticos. Não é um login Google OIDC real, não usa contas financeiras do titular e não altera produção. A confirmação externa do provedor continua sendo uma validação separada.

## Ambiente e reprodução

Na raiz do repositório, com Node.js 24, dependências do lockfile e Docker disponíveis:

```sh
node qa/v323/auth-http-hml.cjs
RODAGEM_HML_CAS_PROOF=1 node qa/v323/auth-http-hml.cjs
```

O primeiro comando executa a suíte contra os arquivos atuais, sem substituir os corpos SQL. O segundo reproduz de forma controlada a diferença entre `40001` e `PT409`, exclusivamente em banco descartável, preservando o snapshot e restaurando a definição da função anterior ao experimento. Nunca configurar esses comandos com URL, senha ou chave de um projeto remoto: o programa não aceita destinos remotos.

Os quatro contêineres usam imagens fixadas por digest, registradas nas evidências: PostgreSQL 17, GoTrue **v2.199.0**, PostgREST **v14.18** e Python 3.13 para transportar bytes HTTP. O banco começa com `network=none`; os demais contêineres compartilham esse namespace. Não há porta publicada, egress dos serviços, volume persistente, serviço de e-mail, provedor externo habilitado ou cobrança.

O transporte alternativo é necessário porque a rede Docker `--internal` deste ambiente não roteava os serviços. Um worker Python recebe método/caminho/corpo por stdin e faz HTTP de verdade em `127.0.0.1`. Ele devolve a resposta original do servidor; não implementa respostas falsas de Auth ou REST. O SDK empacotado no app e `cloud-client.js` usam esse transporte. O nome de projeto sintético em HTTPS existe somente para passar pela validação de configuração do app; nenhum DNS ou servidor Supabase externo é acessado por ele.

Senhas, segredo de assinatura e sessões são aleatórios e efêmeros. Arquivos temporários têm diretório `0700` e arquivos de ambiente `0600`; não são incluídos no repositório ou relatório. Logs dos serviços estão desativados. O diagnóstico público inclui somente códigos, status, nomes de casos, contagens e hashes de fontes/dados sintéticos. A limpeza remove os contêineres e temporários ao terminar ou falhar.

## Cobertura

- Provedores Google, Facebook, e-mail e telefone desativados no stack; identidades/sessões sintéticas sem ativar novos provedores.
- `GET /user` real recusando ausência de token, assinatura inválida e expiração; confirmação autoritativa das duas contas pelo `RodagemCloud.verifySession`.
- Conta adulterada no cache recusada após a resposta autoritativa; o retorno público não contém tokens ou campos arbitrários de metadados.
- Salvamento e leitura de backups com dados sintéticos, RLS entre duas contas, UID divergente, tentativas de alteração de outra conta e acesso anônimo/expirado recusados.
- Conflito de revisão e concorrência HTTP: um vencedor e um conflito, sem alteração da última cópia válida pelo perdedor.
- Empresas distintas, RLS de entidades, recusa de workspace alheio e as quatro funções com conflitos CAS: backup pessoal, salvar entidade, arquivar entidade e salvar membro.
- Expiração de acesso, renovação real via `/token`, rotação de refresh token, renovação explícita sanitizada, sessão revogada e refresh inválido.
- Logout de escopo local via `/logout`, remoção do cache Auth e preservação da outra sessão sintética; troca de conta e troca de perfil durante a verificação.
- Fluxo dos módulos reais `RodagemSync.bind`, `upload` e `restore`: vínculo sem transferência automática, envio confirmado, revisão confirmada, recuperação exata e preservação de outro perfil. Nessa parte, DOM, confirmações e recarregamento são simulados; SDK, Auth, REST e banco continuam reais.

Resultado local desta etapa: **16/16 grupos aprovados**, com fontes canônicas da candidata e sem adaptação do SQL. Nomes dos grupos, rotas/status/códigos observados e hashes das fontes executadas: [auth-http-report.json](../../qa/v323/auth-http-report.json). As contagens representam grupos de verificações; não devem ser somadas como se fossem cenários únicos de Chromium ou testes físicos.

## Conflito CAS: defeito encontrado pelo HTTP real

`40001` significa falha de serialização transacional. O executor Hasql utilizado pelo PostgREST repete automaticamente transações com esse SQLSTATE. Usá-lo como conflito lógico permanente de revisão pode manter a RPC repetindo em vez de entregar um conflito ao cliente. Testes SQL diretos de rejeição não demonstravam esse comportamento da camada HTTP.

A prova controlada registrou o mesmo snapshot, usuário e revisão: com `40001`, nenhuma resposta de conflito chegou antes do limite de 2,5 segundos; mudando somente esse SQLSTATE para `PT409`, a resposta foi HTTP 409 com código `PT409`, em 157 ms naquela execução. Revisão `1`, hash do payload e um registro financeiro sintético permaneceram iguais. A definição original foi restaurada e a leitura válida do backup foi conferida. Imagens, hashes das definições, tempos e fontes: [auth-http-cas-proof.json](../../qa/v323/auth-http-cas-proof.json).

A release candidata usa `PT409` nas quatro funções, mapeia o código do erro no frontend e desativa a repetição automática do cliente REST. O SDK devolve `error.code` e `status` separados; presumir `error.status` não basta. A suíte final lê o SQL canônico, sem a adaptação temporária utilizada durante a investigação. A migração de produção permanece sujeita à aprovação explícita do proprietário.

Referências: [executor PostgREST 14.18](https://github.com/PostgREST/postgrest/blob/v14.18/src/PostgREST/MainTx.hs#L101) e [tratamento de repetição Hasql](https://github.com/nikita-volkov/hasql-transaction/blob/1.1.0.1/library/Hasql/Transaction/Private/Sessions.hs).

## Limites e risco residual

Identidades de fixture com `provider=google` não provam assinatura/nonce do Google, consentimento, seletor de conta, credenciais de produção nem configuração de OAuth. Nenhum novo provedor foi habilitado. O ambiente isolado também não homologa gateway/API key do serviço hospedado, TLS, disponibilidade, carga, rede móvel, Android ou GPS físico.

O logout revoga a sessão/refresh no GoTrue e impede a autorização pelo `verifySession`. Tokens de acesso JWT podem, entretanto, continuar válidos no PostgREST até expirar: o REST verifica assinatura/expiração e RLS, sem consultar `auth.sessions` a cada operação. A suíte registra separadamente a resposta de `/user` e a do REST após logout; não declara revogação instantânea de toda API. Reduzir a expiração e/ou exigir sessão ativa nas operações sensíveis requer projeto e homologação próprios, com migração revisada e autorização antes de qualquer mudança em produção.

Os resultados locais não tornam a versão pronta para operação comercial. Login Google real na candidata, instalação/atualização da PWA, testes físicos de GPS/bateria e aceite operacional continuam pendentes até sua execução e registro separados.
