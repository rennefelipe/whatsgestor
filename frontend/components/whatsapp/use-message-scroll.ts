"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { WhatsappMessage } from "@/types/api";
import { MessageScrollController } from "./message-scroll";

export function useMessageScroll(
  conversationId: string | undefined,
  messages: WhatsappMessage[],
  loading: boolean,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MessageScrollController | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const controller = new MessageScrollController(viewport, setShowLatest);
    controllerRef.current = controller;
    // Images and audio can settle after the message itself has been rendered.
    const observer = new ResizeObserver(() => controller.reconcile());
    observer.observe(content);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      controllerRef.current = null;
    };
  }, [conversationId]);

  useLayoutEffect(() => {
    controllerRef.current?.update(messages.at(-1)?.id, loading);
  }, [conversationId, messages, loading]);

  return {
    viewportRef,
    contentRef,
    showLatest,
    onScroll: useCallback(() => controllerRef.current?.onScroll(), []),
    latest: useCallback(() => controllerRef.current?.latest(), []),
    followSentMessage: useCallback(
      () => controllerRef.current?.followSentMessage(),
      [],
    ),
    preserveOlderMessages: useCallback(
      () => controllerRef.current?.preserveOlderMessages(),
      [],
    ),
  };
}
