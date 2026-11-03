"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { getWhatsappMonitor, type ReceiveMonitor, type SafeMonitorError } from "@/services/api/whatsapp-monitor";
import "./whatsapp-monitor.css";
const styleNames = ["screen", "toolbar", "notice", "warning", "panel", "metrics",
  "help", "tableScroll", "table", "timeline", "confirmed", "unobserved"] as const;
const styles = Object.fromEntries(styleNames.map((name) => [name, "receive-monitor-" + name])) as Record<typeof styleNames[number], string>;

function when(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value)) : "NÃO OBSERVÁVEL";
}
function flag(value: boolean | null | undefined) {
  return value === true ? "true" : value === false ? "false" : "NÃO OBSERVÁVEL";
}
function errorCode(error: SafeMonitorError) {
  const codes = [error.errorCode, error.causeCode, error.errorNumber, error.httpStatus]
    .filter((value) => value !== null && value !== undefined);
  return codes.length ? [...new Set(codes)].join(" / ") : "Sem código disponível";
}
const authLabels: Record<string, string> = {
  unknown: "NÃO OBSERVÁVEL", paired: "Credenciais pareadas",
  authenticated: "Autenticação aceita na abertura",
  unpaired: "Sem pareamento", invalid: "Credenciais inválidas", qr_required: "QR solicitado",
};
const syncLabels: Record<string, string> = {
  Connecting: "Aguardando conclusão das pendências",
  AwaitingInitialSync: "Aguardando sincronização inicial",
  Syncing: "Sincronizando", Online: "Online",
};
const filters: Record<string, string> = {
  append: "Evento append", direction: "Direção da mensagem", missing_id: "Sem identificador",
  jid: "Destinatário não suportado", unsupported_content: "Conteúdo não suportado",
  media_disabled: "Mídia desabilitada", media_recovery: "Mídia em recuperação",
  stale_socket: "Geração anterior do socket",
};

