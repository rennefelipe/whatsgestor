# Banco de dados

O roteiro vigente está em [Configuração SQL Server](CONFIGURACAO-SQL-SERVER.md), com banco novo `WhatsGestor`, três migrations e bootstrap seguro do administrador.

A baseline imutável cria 12 tabelas; a migration de perfis acrescenta colunas via SQL e a de seleções acrescenta cinco tabelas. São 17 tabelas de aplicação mais `whatsgestor_migrations`. Os perfis usam um store SQL explícito; suas colunas adicionais não fazem parte do metadata legado da entidade `User`.

Não regenerar baseline aplicada, habilitar sincronização de schema ou adotar banco legado automaticamente. Tabelas existentes sem histórico correspondente exigem reconciliação revisada. A criação em SQL Server vazio ainda precisa de homologação isolada.

Os comandos antigos com outro nome de banco foram substituídos pelo roteiro vigente. Esta preparação não executa migrations no banco atual.
