# WhatsGestor — preparação do candidato v1.0.0

Data: 26/10/2026. **Preparado para revisão; a publicação como versão estável permanece pendente.** Não foram criados commit, tag, release ou push. Instalação SQL limpa e implantação Windows/IIS não foram executadas; não são declaradas validadas.

## Resultado por fase

| Fase | Estado | Evidência / limite |
|---|---|---|
| 1. Auditoria/preservação | Validada | Inventário e cópia recuperável de 236 arquivos, com SHA-256, antes das edições |
| 2. Funcionalidades protegidas | Validada em testes isolados | Áudio backend e player idênticos à cópia; ajuste mínimo de sincronização da seleção, com regressão reproduzida |
| 3. backend-backup | Concluída | 113 fontes exclusivos e 15 arquivos de migration/spec históricos; mantida local, excluída da publicação |
| 4. Limpeza segura | Concluída | Classificação A/B/C/D e exclusão da distribuição por ignore/lista permitida; nenhum arquivo local apagado |
| 5. Banco/migrations | Concluída offline; validação real pendente | Baseline TypeORM, plano/lock/histórico/bootstrap; sem DDL no banco atual |
| 6. Configuração | Concluída | Exemplos fictícios e documentação; configurações reais preservadas |
| 7. Windows/IIS | Concluída em documentação; implantação pendente | Guias e dois exemplos de proxy; nenhum serviço/binding/ACL operacional alterado |
| 8. Documentação | Concluída | README e seis guias de instalação/operação, auditoria e este relatório |
| 9. Git/GitHub | Concluída na preparação; publicação pendente | Versões 1.0.0, ignore e exportação; índice/histórico não modificados |
| 10. Testes | Validada no escopo abaixo | Builds, typechecks, lint e testes isolados aprovados; limitações explícitas |
| 11. Entrega | Concluída | Relatório, fontes, ferramentas e instruções para revisão manual |

Não existe autorização identificada para criar um banco isolado nesta sessão. Essa operação foi preservada como pendência, sem bloquear a preparação offline nem usar o banco operacional como substituto.

## Preservação e alteração funcional mínima

Cópia original: `C:\Projetos\whatsgestor-release-backups\20261026-163101\code`, com `manifest.json` ao lado. Os 236 arquivos somam 1.738.215 bytes; cada cópia foi comparada por SHA-256 antes das edições. A cópia não contém dependências, dados privados ou banco e não substitui backup operacional.

`backend/src/whatsapp-integration/outbound-adapter.ts` e `frontend/components/whatsapp/conversation-media.tsx` permanecem byte a byte iguais à cópia original. Não foi editada conversão, MIME OGG/Opus, PTT, transporte, protocolo, eventos do player ou lógica de autenticação/recebimento.

O teste novo reproduziu dados antigos no painel quando a conversa selecionada mudava de status e saía do filtro. Em `whatsapp-conversations-screen.tsx`, somente a escolha do objeto foi ajustada: procura a mesma ID também nos itens recebidos antes de conservar a referência anterior. Se a conversa sair da página, a seleção continua aberta. Quando ela retorna no resultado, recebe status, atribuição e contato atualizados. Não há busca automática adicional de uma conversa ausente da página: seus dados só podem ser atualizados quando recebidos novamente ou pelas ações já existentes. Nenhuma alteração visual/CSS.

Não houve gravação no banco atual, envio WhatsApp, pareamento, reset, exclusão de sessão, troca de master.key, alteração de .enc/.env real ou comando para interromper/reiniciar serviços. Os testes escreveram somente em cópias isoladas e diretórios temporários próprios. Na conferência final, GET local em 3001/health não respondeu; isso não comprova o estado da sessão em outra configuração. Não foi feita tentativa de iniciar/reconectar a aplicação.

## Arquivos criados e modificados nesta preparação

Criados ou reintroduzidos como novos exemplos seguros:

- `README.md`; `backend/.env.example`; `frontend/.env.example`.
- `docs/INSTALACAO-WINDOWS.md`, `BANCO-DE-DADOS.md`, `CONFIGURACAO.md`, `DEPLOY-IIS.md`, `BACKUP-RESTAURACAO.md`, `ATUALIZACAO.md`.
- `docs/release-v1/AUDITORIA-INICIAL.md` e este relatório.
- `backend/src/database/data-source.ts` (substitui ausência local anterior; não restaura a configuração legada).
- `backend/src/database/migrations/1793016000000-InitialSchema.ts` e `schema-v1.ts`.
- `backend/scripts/database.cjs`, `schema-audit.cjs`, `generate-baseline.cjs`, `sql/create-clean-database.sql`.
- `backend/test/release-install.test.cjs`, `release-audio.test.cjs`; `frontend/tests/release-regressions.test.mjs`.
- `scripts/prepare-release.cjs` e `prepare-release.test.cjs`.
- `deploy/iis/api.web.config.example` e `frontend.web.config.example`.

