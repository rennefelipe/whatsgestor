import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString({ message: 'O nome deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @MaxLength(150, { message: 'O nome deve ter no máximo 150 caracteres.' })
  name: string;

  @IsUUID('all', { message: 'organizationTypeId deve ser um UUID válido.' })
  organizationTypeId: string;

  @IsOptional()
  @IsUUID('all', { message: 'parentOrganizationId deve ser um UUID válido.' })
  parentOrganizationId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
