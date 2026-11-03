# Atualização e publicação privada

## Atualizar sem perda de dados

1. Leia migrations/notas e valide a versão em SQL de homologação exclusivo, com integração WhatsApp desabilitada. Esta preparação ainda não homologa banco vazio.
2. Prepare diretório de versão novo com lockfiles, testes e builds, fora de `dist`/`.next` servidos por processos ativos.
3. Faça backup consistente do SQL, configurações, mensagens automáticas privadas, mídia e estado/chave WhatsApp. Teste a restauração conforme [backup](BACKUP-RESTAURACAO.md). Não envie esses arquivos ao GitHub.
4. Confira `db:plan` com arquivo privado explícito e confirmação exata do alvo. Banco versionado recebe somente migrations pendentes revisadas. Se tabelas de seleção já existirem sem histórico correspondente, a migration recusa o alvo: analise schema/histórico antes de alterar. Banco legado sem histórico exige plano próprio; não marcar baseline como executada para contornar proteção.
5. Para alvo igual ao `.env` existente, o CLI exige `--maintenance-approved`. Use somente em manutenção realmente autorizada, depois de conferir backup, banco, versão e compatibilidade. Esta preparação não autoriza nem executa manutenção no ambiente atual.
6. Preserve `.env`, diretórios privados, chaves e configurações. Promova artefatos após homologação e reinicie apenas na janela autorizada. Não executar segunda instância usando o mesmo estado WhatsApp.
7. Confira readiness, login/perfis, cadastros/Excel, persistência e funcionalidades autorizadas. Envio/pareamento dependem de autorização do operador. Código anterior só pode voltar se compatível com schema; caso contrário, restaure conjunto revisado. Não fazer downgrade destrutivo automático.

## Publicação no GitHub

Destino **privado**: `rennefelipe/whatsgestor`. O primeiro push exige autorização expressa após revisão. Não usar `--force`, `--mirror` ou publicar todas as refs.

A árvore local contém alterações anteriores, dados ignorados e refs internas de ferramentas. `.gitignore` não limpa histórico. Revise objetos Git e a exportação; não usar `git add .` na instalação ativa.

```powershell
node scripts/prepare-release.cjs --destination C:\Releases\whatsgestor-review
node --test scripts/prepare-release.test.cjs
```

Destino vazio e fora do projeto. A exportação inclui fontes, testes, documentação, deploy, manifests npm e `.env.example`; grava `RELEASE-MANIFEST.json` com SHA-256. Não copia `.git`, dados, sessões, ambientes reais, logs, bancos/backups ou builds. O telefone fornecido como exemplo no pedido original é substituído por valor fictício apenas em quatro arquivos de exemplos/testes da cópia; a instalação operacional não é editada.

Prepare commit em cópia Git isolada, preservando somente ancestralidade revisada de `main`. Confira arquivos e segredos antes de adicionar remoto. Se o remoto contiver histórico, busque e analise; não o sobrescreva. Confirme autenticação e privacidade com CLI/navegador autorizado. Não imprimir tokens nem colocá-los na URL.

Apresente commit, arquivos, testes e pendências e peça autorização para primeiro push. Criar repositório privado ou autorizar OAuth não substitui essa autorização. Quando autorizado, use somente o refspec explícito `main:main`; não envie refs internas de ferramentas.

## Limites

Consulte [evidências](PREPARACAO-GITHUB.md) e [SQL](CONFIGURACAO-SQL-SERVER.md). Build/testes offline e página de login acessível não comprovam migrations, bootstrap ou autenticação em SQL Server real.
