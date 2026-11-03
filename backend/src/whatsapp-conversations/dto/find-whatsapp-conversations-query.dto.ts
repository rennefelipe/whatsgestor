import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

export class FindWhatsappConversationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'connectionId deve ser um UUID válido.' })
  connectionId?: string;

  @IsOptional()
  @IsIn(['waiting', 'in_progress', 'finished'])
  attendanceStatus?: 'waiting' | 'in_progress' | 'finished';

  @IsOptional()
  @IsUUID('all')
  assignedUserId?: string;

  @IsOptional()
  @IsUUID('all')
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
