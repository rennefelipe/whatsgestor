# Modernização do WhatsGestor — 30/10/2026

As alterações foram feitas sobre o diretório existente, preservando as mudanças anteriores. A implementação está no código-fonte. O backend operacional não foi recompilado nem reiniciado; os novos endpoints precisam de implantação conjunta com o frontend.

## Segurança da execução

- Nenhuma migration, comando de escrita no SQL operacional, exclusão real de contato ou mensagem para cliente foi executada.
- Credenciais, arquivos de sessão, reconexão, adaptadores Baileys e armazenamento de mídia operacional não foram modificados.
- Os builds do backend e do frontend foram executados numa cópia em diretório temporário, sem `.env` real, com testes de banco e WhatsApp simulados. Não foi usado `test:sql`.
- Nenhum serviço operacional foi parado por comando. O Next em desenvolvimento pode recarregar a interface/configuração por seu comportamento normal.
- Os modelos automáticos começam inativos. Mesmo um modelo marcado como ativo não habilita envio. O serviço não possui dependência de um provedor de envio.

## Entrega por etapa

| Etapa | Implementação | Verificação | Pendências, riscos e próxima etapa |
| --- | --- | --- | --- |
| 1 — Menu | Conversas, Envio em Lote, Configurações; submenu com todas as áreas; seleção, recolhimento e links por hash preservados. No celular, três acessos principais e cards para as áreas. | Testes de navegação, navegador e capturas. | Conferir a versão implantada na rede local após atualização controlada. |
| 2 — Configurações e organizações | Página inicial com cards; escolha do tipo antes dos dados; shopping com grupo; outros tipos e hierarquia preservados; busca, situação, tipo e confirmação de inativação. | Navegador com três temas, formulário de grupo/shopping e tamanhos de desktop/celular. | Não foi alterada a estrutura SQL. Importar grupos primeiro, depois shoppings usando os IDs existentes. |
| 3 — Contatos | Formulário em Dados do contato, Organização e Loja; contexto hierárquico compacto; loja textual opcional; busca, filtros, paginação, edição e valores legados preservados; apresentação “Restrições de envio”. | Navegador com filtros combinados, paginação, criação, edição sem alterar valores legados, referências inativas, bloqueios, revogação e histórico. | Regras e histórico de campanhas não foram reescritos. |
| 4 — Permissões | Exclusão existente de contatos protegida por administrador, mesmo se atendente possuir `canDelete`; responsável pode transferir seu atendimento; administrador pode transferir outros; testador continua submetido à lista de consultas autorizadas do backend. | Testes HTTP e de serviço, inclusive transferência por dono, recusa a outro atendente e repetição da mesma transferência. | A nova interface de exclusão definitiva depende da autorização e da política descritas abaixo. O endpoint legado de remoção não recebeu uma nova política de vínculos nesta etapa. |
| 5 — Excel | Importar `.xlsx`, exportar filtros, baixar modelo com referências; revisão editável; validação no servidor; duplicados; confirmação; relatório por linha; conferência novamente na gravação; nenhum `UPDATE` automático. | Leitura/gravação de XLSX reais, preservação de texto, números, acentos e zeros; testes de validação, duplicados, posse da prévia, reversão do lote e repetição da confirmação. | Limites de segurança e persistência descritos abaixo. Validar desempenho com volume representativo em SQL Server de homologação antes da implantação. |
| 6 — Automáticas | Modelos para quatro eventos; criar, editar, visualizar, ativar/desativar e excluir quando inativos; variável `{atendente}`; versão para evitar sobrescrita concorrente; observação dos eventos reais em modo de prévia. | Persistência em diretório temporário; conflitos de versão; variáveis inválidas; testes de eventos; navegador com criação e prévia. | Disparos reais continuam bloqueados. A autorização deve anteceder uma implementação de fila/deduplicação durável e sua habilitação. |
| 7 — Visual | Cards, formulários, contexto, filtros, ações Excel e prévias com cores semânticas, estados, tabelas adaptáveis e navegação móvel. | Testes de temas e contraste; capturas de desktop, tablet e celular; build e lint. | Três avisos de lint já existentes nos testes de navegador de WhatsApp permanecem; não são erros de compilação. |

## Investigação de “1 Insight”

O texto e a cor laranja pertencem ao componente `NextLogo` do Next DevTools instalado. A configuração existente já tinha `devIndicators: false`, mas o componente mantém avisos quando há diagnósticos. A documentação e o código locais distinguem esses diagnósticos dos erros comuns.

A aplicação usa navegação interna por hash e autenticação no cliente. Foi configurado `experimental.instantInsights.validationLevel: "manual-warning"`, conforme o guia instalado em `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`. A validação de desempenho instantâneo passa a acontecer apenas nas rotas que a solicitarem explicitamente. Não foram adicionadas regras CSS para esconder o overlay; erros de compilação, execução e alertas de segurança continuam disponíveis.

A causa específica do aviso que apareceu no navegador do usuário não foi capturada numa sessão autenticada operacional. Não se deve afirmar que ele comprovava falha do WhatsApp, nem ocultar um alerta de segurança caso continue aparecendo. A configuração deve ser conferida na versão implantada.

