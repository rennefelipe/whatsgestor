"use client";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useAuth } from "../auth/auth-provider";
import {
  panelLimits,
  panelWidth,
  readPanelWidth,
  writePanelWidth,
  subscribePanelWidth,
} from "./panel-width";

export function useConversationSplit(active = true) {
  const { user } = useAuth();
  const layoutRef = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const [drag, setDrag] = useState<{ userId: string; width: number } | null>(
    null,
  );
  const preference = useSyncExternalStore(
    subscribePanelWidth,
    () => readPanelWidth(user?.id),
    () => null,
  );
  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setContainerWidth(element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  const width = panelWidth(
    containerWidth,
    drag?.userId === user?.id ? (drag?.width ?? preference) : preference,
  );
  const limits = panelLimits(containerWidth);
  const reset = () => {
    setDrag(null);
    if (user) writePanelWidth(user.id, null);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !user)
      return;
    const left = layoutRef.current?.getBoundingClientRect().left ?? 0;
    setDrag({
      userId: user.id,
      width: panelWidth(containerWidth, event.clientX - left),
    });
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (user && drag?.userId === user.id) writePanelWidth(user.id, width);
    setDrag(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const separator = (
    <div
      className="conversation-divider"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Largura da lista de conversas"
      aria-controls="conversation-list conversation-chat"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      title="Arraste ou use as setas. Duplo clique ou Enter restaura a largura."
      onDoubleClick={reset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
      onKeyDown={(event) => {
        if (!user) return;
        const step = event.shiftKey ? 32 : 16;
        const next =
          event.key === "ArrowLeft"
            ? width - step
            : event.key === "ArrowRight"
              ? width + step
              : event.key === "Home"
                ? limits.min
                : event.key === "End"
                  ? limits.max
                  : null;
        if (event.key === "Enter") {
          event.preventDefault();
          reset();
        } else if (next !== null) {
          event.preventDefault();
          writePanelWidth(user.id, panelWidth(containerWidth, next));
        }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
  return {
    layoutRef,
    style: { "--conversation-list-width": `${width}px` } as CSSProperties,
    separator,
    reset,
  };
}
