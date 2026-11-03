import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { FindContactsQueryDto } from '../contacts/dto/find-contacts-query.dto';

export class CreateRecipientSelectionDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FindContactsQueryDto)
  filters!: FindContactsQueryDto;
}

export class UpdateRecipientSelectionDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsInt()
  @Min(0)
  version!: number;

  @IsIn(['filter', 'add', 'remove', 'all', 'clear', 'review'])
  action!: 'filter' | 'add' | 'remove' | 'all' | 'clear' | 'review';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FindContactsQueryDto)
  filters?: FindContactsQueryDto;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  key?: string;
}

export class RecipientPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsIn(['query', 'selected'])
  view: 'query' | 'selected' = 'query';
}
