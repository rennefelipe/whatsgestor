# Configuração

Os dois `.env.example` contêm somente valores fictícios. Configuração real permanece privada e não deve acompanhar exportações, prints ou logs. O processo pode ter overrides de ambiente que prevalecem sobre arquivos; registre a configuração do gerenciador sem publicar segredos. Alterações de configuração do backend exigem reinício planejado autorizado; URL pública do frontend exige novo build.

| Variável/grupo | Uso |
|---|---|
| HOST / PORT | Bind da API; exemplo 127.0.0.1:3001, atrás do proxy |
| DB_HOST / DB_PORT / DB_DATABASE | Servidor, porta TCP fixa e banco previamente provisionado |
| DB_USERNAME / DB_PASSWORD | Login SQL dedicado; nunca usar senha do exemplo |
| DB_ENCRYPT / DB_TRUST_SERVER_CERTIFICATE | TLS SQL; produção usa true/false e cadeia confiável |
| JWT_SECRET / JWT_EXPIRES_IN | Segredo aleatório próprio, mínimo 32 caracteres; validade em segundos |
| CORS_ORIGINS | Origens exatas do frontend separadas por vírgula, sem caminho/barra final |
| NEXT_PUBLIC_API_URL | Origem pública HTTPS da API, compilada no frontend; nunca segredo |
| WHATSAPP_INTEGRATION_ENABLED | Habilita integração; exemplo false |
| WHATSAPP_INTEGRATION_AUTO_RESTORE | Restauração de sessões autenticadas no início; exemplo true; false desabilita |
| WHATSAPP_INTEGRATION_ALLOW_PAIRING | Permissão administrativa para pareamento; exemplo false |
| WHATSAPP_INTEGRATION_ALLOW_SEND | Permissão administrativa para envio; exemplo false |
| WHATSAPP_INTEGRATION_STATE_DIR | Estado cifrado, journals, leases e master.key; externo ao código |
| WHATSAPP_SESSIONS_DIR | Sessões legadas, preservar sem importar/redefinir automaticamente |
| WHATSAPP_MEDIA_DIR | Arquivos de mídia privados; não servir como pasta estática pública |
| WHATSAPP_RECONNECT_LIMIT / BASE_MS / MAX_MS | Usar nomes completos WHATSAPP_RECONNECT_BASE_MS/MAX_MS do exemplo |
| WHATSAPP_PENDING_LIMIT | Limite de envelopes pendentes; exemplo 256 |
| WHATSAPP_MEDIA_TIMEOUT_MS / WHATSAPP_SEND_TIMEOUT_MS | Tempo de mídia/confirmação de envio; exemplo 30000 ms |
| WHATSAPP_RECOVERY_LIMIT / BASE_MS / MAX_MS | Usar WHATSAPP_RECOVERY_BASE_MS/MAX_MS; retries internos, não novo pareamento |
| MESSAGES_TEXT_MAX_LENGTH | Limite de texto; exemplo 4096 |
| MESSAGES_IMAGE_MAX_BYTES / AUDIO_MAX_BYTES / VIDEO_MAX_BYTES / DOCUMENT_MAX_BYTES | Nomes completos prefixados MESSAGES_; exemplo 5/16/20/20 MiB; teto SQL 20 MiB |
| MESSAGES_FILE_CONCURRENCY / MESSAGES_UPLOAD_TIMEOUT_MS | Concorrência e timeout do processamento de uploads |

Consulte `backend/src/config/environment.ts`, `integration-policy.ts` e `messages/file-policy.ts` para validação e limites. Não habilite flags `STAGE*` ou provedores de teste em produção. Política de envio e estado conectado são condições separadas. Um envio incerto deve ser revisado antes de repetir; não contorne idempotência.

## Armazenamento privado e certificados

Crie diretórios privados novos fora da árvore e aplique ACL para conta dedicada, SYSTEM e Administradores. Revise herança e ausência de permissões amplas para Users/Everyone/Authenticated Users; o código recusa diretórios inseguros. Não aplique alterações recursivas de ACL à instalação atual sem revisão. Faça backup de toda a árvore e da master.key; perder a chave impede decifrar o estado. Nunca exponha caminhos privados no IIS.

O executável `ffmpeg` com libopus deve estar no PATH efetivo do serviço. Não foi adicionado download automático nem configurado caminho novo no adapter protegido. HTTPS do site precisa certificado público/confiável; SQL precisa certificado/cadeia aceitos pelo driver. Para CA privada Node, avalie `NODE_EXTRA_CA_CERTS` no gerenciador, apontando para cadeia pública aprovada fora do Git. Não desabilite TLS globalmente. `DB_TRUST_SERVER_CERTIFICATE=true` só é opção consciente de laboratório, não solução padrão de produção.

O frontend lê a URL da API no build, conforme o [guia Next.js de hospedagem](https://nextjs.org/docs/app/guides/self-hosting). Segredos não podem usar prefixo NEXT_PUBLIC_.
