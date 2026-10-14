import { IsBoolean } from 'class-validator';

export class UpdateOrganizationTypeActiveDto {
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive: boolean;
}
