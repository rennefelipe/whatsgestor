"use client";

import { useEffect, useState, useRef } from "react";
import { ImageViewer } from "./image-viewer";
import { Icon } from "../icons";
import { apiBlob } from "@/services/api/client";
import type { WhatsappMessage } from "@/types/api";

export function ConversationMedia({ message }: { message: WhatsappMessage }) {
  const media = message.media;
  const [viewerIdentity, setViewerIdentity] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<{ url: string; identity: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const identity = message.conversationId + "/" + message.id;
  const path = `/whatsapp-conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.id)}/media`;
  useEffect(() => {
    if (media?.availability !== "ready" || media.kind === "document") return;
    const controller = new AbortController();
    let url: string | undefined;
    const load = () => {
      void apiBlob(path, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return;
          url = URL.createObjectURL(blob);
          setFile({ url, identity });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("Não foi possível carregar a mídia.");
        });
    };
    // Fetch only media visible in the history; avoid downloading every old page.
    const observer =
      typeof IntersectionObserver !== "undefined" && container.current
        ? new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              load();
            }
          })
        : null;
    if (observer && container.current) observer.observe(container.current);
    else load();
    return () => {
      observer?.disconnect();
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, identity, media?.availability, media?.kind, attempt]);
  const [downloading, setDownloading] = useState(false);
  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await apiBlob(path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = media?.originalName ?? "documento.pdf";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Não foi possível baixar o documento.");
    } finally {
      setDownloading(false);
    }
  }
  if (!media)
    return (
      <p className="conversation-media-state">
        Os dados do anexo não estão disponíveis nesta consulta. O registro da
        mensagem foi preservado.
      </p>
    );
  const previewClass = `conversation-media-preview ${media.kind}`;
  if (media.availability !== "ready")
    return (
      <div className={previewClass}>
        {media.originalName && (
          <p className="conversation-media-name">{media.originalName}</p>
        )}
        <p className="conversation-media-state" role="status">
          {media.availability === "pending"
            ? "Processando mídia..."
            : "Não foi possível recuperar este arquivo. Os dados da mensagem foram preservados."}
        </p>
      </div>
    );
  const url = file?.identity === identity ? file.url : null;
  return (
    <div className="conversation-media" ref={container}>
      {media.kind === "document" ? (
        <button
          type="button"
          className="conversation-media-download"
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading
            ? "Baixando..."
            : `Baixar PDF: ${media.originalName ?? "Documento"}`}
        </button>
      ) : (
        <div className={previewClass}>
          {error ? null : url ? (
            media.kind === "image" ? (
              <button
                type="button"
                className="conversation-image-card"
                aria-label={
                  message.fromMe
                    ? "Ampliar imagem enviada"
                    : "Ampliar imagem recebida"
                }
                onClick={() => setViewerIdentity(identity)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={
                    message.fromMe
                      ? "Imagem enviada pelo WhatsApp"
                      : "Imagem recebida pelo WhatsApp"
                  }
                  loading="lazy"
                  onError={() =>
                    setError("Não foi possível exibir esta imagem.")
                  }
                />
                <span className="conversation-image-zoom">
                  <Icon name="search" size={16} /> Ampliar
                </span>
              </button>
            ) : (
              <audio
                src={url}
                controls
                onError={() =>
                  setError("Este navegador não conseguiu reproduzir o áudio.")
                }
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const audio = event.currentTarget;
                  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                    audio.currentTime = 1e10;
                  }
                }}
                onDurationChange={(event) => {
                  const audio = event.currentTarget;
                  if (Number.isFinite(audio.duration) && audio.duration > 0) {
                    if (audio.currentTime > audio.duration) {
                      audio.currentTime = 0;
                    }
                  }
                }}
                aria-label={
                  message.fromMe
                    ? "Áudio enviado pelo WhatsApp"
                    : "Áudio recebido pelo WhatsApp"
                }
              />
            )
          ) : (
            <p role="status">Carregando mídia...</p>
          )}
        </div>
      )}
      {media.kind === "image" &&
        url &&
        !error &&
        viewerIdentity === identity && (
          <ImageViewer
            title={message.fromMe ? "Imagem enviada" : "Imagem recebida"}
            key={url}
            src={url}
            onClose={() => setViewerIdentity(null)}
          />
        )}
      {media.sizeBytes !== null && (
        <small>
          {(media.sizeBytes / 1024).toLocaleString("pt-BR", {
            maximumFractionDigits: 0,
          })}{" "}
          KB
        </small>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          {media.kind !== "document" && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setFile(null);
                setViewerIdentity(null);
                setAttempt((value) => value + 1);
              }}
            >
              Tentar novamente
            </button>
          )}
        </p>
      )}
    </div>
  );
}
