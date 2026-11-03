import { IsBoolean } from 'class-validator';

export class UpdateContactTypeActiveDto {
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive!: boolean;
}
