"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiRequestError } from "@/services/api/client";
import {
  getWhatsappAttachmentAttempt,
  reviewWhatsappAttachment,
  sendWhatsappAudio,
  type AttachmentAttempt,
} from "@/services/api/whatsapp-conversations";
import type { WhatsappMessage } from "@/types/api";
import { Icon } from "../icons";
import {
  createAttachmentAttemptId,
  formatAttachmentSize,
} from "./attachment-selection";
import {
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_RECORDING_MS,
  formatRecordingDuration,
  microphoneCapabilityMessage,
  microphoneErrorMessage,
  selectAudioRecordingFormat,
  validateRecordedAudio,
  type AudioRecordingFormat,
} from "./audio-recording";

type CapturePhase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "preview";
type StopReason = "manual" | "duration" | "size" | "error" | "cancel";
interface AudioPreview {
  file: File;
  url: string;
  durationMs: number;
}

function audioDiagnostic(
  event: string,
  details: Record<string, boolean | string>,
) {
  if (process.env.NODE_ENV !== "production")
    console.debug("[WhatsGestor][microfone]", event, details);
}

export function AudioRecorder({
  conversationId,
  allowed,
  onSent,
  onOccupied,
  children,
}: {
  conversationId: string;
  allowed: boolean;
  onSent: (message: WhatsappMessage) => void;
  onOccupied: (value: boolean) => void;
  children: (parts: { button: ReactNode; preview: ReactNode }) => ReactNode;
}) {
  const mounted = useRef(true);
  const allowedRef = useRef(allowed);
  const onSentRef = useRef(onSent);
  const phaseRef = useRef<CapturePhase>("idle");
  const generation = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkBytesRef = useRef(0);
  const startedAtRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);
  const stopReasonRef = useRef<StopReason>("manual");
  const previewRef = useRef<AudioPreview | null>(null);
  const requestBusy = useRef(false);

  const [capability, setCapability] = useState<
    "checking" | "ready" | "unsupported"
  >("checking");
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [preview, setPreview] = useState<AudioPreview | null>(null);
  const [attempt, setAttempt] = useState<AttachmentAttempt | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    onSentRef.current = onSent;
  }, [onSent]);

  useEffect(() => {
    allowedRef.current = allowed;
  }, [allowed]);

  const changePhase = useCallback((value: CapturePhase) => {
    phaseRef.current = value;
    if (mounted.current) setPhase(value);
  }, []);

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (limitRef.current !== null) window.clearTimeout(limitRef.current);
    intervalRef.current = null;
    limitRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const replacePreview = useCallback((next: AudioPreview | null) => {
    const previous = previewRef.current;
    if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
    previewRef.current = next;
    if (mounted.current) setPreview(next);
  }, []);

  const cancelCapture = useCallback(() => {
    generation.current += 1;
    stopReasonRef.current = "cancel";
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Tracks are stopped below even when a partial implementation throws.
        }
      }
    }
    stopTracks();
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    requestBusy.current = false;
    changePhase("idle");
    if (mounted.current) setElapsedMs(0);
  }, [changePhase, clearTimers, stopTracks]);

  const finishCapture = useCallback(
    (
      recorder: MediaRecorder,
      format: AudioRecordingFormat,
      captureGeneration: number,
    ) => {
      clearTimers();
      stopTracks();
      recorderRef.current = null;
      requestBusy.current = false;
      if (
        !mounted.current ||
        captureGeneration !== generation.current ||
        stopReasonRef.current === "cancel"
      ) {
        chunksRef.current = [];
        chunkBytesRef.current = 0;
        return;
      }
      const durationMs = Math.max(1, performance.now() - startedAtRef.current);
      const reason = stopReasonRef.current;
      const blob = new Blob(chunksRef.current, { type: format.mimeType });
      chunksRef.current = [];
      chunkBytesRef.current = 0;
      changePhase("idle");
      setElapsedMs(Math.min(durationMs, MAX_AUDIO_RECORDING_MS));
      if (reason === "error") return;
      const validation = validateRecordedAudio({ size: blob.size, durationMs });
      if (validation || reason === "size") {
        setError(validation ?? "O áudio ultrapassou o limite de 16 MB.");
        return;
      }
      const file = new File(
        [blob],
        `gravacao-${Date.now()}.${format.extension}`,
        { type: format.mimeType },
      );
      const next = {
        file,
        url: URL.createObjectURL(file),
        durationMs,
      };
      replacePreview(next);
      changePhase("preview");
      if (reason === "duration")
        setNotice("A gravação atingiu o limite de 5 minutos e foi encerrada.");
    },
    [changePhase, clearTimers, replacePreview, stopTracks],
  );

  const requestStop = useCallback(
    (reason: StopReason = "manual") => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return;
      stopReasonRef.current = reason;
      changePhase("stopping");
      clearTimers();
      setElapsedMs(
        Math.min(
          Math.max(0, performance.now() - startedAtRef.current),
          MAX_AUDIO_RECORDING_MS,
        ),
      );
      try {
        recorder.stop();
      } catch (cause) {
        cancelCapture();
        setError(microphoneErrorMessage(cause));
      }
    },
    [cancelCapture, changePhase, clearTimers],
  );

  const startRecording = useCallback(async () => {
    if (
      !allowedRef.current ||
      phaseRef.current !== "idle" ||
      previewRef.current ||
      attempt ||
      requestBusy.current
    ) {
      audioDiagnostic("inicio_bloqueado", {
        allowed: allowedRef.current,
        capability,
        phase: phaseRef.current,
        hasPreview: !!previewRef.current,
        hasAttempt: !!attempt,
        busy: requestBusy.current,
      });
      return;
    }
    if (capability !== "ready") {
      const browserCapability = {
        secureContext: window.isSecureContext,
        hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
        hasMediaRecorder: typeof MediaRecorder !== "undefined",
      };
      setError(
        capability === "checking"
          ? "O gravador ainda está sendo preparado. Tente novamente em instantes."
          : microphoneCapabilityMessage(browserCapability),
      );
      audioDiagnostic("capacidade_indisponivel", {
        capability,
        ...browserCapability,
      });
      return;
    }
    const format = selectAudioRecordingFormat(MediaRecorder);
    if (!format) {
      setCapability("unsupported");
      setError("Este navegador não oferece um formato de áudio compatível.");
      return;
    }
    requestBusy.current = true;
    const captureGeneration = ++generation.current;
    changePhase("requesting");
    setElapsedMs(0);
    setError("");
    setNotice("");
    audioDiagnostic("solicitando_microfone", {
      allowed: allowedRef.current,
      capability,
      format: format.mimeType,
    });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (cause) {
      audioDiagnostic("microfone_rejeitado", {
        errorName:
          typeof cause === "object" && cause !== null && "name" in cause
            ? String(cause.name)
            : "UnknownError",
      });
      if (
        mounted.current &&
        captureGeneration === generation.current
      ) {
        requestBusy.current = false;
        changePhase("idle");
        setError(microphoneErrorMessage(cause));
      }
      return;
    }
    audioDiagnostic("microfone_liberado", {
      allowed: allowedRef.current,
      mounted: mounted.current,
    });
    if (
      !mounted.current ||
      captureGeneration !== generation.current ||
      !allowedRef.current
    ) {
      for (const track of stream.getTracks()) track.stop();
      requestBusy.current = false;
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    stopReasonRef.current = "manual";
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        chunkBytesRef.current += event.data.size;
        if (
          chunkBytesRef.current > MAX_AUDIO_RECORDING_BYTES &&
          recorder.state !== "inactive"
        )
          requestStop("size");
      };
      recorder.onerror = () => {
        setError("O navegador interrompeu a gravação de áudio.");
        stopReasonRef.current = "error";
        if (recorder.state !== "inactive") requestStop("error");
      };
      recorder.onstop = () =>
        finishCapture(recorder, format, captureGeneration);
      startedAtRef.current = performance.now();
      recorder.start(1000);
    } catch (cause) {
      cancelCapture();
      setError(microphoneErrorMessage(cause));
      return;
    }
    requestBusy.current = false;
    changePhase("recording");
    audioDiagnostic("gravacao_iniciada", {
      format: format.mimeType,
      phase: "recording",
    });
    intervalRef.current = window.setInterval(() => {
      setElapsedMs(
        Math.min(
          Math.max(0, performance.now() - startedAtRef.current),
          MAX_AUDIO_RECORDING_MS,
        ),
      );
    }, 250);
    limitRef.current = window.setTimeout(
      () => requestStop("duration"),
      MAX_AUDIO_RECORDING_MS,
    );
  }, [
    attempt,
    capability,
    cancelCapture,
    changePhase,
    finishCapture,
    requestStop,
  ]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined" &&
        !!selectAudioRecordingFormat(MediaRecorder);
      setCapability(supported ? "ready" : "unsupported");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      allowed ||
      !["requesting", "recording", "stopping"].includes(phaseRef.current)
    )
      return;
    cancelCapture();
    setError("A gravação foi cancelada porque o envio não está mais disponível.");
  }, [allowed, cancelCapture]);

  useEffect(() => {
    if (
      sending ||
      !attempt ||
      !["prepared", "sending", "confirmed"].includes(attempt.state)
    )
      return;
    let alive = true;
    const timer = window.setInterval(() => {
      void getWhatsappAttachmentAttempt(conversationId, attempt.id)
        .then((result) => {
          if (!alive || !mounted.current) return;
          setAttempt(
            result.state === "registered" || result.state === "failed"
              ? null
              : result,
          );
          if (result.message) {
            onSentRef.current(result.message);
            replacePreview(null);
            changePhase("idle");
            setNotice("Áudio enviado e registrado.");
          }
          if (result.state === "failed") {
            changePhase(previewRef.current ? "preview" : "idle");
            setError("O áudio não foi enviado. Grave novamente ou tente enviar a prévia.");
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [attempt, changePhase, conversationId, replacePreview, sending]);

  async function send() {
    const current = previewRef.current;
    if (!current || !allowed || requestBusy.current || sending || attempt) return;
    let id: string;
    try {
      id = createAttachmentAttemptId();
    } catch {
      setError(
        "Não foi possível preparar o envio neste navegador. Atualize-o ou utilize uma conexão segura.",
      );
      return;
    }
    requestBusy.current = true;
    setSending(true);
    setError("");
    setNotice("");
    const pending: AttachmentAttempt = {
      id,
      state: "sending",
      originalName: current.file.name,
      message: null,
    };
    setAttempt(pending);
    try {
      const message = await sendWhatsappAudio(
        conversationId,
        id,
        current.file,
      );
      onSentRef.current(message);
      if (mounted.current) {
        replacePreview(null);
        setAttempt(null);
        changePhase("idle");
        setNotice("Áudio enviado e registrado.");
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
            replacePreview(null);
            setAttempt(null);
            changePhase("idle");
            setNotice("Áudio enviado e registrado.");
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
          : "Não foi possível confirmar o envio do áudio.",
      );
    } finally {
      requestBusy.current = false;
      if (mounted.current) setSending(false);
    }
  }

  async function review() {
    if (!attempt || attempt.state !== "uncertain" || requestBusy.current)
      return;
    requestBusy.current = true;
    setSending(true);
    try {
      await reviewWhatsappAttachment(conversationId, attempt.id);
      setAttempt(null);
      replacePreview(null);
      changePhase("idle");
      setNotice(
        "Conferência registrada. Se necessário, faça uma nova gravação.",
      );
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 404) {
        setAttempt(null);
        replacePreview(null);
        changePhase("idle");
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
      requestBusy.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const occupied = phase !== "idle" || !!preview || !!attempt || sending;
  useEffect(() => {
    onOccupied(occupied);
  }, [occupied, onOccupied]);
  useEffect(() => () => onOccupied(false), [onOccupied]);

  useEffect(() => {
    // React Strict Mode intentionally runs an extra setup/cleanup cycle in
    // development. Reset this guard in every setup so the real mount can
    // accept the microphone result after that verification cycle.
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelCapture();
      replacePreview(null);
    };
  }, [cancelCapture, replacePreview]);

  const isRecording = phase === "recording";
  const buttonDisabled =
    isRecording
      ? false
      : !allowed ||
        phase !== "idle" ||
        !!preview ||
        !!attempt ||
        sending;
  const title =
    capability === "unsupported"
      ? "Gravação de áudio indisponível neste navegador"
      : allowed
        ? isRecording
          ? "Parar gravação"
          : "Gravar áudio"
        : "Inicie o atendimento como responsável ou administrador, com a conexão ativa";

  return children({
    button: (
      <button
        type="button"
        className={`audio-record-button${isRecording ? " recording" : ""}`}
        disabled={buttonDisabled}
        onClick={() => {
          audioDiagnostic("clique_recebido", {
            allowed,
            capability,
            phase,
            disabled: buttonDisabled,
          });
          if (isRecording) requestStop("manual");
          else void startRecording();
        }}
        data-audio-capability={capability}
        data-audio-phase={phase}
        aria-label={isRecording ? "Parar gravação de áudio" : "Gravar áudio"}
        aria-pressed={isRecording}
        title={title}
      >
        <Icon name={isRecording ? "stop" : "microphone"} size={20} />
      </button>
    ),
    preview: (
      <div
        className="audio-recorder-details"
        role="region"
        aria-label="Gravação e estado do envio de áudio"
        tabIndex={0}
      >
        {["requesting", "recording", "stopping"].includes(phase) && (
          <div className="audio-recording-status" role="status">
            <span className="audio-recording-dot" aria-hidden="true" />
            <strong>
              {phase === "requesting"
                ? "Solicitando microfone..."
                : phase === "stopping"
                  ? "Preparando prévia..."
                  : `Gravando ${formatRecordingDuration(elapsedMs)}`}
            </strong>
            {phase === "recording" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => requestStop("manual")}
              >
                Parar
              </button>
            )}
            {phase !== "stopping" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  cancelCapture();
                  setNotice("Gravação cancelada.");
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        )}
        {preview && (
          <div className="audio-recorder-preview">
            <audio
              controls
              src={preview.url}
              preload="metadata"
              aria-label="Prévia da gravação de áudio"
            />
            <div>
              <strong>Gravação pronta</strong>
              <span>
                {formatRecordingDuration(preview.durationMs)} ·{" "}
                {formatAttachmentSize(preview.file.size)}
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={sending || !!attempt}
              onClick={() => {
                replacePreview(null);
                changePhase("idle");
                setError("");
                setNotice("Gravação cancelada.");
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="audio-send"
              disabled={!allowed || sending || !!attempt}
              onClick={() => void send()}
            >
              {sending ? "Enviando áudio..." : "Enviar áudio"}
            </button>
          </div>
        )}
        {attempt && (
          <div className="audio-recorder-notice" role="status">
            {attempt.state === "uncertain"
              ? "Resultado incerto. Confira no WhatsApp antes de liberar uma nova gravação."
              : attempt.state === "confirmed"
                ? "WhatsApp aceitou o áudio. Aguardando registro local; não reenvie."
                : "Áudio em processamento. Aguarde a confirmação; não reenvie."}
            {attempt.state === "uncertain" && (
              <button
                type="button"
                className="secondary-button"
                disabled={!allowed || sending}
                onClick={() => void review()}
              >
                Conferi no WhatsApp: liberar nova gravação
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="audio-recorder-error" role="alert">
            {error}
            <button
              type="button"
              className="secondary-button"
              disabled={sending}
              onClick={() => setError("")}
            >
              Fechar aviso
            </button>
          </p>
        )}
        {notice && (
          <p className="audio-recorder-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    ),
  });
}
