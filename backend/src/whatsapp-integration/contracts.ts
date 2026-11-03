import type { FileMetadata } from '../messages/file-policy';
import type { MessageRecordInput } from '../whatsapp-conversations/message-record.port';
import { HttpException } from '@nestjs/common';

export type ConnectionState = 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'reconnecting' | 'error' | 'manually_disconnected';
export interface ConnectionRecord { id: string; name: string; phoneNumber: string | null; status: string; isActive: boolean;
  createdAt?: Date; updatedAt?: Date; lastConnectedAt?: Date | null; lastDisconnectedAt?: Date | null }
export interface EventSource { on(event: string, listener: (value: any) => void): unknown; off(event: string, listener: (value: any) => void): unknown }
export interface ProviderSocket {
  events: EventSource;
  transport?: EventSource;
  diagnostics?:EventSource;
  isOpen(): boolean;
  isBuffering(): boolean | null;
  close(): Promise<void>;
  saveCredentials(update?: Record<string,unknown>): Promise<void>;
  /** Production factory owns auth events from construction through shutdown. */
  managesCredentials?: boolean;
  authStorageFailure?(): Error | undefined;
  authentication?(): { hasIdentity: boolean; registered: boolean };
  reserveMessageId?(): string;
  send(remoteJid: string, payload: Record<string, unknown>, idempotencyId: string, signal: AbortSignal): Promise<any>;
  download(message: any, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
  resolveIdentity?(jid:string):Promise<string | null>;
}
export interface SocketFactory {
  hasAuthenticatedSession?(connectionId: string): Promise<boolean>;
  open(connectionId: string, allowPairing: boolean): Promise<ProviderSocket>;
  release(connectionId: string): Promise<void>;
  qrDataUrl(value: string): Promise<string>;
  withSessionLock?<T>(connectionId: string, work: () => Promise<T>): Promise<T>;
}
export interface StateStore {
  get<T>(namespace: string, key: string): Promise<T | null>;
  put(namespace: string, key: string, value: unknown): Promise<void>;
  remove(namespace: string, key: string): Promise<void>;
  entries<T>(namespace: string): Promise<Array<{ key: string; value: T }>>;
}
export interface IngressResult { message: { id: string; conversationId: string; whatsappMessageId?: string }; media?: unknown; duplicate?: boolean }
export interface IntegrationMessages {
  ingest(input: MessageRecordInput, attachment?: { metadata: FileMetadata; content: Buffer }): Promise<IngressResult>;
}
export const SOCKET_FACTORY = Symbol('SOCKET_FACTORY');
export const WHATSAPP_STATE = Symbol('WHATSAPP_STATE');

export function codedError(code: string, status = 503): Error & { code: string; status: number } {
  return Object.assign(new HttpException({statusCode:status,code,message:code},status), { code }) as unknown as Error & {code:string;status:number};
}
export function errorCode(error: any): number | string | null {
  for (const value of [error?.output?.statusCode, error?.statusCode, error?.driverError?.number, error?.number, error?.response?.status, error?.code, error?.cause?.code, error?.status]) {
    if (Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)) return value;
  }
  return null;
}
