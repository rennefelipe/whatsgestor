import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UserResponse } from '../../users/users.service';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: UserResponse }>();
    if (!request.user?.isAdmin) {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }
    return true;
  }
}
