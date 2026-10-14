import { IsBoolean } from 'class-validator';

export class UpdateUserActiveDto {
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive: boolean;
}
