import { IsBoolean, IsInt, Min, ValidateIf } from 'class-validator';

export class UpdateContactDisplaySettingDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'isVisible deve ser verdadeiro ou falso.' })
  isVisible?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: 'displayOrder deve ser um número inteiro.' })
  @Min(1, { message: 'displayOrder deve ser um inteiro positivo.' })
  displayOrder?: number;
}
