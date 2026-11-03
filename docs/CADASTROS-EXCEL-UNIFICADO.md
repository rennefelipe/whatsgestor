# Cadastros, Excel e Configurações — 30/10/2026

Esta atualização substitui a experiência de Excel descrita no relatório anterior por uma planilha única, sem IDs de cadastro. O escopo ficou restrito a cadastros, importação/exportação, navegação de Configurações e testes.

## O que foi implementado

- Card **Importação e exportação**, com modelo, importação e exportação centralizados. Os botões duplicados foram retirados de Contatos e Organizações.
- Arquivo `.xlsx` com uma única aba **Cadastros** e oito colunas: Grupo, Organização / Shopping, Loja, Responsável, WhatsApp, Tipo de contato, E-mail e Ativo. O modelo tem orientações curtas nos cabeçalhos, sem linhas fictícias de cadastro nem abas técnicas.
- Resolução dos vínculos por nomes e telefone normalizado. IDs continuam internos; nenhum ID técnico é exigido nas células ou incluído na exportação.
- Prévia com contagens, ações previstas por linha, campos editáveis, conflitos e relatório final. É possível retirar uma linha **do lote em revisão**, sem apagar nenhum registro do sistema.
- Confirmação exclusiva de administradores, protegida na rota e no serviço. Atendentes podem revisar e exportar; as restrições já existentes de Testador continuam aplicadas.
- Configurações com os onze cards solicitados e apenas os três itens principais na navegação lateral. Cada área tem **Voltar às configurações**. Telas e lógica de WhatsApp não foram alteradas.
- Organizações com expansão/recolhimento individual e geral, contagem de vinculadas, busca, situação e tipo. Os ancestrais necessários aos resultados filtrados aparecem como contexto. Organizações independentes e vínculos legados não são ocultados nem corrigidos automaticamente.
- Ao retornar a Contatos, a lista é recarregada para refletir cadastros importados e alterações de organizações.

## Como funciona a importação

1. Baixe o modelo, mantenha os oito cabeçalhos e preencha apenas os campos aplicáveis.
2. Para cadastrar somente grupo/organização, deixe os campos de contato vazios. Loja isolada não cria entidade própria nem contato vazio.
3. Para um contato independente, deixe Grupo e Organização / Shopping vazios. Responsável, WhatsApp e Tipo de contato são necessários quando a linha contém dados de contato.
4. Grupo + Organização / Shopping identifica o vínculo de um shopping. Nomes iguais em grupos diferentes permanecem distintos.
5. Uma organização existente e identificada sem ambiguidade mantém seu tipo e sua hierarquia. Para uma organização **nova sem grupo**, escolha na revisão um tipo já configurado; não é necessário informar IDs. Essa escolha vale para as novas organizações independentes daquele lote.
6. Tipos estruturais Grupo empresarial/Shopping só são propostos quando o significado é inequívoco e não há um tipo equivalente configurado. Tipos ambíguos ou inativos exigem revisão; tipos personalizados não são inventados.
7. Nomes são comparados em NFC, ignorando maiúsculas/minúsculas e espaços excedentes. Tipos de contato são reutilizados por nome ou propostos para criação.
8. Contatos são identificados por telefone normalizado, organização e loja normalizada. Um telefone já usado com vínculo diferente, vários candidatos equivalentes ou linhas contraditórias são tratados como conflito. O importador não muda organização, loja ou formatação de telefone de um contato existente.
9. Um contato identificado com segurança pode ter responsável, tipo de contato, e-mail e situação atualizados, sempre exibidos na prévia. E-mail e situação vazios preservam os valores existentes. Novos registros começam ativos quando Ativo estiver vazio.
10. **Qualquer linha com erro bloqueia o lote inteiro.** Corrija/retire a linha da revisão e valide novamente. Nenhum cadastro é gravado antes de **Confirmar importação**.

## Transação e concorrência

A prévia é somente leitura e pertence ao usuário que a gerou. Antes de gravar, o servidor bloqueia as tabelas de cadastros numa ordem fixa e recalcula o plano. Se cadastros relevantes mudaram desde a prévia, a confirmação é recusada e é necessário revisar novamente. Não há mudança silenciosa das ações aprovadas.

Criações de grupos, organizações, tipos e contatos, além das atualizações previstas, acontecem na mesma transação, usando os serviços de cadastro existentes. Uma falha reverte o lote, inclusive registros auxiliares criados antes dela. Não há operação automática de exclusão.

A mesma confirmação concluída retorna o relatório, sem repetir gravações. Um resultado de commit incerto bloqueia a repetição automática: consulte o relatório e confira os cadastros antes de preparar outro lote.

As prévias/relatórios ficam em memória por 15 minutos, com limites de cinco por usuário, cem por processo e 30.000 linhas acumuladas. Editar e validar uma prévia substitui a anterior. Reiniciar o processo elimina as prévias temporárias, mas não os cadastros confirmados.

## Exportação e limites

