import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

export class FindWhatsappConversationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'connectionId deve ser um UUID válido.' })
  connectionId?: string;
}
