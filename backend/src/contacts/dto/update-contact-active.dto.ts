import { IsBoolean } from 'class-validator';

export class UpdateContactActiveDto {
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive!: boolean;
}