export function WhatsappMonitorScreen() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [data, setData] = useState<ReceiveMonitor | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [view, setView] = useState("all");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    async function poll() {
      if (stopped) return;
      if (document.hidden) { timer = setTimeout(poll, 2000); return; }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const result = await getWhatsappMonitor(controller.signal);
        if (!stopped) { setData(result); setError(""); }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "API indisponível.");
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [isAdmin, reload]);
  if (!isAdmin) return <main className="main-content"><h1>Monitor WhatsApp</h1><p>Acesso restrito a administradores.</p></main>;
  const connection = data?.connections.find((item) => item.connectionRef === selected) ?? data?.connections[0];
  const messages = connection?.messages.filter((item) => view === "all" ||
    (view === "new" ? item.timestampRelation === "during_socket" : item.timestampRelation === "before_socket")) ?? [];
  return <main className={`main-content ${styles.screen}`}>
    <div className="page-heading">
      <div><p className="eyebrow">Integrações · Administração</p><h1>Monitor WhatsApp</h1>
        <p className="page-subtitle">Recebimento observado, sincronização e caminho de cada mensagem.</p></div>
      <button type="button" className="secondary-button" onClick={() => setReload((value) => value + 1)}>Atualizar</button>
    </div>
    {error && <div className="inline-error" role="alert"><strong>Monitor sem atualização da API.</strong> {error}
      {data && <p>Última coleta preservada: {when(data.at)}. Os valores abaixo podem estar desatualizados.</p>}</div>}
    {!data && !error && <p role="status">Carregando observações do backend…</p>}
    {data && <>
      <div className={styles.toolbar}>
        <span role="status">{error ? "Atualização interrompida" : "Atualização a cada 2 segundos"} · {when(data.at)}</span>
        <label>Conexão <select value={connection?.connectionRef ?? ""} onChange={(event) => setSelected(event.target.value)}>
          {data.connections.map((item) => <option key={item.connectionRef} value={item.connectionRef}>Conexão {item.connectionRef.slice(0, 8)} · geração {item.generation}</option>)}
        </select></label>
      </div>
      <div className={data.instrumentation.active ? styles.notice : styles.warning}>
        <strong>{data.instrumentation.active ? "Instrumentação do transporte ativa" : "Instrumentação do transporte incompleta"}</strong>
        <p>{data.instrumentation.active ? "Frames brutos, Noise e entrada no Baileys possuem observadores carregados." :
          "R0–R2 não estão comprovadamente disponíveis. Causa ainda não identificada; verifique a inicialização do monitor."}</p>
      </div>
      {!connection ? <p>Nenhum socket observado neste boot. Não há evidência para afirmar conexão ou sincronização.</p> : <>
        <dl className={styles.metrics}>
          <div><dt>WebSocket observado</dt><dd>{connection.websocketOpen === null ? "NÃO OBSERVÁVEL" : connection.websocketOpen ? "Aberto" : "Fechado"}</dd></div>
          <div><dt>Autenticação WhatsApp</dt><dd>{authLabels[connection.authentication] ?? "NÃO OBSERVÁVEL"}</dd></div>
          <div><dt>Sincronização inicial</dt><dd>{connection.initialSyncComplete ? "Conclusão observada" : syncLabels[connection.syncState ?? ""] ?? "NÃO OBSERVÁVEL"}</dd></div>
          <div><dt>buffering</dt><dd>{flag(connection.buffering)}</dd></div>
          <div><dt>receivedPendingNotifications</dt><dd>{flag(connection.receivedPendingNotifications)}</dd></div>
          <div><dt>Terminal offline</dt><dd>{connection.offlineTerminalAt ? when(connection.offlineTerminalAt) : "Não observado neste socket"}</dd></div>
          <div><dt>Mensagens no Baileys / processadas</dt><dd>{connection.counters.R2} / {connection.counters.R4}</dd></div>
          <div><dt>Persistidas / filtradas / falhas observadas</dt><dd>{connection.counters.R5} / {connection.filtered} / {connection.failed}</dd></div>
          <div><dt>Última mensagem nova observada</dt><dd>{when(connection.lastNewMessage?.firstObservedAt)}</dd>
            {connection.lastNewMessage && <small>Original: {when(connection.lastNewMessage.messageTimestamp)} · {connection.lastNewMessage.messageRef.slice(0, 10)}</small>}</div>
        </dl>
        <section className={styles.panel} aria-label="Transporte e fila">
          <h2>Transporte e sincronização</h2>
          <p>R0: {connection.rawFrameCount} blocos brutos · último {when(connection.lastRawAt)}. R1: {connection.decodedFrameCount} frames decodificados · último {when(connection.lastDecodedAt)}.</p>
          <p>Preview offline: {connection.offlinePreviewCount ?? "NÃO OBSERVÁVEL"}.
            {" "}Fila pendente: {connection.queue?.offlineQueuePending ?? "NÃO OBSERVÁVEL"} · em processamento: {flag(connection.queue?.offlineQueueActive as boolean | null)} · falhas: {connection.queue?.offlineQueueFailed ?? "NÃO OBSERVÁVEL"}.</p>
          <p>Item ativo: {String(connection.queue?.offlineQueueActiveKind ?? "nenhum observado")} · idade: {connection.queue?.offlineQueueActiveAgeMs ?? "—"} ms.
            {" "}Snapshot: {when(connection.snapshotAt)}.</p>
          <p className={styles.help}>R0 conta blocos de transporte, que podem conter partes ou múltiplos nós. Não existe associação individual comprovada entre cada bloco bruto e uma mensagem.</p>
        </section>
        <section className={styles.panel} aria-label="Último erro observado">
          <h2>Último erro real</h2>
          {connection.lastError ? <><p><strong>{String(connection.lastError.stage)}</strong> · {errorCode(connection.lastError)} · {when(String(connection.lastError.at))}</p>
            <p>Origem: {String(connection.lastError.origin)}. A relação com uma mensagem exige a mesma referência; este erro isolado não determina sua causa.</p></> : <p>Nenhum erro explícito registrado nesta geração. Causa ainda não identificada.</p>}
        </section>
        <section className={styles.panel} aria-label="Linha do tempo do recebimento">
          <div className={styles.toolbar}><h2>Linha do tempo das mensagens</h2><label>Exibir <select value={view} onChange={(event) => setView(event.target.value)}>
            <option value="all">Todas</option><option value="new">Timestamp durante este socket</option><option value="old">Timestamp anterior ao socket</option>
          </select></label></div>
          <p className={styles.help}>append / notify são tipos de evento. A classificação temporal usa o horário original; notify não comprova recebimento recente. R6 confirma resposta HTTP concluída, sem afirmar renderização na tela.</p>
          <div className={styles.tableScroll}><table className={styles.table}><thead><tr>
            <th>Referência / horário original</th><th>Observação / tipo</th><th>Etapas confirmadas</th><th>Resultado e próxima etapa</th>
          </tr></thead><tbody>{messages.map((message) => <tr key={message.messageRef}>
            <td><code>{message.messageRef.slice(0, 12)}</code><br />{when(message.messageTimestamp)}
              <small>{message.timestampRelation === "before_socket" ? "Anterior ao socket" : message.timestampRelation === "during_socket" ? "Durante este socket" : "Horário não confirmado"}</small></td>
            <td>{when(message.firstObservedAt)}<small>{message.type ?? "Tipo ainda não observado"} · {message.category} · {message.direction}</small></td>
            <td><ol className={styles.timeline}>{data.stages.map((stage) => <li key={stage.id} className={message.stages[stage.id] ? styles.confirmed : styles.unobserved}>
              <strong>{stage.id}</strong> {stage.label}<small>{stage.id === "R0" ? "Agregado do transporte" : message.stages[stage.id] ? when(message.stages[stage.id]) : "Não observado"}</small>
            </li>)}</ol></td>
            <td>Última: <strong>{message.lastConfirmedStage ?? "NÃO OBSERVÁVEL"}</strong><br />
              Próxima não observada: {message.nextStageNotObserved ?? "—"}
              <small>{message.outcome === "filtered" ? `Filtrada: ${filters[message.filterReason ?? ""] ?? message.filterReason}` :
                message.outcome === "failed" && message.error ? `Erro: ${errorCode(message.error)}` :
                  message.stages.R6 ? "Incluída em resposta da API" : message.outcome === "persisted" ? "Persistência concluída; pode ser registro já existente" : "Causa ainda não identificada"}</small>
              {message.upsertRequestedAt && <small>Upsert solicitado: {when(message.upsertRequestedAt)} · buffering: {flag(message.bufferedWhenRequested)}</small>}
              {message.sqlStartedAt && <small>SQL iniciado: {when(message.sqlStartedAt)}</small>}
            </td>
          </tr>)}</tbody></table></div>
          {!messages.length && <p>Nenhuma mensagem observada neste filtro. Ausência de evento não comprova erro.</p>}
        </section>
      </>}
      <p className={styles.help}>Boot {data.bootId.slice(0, 8)} · início {when(data.startedAt)}. Contadores reiniciam por geração.
        {" "}Dados em memória por até {data.retention.minutes} minutos, com limite de {data.retention.maxMessagesPerConnection} mensagens por conexão. O monitor permanece disponível após reiniciar; a coleta não depende do diagnóstico temporário.</p>
    </>}
  </main>;
}
