/** Version-independent envelope codec. Never treats a numeric-keyed business
 * object as bytes; typed arrays receive an explicit marker before persistence. */
export const stateReplacer = (_key: string, value: any): any => {
  if (value instanceof Uint8Array) return { type: 'Buffer', data: [...value] };
  if (typeof value === 'bigint') return { __wgBigInt: value.toString() };
  return value;
};
export const stateReviver = (_key: string, value: any): any => {
  if (value && (value.type === 'Buffer' || value.buffer === true)) {
    const data = value.data ?? value.value;
    if (typeof data === 'string') return Buffer.from(data, 'base64');
    if (Array.isArray(data) && data.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255)) return Buffer.from(data);
  }
  if (value && Object.keys(value).length === 1 && typeof value.__wgBigInt === 'string' && /^-?\d{1,30}$/.test(value.__wgBigInt)) return BigInt(value.__wgBigInt);
  return value;
};
export const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value, stateReplacer), stateReviver);
