import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { USER_ROLES, type UserRole } from '../user-profile';

export class UserProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/, { message: 'O nome completo não pode ser vazio.' })
  @MaxLength(200)
  fullName?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(USER_ROLES, { message: 'Perfil inválido.' })
  role?: UserRole;
}
