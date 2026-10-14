import { IsBoolean } from 'class-validator';

export class UpdateWhatsappConnectionActiveDto {
  @IsBoolean({ message: 'isActive deve ser verdadeiro ou falso.' })
  isActive: boolean;
}
