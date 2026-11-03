# Windows Server, processos Node e IIS

Arquitetura proposta: dois processos Node independentes, uma instância de cada, em loopback; IIS termina HTTPS e encaminha `app.example.invalid` para 127.0.0.1:3000 e `api.example.invalid` para 127.0.0.1:3001. Os domínios são exemplos; não há configuração aplicada nesta tarefa. O IIS não inicia nem supervisiona automaticamente os processos Node.

## Processos persistentes

Escolha e aprove um gerenciador compatível com serviços Windows (por exemplo wrapper de serviço revisado pela infraestrutura). Instalação/atualização desse gerenciador é decisão operacional separada. Não use `sc create` apontando diretamente para node.exe como se fosse serviço nativo.

Configure caminho absoluto do Node, argumentos equivalentes a `node dist/main.js` no backend e `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000` no frontend. Defina diretórios de trabalho corretos, ambiente privado, conta dedicada, inicialização automática, reinício com backoff e rotação de stdout/stderr em pasta restrita. Preserve overrides existentes em atualizações. Teste o encerramento gracioso antes de usar stop/start em atendimento; não mate processos com filas pendentes. Nunca rode duas instâncias com o mesmo estado/sessão WhatsApp, nem use cluster/autoscaling para o backend atual.

## Proxy

Instale e revise URL Rewrite e Application Request Routing; habilite proxy no ARR no nível do servidor. Crie dois sites com bindings HTTPS e certificados correspondentes. Copie o exemplo apropriado de `deploy/iis` para uma pasta de proxy nova, sem apontar a raiz do site para código, `.env`, sessões ou mídias. Configure DNS/firewall; portas Node devem permanecer locais. O frontend deve ter sido compilado com a URL pública da API; CORS deve conter a origem pública exata do frontend.

Os exemplos apenas encaminham rotas. Revise preservação de Host, encaminhamento de protocolo HTTPS e políticas de cabeçalhos no ARR de acordo com os hosts reais; não habilite valores fornecidos por clientes não confiáveis. Certificados HTTPS e permissões das contas não são fornecidos pelo repositório.

SSE exige resposta em streaming sem buffering e timeout de proxy suficiente para conexões longas. Ajuste esses limites na configuração ARR aprovada e verifique `/whatsapp-events` autenticado pelo navegador: evento inicial e atualizações contínuas. Não coloque tokens na URL. Ajuste limites de upload IIS/ARR acima do tamanho multipart admitido pelo backend (teto de arquivo 20 MiB), sem remover as validações da API. Teste áudio, documento e timeout real pelo proxy. A tela Conversas também usa polling; SSE isoladamente não comprova que a lista foi atualizada.

Após implantação, verifique health, login, permissões, CORS, conteúdo estático, filtros, paginação, uploads, logs sanitizados e persistência. Valide recebimento/envio WhatsApp apenas manualmente e com autorização. Faça teste de reinicialização do servidor de homologação para confirmar persistência dos serviços, sem reutilizar sessão ativa de produção.

Referências: [Microsoft: proxy com URL Rewrite e ARR](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing) e [Next.js: self-hosting](https://nextjs.org/docs/app/guides/self-hosting). Configuração IIS/streaming/serviço ainda não validada neste ambiente.
