import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateWhatsappConnectionDto {
  @IsString({ message: 'O nome deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @Matches(/\S/, { message: 'O nome não pode conter apenas espaços.' })
  @MaxLength(150, { message: 'O nome deve ter no máximo 150 caracteres.' })
  name: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
