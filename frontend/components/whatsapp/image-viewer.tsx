"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { imagePan, imageScale } from "./image-transform";

export function ImageViewer({
  src,
  onClose,
  title = "Imagem recebida",
}: {
  src: string;
  onClose: () => void;
  title?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dimensions, setDimensions] = useState("");
  function constrain(next: typeof transform) {
    const img = image.current,
      view = viewport.current;
    const scale = imageScale(next.scale);
    return {
      scale,
      ...imagePan(
        next.x,
        next.y,
        scale,
        img?.offsetWidth ?? 0,
        img?.offsetHeight ?? 0,
        view?.clientWidth ?? 0,
        view?.clientHeight ?? 0,
      ),
    };
  }
  function zoom(factor: number) {
    setTransform((current) =>
      constrain({ ...current, scale: current.scale * factor }),
    );
  }
  function reset() {
    setTransform({ scale: 1, x: 0, y: 0 });
  }
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setTransform((current) => {
        const scale = imageScale(
          current.scale * Math.exp(-event.deltaY * 0.002),
        );
        const img = image.current;
        return {
          scale,
          ...imagePan(
            current.x,
            current.y,
            scale,
            img?.offsetWidth ?? 0,
            img?.offsetHeight ?? 0,
            view.clientWidth,
            view.clientHeight,
          ),
        };
      });
    };
    view.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(() =>
      setTransform((current) => {
        const img = image.current;
        return {
          ...current,
          ...imagePan(
            current.x,
            current.y,
            current.scale,
            img?.offsetWidth ?? 0,
            img?.offsetHeight ?? 0,
            view.clientWidth,
            view.clientHeight,
          ),
        };
      }),
    );
    observer.observe(view);
    return () => {
      view.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-labelledby="image-viewer-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="image-viewer-toolbar">
        <div>
          <strong id="image-viewer-title">{title}</strong>
          <small>{dimensions || "Visualização da imagem"}</small>
        </div>
        <div className="image-viewer-actions">
          <button
            type="button"
            aria-label="Reduzir zoom"
            disabled={status !== "ready" || transform.scale <= 1}
            onClick={() => zoom(1 / 1.25)}
          >
            −
          </button>
          <output aria-label="Zoom">
            {Math.round(transform.scale * 100)}%
          </output>
          <button
            type="button"
            aria-label="Ampliar zoom"
            disabled={status !== "ready" || transform.scale >= 8}
            onClick={() => zoom(1.25)}
          >
            +
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label="Restaurar zoom"
            title="Restaurar zoom"
          >
            <Icon name="refresh" size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar visualizador"
            autoFocus
          >
            <Icon name="close" size={20} />
          </button>
        </div>
      </header>
      <div
        ref={viewport}
        className={`image-viewer-viewport${transform.scale > 1 ? " zoomed" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const before = [...pointers.current.values()];
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          const after = [...pointers.current.values()];
          if (before.length === 2) {
            const distance = (points: typeof before) =>
              Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const start = distance(before);
            if (start > 0) zoom(distance(after) / start);
          } else if (before.length === 1) {
            setTransform((current) =>
              constrain({
                ...current,
                x: current.x + event.clientX - previous.x,
                y: current.y + event.clientY - previous.y,
              }),
            );
          }
        }}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) =>
          pointers.current.delete(event.pointerId)
        }
      >
        {status === "loading" && <p role="status">Carregando imagem...</p>}
        {status === "error" && (
          <p role="alert">
            Não foi possível exibir esta imagem. Feche o visualizador e tente
            carregar a mídia novamente.
          </p>
        )}
        {/* The same authenticated Blob URL is reused without a second API request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={image}
          src={src}
          alt={`${title} pelo WhatsApp ampliada`}
          draggable={false}
          className={status === "ready" ? "" : "image-viewer-hidden"}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
          onLoad={(event) => {
            setStatus("ready");
            setDimensions(
              `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`,
            );
          }}
          onError={() => setStatus("error")}
        />
      </div>
      <p className="image-viewer-help">
        Use os botões, a roda do mouse ou dois dedos para ampliar. Arraste para
        mover. Esc fecha.
      </p>
    </dialog>,
    document.body,
  );
}
