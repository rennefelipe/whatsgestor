import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { conversationQuery } from './conversation-query';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { DomainEvents } from '../events/domain-events';
import { randomUUID } from 'node:crypto';
import { UsersProfileStore } from '../users/users-profile.store';

type AttendanceAction = 'claim' | 'finish' | 'reopen' | 'assign';

@Injectable()
export class WhatsappAttendanceService {
  constructor(private readonly dataSource: DataSource,@Optional()private readonly events?:DomainEvents,
    @Optional() private readonly profiles?: UsersProfileStore) {}

  claim(id: string, actorId: string): Promise<WhatsappConversation> {
    return this.transition(id, actorId, 'claim');
  }

  finish(id: string, actorId: string): Promise<WhatsappConversation> {
    return this.transition(id, actorId, 'finish');
  }

  reopen(id: string, actorId: string): Promise<WhatsappConversation> {
    return this.transition(id, actorId, 'reopen');
  }

  assign(
    id: string,
    actorId: string,
    assignedUserId: string,
  ): Promise<WhatsappConversation> {
    return this.transition(id, actorId, 'assign', assignedUserId);
  }

  private async activeUser(
    manager: EntityManager,
    id: string,
  ): Promise<User | null> {
    // HOLDLOCK in SQL Server keeps the user active and their role stable until commit.
    const user = await manager.getRepository(User).findOne({
      where: { id, isActive: true },
      select: { id: true, isAdmin: true, isActive: true },
      lock: { mode: 'pessimistic_read' },
    });
    if (user && this.profiles) {
      const profile = (await this.profiles.read([id], manager)).get(id.toLowerCase());
      if (profile?.role === 'tester') return null;
    }
    return user;
  }

  private async transition(
    id: string,
    actorId: string,
    action: AttendanceAction,
    assignedUserId?: string,
  ): Promise<WhatsappConversation> {
    const updated=await this.dataSource.transaction(async (manager) => {
      const actor = await this.activeUser(manager, actorId);
      if (!actor)
        throw new UnauthorizedException(
          'Usuário autenticado inexistente ou inativo.',
        );
      if (
        action === 'assign' &&
        (!assignedUserId || !(await this.activeUser(manager, assignedUserId)))
      ) {
        throw new BadRequestException(
          'O responsável informado não existe ou está inativo.',
        );
      }

      const repository = manager.getRepository(WhatsappConversation);
      // SQL Server holds the UPDLOCK until commit, serializing this conversation.
      const conversation = await repository.findOne({
        where: { id },
        select: { id: true, attendanceStatus: true, assignedUserId: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation)
        throw new NotFoundException('Conversa WhatsApp não encontrada.');

      if (action === 'assign' && !actor.isAdmin && conversation.assignedUserId !== actor.id) {
        throw new ForbiddenException('Somente o responsável ou um administrador pode transferir este atendimento.');
      }
      if (action === 'assign' && conversation.assignedUserId === assignedUserId) {
        throw new ConflictException('O usuário selecionado já é responsável por este atendimento.');
      }

      if (action === 'claim') {
        if (
          conversation.attendanceStatus !== 'waiting' ||
          conversation.assignedUserId !== null
        ) {
          throw new ConflictException(
            'Esta conversa não está disponível para assumir.',
          );
        }
        await repository.update(id, {
          attendanceStatus: 'in_progress',
          assignedUserId: actor.id,
          attendanceStartedAt: () => 'SYSUTCDATETIME()',
          attendanceFinishedAt: null,
        });
      } else if (action === 'finish') {
        if (conversation.attendanceStatus !== 'in_progress') {
          throw new ConflictException(
            'Somente conversas em atendimento podem ser finalizadas.',
          );
        }
        if (conversation.assignedUserId !== actor.id && !actor.isAdmin) {
          throw new ForbiddenException(
            'Somente o responsável ou um administrador pode finalizar o atendimento.',
          );
        }
        await repository.update(id, {
          attendanceStatus: 'finished',
          attendanceFinishedAt: () => 'SYSUTCDATETIME()',
        });
      } else if (action === 'reopen') {
        if (conversation.attendanceStatus !== 'finished') {
          throw new ConflictException(
            'Somente conversas finalizadas podem ser reabertas.',
          );
        }
        // Keep the previous timestamps until a new attendance is claimed.
        await repository.update(id, {
          attendanceStatus: 'waiting',
          assignedUserId: null,
        });
      } else {
        if (conversation.attendanceStatus !== 'in_progress') {
          throw new ConflictException(
            'Somente conversas em atendimento podem ser transferidas.',
          );
        }
        await repository.update(id, { assignedUserId });
      }

      const updated = await conversationQuery(repository)
        .where('conversation.id = :id', { id })
        .getOne();
      if (!updated)
        throw new NotFoundException('Conversa WhatsApp não encontrada.');
      return updated;
    });
    this.events?.emit({type:'attendance.changed',connectionId:updated.connectionId,conversationId:updated.id,
      automaticEvent: action === 'claim' ? 'started' : action === 'assign' ? 'transferred' : action === 'finish' ? 'finished' : undefined,
      transitionKey: randomUUID()});
    return updated;
  }
}
