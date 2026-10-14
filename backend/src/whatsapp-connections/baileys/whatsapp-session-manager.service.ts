import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import makeWASocket, {
  downloadMediaMessage,
  type ConnectionState,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import { Repository } from 'typeorm';
import type { Readable } from 'node:stream';
import { BaileysIncomingMessageProcessor } from '../../whatsapp-conversations/baileys-incoming-message.processor';
import {
  receiveDiagnostic,
  receiveFailureCategory,
} from '../../whatsapp-conversations/receive-diagnostics';
import { whatsappMediaEnabled } from '../../whatsapp-conversations/media-feature';
import { WhatsappConnection } from '../entities/whatsapp-connection.entity';
import {
  checkSessionCredentials,
  type CredentialCheck,
} from './session-credentials';

const QR_TTL_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;
const MANUAL_DISCONNECT_MARKER = 'manual-disconnect';
const SILENT_LOGGER = pino({ level: 'silent' });

type DisconnectClassification =
  | 'transient'
  | 'logout'
  | 'invalid_session'
  | 'connection_replaced'
  | 'unknown';

interface ManagedSession {
  socket?: ReturnType<typeof makeWASocket>;
  connected: boolean;
  startPromise?: Promise<void>;
  retryTimer?: NodeJS.Timeout;
  retryAttempts: number;
  stopRequested: boolean;
  pendingCredentialSave?: Promise<void>;
  qrCode?: string;
  qrExpiresAt?: Date;
  qrTimer?: NodeJS.Timeout;
  qrGeneration: number;
}

export interface SentWhatsappTextMessage {
  whatsappMessageId: string;
  messageTimestamp: Date | null;
}

export interface WhatsappConnectionStatus {
  id: string;
  status: WhatsappConnection['status'];
  phoneNumber: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
}

@Injectable()
export class WhatsappSessionManagerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsappSessionManagerService.name);
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly sessionsDirectory = resolve(
    process.env.WHATSAPP_SESSIONS_DIR ??
      join(homedir(), '.whatsgestor', 'whatsapp-sessions'),
  );

  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly connections: Repository<WhatsappConnection>,
    private readonly incomingMessages: BaileysIncomingMessageProcessor,
  ) {
    // Baileys creates auth files internally; a restrictive umask protects those writes.
    process.umask(0o077);
  }

  async onModuleInit(): Promise<void> {
    receiveDiagnostic('receiver_initialized', {
      mediaEnabled: whatsappMediaEnabled(),
    });
    this.logEvent('log', 'manager_initializing');
    await this.ensurePrivateDirectory(this.sessionsDirectory);
    const connections = await this.connections.findBy({ isActive: true });
    this.logEvent('log', 'active_connections_scanned', {
      count: connections.length,
    });

    for (const connection of connections) {
      const sessionDirectory = this.getSessionDirectory(connection.id);
      await this.secureExistingSessionFiles(sessionDirectory);
      if (await this.hasManualDisconnectMarker(sessionDirectory)) {
        this.logEvent('log', 'session_restore_skipped', {
          connectionId: connection.id,
          reason: 'manual_disconnect',
        });
        if (connection.status !== 'disconnected') {
          await this.updateConnection(connection.id, {
            status: 'disconnected',
            lastDisconnectedAt: new Date(),
          });
        }
        continue;
      }
      const credentialCheck = await this.checkCredentials(sessionDirectory);
      this.logEvent('log', 'session_credentials_checked', {
        connectionId: connection.id,
        result: credentialCheck,
      });
      if (credentialCheck !== 'paired') {
        this.logEvent('log', 'session_restore_skipped', {
          connectionId: connection.id,
          reason: `credentials_${credentialCheck}`,
        });
        if (connection.status !== 'disconnected') {
          await this.updateConnection(connection.id, {
            status: 'disconnected',
            lastDisconnectedAt: new Date(),
          });
        }
        continue;
      }

      this.logEvent('log', 'session_restore_eligible', {
        connectionId: connection.id,
      });
      const session = this.getOrCreateSession(connection.id);
      session.stopRequested = false;
      await this.updateConnection(connection.id, { status: 'reconnecting' });
      this.logEvent('log', 'session_restore_started', {
        connectionId: connection.id,
      });
      await this.startSocket(connection.id, session, true).catch(() => {
        this.logEvent('error', 'session_restore_failed', {
          connectionId: connection.id,
        });
      });
    }
    this.logEvent('log', 'manager_initialized');
  }

  async onModuleDestroy(): Promise<void> {
    this.logEvent('log', 'manager_shutdown_started', {
      sessions: this.sessions.size,
    });
    for (const [id, session] of this.sessions) {
      session.stopRequested = true;
      session.connected = false;
      this.clearTimers(session);
      const socket = session.socket;
      session.socket = undefined;
      if (socket) {
        this.logEvent('log', 'socket_shutdown_requested', {
          connectionId: id,
        });
      }
      socket?.end(undefined);
      await session.pendingCredentialSave;
      this.sessions.delete(id);
    }
    this.logEvent('log', 'manager_shutdown_completed');
  }

  async connect(id: string): Promise<WhatsappConnectionStatus> {
    const connection = await this.findConnection(id);
    if (!connection.isActive) {
      throw new BadRequestException(
        'Ative a conexão antes de iniciar a sessão.',
      );
    }

    const session = this.getOrCreateSession(id);
    if (session.socket || session.startPromise) {
      return this.getStatus(id);
    }
    this.clearRetryTimer(session);
    session.stopRequested = false;
    session.retryAttempts = 0;
    await this.ensurePrivateDirectory(this.getSessionDirectory(id));
    await rm(join(this.getSessionDirectory(id), MANUAL_DISCONNECT_MARKER), {
      force: true,
    });
    await this.startSocket(id, session, false);
    return this.getStatus(id);
  }

  async getQr(id: string): Promise<{ qrCode: string; expiresAt: Date }> {
    const connection = await this.findConnection(id);
    if (!connection.isActive) {
      throw new BadRequestException(
        'Ative a conexão antes de consultar o QR Code.',
      );
    }
    const session = this.sessions.get(id);
    if (
      !session?.qrCode ||
      !session.qrExpiresAt ||
      session.qrExpiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException(
        'Não há um QR Code válido para esta conexão.',
      );
    }
    return { qrCode: session.qrCode, expiresAt: session.qrExpiresAt };
  }

  async getStatus(id: string): Promise<WhatsappConnectionStatus> {
    const connection = await this.findConnection(id);
    return {
      id: connection.id,
      status: connection.status,
      phoneNumber: connection.phoneNumber,
      lastConnectedAt: connection.lastConnectedAt,
      lastDisconnectedAt: connection.lastDisconnectedAt,
    };
  }

  async sendText(
    connectionId: string,
    remoteJid: string,
    textContent: string,
  ): Promise<SentWhatsappTextMessage> {
    const connection = await this.connections.findOneBy({ id: connectionId });
    if (!connection) {
      throw new NotFoundException('Conexão WhatsApp não encontrada.');
    }

    const session = this.sessions.get(connectionId);
    if (
      !connection.isActive ||
      connection.status !== 'connected' ||
      !session?.connected ||
      !session.socket
    ) {
      throw new ServiceUnavailableException(
        'A conexão WhatsApp não está ativa e conectada.',
      );
    }

    let sentMessage: Awaited<ReturnType<typeof session.socket.sendMessage>>;
    try {
      sentMessage = await session.socket.sendMessage(remoteJid, {
        text: textContent,
      });
    } catch {
      throw new BadGatewayException(
        'Não foi possível confirmar o envio ao WhatsApp. Verifique a conversa antes de repetir.',
      );
    }
    if (!sentMessage?.key?.id) {
      throw new BadGatewayException(
        'O WhatsApp não confirmou a aceitação da mensagem. Verifique a conversa antes de repetir.',
      );
    }

    return {
      whatsappMessageId: sentMessage.key.id,
      messageTimestamp: this.toMessageDate(sentMessage.messageTimestamp),
    };
  }

  async profilePictureUrl(
    connectionId: string,
    remoteJid: string,
  ): Promise<string | null> {
    if (!/^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(remoteJid)) return null;
    const session = this.sessions.get(connectionId);
    if (!session?.connected || !session.socket) return null;
    const connection = await this.connections.findOneBy({ id: connectionId });
    if (!connection?.isActive || connection.status !== 'connected') return null;
    try {
      return (
        (await session.socket.profilePictureUrl(remoteJid, 'preview', 5_000)) ??
        null
      );
    } catch {
      return null;
    } // Missing/private photos are normal; do not log identifiers.
  }

  async assertAttachmentConnection(connectionId: string): Promise<void> {
    const connection = await this.connections.findOneBy({ id: connectionId });
    const session = this.sessions.get(connectionId);
    if (
      !connection?.isActive ||
      connection.status !== 'connected' ||
      !session?.connected ||
      !session.socket
    )
      throw new ServiceUnavailableException(
        'A conexão WhatsApp não está ativa e conectada.',
      );
  }

  async sendAttachment(
    connectionId: string,
    remoteJid: string,
    media: {
      kind: 'image' | 'document' | 'audio';
      mimeType: string;
      originalName: string;
      stream: Readable;
      durationSeconds?: number;
    },
  ): Promise<SentWhatsappTextMessage> {
    await this.assertAttachmentConnection(connectionId);
    const socket = this.sessions.get(connectionId)!.socket!;
    try {
      const result = await socket.sendMessage(
        remoteJid,
        media.kind === 'image'
          ? { image: { stream: media.stream }, mimetype: media.mimeType }
          : media.kind === 'document'
            ? {
                document: { stream: media.stream },
                mimetype: media.mimeType,
                fileName: media.originalName,
              }
            : {
                audio: { stream: media.stream },
                // Baileys/WhatsApp expect the Opus codec declaration for
                // interoperable voice notes; the private file remains audio/ogg.
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                seconds: media.durationSeconds,
              },
      );
      if (!result?.key?.id) throw Error('Missing acknowledgement');
      return {
        whatsappMessageId: result.key.id,
        messageTimestamp: this.toMessageDate(result.messageTimestamp),
      };
    } catch {
      throw new BadGatewayException(
        'Resultado do envio incerto. Confira o WhatsApp antes de enviar novamente.',
      );
    }
  }

  hasConnectedProfileSession(connectionId: string): boolean {
    const session = this.sessions.get(connectionId);
    return !!session?.connected && !!session.socket;
  }

  async disconnect(id: string): Promise<WhatsappConnectionStatus> {
    await this.findConnection(id);
    const sessionDirectory = this.getSessionDirectory(id);
    const session = this.sessions.get(id);
    if (session) {
      session.stopRequested = true;
      this.clearTimers(session);
      session.connected = false;
      const socket = session.socket;
      session.socket = undefined;
      socket?.end(undefined);
      await session.pendingCredentialSave;
      this.clearQr(session);
    }
    if ((await this.checkCredentials(sessionDirectory)) === 'paired') {
      await this.ensurePrivateDirectory(sessionDirectory);
      await writeFile(join(sessionDirectory, MANUAL_DISCONNECT_MARKER), '1', {
        mode: 0o600,
      });
      await this.secureSessionFiles(sessionDirectory);
    }
    await this.updateConnection(id, {
      status: 'disconnected',
      lastDisconnectedAt: new Date(),
    });
    return this.getStatus(id);
  }

  async logout(id: string): Promise<WhatsappConnectionStatus> {
    await this.disconnect(id);
    await rm(this.getSessionDirectory(id), { recursive: true, force: true });
    await this.updateConnection(id, { phoneNumber: null });
    return this.getStatus(id);
  }

  private async startSocket(
    id: string,
    session: ManagedSession,
    restoring: boolean,
  ): Promise<void> {
    if (session.socket) return;
    if (session.startPromise) return session.startPromise;

    session.startPromise = this.createSocket(id, session, restoring).finally(
      () => {
        session.startPromise = undefined;
      },
    );
    return session.startPromise;
  }

  private async createSocket(
    id: string,
    session: ManagedSession,
    restoring: boolean,
  ): Promise<void> {
    const sessionDirectory = this.getSessionDirectory(id);
    this.logEvent('log', 'socket_creation_started', {
      connectionId: id,
      restoring,
    });
    try {
      await this.ensurePrivateDirectory(sessionDirectory);

      const { state, saveCreds } =
        await useMultiFileAuthState(sessionDirectory);
      if (session.stopRequested) return;
      const socket = makeWASocket({
        auth: state,
        logger: SILENT_LOGGER,
        printQRInTerminal: false,
        qrTimeout: QR_TTL_MS,
        shouldSyncHistoryMessage: () => false,
        syncFullHistory: false,
      });
      session.socket = socket;

      socket.ev.on('creds.update', () => {
        if (session.socket !== socket) return;
        session.pendingCredentialSave = (
          session.pendingCredentialSave ?? Promise.resolve()
        )
          .then(() => saveCreds())
          .then(() => this.secureSessionFiles(sessionDirectory))
          .then(() => {
            this.logEvent('log', 'credentials_saved', {
              connectionId: id,
            });
          })
          .catch(() => {
            this.logEvent('error', 'credentials_save_failed', {
              connectionId: id,
            });
          });
      });

      socket.ev.on('connection.update', (update) => {
        void this.handleConnectionUpdate(id, session, socket, update).catch(
          () => {
            this.logEvent('error', 'connection_update_handling_failed', {
              connectionId: id,
            });
          },
        );
      });
      socket.ev.on('messages.upsert', (upsert) => {
        if (session.socket !== socket) {
          receiveDiagnostic('stale_socket_upsert_ignored');
          return;
        }
        void this.incomingMessages
          .process(
            id,
            upsert,
            (message) => (signal) =>
              downloadMediaMessage(message, 'stream', {
                options: { signal, timeout: 30_000, maxRedirects: 0 },
              }),
          )
          .catch(() => {
            this.logEvent('error', 'message_event_processing_failed', {
              connectionId: id,
            });
          });
      });
      await this.secureSessionFiles(sessionDirectory);
      this.logEvent('log', 'socket_creation_completed', {
        connectionId: id,
      });
    } catch {
      session.socket = undefined;
      await this.updateConnection(id, { status: 'error' });
      this.logEvent('error', 'socket_creation_failed', {
        connectionId: id,
        restoring,
      });
      if (restoring) {
        throw new ServiceUnavailableException(
          'Não foi possível restaurar a sessão WhatsApp.',
        );
      }
      throw new ServiceUnavailableException(
        'Não foi possível iniciar a sessão WhatsApp.',
      );
    }
  }

  private async handleConnectionUpdate(
    id: string,
    session: ManagedSession,
    socket: ReturnType<typeof makeWASocket>,
    update: Partial<ConnectionState>,
  ): Promise<void> {
    if (session.socket !== socket) {
      if (update.connection === 'close') {
        const disconnectCode = this.getDisconnectCode(
          update.lastDisconnect?.error,
        );
        this.logEvent('warn', 'stale_socket_close_ignored', {
          connectionId: id,
          disconnectCode: disconnectCode ?? null,
          classification: this.classifyDisconnect(disconnectCode),
        });
      }
      return;
    }

    if (update.qr) {
      this.logEvent('log', 'connection_update_qr_received', {
        connectionId: id,
      });
      this.clearQr(session);
      const qrGeneration = session.qrGeneration;
      const qrCode = await QRCode.toDataURL(update.qr, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      });
      if (session.socket !== socket || session.qrGeneration !== qrGeneration) {
        return;
      }
      session.qrCode = qrCode;
      session.qrExpiresAt = new Date(Date.now() + QR_TTL_MS);
      session.qrTimer = setTimeout(() => {
        this.clearQr(session);
        void this.updateConnection(id, { status: 'connecting' }).catch(() => {
          this.logEvent('error', 'connection_status_update_failed', {
            connectionId: id,
            status: 'connecting',
          });
        });
      }, QR_TTL_MS);
      await this.updateConnection(id, { status: 'qr_ready' });
      return;
    }

    if (update.connection === 'open') {
      receiveDiagnostic('connection_open');
      session.connected = true;
      this.logEvent('log', 'connection_update_open', {
        connectionId: id,
      });
      this.clearQr(session);
      session.retryAttempts = 0;
      const phoneNumber = socket.user?.id?.split('@')[0].split(':')[0] ?? null;
      await this.updateConnection(id, {
        status: 'connected',
        phoneNumber,
        lastConnectedAt: new Date(),
      });
      return;
    }

    if (update.connection === 'connecting') {
      this.logEvent('log', 'connection_update_connecting', {
        connectionId: id,
      });
      await this.updateConnection(id, {
        status: session.retryAttempts > 0 ? 'reconnecting' : 'connecting',
      });
      return;
    }

    if (update.connection !== 'close') return;
    receiveDiagnostic('connection_close', {
      code: this.getDisconnectCode(update.lastDisconnect?.error) ?? null,
      category: receiveFailureCategory(update.lastDisconnect?.error),
    });

    session.connected = false;
    session.socket = undefined;
    this.clearQr(session);
    const disconnectCode = this.getDisconnectCode(update.lastDisconnect?.error);
    const disconnectClassification = this.classifyDisconnect(disconnectCode);
    this.logEvent('warn', 'connection_update_close', {
      connectionId: id,
      disconnectCode: disconnectCode ?? null,
      classification: disconnectClassification,
    });
    await this.updateConnection(id, {
      status: 'disconnected',
      lastDisconnectedAt: new Date(),
    });

    if (
      session.stopRequested ||
      disconnectCode === DisconnectReason.loggedOut ||
      disconnectCode === DisconnectReason.badSession ||
      disconnectCode === DisconnectReason.forbidden ||
      disconnectCode === DisconnectReason.connectionReplaced
    ) {
      this.logEvent('warn', 'reconnection_stopped', {
        connectionId: id,
        disconnectCode: disconnectCode ?? null,
        classification: disconnectClassification,
        stopRequested: session.stopRequested,
      });
      // A close event is not authorization to destroy credentials. Even 500 can
      // originate from a WebSocket error; preserve files for diagnosis/recovery.
      receiveDiagnostic('session_preserved_after_close');
      if (!session.stopRequested) {
        await this.updateConnection(id, { status: 'error' });
      }
      return;
    }

    await this.scheduleReconnect(id, session);
  }

  private async scheduleReconnect(
    id: string,
    session: ManagedSession,
  ): Promise<void> {
    if (session.stopRequested || session.retryTimer) return;
    if (session.retryAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logEvent('error', 'reconnection_limit_reached', {
        connectionId: id,
        attempts: session.retryAttempts,
      });
      void this.updateConnection(id, { status: 'error' }).catch(() => {
        this.logEvent('error', 'connection_status_update_failed', {
          connectionId: id,
          status: 'error',
        });
      });
      return;
    }

    const delay = RECONNECT_BASE_DELAY_MS * 2 ** session.retryAttempts;
    session.retryAttempts += 1;
    this.logEvent('warn', 'reconnection_scheduled', {
      connectionId: id,
      attempt: session.retryAttempts,
      delayMs: delay,
    });
    await this.updateConnection(id, { status: 'reconnecting' });
    session.retryTimer = setTimeout(() => {
      session.retryTimer = undefined;
      if (session.stopRequested) return;
      void this.startSocket(id, session, true).catch(() => {
        if (session.retryAttempts >= MAX_RECONNECT_ATTEMPTS) {
          void this.updateConnection(id, { status: 'error' }).catch(() => {
            this.logEvent('error', 'connection_status_update_failed', {
              connectionId: id,
              status: 'error',
            });
          });
        } else {
          void this.scheduleReconnect(id, session).catch(() => {
            this.logEvent('error', 'reconnection_schedule_failed', {
              connectionId: id,
            });
          });
        }
      });
    }, delay);
  }

  private getDisconnectCode(error?: Error): number | undefined {
    if (
      error &&
      'output' in error &&
      typeof error.output === 'object' &&
      error.output !== null &&
      'statusCode' in error.output &&
      typeof error.output.statusCode === 'number'
    ) {
      // Baileys maps unclassified WebSocket failures to 500, also used for
      // badSession. Transport failures should follow the bounded retry path.
      if (
        error.output.statusCode === Number(DisconnectReason.badSession) &&
        error.message.startsWith('WebSocket Error (')
      ) {
        return DisconnectReason.connectionLost;
      }
      return error.output.statusCode;
    }
    return undefined;
  }

  private toMessageDate(timestamp: unknown): Date | null {
    let seconds: number;
    if (typeof timestamp === 'number') {
      seconds = timestamp;
    } else if (
      typeof timestamp === 'object' &&
      timestamp !== null &&
      'low' in timestamp &&
      'high' in timestamp &&
      typeof timestamp.low === 'number' &&
      typeof timestamp.high === 'number'
    ) {
      seconds = timestamp.high * 0x1_0000_0000 + (timestamp.low >>> 0);
    } else {
      return null;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private classifyDisconnect(
    code: number | undefined,
  ): DisconnectClassification {
    if (code === DisconnectReason.loggedOut) return 'logout';
    if (
      code === DisconnectReason.badSession ||
      code === DisconnectReason.forbidden
    ) {
      return 'invalid_session';
    }
    if (code === DisconnectReason.connectionReplaced) {
      return 'connection_replaced';
    }
    if (
      code === DisconnectReason.connectionClosed ||
      code === DisconnectReason.connectionLost ||
      code === DisconnectReason.timedOut ||
      code === DisconnectReason.restartRequired ||
      code === DisconnectReason.unavailableService ||
      code === DisconnectReason.multideviceMismatch
    ) {
      return 'transient';
    }
    return 'unknown';
  }

  private async findConnection(id: string): Promise<WhatsappConnection> {
    const connection = await this.connections.findOneBy({ id });
    if (!connection) {
      throw new NotFoundException('Conexão WhatsApp não encontrada.');
    }
    return connection;
  }

  private async updateConnection(
    id: string,
    fields: Partial<
      Pick<
        WhatsappConnection,
        'status' | 'phoneNumber' | 'lastConnectedAt' | 'lastDisconnectedAt'
      >
    >,
  ): Promise<void> {
    const result = await this.connections.update(id, fields);
    const status = fields.status;
    if (status !== undefined) {
      if (result.affected === 0) {
        this.logEvent('warn', 'connection_status_update_missing', {
          connectionId: id,
          status,
        });
      } else {
        this.logEvent('log', 'connection_status_updated', {
          connectionId: id,
          status,
        });
      }
    }
  }

  private getOrCreateSession(id: string): ManagedSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = {
        retryAttempts: 0,
        stopRequested: true,
        connected: false,
        qrGeneration: 0,
      };
      this.sessions.set(id, session);
    }
    return session;
  }

  private getSessionDirectory(id: string): string {
    return join(this.sessionsDirectory, id);
  }

  private async checkCredentials(directory: string): Promise<CredentialCheck> {
    return checkSessionCredentials(directory);
  }

  private async hasManualDisconnectMarker(directory: string): Promise<boolean> {
    try {
      const marker = await stat(join(directory, MANUAL_DISCONNECT_MARKER));
      return marker.isFile();
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return false;
      }
      this.logEvent('warn', 'manual_disconnect_marker_invalid');
      return true;
    }
  }

  private async ensurePrivateDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await chmod(directory, 0o700);
    }
  }

  private async secureSessionFiles(directory: string): Promise<void> {
    await this.ensurePrivateDirectory(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.ensurePrivateDirectory(entryPath);
      } else if (entry.isFile() && process.platform !== 'win32') {
        await chmod(entryPath, 0o600);
      }
    }
  }

  private async secureExistingSessionFiles(directory: string): Promise<void> {
    try {
      const directoryInfo = await stat(directory);
      if (directoryInfo.isDirectory()) {
        await this.secureSessionFiles(directory);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  private clearQr(session: ManagedSession): void {
    session.qrGeneration += 1;
    if (session.qrTimer) clearTimeout(session.qrTimer);
    session.qrTimer = undefined;
    session.qrCode = undefined;
    session.qrExpiresAt = undefined;
  }

  private clearRetryTimer(session: ManagedSession): void {
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.retryTimer = undefined;
  }

  private clearTimers(session: ManagedSession): void {
    this.clearRetryTimer(session);
    this.clearQr(session);
  }

  private logEvent(
    level: 'log' | 'warn' | 'error',
    event: string,
    details: Record<string, string | number | boolean | null> = {},
  ): void {
    const message = JSON.stringify({ event, ...details });
    if (level === 'error') {
      this.logger.error(message);
    } else if (level === 'warn') {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
