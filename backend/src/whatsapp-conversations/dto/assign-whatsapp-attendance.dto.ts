import { IsUUID } from 'class-validator';

export class AssignWhatsappAttendanceDto {
  @IsUUID('all', { message: 'assignedUserId deve ser um UUID válido.' })
  assignedUserId!: string;
}
