import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type CredentialCheck =
  'directory_missing' | 'file_missing' | 'invalid' | 'unpaired' | 'paired';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPersistedBytes(value: unknown): boolean {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.length > 0;
  }
  if (!isRecord(value) || value.type !== 'Buffer') return false;

  if (typeof value.data === 'string') {
    if (
      value.data.length === 0 ||
      value.data.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.data,
      )
    ) {
      return false;
    }
    const decoded = Buffer.from(value.data, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value.data;
  }

  if (!Array.isArray(value.data)) return false;
  return (
    value.data.length > 0 &&
    value.data.every(
      (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )
  );
}

function isKeyPair(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPersistedBytes(value.public) &&
    isPersistedBytes(value.private)
  );
}

function hasRestorableCredentials(value: unknown): value is RecordValue {
  if (!isRecord(value)) return false;

  const signedPreKey = value.signedPreKey;
  return (
    typeof value.registered === 'boolean' &&
    Number.isInteger(value.registrationId) &&
    isKeyPair(value.noiseKey) &&
    isKeyPair(value.pairingEphemeralKeyPair) &&
    isKeyPair(value.signedIdentityKey) &&
    isRecord(signedPreKey) &&
    Number.isInteger(signedPreKey.keyId) &&
    isKeyPair(signedPreKey.keyPair) &&
    isPersistedBytes(signedPreKey.signature) &&
    Number.isInteger(value.firstUnuploadedPreKeyId) &&
    Number.isInteger(value.nextPreKeyId)
  );
}

function hasPairingIdentity(credentials: RecordValue): boolean {
  return (
    credentials.me !== undefined ||
    credentials.account !== undefined ||
    credentials.signalIdentities !== undefined
  );
}

function isPaired(credentials: RecordValue): boolean {
  const me = credentials.me;
  const account = credentials.account;
  const signalIdentities = credentials.signalIdentities;
  if (
    !isRecord(me) ||
    typeof me.id !== 'string' ||
    !/^[^@\s]+@[^@\s]+$/.test(me.id) ||
    !isRecord(account) ||
    Object.keys(account).length === 0 ||
    !Array.isArray(signalIdentities)
  ) {
    return false;
  }

  return signalIdentities.some((identity) => {
    if (!isRecord(identity) || !isRecord(identity.identifier)) return false;
    return (
      typeof identity.identifier.name === 'string' &&
      identity.identifier.name.length > 0 &&
      Number.isInteger(identity.identifier.deviceId) &&
      isPersistedBytes(identity.identifierKey)
    );
  });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

export async function checkSessionCredentials(
  directory: string,
): Promise<CredentialCheck> {
  try {
    const directoryInfo = await stat(directory);
    if (!directoryInfo.isDirectory()) return 'invalid';
  } catch (error) {
    return isNotFound(error) ? 'directory_missing' : 'invalid';
  }

  let contents: string;
  try {
    contents = await readFile(join(directory, 'creds.json'), 'utf8');
  } catch (error) {
    return isNotFound(error) ? 'file_missing' : 'invalid';
  }

  let credentials: unknown;
  try {
    credentials = JSON.parse(contents) as unknown;
  } catch {
    return 'invalid';
  }

  if (!hasRestorableCredentials(credentials)) return 'invalid';
  if (!hasPairingIdentity(credentials)) return 'unpaired';
  return isPaired(credentials) ? 'paired' : 'invalid';
}
