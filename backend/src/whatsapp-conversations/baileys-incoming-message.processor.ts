import { whatsappMediaEnabled } from './media-feature';
import { incomingMedia } from './incoming-media';
import {
  receiveDiagnostic,
  receivedJidCategory,
  receivedMessageCategory,
} from './receive-diagnostics';
import {
  WhatsappMediaService,
  type MediaDownload,
} from './whatsapp-media.service';
import { Injectable, Logger } from '@nestjs/common';
import type { WAMessage } from '@whiskeysockets/baileys';
import {
  type PersistWhatsappMessageInput,
  WhatsappConversationsService,
} from './whatsapp-conversations.service';

export interface BaileysMessageUpsert {
  type: 'append' | 'notify';
  messages: WAMessage[];
  requestId?: string;
}

function getTextContent(message: WAMessage['message']): string | null {
  const content = message;
  if (!content) return null;
  if (typeof content.conversation === 'string') {
    return content.conversation.length > 0 ? content.conversation : null;
  }
  const extendedText = content.extendedTextMessage?.text;
  return typeof extendedText === 'string' && extendedText.length > 0
    ? extendedText
    : null;
}

function toMessageDate(timestamp: unknown): Date | null {
  let seconds: number;
  if (typeof timestamp === 'number') {
    seconds = timestamp;
  } else if (typeof timestamp === 'string') {
    seconds = Number(timestamp);
  } else if (typeof timestamp === 'object' && timestamp !== null) {
    if (
      !('low' in timestamp) ||
      !('high' in timestamp) ||
      typeof timestamp.low !== 'number' ||
      typeof timestamp.high !== 'number'
    ) {
      return null;
    }
    seconds = timestamp.high * 0x1_0000_0000 + (timestamp.low >>> 0);
  } else {
    return null;
  }

  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isIndividualRemoteJid(remoteJid: string): boolean {
  return (
    remoteJid !== 'status@broadcast' &&
    !remoteJid.endsWith('@g.us') &&
    !remoteJid.endsWith('@broadcast') &&
    !remoteJid.endsWith('@newsletter') &&
    /^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(remoteJid)
  );
}

export function normalizeIncomingMessage(
  connectionId: string,
  upsertType: BaileysMessageUpsert['type'],
  message: WAMessage,
): PersistWhatsappMessageInput | null {
  if (upsertType !== 'notify' || message.key.fromMe !== false) return null;

  const remoteJid = message.key.remoteJid;
  const whatsappMessageId = message.key.id;
  const media = incomingMedia(message);
  const textContent = media ? media.caption : getTextContent(message.message);
  if (
    !remoteJid ||
    !isIndividualRemoteJid(remoteJid) ||
    !whatsappMessageId ||
    (textContent === null && media === null)
  ) {
    return null;
  }

  return {
    connectionId,
    remoteJid,
    contactName: message.pushName ?? null,
    whatsappMessageId,
    fromMe: false,
    messageType: media?.kind ?? 'text',
    textContent,
    messageTimestamp: toMessageDate(message.messageTimestamp),
    status: 'received',
  };
}

@Injectable()
export class BaileysIncomingMessageProcessor {
  private readonly logger = new Logger(BaileysIncomingMessageProcessor.name);

  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly media?: WhatsappMediaService,
  ) {}

  async process(
    connectionId: string,
    upsert: BaileysMessageUpsert,
    download?: (message: WAMessage) => MediaDownload,
  ): Promise<void> {
    receiveDiagnostic('messages_upsert', {
      type: upsert.type === 'notify' ? 'notify' : 'append',
      count: upsert.messages.length,
      recovery: upsert.requestId !== undefined,
      mediaEnabled: whatsappMediaEnabled(),
    });

    const downloads: Promise<void>[] = [];
    for (const message of upsert.messages) {
      try {
        const summary = {
          type: upsert.type === 'notify' ? 'notify' : 'append',
          direction:
            message.key.fromMe === false
              ? 'incoming'
              : message.key.fromMe === true
                ? 'outgoing'
                : 'unknown',
          jidCategory: receivedJidCategory(message.key.remoteJid),
          category: receivedMessageCategory(message),
          recovery: upsert.requestId !== undefined,
        };
        if (upsert.type !== 'notify') {
          receiveDiagnostic('message_ignored', {
            ...summary,
            reason: 'append',
          });
          continue;
        }
        const input = normalizeIncomingMessage(
          connectionId,
          upsert.type,
          message,
        );
        const metadata = incomingMedia(message);
        if (
          metadata &&
          (!whatsappMediaEnabled() || upsert.requestId !== undefined)
        ) {
          receiveDiagnostic('message_ignored', {
            ...summary,
            reason: !whatsappMediaEnabled()
              ? 'media_disabled'
              : 'media_recovery',
          });
          continue;
        }
        if (input) {
          const persisted = await this.conversations.persistMessage(input, {
            allowAutomaticReopen: upsert.requestId === undefined,
          });
          receiveDiagnostic('message_persisted', summary);
          if (metadata && this.media)
            downloads.push(
              this.media
                .receive(persisted, metadata, download?.(message))
                .catch(() => {
                  this.logger.warn('whatsapp_media_processing_failed');
                }),
            );
        } else {
          receiveDiagnostic('message_ignored', {
            ...summary,
            reason:
              message.key.fromMe !== false
                ? 'direction'
                : !message.key.id
                  ? 'missing_id'
                  : !message.key.remoteJid ||
                      !isIndividualRemoteJid(message.key.remoteJid)
                    ? 'jid'
                    : 'unsupported_content',
          });
        }
      } catch {
        receiveDiagnostic('message_persistence_failed');
        this.logger.error('whatsapp_message_persistence_failed');
      }
    }
    await Promise.all(downloads);
  }
}
