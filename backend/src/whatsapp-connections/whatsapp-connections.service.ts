import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';
import { CreateWhatsappConnectionDto } from './dto/create-whatsapp-connection.dto';
import { UpdateWhatsappConnectionActiveDto } from './dto/update-whatsapp-connection-active.dto';
import { UpdateWhatsappConnectionDto } from './dto/update-whatsapp-connection.dto';
import { WhatsappConnection } from './entities/whatsapp-connection.entity';

@Injectable()
export class WhatsappConnectionsService {
  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly connections: Repository<WhatsappConnection>,
    private readonly sessions: WhatsappSessionManagerService,
  ) {}

  findAll(): Promise<WhatsappConnection[]> {
    return this.connections.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<WhatsappConnection> {
    const connection = await this.connections.findOneBy({ id });
    if (!connection) {
      throw new NotFoundException('Conexão WhatsApp não encontrada.');
    }
    return connection;
  }

  async create(dto: CreateWhatsappConnectionDto): Promise<WhatsappConnection> {
    const connection = this.connections.create({
      name: dto.name.trim(),
      isActive: dto.isActive ?? true,
      status: 'disconnected',
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
    });
    return this.connections.save(connection);
  }

  async update(
    id: string,
    dto: UpdateWhatsappConnectionDto,
  ): Promise<WhatsappConnection> {
    const connection = await this.findOne(id);
    if (dto.name !== undefined) connection.name = dto.name.trim();
    if (dto.isActive !== undefined) connection.isActive = dto.isActive;
    await this.connections.save(connection);
    if (dto.isActive === false) {
      await this.sessions.disconnect(id);
      return this.findOne(id);
    }
    return connection;
  }

  updateActive(
    id: string,
    dto: UpdateWhatsappConnectionActiveDto,
  ): Promise<WhatsappConnection> {
    return this.update(id, { isActive: dto.isActive });
  }
}
