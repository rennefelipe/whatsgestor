import { Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {},
  useMultiFileAuthState: jest.fn(),
}));
import { WhatsappSessionManagerService } from '../whatsapp-connections/baileys/whatsapp-session-manager.service';
import {
  ProfilePhotosService,
  allowedPhotoUrl,
} from './profile-photos.service';

describe('private profile photos', () => {
  const conversation = {
    id: 'conversation',
    connectionId: 'connection',
    remoteJid: 'synthetic@lid',
    contactId: 'contact',
  };
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });
  function fixture(url: string | null = 'https://pps.whatsapp.net/photo') {
    const conversations = {
      findOneBy: jest.fn().mockResolvedValue(conversation),
      find: jest.fn().mockResolvedValue([conversation]),
    };
    const contacts = { existsBy: jest.fn().mockResolvedValue(true) };
    const sessions = {
      profilePictureUrl: jest.fn().mockResolvedValue(url),
      hasConnectedProfileSession: jest.fn().mockReturnValue(true),
    };
    const service = new ProfilePhotosService(
      conversations as unknown as Repository<WhatsappConversation>,
      contacts as unknown as Repository<Contact>,
      sessions as unknown as WhatsappSessionManagerService,
    );
    const download = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    global.fetch = download;
    return { service, conversations, sessions, download };
  }
  it('preserves exact LID, deduplicates concurrent queries and caches bytes', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      f.service.conversation('conversation'),
      f.service.conversation('conversation'),
    ]);
    expect(a?.mime).toBe('image/png');
    expect(a).toBe(b);
    expect(f.sessions.profilePictureUrl).toHaveBeenCalledWith(
      'connection',
      'synthetic@lid',
    );
    await f.service.conversation('conversation');
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.sessions.profilePictureUrl).toHaveBeenCalledTimes(1);
  });
  it('negative-caches unavailable/private/disconnected photos', async () => {
    const f = fixture(null);
    expect(await f.service.conversation('conversation')).toBeNull();
    expect(await f.service.conversation('conversation')).toBeNull();
    expect(f.sessions.profilePictureUrl).toHaveBeenCalledTimes(1);
    expect(f.download).not.toHaveBeenCalled();
  });
  it('never derives a phone number or chooses an ambiguous contact link', async () => {
    const f = fixture();
    f.conversations.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        conversation,
        { ...conversation, remoteJid: 'other@s.whatsapp.net' },
      ]);
    expect(await f.service.contact('contact')).toBeNull();
    expect(await f.service.contact('contact')).toBeNull();
    expect(f.sessions.profilePictureUrl).not.toHaveBeenCalled();
  });
  it('loads a contact only through an explicit conversation link', async () => {
    const f = fixture();
    expect(await f.service.contact('contact')).not.toBeNull();
    expect(f.conversations.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'contact' } }),
    );
  });
  it.each([
    'http://pps.whatsapp.net/a',
    'https://127.0.0.1/a',
    'https://pps.whatsapp.net.evil.test/a',
    'https://user:password@pps.whatsapp.net/a',
    'https://pps.whatsapp.net:8443/a',
  ])('rejects unsafe photo URL %s', async (url) => {
    const f = fixture(url);
    expect(allowedPhotoUrl(url)).toBe(false);
    expect(await f.service.conversation('conversation')).toBeNull();
    expect(f.download).not.toHaveBeenCalled();
  });
  it('rejects SVG, invalid signatures, oversized data and network failures', async () => {
    for (const response of [
      new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      new Response('invalid', { headers: { 'content-type': 'image/png' } }),
      new Response(new Uint8Array(512 * 1024 + 1), {
        headers: { 'content-type': 'image/png' },
      }),
    ]) {
      const f = fixture();
      f.download.mockResolvedValue(response);
      expect(await f.service.conversation('conversation')).toBeNull();
    }
    const f = fixture();
    f.download.mockRejectedValue(new Error('synthetic network failure'));
    expect(await f.service.conversation('conversation')).toBeNull();
  });
  it('refreshes a positive cache after expiry', async () => {
    jest.useFakeTimers();
    const f = fixture();
    await f.service.conversation('conversation');
    jest.setSystemTime(Date.now() + 16 * 60_000);
    await f.service.conversation('conversation');
    expect(f.download).toHaveBeenCalledTimes(2);
  });
});
