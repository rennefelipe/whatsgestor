# Recuperação automática da sessão WhatsApp

Entrega local em 27/10/2026. Nenhuma publicação no GitHub, migration, alteração do banco operacional, envio real ou reinicialização de serviço foi executada. Os fluxos de mensagens, mídia, áudio, Conversas e Envio em Lote foram preservados.

## Diagnóstico registrado antes das alterações

Registro original: `artifacts/backup-reconnection-20261027-134756/DIAGNOSTICO-ANTES.txt`.

`ConnectionRegistry` lê `dbo.whatsapp_connections`. `isActive` habilita o cadastro; o `status` armazenado no SQL não comprova uma conexão atual. A API já apresenta o estado do `ConnectionManager`, incluindo abertura real do websocket, erros e sincronização.

A inicialização automática já existia em `IntegrationLifecycle`, mas `WHATSAPP_INTEGRATION_AUTO_RESTORE=false` no `.env` local impedia sua execução. Além disso, a implementação exigia `intent.restore=true`, deixando de considerar sessões autenticadas anteriores a esse registro. Uma leitura de intenção com erro interrompia a recuperação das sessões seguintes.

As credenciais vêm de `session-auth.authId` ou do ID da conexão, no armazenamento criptografado `auth`. Sem seleção de namespace, há fallback de leitura para o `creds.json` legado. O Baileys rc14 usa `creds.me.id` para retomar a identidade; `registered=false` isoladamente não invalida uma sessão. O diretório legado permanece somente para leitura.

O bloqueio antigo criava `<id>.socket.lock` com `wx`, gravando apenas PID. Qualquer arquivo existente produzia `SOCKET_LEASE_EXISTS`; uma queda forçada deixava o arquivo órfão e impedia a próxima conexão.

Já existiam orçamento persistente de reconexão, espera exponencial, tratamento separado do reinício 515, desconexão manual persistente, bloqueio de sessões revogadas e persistência idempotente de mensagens. Foram mantidos.

## Comportamento implementado

- O hook `onApplicationBootstrap` inicia a restauração após a inicialização dos módulos e do DataSource. O adapter de envio continua sendo registrado pelo ciclo de vida.
- Apenas cadastros ativos e credenciais com identidade salva são candidatos. Não há geração automática de QR para sessão sem autenticação; `authenticationIssue=pairing_incomplete` e `requiresPairingRecovery=true` indicam intervenção.
- `manual`, `blocked` e `restore=false` impedem restauração. Sem intenção persistida, também se respeitam o status manual e a data de desconexão posterior à última conexão.
- A intenção é conferida novamente antes de uma tentativa automática. Chamadas concorrentes compartilham a abertura. Erros de uma sessão não impedem a tentativa nas demais.
- Falhas temporárias reconhecidas durante a criação do transporte continuam consumindo o orçamento de espera progressiva. Falhas de propriedade do lock ou armazenamento não são tratadas como falhas de rede.
- Encerramento normal drena as credenciais e libera os bloqueios. Uma falha ao fechar uma sessão não impede o fechamento das seguintes.
- O `.env` local passou a `WHATSAPP_INTEGRATION_AUTO_RESTORE=true`, preservando as demais configurações. O exemplo e a documentação foram atualizados; `false` continua disponível como desativação explícita.

## Exclusividade no Windows

`socket-lease.ts` usa um processo auxiliar PowerShell oculto, sem shell intermediário, que abre o arquivo estável `<id>.socket.guard` com `FileShare.None`. Esse handle do Windows serializa toda inspeção, recuperação, criação e liberação do `.socket.lock`. O guard permanece no disco e nunca deve ser removido durante a operação.

O mesmo auxiliar realiza todas as operações com a metadata enquanto mantém o handle exclusivo. Assim, se o auxiliar morrer entre inspeção e criação, ele também deixa de executar a exclusão; um recuperador concorrente não pode ultrapassá-lo. EOF na entrada após morte do backend encerra o auxiliar e libera o handle pelo sistema operacional. O `.socket.lock` remanescente será reavaliado no próximo início.

Novos registros incluem PID do backend, hostname, token aleatório, início estimado do processo e data da aquisição. Apenas PID comprovadamente inexistente pode ser recuperado. Um PID existente é sempre recusado, mesmo se a data sugerir reutilização. Não há tomada de posse por idade do arquivo. Arquivos inválidos, host diferente, acesso negado ou impossibilidade de verificar exclusividade resultam em `SOCKET_LEASE_UNVERIFIED`; a metadata não é removida. PID ativo resulta em `SOCKET_LEASE_EXISTS`.

Locks legados com apenas PID podem ser recuperados quando esse PID não existe no computador local. Por isso, a estratégia Windows exige volume local fixo; compartilhamentos UNC e volumes mapeados são recusados. Fora do Windows, mantém-se aquisição exclusiva conservadora sem recuperação automática de órfãos.

Na liberação normal, o auxiliar confere seu token antes de remover a metadata. Se o auxiliar morrer enquanto o backend continua ativo, o PID vivo na metadata impede outro processo de assumir a sessão; pode ser necessário encerrar normalmente essa instância e iniciar novamente após investigação.

