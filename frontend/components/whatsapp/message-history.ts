import type { PaginatedResponse, WhatsappMessage } from "@/types/api";

// Retain a useful recent window even when the last ascending page has one item.
// Polling catches every crossed page and never moves the older-history cursor.
export async function loadRecentHistory(
  read: (page: number) => Promise<PaginatedResponse<WhatsappMessage>>,
  pageSize: number,
  previousLatestPage = 0,
) {
  const first = await read(1);
  const latestPage = Math.max(1, Math.ceil(first.total / pageSize));
  const firstLoadedPage = previousLatestPage
    ? Math.min(previousLatestPage, latestPage)
    : Math.max(1, latestPage - 1);
  if (latestPage - firstLoadedPage >= 20)
    throw new Error(
      "Há muitas mensagens novas. Reabra esta conversa para carregar o histórico recente.",
    );
  const items: WhatsappMessage[] = [];
  for (let page = firstLoadedPage; page <= latestPage; page++) {
    const result = page === 1 ? first : await read(page);
    if (result.total !== first.total)
      throw new Error(
        "O histórico mudou durante a consulta. Atualize novamente.",
      );
    items.push(...result.items);
  }
  return { items, total: first.total, firstLoadedPage, latestPage };
}
