import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSessionCredentials } from './session-credentials';

function serializedBytes(base64 = false): {
  type: 'Buffer';
  data: number[] | string;
} {
  return { type: 'Buffer', data: base64 ? 'AQ==' : [1] };
}

function keyPair(base64 = false): {
  public: ReturnType<typeof serializedBytes>;
  private: ReturnType<typeof serializedBytes>;
} {
  return {
    public: serializedBytes(base64),
    private: serializedBytes(base64),
  };
}

function credentials(
  registered: boolean,
  base64 = false,
): Record<string, unknown> {
  return {
    registered,
    registrationId: 1,
    noiseKey: keyPair(base64),
    pairingEphemeralKeyPair: keyPair(base64),
    signedIdentityKey: keyPair(base64),
    signedPreKey: {
      keyId: 1,
      keyPair: keyPair(base64),
      signature: serializedBytes(base64),
    },
    firstUnuploadedPreKeyId: 1,
    nextPreKeyId: 2,
  };
}

function pairedCredentials(
  registered: boolean,
  base64 = false,
): Record<string, unknown> {
  return {
    ...credentials(registered, base64),
    me: { id: '15551234567:1@s.whatsapp.net' },
    account: { details: serializedBytes(base64) },
    signalIdentities: [
      {
        identifier: { name: '15551234567@s.whatsapp.net', deviceId: 1 },
        identifierKey: serializedBytes(base64),
      },
    ],
  };
}

describe('checkSessionCredentials', () => {
  let root: string;
  let sessionCount = 0;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'whatsapp-auth-check-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not restore when the session directory is missing', async () => {
    expect(await checkSessionCredentials(join(root, 'missing'))).toBe(
      'directory_missing',
    );
  });

  it('does not restore when creds.json is missing', async () => {
    const sessionDirectory = join(root, 'session');
    await mkdir(sessionDirectory);

    expect(await checkSessionCredentials(sessionDirectory)).toBe(
      'file_missing',
    );
  });

  it('rejects complete but unpaired credentials without identity', async () => {
    const sessionDirectory = await writeCredentials(credentials(false));

    expect(await checkSessionCredentials(sessionDirectory)).toBe('unpaired');
  });

  it('does not treat registered credentials without pairing identity as paired', async () => {
    const sessionDirectory = await writeCredentials(credentials(true));

    expect(await checkSessionCredentials(sessionDirectory)).toBe('unpaired');
  });

  it('accepts paired QR credentials when registered is false', async () => {
    const sessionDirectory = await writeCredentials(pairedCredentials(false));

    expect(await checkSessionCredentials(sessionDirectory)).toBe('paired');
  });

  it('accepts paired credentials with Baileys BufferJSON base64 bytes', async () => {
    const sessionDirectory = await writeCredentials(
      pairedCredentials(false, true),
    );

    expect(await checkSessionCredentials(sessionDirectory)).toBe('paired');
  });

  it.each(['', 'not-base64', 'AQ=', 'AQ===', 'AR=='])(
    'rejects invalid or empty base64 bytes (%s)',
    async (data) => {
      const invalid = pairedCredentials(false, true);
      const noiseKey = invalid.noiseKey as {
        public: { type: string; data: string | number[] };
      };
      noiseKey.public.data = data;
      const sessionDirectory = await writeCredentials(invalid);

      expect(await checkSessionCredentials(sessionDirectory)).toBe('invalid');
    },
  );

  it('continues accepting registered credentials with a valid identity', async () => {
    const sessionDirectory = await writeCredentials(pairedCredentials(true));

    expect(await checkSessionCredentials(sessionDirectory)).toBe('paired');
  });

  it('rejects malformed or incomplete credentials', async () => {
    const sessionDirectory = join(root, 'session');
    await mkdir(sessionDirectory);
    await writeFile(join(sessionDirectory, 'creds.json'), '{}');

    expect(await checkSessionCredentials(sessionDirectory)).toBe('invalid');

    await writeFile(join(sessionDirectory, 'creds.json'), '{malformed');

    expect(await checkSessionCredentials(sessionDirectory)).toBe('invalid');

    await writeFile(
      join(sessionDirectory, 'creds.json'),
      JSON.stringify({ ...credentials(false), me: { id: 'not-a-jid' } }),
    );

    expect(await checkSessionCredentials(sessionDirectory)).toBe('invalid');
  });

  it('rejects a pairing identity without all required identity indicators', async () => {
    const incomplete = {
      ...credentials(false),
      me: { id: '15551234567@s.whatsapp.net' },
    };
    const sessionDirectory = await writeCredentials(incomplete);

    expect(await checkSessionCredentials(sessionDirectory)).toBe('invalid');
  });

  async function writeCredentials(
    value: Record<string, unknown>,
  ): Promise<string> {
    sessionCount += 1;
    const sessionDirectory = join(root, `session-${sessionCount}`);
    await mkdir(sessionDirectory);
    await writeFile(
      join(sessionDirectory, 'creds.json'),
      JSON.stringify(value),
    );
    return sessionDirectory;
  }
});
