import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateContactTypeDto {
  @IsString({ message: 'O nome deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @MaxLength(100, { message: 'O nome deve ter no máximo 100 caracteres.' })
  name: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