Modificados em relação à cópia inicial:

- `.gitignore` e `frontend/.gitignore`: exclusões de dados operacionais e exceções para exemplos de ambiente.
- `backend/package.json`: comandos explícitos de manutenção/testes; `backend/package-lock.json`: apenas versão do pacote raiz alinhada a 1.0.0.
- `frontend/package.json` e `frontend/package-lock.json`: versão 1.0.0, comandos typecheck/test; `frontend/README.md`: instruções do projeto.
- `frontend/components/whatsapp/whatsapp-conversations-screen.tsx`: sincronização mínima descrita acima.

Nenhuma versão/resolução de dependência mudou nos lockfiles; comparação estrutural confirmou igualdade após desconsiderar somente a versão do pacote raiz. Não houve npm install/update, modificação de node_modules ou build sobre os dist/.next da aplicação atual. A validação reaproveitou dependências já instaladas, por links no backend/testes e cópia física no build frontend. Uma instalação independente por npm ci no servidor novo ainda precisa ser validada.

## Limpeza e backend-backup

Nenhuma remoção local proposta foi executada. `backend-backup` possui código exclusivo, migrations históricas, .env, certificados e logs. Não foi considerado dispensável como evidência histórica; nenhum import do backend atual exige essa pasta. Ela fica fora da distribuição, assim como artifacts, backups .bak*, builds e dependências. Não confundir essa exclusão com backup operacional SQL/estado.

Itens A/B/C/D constam da auditoria inicial. Scripts/arquivos desconhecidos ou históricos permanecem locais. Os caminhos permitidos da ferramenta de exportação não abrangem relatórios operacionais de backend/docs, arquivos locais de teste SQL, sessões, artefatos ou o backend antigo. Migrations, SQL de instalação e exemplos permanecem incluídos. Testes confirmam rejeição de fontes ligadas por links e exclusão de arquivos privados.

## Banco e instalação em outro servidor

Catálogo atual inspecionado exclusivamente com SELECT: 18 tabelas, 155 colunas e 48 restrições catalogadas. Há tabelas legadas recipient_selection_* e histórico antigo migrations. Nenhuma delas foi alterada. Evidência de catálogo sem valores dos dados está fora do repositório.

A baseline nova congela 12 tabelas operacionais e 47 instruções, com PKs, FKs, índices, CHECKs, defaults e cinco configurações de exibição. Utiliza o mesmo mecanismo TypeORM; não inicia na aplicação. O executor mantém histórico dedicado para instalações novas, transação e lock de manutenção; recusa schema existente não adotado e histórico desconhecido. Não é uma migration de atualização automática do banco legado.

Procedimento: provisionar banco vazio exclusivo pelo DBA; criar arquivo de conexão restrito fora do projeto; compilar backend; executar db:plan com confirmação de nome; revisar; executar db:migrate com --apply; repetir plano; criar primeiro administrador por db:bootstrap usando senha temporária exclusiva. A segunda criação de administrador é recusada. Ver comandos e limites em [Banco de dados](../BANCO-DE-DADOS.md).

Não há senha administrativa fixa, seed com dados reais, DROP/TRUNCATE ou down destrutivo automático. A sintaxe DDL e os efeitos em SQL Server vazio continuam sem validação real. Adoção da instalação legada requer reconciliação específica de schema/histórico antes de qualquer manutenção autorizada.

## Testes e evidências

Logs e cópias de validação ficam em `C:\Projetos\whatsgestor-release-backups\20261026-163101`, fora do conjunto publicável:

| Verificação | Resultado |
|---|---|
| Backend npm test, incluindo build | 163 aprovados, zero falhas/pulos; exit 0; backend-tests.log |
| Backend typecheck | Aprovado; backend-typecheck.log |
| Testes específicos de release, versão final | 6 aprovados, zero falhas; release-tests-final.log |
| Frontend npm test | 66 aprovados, zero falhas/pulos; frontend-tests.log |
| Frontend typecheck | Aprovado; frontend-typecheck.log |
| Frontend build de produção | Aprovado; frontend-build-physical.log |
| ESLint frontend inteiro exportado | Exit 0; zero erros, três avisos preexistentes em scripts de navegador; frontend-lint.log |
| Chrome headless / recebimento simulado | Aprovado; polling, prévia e filtros; browser-receive.log |
| Chrome headless / envio simulado | Aprovado; política, pendentes, UUID estável e prevenção de repetição; browser-send.log |
| Exportação e exclusão de privados | 2 testes aprovados; export-tests.log |

Os seis testes específicos incluem cinco verificações de instalação/CLI/bootstrap e uma de áudio real por FFmpeg com silêncio sintético, adapter original e socket simulado. O mesmo pedido repetido produz um único envio simulado; payload convertido é OggS/OpusHead, MIME audio/ogg; codecs=opus e ptt=true. A suíte completa de 163 contém as verificações de instalação; a execução específica final acrescenta a regressão de áudio e confirma o bootstrap após ajuste do mock. Não somar esses números como testes todos distintos.

