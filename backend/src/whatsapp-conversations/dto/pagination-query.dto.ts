import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'page deve ser um inteiro.' })
  @Min(1, { message: 'page deve ser maior ou igual a 1.' })
  @Max(1_000_000, { message: 'page excede o limite permitido.' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'pageSize deve ser um inteiro.' })
  @Min(1, { message: 'pageSize deve ser maior ou igual a 1.' })
  @Max(100, { message: 'pageSize deve ser menor ou igual a 100.' })
  pageSize = 50;
}
