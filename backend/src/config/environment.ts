type Environment = Record<string, unknown>;

function integer(value: unknown, name: string, fallback?: number): number {
  const candidate = value ?? fallback;
  if (!/^\d+$/.test(String(candidate))) {
    throw new Error(`Configuracao invalida: ${name} deve ser um inteiro de 1 a 65535.`);
  }
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Configuracao invalida: ${name} deve ser um inteiro de 1 a 65535.`);
  }
  return parsed;
}

function boolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Configuracao invalida: ${name} deve ser true ou false.`);
}

/** Validation errors contain names only, never supplied values. */
export function validateEnvironment(values: Environment): Environment {
  for (const key of ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
    if (typeof values[key] !== 'string' || !(values[key] as string).trim()) {
      throw new Error(`Configuracao invalida: ${key} obrigatorio.`);
    }
  }
  const host = values.HOST ?? '127.0.0.1';
  if (typeof values.JWT_SECRET !== 'string' || values.JWT_SECRET.trim().length < 32) {
    throw new Error('Configuracao invalida: JWT_SECRET deve ter pelo menos 32 caracteres.');
  }
  const jwtExpiration = values.JWT_EXPIRES_IN ?? '3600';
  if (!/^\d+$/.test(String(jwtExpiration)) || !Number.isSafeInteger(Number(jwtExpiration)) || Number(jwtExpiration) < 1) {
    throw new Error('Configuracao invalida: JWT_EXPIRES_IN deve ser um inteiro positivo em segundos.');
  }
  if (typeof host !== 'string' || !host.trim() || /[\s/]/.test(host)) {
    throw new Error('Configuracao invalida: HOST deve ser um endereco ou hostname.');
  }
  const rawOrigins = values.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000';
  if (typeof rawOrigins !== 'string') {
    throw new Error('Configuracao invalida: CORS_ORIGINS deve listar origens HTTP separadas por virgula.');
  }
  const origins = rawOrigins.split(',').map((origin) => origin.trim());
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      throw new Error('Configuracao invalida: CORS_ORIGINS deve conter origens HTTP exatas, sem caminhos.');
    }
  }
  return {
    ...values,
    JWT_EXPIRES_IN: Number(jwtExpiration),
    HOST: host,
    PORT: integer(values.PORT, 'PORT', 3001),
    DB_PORT: integer(values.DB_PORT, 'DB_PORT'),
    CORS_ORIGINS: [...new Set(origins)],
    DB_ENCRYPT: boolean(values.DB_ENCRYPT, 'DB_ENCRYPT', false),
    DB_TRUST_SERVER_CERTIFICATE: boolean(values.DB_TRUST_SERVER_CERTIFICATE, 'DB_TRUST_SERVER_CERTIFICATE', true),
  };
}
