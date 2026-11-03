import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateContactDto {
  @IsOptional()
  @IsUUID('all', { message: 'organizationId deve ser um UUID válido.' })
  organizationId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('all', { message: 'contactTypeId deve ser um UUID válido.' })
  contactTypeId?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: 'storeName deve ser um texto.' })
  @MaxLength(150, { message: 'storeName deve ter no máximo 150 caracteres.' })
  storeName?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'O nome do contato deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome do contato não pode ser vazio.' })
  @MaxLength(150, {
    message: 'O nome do contato deve ter no máximo 150 caracteres.',
  })
  contactName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'O telefone deve ser um texto.' })
  @IsNotEmpty({ message: 'O telefone não pode ser vazio.' })
  @MaxLength(30, { message: 'O telefone deve ter no máximo 30 caracteres.' })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'O e-mail informado é inválido.' })
  @MaxLength(200, { message: 'O e-mail deve ter no máximo 200 caracteres.' })
  email?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