Os dois novos testes frontend executam os callbacks extraídos do fonte real: seleção preservada/atualizada e duração de áudio indefinida/zero seguida de duração finita. O teste de seleção falhou antes da alteração mínima e passou depois. Os testes existentes cobrem autenticação, storage, 515, recebimento, persistência simulada, deduplicação, mídia e envio com confirmação/política.

O primeiro build isolado falhou porque Turbopack não aceita a junction de node_modules fora de sua raiz. Foi repetido sem alteração do projeto, com cópia física das mesmas dependências, e passou. Um teste intermediário de bootstrap falhou por ausência de Buffer no contexto VM do teste; o mock foi corrigido e a execução final passou. Não houve correção do adapter/player para satisfazer testes.

A verificação dos links da exportação detectou que a regra de pastas backup-* também excluía o guia BACKUP-RESTAURACAO.md. A regra passou a reconhecer esse prefixo somente em diretórios, e o guia foi incluído na regressão do exportador. A exportação final está em `C:\Projetos\whatsgestor-release-backups\20261026-163101\release-review-final`, com manifesto SHA-256. Cópias intermediárias de validação não são o pacote final.

Não foi executado ESLint backend: o pacote não possui configuração/comando correspondente. TypeScript e testes fazem a verificação disponível. Testes SQL reais e de todos os fluxos WhatsApp/IIS não foram executados. Browser QA usa React e adaptadores reais com API simulada, exige Chrome Windows e módulos transitivos já instalados; não substitui homologação HTTP/IIS nem recebimento/envio real.

## Segurança, Git e publicação

Branch main, HEAD 9f3a86e; índice sem alterações staged. Modificações/exclusões/não rastreados anteriores permanecem preservados. Existem referências internas refs/codex além de main; não copiar .git nem usar push --mirror como publicação. Nenhum comando de reset/clean/checkout foi executado.

Varredura por igualdade dos segredos atuais não encontrou correspondências no candidato nem nos objetos alcançáveis pelas refs examinadas. A varredura de padrões em 2.051 blobs encontrou ocorrências de literais em fixtures, código gerado e artefatos históricos; não encontrou padrão de chave privada ou token de serviço. No candidato revisado, os 16 alertas de atribuição correspondem a fixtures de teste e ao sentinela de entrada inválida da autenticação, sem credencial operacional identificada. Não foram registrados valores de segredos nos relatórios. Essas verificações têm cobertura limitada e não certificam todo tipo de dado privado ou segredo.

O índice atual não rastreia .env real, .enc ou master.key; exemplos devem ser versionados. Regras foram verificadas com git check-ignore: exemplos/migrations/SQL de instalação não são excluídos; dados operacionais são. O histórico ampliado não é aprovado para publicação só por isso. Se surgir segredo em revisão adicional, interromper publicação, revogar/rotacionar e tratar histórico com autorização. Não reescrever refs automaticamente.

O caminho recomendado é uma exportação nova, sem histórico, por `node scripts/prepare-release.cjs --destination <diretorio-vazio-fora-do-projeto>`. Revise manifesto/hash e todo o conteúdo, repita varredura/testes e siga [Atualização/publicação manual](../ATUALIZACAO.md). Não publicar artifacts, backend-backup, .env reais, sessões, estado/chaves, certificados, backups SQL, mídias, node_modules ou builds. Não criar tag final antes de aprovação.

## Pendências e riscos antes da versão estável

- Validar instalação e reexecução em SQL Server novo autorizado, bootstrap/login, constraints, falha transacional e permissões mínimas.
- Validar npm ci e ferramentas externas em servidor novo; dependências existentes foram reaproveitadas, sem auditoria de vulnerabilidades de dependências nesta tarefa.
- Homologar Windows/IIS/HTTPS, streaming, uploads, serviço persistente, encerramento gracioso e restauração coerente SQL/estado/mídia.
- Revisar licença/distribuição e o conteúdo final escolhido pelo proprietário; não foi presumida licença global a partir de um package.json.
- Manter em separado a adoção do schema legado; não executar baseline no ambiente atual.
- Teste manual autorizado de recebimento, um envio, áudio gravado/duração e mídia após implantação; nenhum envio real foi feito aqui.
- Integração depende de Baileys rc14 e dos servidores WhatsApp. Testes locais aprovados não garantem disponibilidade externa nem equivalem a homologação operacional.

Não é necessário reiniciar o backend atual para produzir/revisar este pacote: seu código funcional não foi alterado. A sincronização de seleção exige carregar um novo build frontend em implantação autorizada. Nenhum serviço atual foi reiniciado para isso. A promoção para estável e a publicação permanecem pendentes dessas validações e da autorização do operador.
