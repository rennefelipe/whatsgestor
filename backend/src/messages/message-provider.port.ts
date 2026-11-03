import type { FileMetadata } from './file-policy';
import type { MessageRecordInput } from '../whatsapp-conversations/message-record.port';

/** Provider-independent contract retained for adapters. Preparing never sends. */
export interface MessageProvider {
  sendText(input: { connectionId: string; remoteJid: string; text: string; idempotencyKey: string; signal: AbortSignal }): Promise<MessageRecordInput>;
  sendFile(input: { connectionId: string; remoteJid: string; metadata: FileMetadata; content: Buffer; idempotencyKey: string; signal: AbortSignal }): Promise<MessageRecordInput>;
}
export const MESSAGE_INGRESS = Symbol('MESSAGE_INGRESS');
export const MESSAGE_RECEIPTS = Symbol('MESSAGE_RECEIPTS');
export const MESSAGE_STATES = ['pending', 'sent', 'delivered', 'read', 'failed', 'received'] as const;
export type MessageState = typeof MESSAGE_STATES[number];
export interface MessageReceipt {
  connectionId: string;
  remoteJid: string;
  whatsappMessageId: string;
  fromMe: boolean;
  status: MessageState;
}
