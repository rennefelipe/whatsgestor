import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { UserResponse } from '../../users/users.service';
import { effectiveRole } from '../../users/user-profile';

// Explicit route metadata allowlist: URL spelling, query strings and future
// controllers cannot accidentally grant new tester permissions. No WhatsApp
// controller is touched or allowed, including GET routes with side effects.
const READ_ROUTES: Readonly<Record<string, readonly string[]>> = {
  auth: ['me'],
  contacts: ['/', 'options', ':id'],
  organizations: ['/', ':id'],
  'organization-types': ['/', ':id'],
  'contact-types': ['/', ':id'],
  'contact-display-settings': ['/'],
};

@Injectable()
export class TesterPermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ method: string; user?: UserResponse }>();
    if (!request.user || effectiveRole(request.user) !== 'tester') return true;
    const controller = Reflect.getMetadata(PATH_METADATA, context.getClass());
    const route = Reflect.getMetadata(PATH_METADATA, context.getHandler());
    if ((request.method === 'GET' || request.method === 'HEAD') &&
        typeof controller === 'string' && typeof route === 'string' &&
        READ_ROUTES[controller]?.includes(route)) return true;
    throw new ForbiddenException('Perfil Testador: acesso restrito às consultas autorizadas de contatos.');
  }
}
