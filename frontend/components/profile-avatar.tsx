"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import { contactInitials, profilePhoto } from "./profile-photo-cache";

export function ProfileAvatar({
  name,
  conversationId,
  contactId,
  className = "",
}: {
  name: string;
  conversationId?: string;
  contactId?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const container = useRef<HTMLSpanElement>(null);
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const path = conversationId
    ? `/whatsapp-profile-photos/conversations/${encodeURIComponent(conversationId)}`
    : contactId
      ? `/whatsapp-profile-photos/contacts/${encodeURIComponent(contactId)}`
      : null;
  const userId = user?.id;
  const key = userId + "/" + path;
  useEffect(() => {
    if (!userId || !path) return;
    let stopped = false;
    let visible = false;
    let url: string | null = null;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      void profilePhoto(userId, path).then((blob) => {
        if (stopped) return;
        if (url) URL.revokeObjectURL(url);
        url = blob ? URL.createObjectURL(blob) : null;
        setPhoto(url ? { key, url } : null);
        setFailed(null);
      });
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) load();
    });
    if (container.current) observer.observe(container.current);
    const refresh = () => {
      if (visible) load();
    };
    const timer = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      if (url) URL.revokeObjectURL(url);
    };
  }, [userId, path, key]);
  const src = photo?.key === key && failed !== photo.url ? photo.url : null;
  return (
    <span
      className={`profile-avatar ${className}`}
      ref={container}
      aria-hidden="true"
    >
      {src ? (
        // Authenticated object URL; never load a private WhatsApp URL in the browser.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={36}
          height={36}
          onError={() => setFailed(src)}
        />
      ) : (
        contactInitials(name)
      )}
    </span>
  );
}
