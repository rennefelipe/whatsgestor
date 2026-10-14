import { IsBoolean } from 'class-validator';

export class UpdateUserDeletePermissionDto {
  @IsBoolean({ message: 'canDelete deve ser verdadeiro ou falso.' })
  canDelete: boolean;
}