O encaminhamento `/lan-api`, sua origem local e `allowedDevOrigins` foram preservados.

## Excel: uso e limites

1. Baixe o modelo na tela correspondente. A primeira aba contém as colunas de dados; as demais têm nomes, IDs e situações dos cadastros de referência.
2. Em contatos, preencha `Nome`, `WhatsApp` e `Tipo de contato ID`. `Organização ID`, `Loja` e `Email` são opcionais. Em organizações, preencha `Nome` e `Tipo de organização ID`; shopping exige `Organização pai ID` de um grupo ativo.
3. `Ativo` aceita Sim/Não, true/false ou 1/0; vazio significa ativo. Fórmulas, links e objetos em células de dados são recusados. Valores são tratados como texto, inclusive números com zeros e textos iniciados com `=`.
4. A primeira aba pode ter até 500 registros, 30 colunas e arquivo de até 2 MB. O conteúdo JSON do lote deve ficar em até 90 KB, abaixo do limite de entrada já existente na API; lotes maiores devem ser divididos.
5. Revise as células na tela e valide novamente. Apenas linhas válidas da prévia são elegíveis à confirmação; inconsistências e duplicados são informados e ignorados.
6. A confirmação revalida referências e duplicados dentro da transação. Uma falha interrompe o lote e reverte as gravações daquela transação. Nunca são atualizados registros existentes.
7. A mesma confirmação concluída retorna seu relatório, sem repetir inserções. As prévias são privadas por usuário e duram 15 minutos. Há limite de cinco prévias por usuário e cem por processo; reiniciar o processo elimina prévias e relatórios temporários.
8. Falha de conexão perto do commit é tratada conservadoramente como resultado incerto. Não há repetição automática: consulte o relatório e confira os cadastros antes de preparar outro lote.

Duplicados de contato são identificados pelo telefone normalizado com a regra existente do projeto. Organizações usam nome normalizado, tipo e vínculo pai. A exportação usa uma lista explícita de campos de cadastro, sem usuários, senhas, tokens ou dados de autenticação. Contatos exportam todos os resultados dos filtros, além da página atual; organizações exportam os resultados visíveis dos filtros de busca, situação e tipo. As abas de referência do modelo contêm o catálogo necessário aos vínculos.

