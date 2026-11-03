import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCampaignPreferenceDto {
  @IsIn(['phone', 'identity']) target!: 'phone' | 'identity';
  @IsOptional() @IsUUID() evidenceConversationId?: string;
  @IsOptional() @IsUUID() shoppingId?: string | null;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
export class RevokeCampaignPreferenceDto {
  @IsInt() @Min(1) version!: number;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
  @IsIn([true]) confirmed!: boolean;
}
export class CampaignPreferencePageDto {
  @Max(1000000)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
}
