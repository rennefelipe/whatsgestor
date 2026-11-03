import {
  IsBoolean,
  IsNotEmpty,
  ValidateIf,
  IsString,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';

import { UserProfileDto } from './user-profile.dto';

export class UpdateUserDto extends UserProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'O username deve ser um texto.' })
  @IsNotEmpty({ message: 'O username não pode ser vazio.' })
  @Matches(/\S/, { message: 'O username não pode conter apenas espaços.' })
  @MaxLength(100, { message: 'O username deve ter no máximo 100 caracteres.' })
  username?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'A senha deve ser um texto.' })
  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
  password?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isAdmin deve ser verdadeiro ou falso.' })
  isAdmin?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'canDelete deve ser verdadeiro ou falso.' })
  canDelete?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
