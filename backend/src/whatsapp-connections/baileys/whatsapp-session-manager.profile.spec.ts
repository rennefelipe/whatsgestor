jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {},
  useMultiFileAuthState: jest.fn(),
}));
import { WhatsappSessionManagerService } from './whatsapp-session-manager.service';

describe('read-only profile query', () => {
  function fixture(connected = true, active = true) {
    const manager = Object.create(
      WhatsappSessionManagerService.prototype,
    ) as WhatsappSessionManagerService;
    const profilePictureUrl = jest
      .fn()
      .mockResolvedValue('https://pps.whatsapp.net/photo');
    const findOneBy = jest
      .fn()
      .mockResolvedValue({ isActive: active, status: 'connected' });
    Object.defineProperty(manager, 'connections', { value: { findOneBy } });
    Object.defineProperty(manager, 'sessions', {
      value: new Map([
        ['connection', { connected, socket: { profilePictureUrl } }],
      ]),
    });
    return { manager, profilePictureUrl, findOneBy };
  }
  it('uses the exact LID and preview with timeout on the existing socket', async () => {
    const f = fixture();
    expect(await f.manager.profilePictureUrl('connection', 'client@lid')).toBe(
      'https://pps.whatsapp.net/photo',
    );
    expect(f.profilePictureUrl).toHaveBeenCalledWith(
      'client@lid',
      'preview',
      5000,
    );
  });
  it('does not query or reconnect a disconnected session', async () => {
    const f = fixture(false);
    expect(
      await f.manager.profilePictureUrl('connection', 'client@lid'),
    ).toBeNull();
    expect(f.profilePictureUrl).not.toHaveBeenCalled();
    expect(f.findOneBy).not.toHaveBeenCalled();
  });
  it('does not query an inactive connection', async () => {
    const f = fixture(true, false);
    expect(
      await f.manager.profilePictureUrl('connection', 'client@lid'),
    ).toBeNull();
    expect(f.profilePictureUrl).not.toHaveBeenCalled();
  });
  it('treats denied or missing pictures as a normal fallback', async () => {
    const f = fixture();
    f.profilePictureUrl.mockRejectedValue(new Error('private'));
    expect(
      await f.manager.profilePictureUrl('connection', 'client@lid'),
    ).toBeNull();
  });
  it('never queries a group or guesses a telephone identifier', async () => {
    const f = fixture();
    expect(
      await f.manager.profilePictureUrl('connection', 'client@g.us'),
    ).toBeNull();
    expect(f.profilePictureUrl).not.toHaveBeenCalled();
  });
});