Base técnica: [Microsoft — FileShare.None](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare?view=net-9.0) e [Node.js — child_process](https://nodejs.org/api/child_process.html).

## Arquivos e backups

Alterados: `backend/src/whatsapp-integration/baileys-socket.factory.ts`, `connection-manager.ts`, `contracts.ts`, `whatsapp-integration.module.ts`, `backend/package.json`, `backend/.env.example`, `backend/.env` e `docs/CONFIGURACAO.md`.

Criados: `backend/src/whatsapp-integration/socket-lease.ts`, `backend/test/automatic-restore.test.cjs` e este relatório.

Antes das alterações, foram copiados o módulo de integração completo, os testes, `package.json`, `.env.example` e `CONFIGURACAO.md` para `artifacts/backup-reconnection-20261027-134756/`. A configuração privada anterior está em `backend/.env.bak-reconnection-20261027-134756`. Esses backups são locais e ignorados pelo Git. Não compartilhe o backup privado de configuração.

## Validação

Os builds e testes são executados em cópia isolada indicada em `artifacts/reconnection-validation-path.txt`, sem `.env` operacional. O build não substitui `dist` nem `.next` da instalação em execução. As dependências existentes foram reutilizadas, sem atualização de versões.

O novo `npm run test:restore` executa os testes específicos, também incluídos em `npm test`. Eles cobrem bootstrap, recriação do backend, credenciais preservadas, cadastro desativado, desconexão manual, sessão revogada, falta de identidade, falha isolada, aberturas concorrentes, queda temporária com falha na reabertura, PID ativo/reutilizado, propriedade inválida, lock legado órfão, disputa por sessão e morte abrupta de outro processo. O SDK é simulado e nenhuma mensagem é enviada.

Os testes existentes de integração e recebimento verificam deduplicação por identificador, lotes concorrentes e replay após recriação. A implementação de envio, recepção e sincronização não foi modificada. Mensagens pendentes dependem do que o WhatsApp/Baileys disponibilizar; não há promessa de recuperar conteúdo ausente no provedor.

Resultados finais:

| Verificação | Resultado |
| --- | --- |
| Backend `npm run typecheck` | Aprovado na versão final |
| Backend `npm run build` | Aprovado em diretório isolado |
| Backend `npm test` | 179 testes aprovados, zero falhas |
| Backend `npm run test:restore` | 9 testes aprovados na versão final, zero falhas |
| Frontend `npm run typecheck` | Aprovado |
| Frontend `npm test` | 66 testes aprovados, zero falhas |
| Frontend `npm run build` | Aprovado em diretório isolado, com cópia física das dependências |
| Frontend `npm run lint` | Zero erros; 3 avisos preexistentes de expressão sem efeito nos scripts `browser-whatsapp-*` |
| Verificação dos arquivos preservados | 15 arquivos restantes da integração idênticos ao backup; `.env` alterado somente na opção de restauração |

A execução completa incluiu os oito cenários iniciais do arquivo novo. O cenário adicional de QR inesperado e os ajustes finais do guard foram validados depois pela execução específica dos nove testes. Os testes de recebimento da suíte completa também já cobrem rejeição de QR inesperado, deduplicação, replay e preservação de mensagens.

Evidências locais: `artifacts/reconnection-focused-tests.log`, `artifacts/reconnection-preservation.json` e `artifacts/reconnection-delivery-hashes.json`. Os testes de orçamento de reconexão usam estado em memória para separar a temporização da latência do disco/ACL; a preservação de credenciais e a recriação do backend são verificadas com armazenamento criptografado real em diretório temporário.

Pendentes deliberadamente: teste de reinicialização/desligamento com a conta real, smoke test operacional, `test:sql` e scripts opcionais de navegador. Não foram usados para justificar alteração no banco nem abertura de sessão real.

## Ativação pelo operador

1. Agendar o encerramento normal da instância atual. Manter os diretórios existentes de sessões, estado, chave e mídias, usando a mesma conta e as mesmas permissões.
2. Com o backend parado, executar `npm run build` em `C:\Projetos\whatsgestor\backend` para gerar o `dist` operacional atualizado. O build desta entrega foi isolado deliberadamente.
3. Conferir `WHATSAPP_INTEGRATION_ENABLED=true` e `WHATSAPP_INTEGRATION_AUTO_RESTORE=true`, já configurados localmente. Não é necessário alterar autorização de envio ou de pareamento.
4. Iniciar pelo procedimento habitual, mantendo uma única instância por sessão. As sessões elegíveis devem passar de conectando para conectado sem clique. Conferir `/whatsapp-connections/:id/status` ou a tela de Conexões; socket aberto e sincronização concluída são observações diferentes.
5. Se aparecer erro de propriedade, investigar o processo/host indicado na metadata e o código do diagnóstico. Não apagar locks, arquivos de sessão ou chave para forçar uma conexão. Sessão revogada ou sem identidade exige o fluxo explícito do operador.

Não é necessário rebuild do frontend para esta alteração. A validação real após reinicialização e após desligar o computador fica para a janela de operação autorizada.

## Reversão pelo operador

Com o backend parado, restaurar apenas os arquivos alterados que têm correspondentes no backup acima, incluindo `backend/package.json`, `.env.example` e `docs/CONFIGURACAO.md`. Restaurar `backend/.env` a partir do backup privado. Remover apenas os novos arquivos de código/teste desta entrega se for voltar integralmente à implementação anterior. Não restaurar o módulo inteiro indiscriminadamente caso tenham ocorrido alterações posteriores.

Executar novamente `npm run build` no backend e iniciar pelo procedimento habitual. Não restaurar ou apagar dados SQL, sessões, arquivos `.enc`, `master.key`, mídias ou locks durante a reversão do código. O arquivo `.socket.guard` inativo pode permanecer: a implementação antiga não o usa. O lock antigo volta a exigir revisão manual de órfãos. Não usar `git reset` para reverter, pois existem muitas alterações preexistentes no workspace.
