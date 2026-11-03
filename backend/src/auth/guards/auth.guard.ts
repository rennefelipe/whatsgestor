import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { isUUID } from 'class-validator';

interface AuthenticatedRequest {
  headers: { authorization?: string };
  user?: Awaited<ReturnType<UsersService['findActiveById']>>;
}

interface JwtPayload {
  sub: string;
  exp: number;
  iat?: number;
  userRevision?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? authorization.match(/^Bearer\s+(\S+)$/i) : null;
    if (!match) throw new UnauthorizedException('Autenticação necessária.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(match[1]);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    if (typeof payload.sub !== 'string' || !isUUID(payload.sub) || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException('Token inválido ou expirado.');
    // New tokens carry an exact revision. Legacy tokens keep working until a
    // user edit later than their issue time; no revocation state is lost on restart.
    const updatedAt = new Date(user.updatedAt);
    const revisionMatches = payload.userRevision !== undefined
      ? payload.userRevision === updatedAt.toISOString()
      : typeof payload.iat === 'number' && updatedAt.getTime() <= payload.iat * 1000;
    if (!revisionMatches) throw new UnauthorizedException('Usuário alterado. Entre novamente.');
    request.user = user;
    return true;
  }
}
