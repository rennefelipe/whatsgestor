import { IsBoolean } from 'class-validator';

export class UpdateOrganizationActiveDto {
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive: boolean;
}
