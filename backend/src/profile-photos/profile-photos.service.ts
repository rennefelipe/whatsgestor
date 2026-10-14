import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { WhatsappSessionManagerService } from '../whatsapp-connections/baileys/whatsapp-session-manager.service';
import { validMediaContent } from '../whatsapp-conversations/private-media-storage';

export interface ProfilePhoto {
  bytes: Buffer;
  mime: string;
}
export function allowedPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      /^(?:[a-z0-9-]+\.)*(?:whatsapp\.net|whatsapp\.com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

@Injectable()
export class ProfilePhotosService {
  private readonly cache = new Map<
    string,
    { expires: number; photo: ProfilePhoto | null }
  >();
  private readonly pending = new Map<string, Promise<ProfilePhoto | null>>();
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(
    @InjectRepository(WhatsappConversation)
    private readonly conversations: Repository<WhatsappConversation>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly sessions: WhatsappSessionManagerService,
  ) {}

  async conversation(id: string): Promise<ProfilePhoto | null> {
    const conversation = await this.conversations.findOneBy({ id });
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    return this.photo(conversation);
  }
  async contact(id: string): Promise<ProfilePhoto | null> {
    if (!(await this.contacts.existsBy({ id })))
      throw new NotFoundException('Contato não encontrado.');
    const linked = await this.conversations.find({
      where: { contactId: id },
      order: { lastMessageAt: 'DESC', id: 'ASC' },
      take: 21,
    });
    // No inferred numbers or LID/PN mapping. Ambiguous explicit links use initials.
    if (
      !linked.length ||
      linked.length > 20 ||
      new Set(linked.map((item) => item.remoteJid)).size !== 1
    )
      return null;
    const source = linked.find((item) =>
      this.sessions.hasConnectedProfileSession(item.connectionId),
    );
    return source ? this.photo(source) : null;
  }
  private async photo(
    conversation: WhatsappConversation,
  ): Promise<ProfilePhoto | null> {
    if (!/^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(conversation.remoteJid))
      return null;
    const key = conversation.connectionId + '/' + conversation.remoteJid;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.photo;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.active >= 2 && this.queue.length >= 16) return null;
    const request = this.load(conversation)
      .then((photo) => {
        this.cache.delete(key);
        while (this.cache.size >= 64) {
          for (const oldest of this.cache.keys()) {
            this.cache.delete(oldest);
            break;
          }
        }
        this.cache.set(key, {
          photo,
          expires: Date.now() + (photo ? 15 * 60_000 : 2 * 60_000),
        });
        return photo;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  private async load(
    conversation: WhatsappConversation,
  ): Promise<ProfilePhoto | null> {
    if (this.active >= 2)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      const url = await this.sessions.profilePictureUrl(
        conversation.connectionId,
        conversation.remoteJid,
      );
      if (!url || !allowedPhotoUrl(url)) return null;
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
      });
      const mime =
        response.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase() ?? '';
      if (
        !response.ok ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
        !response.body
      ) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.length;
          if (size > 512 * 1024) {
            await reader.cancel();
            return null;
          }
          chunks.push(Buffer.from(item.value));
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      return bytes.length && validMediaContent(mime, bytes.subarray(0, 32))
        ? { bytes, mime }
        : null;
    } catch {
      return null;
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
