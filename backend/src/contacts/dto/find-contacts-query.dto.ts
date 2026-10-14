import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class FindContactsQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'organizationId deve ser um UUID válido.' })
  organizationId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'contactTypeId deve ser um UUID válido.' })
  contactTypeId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'isActive deve ser true ou false.' })
  isActive?: boolean;

  @IsOptional()
  @IsString({ message: 'search deve ser um texto.' })
  @MaxLength(200, { message: 'search deve ter no máximo 200 caracteres.' })
  search?: string;
}
