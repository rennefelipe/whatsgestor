import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IntegrationPolicy {
  readonly enabled: boolean;
  readonly autoRestore: boolean;
  readonly allowPairing: boolean;
  readonly allowSending: boolean;
  readonly reconnectLimit: number;
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
  readonly pendingLimit: number;
  readonly mediaTimeoutMs: number;
  readonly sendTimeoutMs: number;
  readonly recoveryLimit:number;
  readonly recoveryBaseMs:number;
  readonly recoveryMaxMs:number;
  constructor(readonly config: ConfigService) {
    const bool = (key: string) => {
      const value = config.get(key);
      if (value == null || value === 'false' || value === false) return false;
      if (value === 'true' || value === true) return true;
      throw new Error(`Configuracao invalida: ${key}.`);
    };
    const integer = (key: string, fallback: number, min: number, max: number) => {
      const value = config.get(key) ?? fallback;
      if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`Configuracao invalida: ${key}.`);
      return Number(value);
    };
    this.enabled = bool('WHATSAPP_INTEGRATION_ENABLED');
    this.autoRestore = bool('WHATSAPP_INTEGRATION_AUTO_RESTORE');
    this.allowPairing = bool('WHATSAPP_INTEGRATION_ALLOW_PAIRING');
    this.allowSending = bool('WHATSAPP_INTEGRATION_ALLOW_SEND');
    this.reconnectLimit = integer('WHATSAPP_RECONNECT_LIMIT', 3, 0, 10);
    this.reconnectBaseMs = integer('WHATSAPP_RECONNECT_BASE_MS', 2000, 1, 60000);
    this.reconnectMaxMs = integer('WHATSAPP_RECONNECT_MAX_MS', 30000, 1, 300000);
    this.pendingLimit = integer('WHATSAPP_PENDING_LIMIT', 256, 1, 4096);
    this.mediaTimeoutMs = integer('WHATSAPP_MEDIA_TIMEOUT_MS', 30000, 1, 120000);
    this.sendTimeoutMs = integer('WHATSAPP_SEND_TIMEOUT_MS', 30000, 1, 120000);
    this.recoveryLimit=integer('WHATSAPP_RECOVERY_LIMIT',3,1,10);
    this.recoveryBaseMs=integer('WHATSAPP_RECOVERY_BASE_MS',1000,1,60000);
    this.recoveryMaxMs=integer('WHATSAPP_RECOVERY_MAX_MS',30000,1,300000);
  }
}