- A exportação tem o mesmo formato da importação. Inclui linhas exclusivamente organizacionais para preservar grupos, organizações sem contatos e suas situações.
- Busca, organização e situação podem ser filtradas na central. Os vínculos organizacionais necessários aos contatos selecionados acompanham o arquivo, com sua situação original, mesmo quando servem apenas de contexto ao filtro.
- Cadastros legados ou nomes ambíguos são sinalizados para revisão na reimportação. Hierarquias não são achatadas nem reatribuídas silenciosamente.
- Telefones e textos são gravados como valores literais, preservando acentos, zeros e textos iniciados com `=`. Células com fórmulas, links ou objetos são recusadas na leitura.
- Limite de 10.000 linhas e 8 MB por arquivo/conteúdo de revisão. A exportação também verifica esses limites para manter a compatibilidade; arquivos maiores exigem filtros mais específicos, sem truncamento silencioso.
- A conferência do catálogo é limitada a 50.000 registros por entidade. Não são usados catálogos parciais.
- A revisão usa paginação de 50 linhas. O envio de seu conteúdo usa upload multipart com limite próprio, sem alterar o parser global, as rotas operacionais ou variáveis de ambiente.
- Os bloqueios transacionais podem aguardar outras escritas. Desempenho com lotes grandes deve ser medido em SQL Server de homologação; os testes desta entrega não escreveram no banco operacional.

## Preservação do WhatsApp

Não foram modificados Baileys, adaptadores de mensagens, sessões, autenticação, QR Code, reconexão, políticas de envio, variáveis `WHATSAPP_INTEGRATION_*`, conversas, atendimento, transferência ou finalização.

Foi registrado um conjunto de **93 hashes antes da edição**, cobrindo os arquivos de integração, mensagens, conversas, autenticação/configuração do backend, componentes/serviços de WhatsApp do frontend, configuração Next e arquivos `.env*`. A conferência final não encontrou alterações nesses arquivos. Não foram executados reinícios de serviços, migrations, alterações de esquema, envios reais ou gravações no SQL operacional. Os builds foram feitos numa cópia temporária sem `.env` real.

## Arquivos desta atualização

Backend:

- `src/data-exchange/data-exchange.module.ts`: prévias, confirmação administrativa, upload de revisão, exportação e revalidação transacional.
- `src/data-exchange/registration-plan.ts`: resolução de nomes, ações previstas, conflitos e identificação segura dos contatos.
- `src/data-exchange/registration-export.ts`: exportação legível com vínculos e filtros.
- `test/registration-exchange.test.cjs`, `test/helpers/registrations-fixture.cjs`, `test/modernization.test.cjs` e `package.json`: testes do formato novo, servidor isolado e inclusão na suíte. Os testes de Excel antigos foram substituídos; os testes remanescentes de mensagens/atendimento não tiveram sua lógica alterada.

Frontend:

- `components/app-shell.tsx`, `components/section-navigation.ts`, `components/settings/settings-home.tsx`: navegação principal, cards e retorno.
- `components/settings/settings-screen.tsx`, `components/settings/organization-tree.ts`: hierarquia recolhível e filtros.
- `components/settings/data-exchange-screen.tsx`, `components/excel-actions.tsx`, `services/api/data-exchange.ts`: central, prévia, confirmação e relatório.
- `services/excel.ts`: aba Cadastros, modelo e leitura/gravação do XLSX. O helper obsoleto `services/exchange-presentation.ts`, que exportava IDs, foi removido.
- `components/contacts/contacts-screen.tsx`: retirada dos botões duplicados e atualização da listagem ao voltar.
- `app/globals.css`: apresentação da central, revisão responsiva e hierarquia compacta.
- `tests/excel.test.mjs`, `tests/organization-tree.test.mjs`, `tests/section-navigation.test.mjs`, `tests/browser-contacts.mjs`: formato, navegação, hierarquia e testes de navegador.

## Validação

- **25 testes do backend aprovados**: 14 cenários da importação/exportação nova e 11 de regressão dos cadastros existentes. Incluem HTTP autenticado, upload real de revisão em memória, administrador/atendente, repetição, rollback, nomes ambíguos, tipos, hierarquia e exportação seguida de reimportação.
- **84 testes do frontend aprovados**, incluindo XLSX real com uma aba, oito colunas, ausência de IDs, fórmulas recusadas, arquivo maior que o limite antigo de 500 linhas, filtros e hierarquia.
- Build do backend e build de produção do frontend aprovados em cópia isolada. Lint sem erros; permanecem três avisos anteriores nos testes de navegador de WhatsApp, cujos arquivos não foram alterados.
- Navegador com componentes reais e transporte simulado: cards/retorno, três itens na navegação, expansão/recolhimento, filtros, download de XLSX, revisão/correção, confirmação administrativa e bloqueio para atendente. Capturas de desktop/celular inspecionadas; regressões de cadastros também verificadas nos três temas.

Evidências locais: `artifacts/cadastros-unificados/` (logs, capturas e conferência dos hashes).

## Pendências

A implantação conjunta da versão atualizada do frontend e backend depende de autorização para atualizar os serviços em execução. Nenhum deploy/reinício foi realizado nesta entrega. A validação com SQL Server real deve ocorrer em ambiente de homologação autorizado; nenhuma migration é necessária para esta implementação.
