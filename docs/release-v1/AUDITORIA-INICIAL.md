# Auditoria inicial — candidato WhatsGestor v1.0.0

Data: 26/10/2026. Esta preparação não autoriza publicação nem alterações no banco ou serviços atuais.

## Preservação

Antes das edições, 236 arquivos (1.738.215 bytes) foram copiados e comparados por SHA-256 em `../whatsgestor-release-backups/20261026-163101/code`. O manifesto e o estado inicial do Git estão ao lado dessa cópia, fora do repositório. Dependências, builds, sessões, mídias e `.env` reais foram excluídos dessa cópia de código. A cópia não substitui backup operacional do banco e do armazenamento privado.

## Estado encontrado

- Branch `main`; um commit anterior, `9f3a86e`. Há numerosas modificações, exclusões e arquivos não rastreados anteriores à tarefa. Nenhuma foi descartada, adicionada ao índice ou restaurada automaticamente.
- Backend NestJS/TypeORM/SQL Server, versão de pacote 1.0.0. Frontend Next 16.4.0/React 19.3.0, pacote ainda 0.1.0. Baileys fixado em 7.0.0-rc14.
- Código atual em `backend/src` e `frontend`. Testes atuais em `backend/test` e `frontend/tests`; scripts SQL de diagnóstico em `backend/scripts`.
- O backend declara 11 entidades; `whatsapp_connections` é acessada por SQL parametrizado e não tem entidade no conjunto atual. `synchronize`, `migrationsRun` e `dropSchema` são false.
- A antiga cadeia TypeORM está em `backend-backup/src/database`; os arquivos correspondentes foram excluídos do backend ativo antes desta tarefa. Não existe executor de migrations ativo no pacote atual.
- `backend-backup` contém código antigo exclusivo, migrations históricas, dependências, certificados, `.env`, logs e resultados operacionais. Não é apenas duplicação byte a byte. Nenhum import atual depende dela; a referência encontrada em `backend/OPERACAO.txt` é histórica. Manter a pasta local e excluir da publicação; conservar o histórico de migrations como evidência local, sem restaurar aplicações antigas.

## Classificação da limpeza

| Classe | Itens | Ação |
|---|---|---|
| A — necessário | Fontes atuais, lockfiles, testes, configuração de build | Preservar e incluir no conjunto revisado |
| B — gerado | node_modules, .next, dist, coverage, caches | Ignorar; validar builds em cópia isolada |
| C — cópia histórica comprovada | Backups de fontes `.bak*`, `backup-audio-*`, artefatos de intervenções | Excluir da publicação; não apagar localmente |
| D — operacional/desconhecido | backend-backup, relatórios/scripts históricos, dados privados | Manter local; auditar referências e não publicar |

## Áreas funcionais protegidas

O adapter de saída contém conversão por FFmpeg/libopus para `audio/ogg; codecs=opus` e `ptt: true`. Não será editado. O player trata loadedmetadata/durationchange e busca duração em áudio com duração inicialmente indefinida: preservar. A reconciliação de conversas já preserva a seleção; verificar regressões sem refatoração ampla. Não alterar protocolo, identidade visual, sessões ou autenticação.

## Segurança e limites

Os `.env` reais não estão rastreados no índice atual; `.env.example` antigo está rastreado, porém ausente da árvore atual. `.gitignore` ainda não exclui `artifacts`, `backend-backup`, variações `.bak-*`, certificados e estado cifrado suficientemente. Apenas ignorar não limpa histórico. A varredura de valores secretos conhecidos e do conjunto de publicação terá resultado separado, sem divulgar valores.

Não há banco isolado autorizado identificado nesta sessão. A instalação limpa pode ser preparada e testada offline, mas não será declarada validada em SQL Server vazio sem execução correspondente. Migrations não serão executadas contra o banco atual. GitHub, tags, IIS e serviços Windows não serão alterados automaticamente.
