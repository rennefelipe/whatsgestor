import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString({ message: 'O username deve ser um texto.' })
  @IsNotEmpty({ message: 'O username é obrigatório.' })
  @Matches(/\S/, { message: 'O username não pode conter apenas espaços.' })
  @MaxLength(100, { message: 'O username deve ter no máximo 100 caracteres.' })
  username: string;

  @IsString({ message: 'A senha deve ser um texto.' })
  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
  password: string;

  @IsBoolean({ message: 'isAdmin deve ser verdadeiro ou falso.' })
  isAdmin: boolean;

  @IsBoolean({ message: 'canDelete deve ser verdadeiro ou falso.' })
  canDelete: boolean;

  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive: boolean;
}
