import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import type { UserResponse } from '../users/users.service';

class LoginDto {
  @IsString({ message: 'O username deve ser um texto.' })
  @IsNotEmpty({ message: 'O username é obrigatório.' })
  @MaxLength(100, { message: 'O username deve ter no máximo 100 caracteres.' })
  username!: string;

  @IsString({ message: 'A senha deve ser um texto.' })
  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: UserResponse): UserResponse {
    return user;
  }
}
