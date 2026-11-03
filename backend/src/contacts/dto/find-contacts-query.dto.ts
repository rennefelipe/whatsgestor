import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class FindContactsQueryDto {
  @IsOptional()
  @IsUUID('all')
  groupId?: string;

  @IsOptional()
  @IsUUID('all')
  shoppingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  storeName?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  withoutStore?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // Pagination is opt-in to preserve existing array consumers (including Conversations).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

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
