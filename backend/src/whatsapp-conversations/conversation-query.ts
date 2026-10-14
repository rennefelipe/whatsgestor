import { Repository } from 'typeorm';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';

export function conversationQuery(
  repository: Repository<WhatsappConversation>,
) {
  return repository
    .createQueryBuilder('conversation')
    .leftJoin('conversation.contact', 'contact')
    .addSelect(['contact.id', 'contact.contactName'])
    .leftJoin('conversation.assignedUser', 'assignedUser')
    .addSelect(['assignedUser.id', 'assignedUser.username']);
}
