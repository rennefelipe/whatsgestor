import { IsUUID, ValidateIf } from 'class-validator';

export class UpdateWhatsappConversationContactDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('all', { message: 'contactId deve ser um UUID válido ou null.' })
  contactId: string | null;
}
