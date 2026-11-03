import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { UserResponse } from '../../users/users.service';

@Injectable()
export class DeletePermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; user?: UserResponse }>();
    if (
      request.method !== 'DELETE' ||
      request.user?.isAdmin ||
      request.user?.canDelete
    ) {
      return true;
    }
    throw new ForbiddenException(
      'Você não tem permissão para excluir registros.',
    );
  }
}
