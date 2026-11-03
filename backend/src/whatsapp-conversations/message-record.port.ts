import type { WhatsappMessage } from './entities/whatsapp-message.entity';

export const CONVERSATION_MESSAGE_RECORDS = Symbol('CONVERSATION_MESSAGE_RECORDS');

/** Internal persistence boundary, independent of the WhatsApp provider. */
export interface MessageRecordInput {
  connectionId: string;
  remoteJid: string;
  whatsappMessageId: string;
  fromMe: boolean;
  origin: 'live' | 'history' | 'outgoing';
  contactName?: string | null;
  messageType?: string;
  textContent?: string | null;
  messageTimestamp?: Date | null;
  status?: string;
}

export interface ConversationMessageRecords {
  recordWithOutcome?(input: MessageRecordInput): Promise<{message:WhatsappMessage;duplicate:boolean}>;
  record(input: MessageRecordInput): Promise<WhatsappMessage>;
}
