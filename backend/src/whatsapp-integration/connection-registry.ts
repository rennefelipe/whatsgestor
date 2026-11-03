import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ConnectionRecord } from './contracts';

const columns = '[id],[name],[phoneNumber],[status],[isActive],[createdAt],[updatedAt],[lastConnectedAt],[lastDisconnectedAt]';
@Injectable()
export class ConnectionRegistry {
  constructor(private readonly database: DataSource) {}
  async list(): Promise<ConnectionRecord[]> { return this.database.query(`SELECT ${columns} FROM dbo.whatsapp_connections ORDER BY [createdAt] DESC,[id] ASC`); }
  async find(id: string): Promise<ConnectionRecord> {
    const rows = await this.database.query(`SELECT ${columns} FROM dbo.whatsapp_connections WHERE [id]=@0`, [id]);
    if (!rows[0]) throw new NotFoundException('Conexao WhatsApp nao encontrada.');
    return rows[0];
  }
  async create(name: string, active = true): Promise<ConnectionRecord> {
    const rows = await this.database.query(`INSERT INTO dbo.whatsapp_connections ([id],[name],[status],[isActive],[createdAt],[updatedAt])
      OUTPUT INSERTED.* VALUES (NEWID(),@0,N'disconnected',@1,SYSUTCDATETIME(),SYSUTCDATETIME())`, [name,active]);
    return rows[0];
  }
  async update(id: string, values: { name?: string; isActive?: boolean }): Promise<ConnectionRecord> {
    await this.find(id);
    if (values.name !== undefined) await this.database.query('UPDATE dbo.whatsapp_connections SET [name]=@0,[updatedAt]=SYSUTCDATETIME() WHERE [id]=@1',[values.name,id]);
    if (values.isActive !== undefined) await this.database.query('UPDATE dbo.whatsapp_connections SET [isActive]=@0,[updatedAt]=SYSUTCDATETIME() WHERE [id]=@1',[values.isActive,id]);
    return this.find(id);
  }
}
