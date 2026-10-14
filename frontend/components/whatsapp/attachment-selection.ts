export function validateAttachmentSelection(
  file: Pick<File, "name" | "type" | "size">,
): string | null {
  const types: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
  };
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!types[extension] || types[extension] !== file.type)
    return "Selecione JPEG, PNG, WebP ou PDF com extensão e tipo correspondentes.";
  if (!file.size) return "O arquivo está vazio.";
  if (file.size > (extension === "pdf" ? 20 : 5) * 1024 * 1024)
    return extension === "pdf"
      ? "O PDF deve ter até 20 MB."
      : "A imagem deve ter até 5 MB.";
  return null;
}
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const megabytes = bytes >= 1024 * 1024;
  return `${(bytes / (megabytes ? 1024 * 1024 : 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${megabytes ? "MB" : "KB"}`;
}
export function createAttachmentAttemptId(
  api: Pick<Crypto, "getRandomValues"> &
    Partial<Pick<Crypto, "randomUUID">> = globalThis.crypto,
): string {
  if (typeof api?.randomUUID === "function") return api.randomUUID();
  if (!api?.getRandomValues) throw new Error("Secure randomness unavailable");
  const bytes = api.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
