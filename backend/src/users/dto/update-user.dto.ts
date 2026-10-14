import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'O username deve ser um texto.' })
  @IsNotEmpty({ message: 'O username não pode ser vazio.' })
  @Matches(/\S/, { message: 'O username não pode conter apenas espaços.' })
  @MaxLength(100, { message: 'O username deve ter no máximo 100 caracteres.' })
  username?: string;

  @IsOptional()
  @IsString({ message: 'A senha deve ser um texto.' })
  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
  password?: string;

  @IsOptional()
  @IsBoolean({ message: 'isAdmin deve ser verdadeiro ou falso.' })
  isAdmin?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'canDelete deve ser verdadeiro ou falso.' })
  canDelete?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
