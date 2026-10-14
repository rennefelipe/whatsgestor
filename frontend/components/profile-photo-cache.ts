import { apiBlob } from "@/services/api/client";
const cache = new Map<string, { blob: Blob | null; expires: number }>();
const pending = new Map<string, Promise<Blob | null>>();
let active = 0;
const queue: Array<() => void> = [];
export async function profilePhoto(
  userId: string,
  path: string,
): Promise<Blob | null> {
  const key = userId + "/" + path;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.blob;
  const existing = pending.get(key);
  if (existing) return existing;
  if (active >= 2 && queue.length >= 32) return null;
  const load = async () => {
    if (active >= 2) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    let blob: Blob | null = null;
    try {
      const result = await apiBlob(path, AbortSignal.timeout(20_000));
      if (
        result.size > 0 &&
        result.size <= 512 * 1024 &&
        ["image/jpeg", "image/png", "image/webp"].includes(result.type)
      )
        blob = result;
    } catch {
      /* Private, absent or disconnected photos retain initials. */
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
    while (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, {
      blob,
      expires: Date.now() + (blob ? 5 * 60_000 : 2 * 60_000),
    });
    return blob;
  };
  const promise = load().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
export function contactInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  return words.length
    ? (
        Array.from(words[0])[0] +
        (words.length > 1 ? Array.from(words.at(-1)!)[0] : "")
      ).toLocaleUpperCase("pt-BR")
    : "?";
}
