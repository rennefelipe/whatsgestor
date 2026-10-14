import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateOrganizationDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'O nome deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome não pode ser vazio.' })
  @MaxLength(150, { message: 'O nome deve ter no máximo 150 caracteres.' })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('all', { message: 'organizationTypeId deve ser um UUID válido.' })
  organizationTypeId?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('all', { message: 'parentOrganizationId deve ser um UUID válido.' })
  parentOrganizationId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive?: boolean;
}
