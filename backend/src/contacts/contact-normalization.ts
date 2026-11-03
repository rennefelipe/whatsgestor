import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizeContactPhone(original: string) {
  const invalid = {
    normalizedPhone: null,
    candidateJid: null,
    reason: 'Número inválido ou formato não suportado',
  };
  let input = original.trim().replace(/\s/gu, '');
  if (/^\d+@s\.whatsapp\.net$/.test(input)) input = '+' + input.split('@')[0];
  if (!/^\+?[\d\s()./-]+$/.test(input)) return invalid;
  const digits = input.replace(/\D/g, '');
  if (/^(\d)\1+$/.test(digits)) return invalid;
  if (input.startsWith('00')) input = '+' + digits.slice(2);
  else if (!input.startsWith('+') && /^55\d{10,11}$/.test(digits))
    input = '+' + digits;
  const parsed = parsePhoneNumberFromString(input, {
    defaultCountry: 'BR',
    extract: false,
  });
  if (
    !parsed?.isValid() ||
    !['MOBILE', 'FIXED_LINE', 'FIXED_LINE_OR_MOBILE'].includes(
      parsed.getType() ?? '',
    )
  )
    return invalid;
  return {
    normalizedPhone: String(parsed.number),
    candidateJid: parsed.number.slice(1) + '@s.whatsapp.net',
    reason: null,
  };
}

// NFC preserves accents and compatibility characters. Only case and Unicode
// whitespace are ignored; punctuation and diacritics remain significant.
export function normalizeStoreName(value?: string | null): string | null {
  return (
    value
      ?.normalize('NFC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLocaleLowerCase('pt-BR')
      .normalize('NFC') || null
  );
}

export function contactPhoneMatcher(
  search: string,
): (original: string) => boolean {
  const target = normalizeContactPhone(search).normalizedPhone;
  if (target)
    return (original) =>
      target === normalizeContactPhone(original).normalizedPhone;
  // Preserve partial-number search, but never turn letters, extensions or LIDs
  // into a different valid number. Invalid full numbers only match literally.
  const input = search.trim();
  if (/^[\d\s()./-]+$/.test(input) && input.replace(/\D/g, '').length < 10) {
    const digits = input.replace(/\D/g, '');
    return (original) =>
      !!digits &&
      (
        normalizeContactPhone(original).normalizedPhone?.slice(1) ??
        original.replace(/[^0-9]/g, '')
      ).includes(digits);
  }
  return (original) => original.trim() === input;
}

export function matchesContactPhone(original: string, search: string): boolean {
  return contactPhoneMatcher(search)(original);
}
