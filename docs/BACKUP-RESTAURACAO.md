# Backup e restauração

Backup de código não substitui backup operacional. Conserve conjuntos com data, versão, hashes, retenção e controle de acesso, criptografados fora do repositório e em local separado do servidor. Teste restauração em ambiente isolado. Nunca publique esses conjuntos.

Inclua: backup consistente SQL Server (com estratégia de logs/ponto no tempo definida pelo DBA), árvore completa de estado cifrado com master.key e journals, mídias privadas, sessões legadas necessárias, configurações reais e overrides do gerenciador, certificados/chaves conforme política e versão exata de código/lockfiles. Não salve valores de segredos no relatório de backup. Cópias de código em `backend-backup` não garantem recuperação do banco/estado.

Para um conjunto coerente entre SQL e arquivos, agende manutenção autorizada: impeça novos envios/alterações, acompanhe processamento e drene filas, encerre graciosamente quando apropriado e faça cópias consistentes. Cópia de `.enc` enquanto a sessão grava pode capturar estados de momentos diferentes; não alegue snapshot coerente só por copiar uma pasta. Use o procedimento de snapshot aprovado pela infraestrutura ou janela coordenada. Não renomeie/apague journals, temporários ou locks para forçar uma cópia.

O DBA deve executar BACKUP DATABASE em destino restrito com verificação/checksum conforme política SQL e executar RESTORE VERIFYONLY, seguido por restauração real de ensaio. Não há script automático que escolha ou sobrescreva o banco atual. Registre alvo, tamanhos e resultado sem conteúdo dos dados.

Restauração: valide o backup em servidor/banco novo; mantenha integração WhatsApp desabilitada para não abrir identidade duplicada. Restaure SQL, estado inteiro, chave correspondente e mídia como conjunto. Reaplique ACL para a conta correta; configure caminhos/origens próprios. Inspecione ausência de outra instância usando a sessão antes de qualquer ativação autorizada. Não remova `.socket.lock` sem confirmar processo e procedimento de lease. Não gere nova master.key, não apague .enc e não execute novo pareamento como método de restauração.

Confira login, permissões, contagens e integridade do histórico em ambiente restrito. A ativação da identidade restaurada exige desligamento coordenado da instância antiga e autorização; falhas de storage/identidade devem permanecer bloqueadas até diagnóstico. Documente objetivo de perda aceitável e tempo de recuperação. Nenhum backup SQL/restauração operacional foi executado nesta preparação.
