"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "../icons";
import { ApiRequestError } from "@/services/api/client";
import {
  sendWhatsappAttachment,
  pendingWhatsappAttachment,
  getWhatsappAttachmentAttempt,
  reviewWhatsappAttachment,
  type AttachmentAttempt,
} from "@/services/api/whatsapp-conversations";
import type { WhatsappMessage } from "@/types/api";
import {
  validateAttachmentSelection,
  formatAttachmentSize,
  createAttachmentAttemptId,
} from "./attachment-selection";

export function AttachmentComposer({
  conversationId,
  allowed,
  onSent,
  onBusy,
  onOccupied,
  children,
}: {
  conversationId: string;
  allowed: boolean;
  onSent: (message: WhatsappMessage) => void;
  onBusy: (value: boolean) => void;
  onOccupied?: (value: boolean) => void;
  children: (parts: { button: ReactNode; preview: ReactNode }) => ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [verified, setVerified] = useState(false);
  const [attempt, setAttempt] = useState<AttachmentAttempt | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const onSentRef = useRef(onSent);
  const pendingIsAudio = attempt?.kind === "audio";
  useEffect(() => {
    onSentRef.current = onSent;
  }, [onSent]);
  const occupied = checking || !verified || sending || !!attempt || !!file;
  useEffect(() => {
    onOccupied?.(occupied);
  }, [occupied, onOccupied]);
  useEffect(() => () => onOccupied?.(false), [onOccupied]);
  const applyPending = useCallback((result: AttachmentAttempt | null) => {
    if (!mounted.current) return;
    setVerified(true);
    setAttempt(result?.message ? null : result);
    if (result?.message) {
      onSentRef.current(result.message);
      setNotice(
        result.kind === "audio"
          ? "Áudio enviado e registrado."
          : "Anexo enviado e registrado.",
      );
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void pendingWhatsappAttachment(conversationId)
      .then(applyPending)
      .catch(() => {
        if (mounted.current)
          setError(
            "Não foi possível verificar envios pendentes. Verifique novamente; se persistir, avise o administrador.",
          );
      })
      .finally(() => {
        if (mounted.current) setChecking(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [conversationId, applyPending]);
  async function verifyAgain() {
    if (checking || busy.current) return;
    setChecking(true);
    setError("");
    try {
      applyPending(await pendingWhatsappAttachment(conversationId));
    } catch {
      if (mounted.current)
        setError(
          "Não foi possível verificar envios pendentes. Verifique novamente; se persistir, avise o administrador.",
        );
    } finally {
      if (mounted.current) setChecking(false);
    }
  }
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    let alive = true;
    // Resolve preview asynchronously, keeping effect updates out of render.
    void Promise.resolve().then(() => {
      if (alive && mounted.current) setPreview(url);
    });
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useEffect(() => {
    if (
      sending ||
      !attempt ||
      !["prepared", "sending", "confirmed"].includes(attempt.state)
    )
      return;
    let alive = true;
    const timer = setInterval(() => {
      void getWhatsappAttachmentAttempt(conversationId, attempt.id)
        .then((result) => {
          if (!alive) return;
          setAttempt(
            result.state === "registered" || result.state === "failed"
              ? null
              : result,
          );
          if (result.message) {
            onSentRef.current(result.message);
            setFile(null);
            setPreview(null);
            setNotice("Anexo enviado e registrado.");
          }
          if (result.state === "failed")
            setError("O anexo não foi enviado. Selecione o arquivo novamente.");
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [conversationId, attempt, sending]);
  function remove() {
    setFile(null);
    setPreview(null);
    setError("");
    setNotice("");
    if (input.current) input.current.value = "";
  }
  async function send() {
    if (!file || !allowed || busy.current || attempt || checking || !verified)
      return;
    let id: string;
    try {
      id = createAttachmentAttemptId();
    } catch {
      setError(
        "Não foi possível preparar o envio neste navegador. Atualize-o ou utilize uma conexão segura.",
      );
      return;
    }
    busy.current = true;
    setSending(true);
    onBusy(true);
    setError("");
    setNotice("");
    const pending: AttachmentAttempt = {
      id,
      state: "sending",
      originalName: file.name,
      message: null,
    };
    setAttempt(pending);
    try {
      const message = await sendWhatsappAttachment(conversationId, id, file);
      onSentRef.current(message);
      if (mounted.current) {
        setFile(null);
        setPreview(null);
        setAttempt(null);
        setNotice("Anexo enviado e registrado.");
        if (input.current) input.current.value = "";
      }
    } catch (cause) {
      if (!mounted.current) return;
      const rejected =
        cause instanceof ApiRequestError &&
        [400, 401, 403, 413, 415, 422, 503].includes(cause.status);
      if (rejected) setAttempt(null);
      else {
        try {
          const result = await getWhatsappAttachmentAttempt(conversationId, id);
          if (!mounted.current) return;
          if (result.message) {
            onSentRef.current(result.message);
            setAttempt(null);
            setFile(null);
            setPreview(null);
            setNotice("Anexo enviado e registrado.");
            return;
          }
          setAttempt(result.state === "failed" ? null : result);
        } catch {
          setAttempt({ ...pending, state: "uncertain" });
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível confirmar o envio.",
      );
    } finally {
      busy.current = false;
      onBusy(false);
      if (mounted.current) setSending(false);
    }
  }
  async function review() {
    if (!attempt || attempt.state !== "uncertain" || busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      await reviewWhatsappAttachment(conversationId, attempt.id);
      setAttempt(null);
      remove();
      setNotice(
        "Conferência registrada. Se necessário, selecione um novo anexo.",
      );
    } catch (cause) {
      // A missing record can result from an interrupted upload before journaling.
      if (cause instanceof ApiRequestError && cause.status === 404) {
        setAttempt(null);
        remove();
        setNotice(
          "Conferência concluída. A tentativa anterior não será repetida.",
        );
      } else
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível registrar a conferência.",
        );
    } finally {
      busy.current = false;
      setSending(false);
    }
  }
  const disabled = !allowed || sending || checking || !verified || !!attempt;
  return children({
    button: (
      <>
        <input
          ref={input}
          type="file"
          hidden
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (!selected) return;
            const validation = validateAttachmentSelection(selected);
            setError(validation ?? "");
            setNotice("");
            setPreview(null);
            setFile(validation ? null : selected);
            if (validation) event.target.value = "";
          }}
        />
        <button
          type="button"
          className="attachment-clip"
          disabled={disabled}
          onClick={() => input.current?.click()}
          aria-label="Anexar imagem ou PDF"
          title={
            allowed
              ? "Anexar imagem (até 5 MB) ou PDF (até 20 MB)"
              : "Inicie o atendimento como responsável ou administrador, com a conexão ativa"
          }
        >
          <Icon name="paperclip" size={20} />
        </button>
      </>
    ),
    preview: (
      <div
        className="attachment-details"
        role="region"
        aria-label="Anexos e estado do envio"
        tabIndex={0}
      >
        {file && (
          <div className="attachment-preview">
            {preview && file.type.startsWith("image/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Prévia do anexo selecionado"
                onError={() => setPreview(null)}
              />
            )}
            <div>
              <strong>{file.name}</strong>
              <span>
                {file.type} · {formatAttachmentSize(file.size)}
              </span>
              <small>O texto no campo será enviado separadamente.</small>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={sending || !!attempt}
              onClick={remove}
            >
              Remover
            </button>
            <button
              type="button"
              className="attachment-send"
              disabled={!allowed || sending || !!attempt || checking}
              onClick={() => void send()}
            >
              {sending ? "Enviando anexo..." : "Enviar anexo"}
            </button>
          </div>
        )}
        {checking && (
          <p className="attachment-notice" role="status">
            Verificando anexos pendentes...
          </p>
        )}
        {attempt && (
          <div className="attachment-notice" role="status">
            {attempt.state === "uncertain"
              ? `Resultado incerto. Confira no WhatsApp antes de liberar ${pendingIsAudio ? "uma nova gravação" : "um novo envio"}.`
              : attempt.state === "confirmed"
                ? `WhatsApp aceitou ${pendingIsAudio ? "o áudio" : "o anexo"}. Aguardando registro local; não reenvie.`
                : `${pendingIsAudio ? "Áudio" : "Anexo"} em processamento. Aguarde a confirmação; não reenvie.`}
            {attempt.state === "uncertain" && (
              <button
                type="button"
                className="secondary-button"
                disabled={!allowed || sending}
                onClick={() => void review()}
              >
                Conferi no WhatsApp: liberar {pendingIsAudio ? "nova gravação" : "novo anexo"}
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="attachment-error" role="alert">
            {error}
            <button
              type="button"
              className="secondary-button"
              disabled={checking || sending || !!attempt}
              onClick={() => (!verified ? void verifyAgain() : setError(""))}
            >
              {verified ? "Fechar aviso" : "Verificar novamente"}
            </button>
          </p>
        )}
        {notice && (
          <p className="attachment-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    ),
  });
}
