// Keep current text/history endpoints usable until the additive migration is approved and applied.
export function whatsappMediaEnabled(): boolean {
  return process.env.WHATSAPP_MEDIA_ENABLED === 'true';
}
