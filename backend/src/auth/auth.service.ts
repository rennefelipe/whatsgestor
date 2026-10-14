import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { isPasswordWithinHashLimit } from '../users/password-hash';

const DUMMY_PASSWORD_HASH =
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface LoginCredentials {
  username: string;
  password: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(credentials: LoginCredentials) {
    const user = await this.users.findByUsername(credentials.username);
    const withinHashLimit = isPasswordWithinHashLimit(credentials.password);
    const passwordMatches = await bcrypt.compare(
      withinHashLimit ? credentials.password : 'invalid-password',
      withinHashLimit
        ? (user?.passwordHash ?? DUMMY_PASSWORD_HASH)
        : DUMMY_PASSWORD_HASH,
    );
    if (!user || !user.isActive || !withinHashLimit || !passwordMatches) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
    });
    return { accessToken, user: this.users.toResponse(user) };
  }
}