A biblioteca [ExcelJS](https://github.com/exceljs/exceljs) está fixada em `4.4.0` no frontend e é carregada quando uma ação de Excel é usada. O lockfile foi atualizado. Não foi executado `npm ci` sobre as dependências da instância operacional; a implantação deve usar o lockfile em um diretório preparado para isso.

O importador adquire bloqueios breves nas tabelas envolvidas para conferir duplicados e gravar o lote. Isso evita uma corrida entre conferência e inserção, mas pode aguardar ou bloquear outras escritas durante a confirmação. O teto de 500 registros reduz essa exposição; volume maior exige medição e outro desenho, não aumento indiscriminado do limite.

## Mensagens automáticas: eventos e proteções para revisão

| Modelo | Evento observado | Condições |
| --- | --- | --- |
| Aguardando | Primeira mensagem direta ao criar uma conversa, ou mensagem direta que reabre atendimento finalizado | Mensagem recebida, origem `live`, conversa individual, registro novo e transação confirmada. Histórico e mensagens próprias não geram esse evento. |
| Iniciado | `claim` concluído | Transição válida de aguardando para em atendimento. |
| Transferido | `assign` concluído | Em atendimento; responsável atual ou administrador; destino ativo e permitido; destino diferente do responsável atual. |
| Finalizado | `finish` concluído | Em atendimento; responsável atual ou administrador. |

- As observações são emitidas após o commit, usando o barramento existente. Elas não alteram o mecanismo Baileys.
- Mensagens com a mesma chave já registradas não geram outro evento de aguardando. Uma transferência repetida para o mesmo usuário é recusada.
- Reconexão e mudança de conexão não são gatilhos. Reabertura manual não envia aviso de aguardando.
- O observador mantém até 200 observações recentes em memória e ignora uma chave já observada. Isso é diagnóstico; **não constitui garantia durável de envio único**.
- Há apenas um modelo ativo por evento. Excluir exige modelo inativo e versão atual. A única variável disponível é `{atendente}`; variáveis desconhecidas são recusadas.
- Os modelos são salvos atomicamente em `backend/data/application-settings/automatic-messages.json`, ou no diretório definido por `APP_SETTINGS_DIRECTORY`. O local padrão está ignorado no Git. Incluir esse diretório no backup da aplicação; não misturá-lo com credenciais WhatsApp. A persistência pressupõe uma única instância gravadora.
- O retorno da API informa `dispatchEnabled: false`. Não há flag que possa habilitar envios acidentalmente: este serviço não recebe um adaptador de envio.

**Autorização futura:** antes de habilitar disparos reais, aprovar os gatilhos acima, texto, destinatários e conexões de teste. Ainda será necessário implementar e revisar uma fila persistente com identidade única por transição, recuperação após reinício, tratamento de resultado incerto, seleção do atendente correto e política de falha sem repetição cega. Essa parte não foi habilitada nem testada com clientes.

## Exclusão definitiva: análise e proposta pendente

O método legado `ContactsService.remove` remove o registro diretamente. O guard agora restringe sua rota a administradores; o método legado não foi expandido nesta entrega.

Vínculos encontrados no código:

- `whatsapp_conversations.contactId`: FK com `ON DELETE SET NULL`. As conversas e mensagens sobrevivem, mas a associação ao contato se perde.
- `contact_campaign_preferences.sourceContactId`: referência sem FK de contato. Telefone/identidade e histórico de restrições devem sobreviver à remoção do cadastro, conforme o funcionamento existente.
- `recipient_selection_sources.contactId`, snapshots de seleção e demais snapshots: histórico independente do cadastro. Remover o contato não pode apagar, reescrever ou invalidar silenciosamente esses registros.
- `contact_campaign_preference_events`: trilha de bloqueio/revogação, com estados históricos. Não deve ser apagada para permitir uma exclusão.
- Não foi encontrada uma trilha dedicada de auditoria para exclusão definitiva de contatos. O backend de disparo de campanhas não está completo nesta árvore; vínculos futuros também precisam ser considerados.

**Proposta para autorizar separadamente:** disponibilizar o botão apenas ao administrador; exigir confirmação com nome do contato; revalidar a permissão e os vínculos sob transação; recusar exclusão quando houver conversa, preferência, fonte de seleção ou vínculo desconhecido; registrar auditoria durável de autor, horário, motivo e identificação do registro antes da remoção. Definir retenção dos snapshots sem alterar o histórico de restrições. Se exigir nova tabela de auditoria, preparar e aprovar uma migration específica antes de qualquer aplicação ao banco.

Nenhum botão novo de exclusão definitiva foi disponibilizado e nenhuma exclusão operacional foi executada. Até essa autorização, a opção segura para o usuário continua sendo inativar.

## Arquivos desta implementação

Frontend:

- `components/app-shell.tsx`, `components/section-navigation.ts`, `next.config.ts`, `app/globals.css`.
- `components/settings/settings-home.tsx`, `settings-screen.tsx`, `settings-entity-modal.tsx`, `automatic-messages-screen.tsx`.
- `components/contacts/contacts-screen.tsx`, `contact-form-modal.tsx`, `contact-list.tsx`, `campaign-preferences-modal.tsx`.
- `components/whatsapp/conversation-attendance.ts`, `conversation-attendance-controls.tsx`.
- `components/excel-actions.tsx`, `services/excel.ts`, `services/exchange-presentation.ts`.
- `package.json`, `package-lock.json`, `tests/excel.test.mjs`, `tests/section-navigation.test.mjs`, `tests/browser-contacts.mjs`.

Backend e documentação:

- `src/app.module.ts`, `src/automatic-messages/automatic-messages.module.ts`, `src/data-exchange/data-exchange.module.ts`, `src/events/domain-events.ts`.
- `src/contacts/contacts.controller.ts`, `src/users/users.module.ts`.
- `src/whatsapp-conversations/whatsapp-attendance.service.ts`, `whatsapp-conversations.controller.ts`, `whatsapp-conversations.module.ts`, `conversation-message-records.service.ts`.
- `test/modernization.test.cjs`, `test/conversations.test.cjs`, `test/registrations.test.cjs`, `test/helpers/conversations-fixture.cjs`, `package.json`, `.env.example`.
- `.gitignore` e este relatório.

## Validação final

- Frontend: typecheck aprovado; 79 testes automatizados aprovados; lint sem erros, com três avisos anteriores nos testes de WhatsApp.
- Build de produção: aprovado na cópia isolada, com as rotas `/`, `/login` e `/_not-found` prerenderizadas.
- Navegador: fluxo de contatos/organizações/restrições aprovado em três temas e larguras 1440, 768 e 390 px; cards de Configurações e criação/prévia de modelos automáticos também aprovados. Capturas inspecionadas visualmente.
- Backend: typecheck e **199 testes aprovados** na execução completa final. Os sete testes novos, os 17 testes de conversas e os 18 testes de pairing/reconexão também passaram nas verificações isoladas.
- Uma execução anterior com cargas de build/testes simultâneas sofreu timeouts nos testes de pairing; também revelou a necessidade de atualizar o simulador transacional para expor `manager.query`, usado na checagem de perfil. O simulador foi corrigido; os grupos isolados e uma nova execução completa passaram. Nenhum ajuste foi feito no transporte operacional para contornar esses resultados.

Evidências locais ficam em `artifacts/modernizacao/`, sem credenciais ou dados operacionais.

## Próxima etapa

Revisar a entrega e preparar implantação conjunta em diretório separado, com o lockfile e backup habitual. Os novos endpoints dependem da versão atualizada do backend; não executar migrations para esta entrega. Confirmar cadastros, acesso LAN e sessões numa janela controlada. Tratar exclusão definitiva e disparos reais como decisões específicas, conforme as propostas acima.
