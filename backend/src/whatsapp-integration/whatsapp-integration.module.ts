import { Injectable,Module,OnApplicationBootstrap } from '@nestjs/common';
import { DomainEventsModule } from '../events/domain-events';
import { MessagesModule } from '../messages/messages.module';
import { OutboundRouter } from '../messages/outbound-router';
import { WhatsappConversationsModule } from '../whatsapp-conversations/whatsapp-conversations.module';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BaileysSocketFactory,loadBaileys,SDK_LOADER } from './baileys-socket.factory';
import { SOCKET_FACTORY,WHATSAPP_STATE } from './contracts';
import { IntegrationPolicy } from './integration-policy';
import { EncryptedStateStore } from './encrypted-state.store';
import { ConnectionRegistry } from './connection-registry';
import { ConnectionManager } from './connection-manager';
import { IncomingPipeline } from './incoming-pipeline';
import { BaileysOutboundAdapter } from './outbound-adapter';
import { ConnectionsController } from './connections.controller';
import { RealtimeController,RealtimeAccess } from './realtime.controller';
@Injectable()
export class IntegrationLifecycle implements OnApplicationBootstrap {
  constructor(private readonly manager:ConnectionManager,private readonly router:OutboundRouter,private readonly adapter:BaileysOutboundAdapter){}
  async onApplicationBootstrap(){this.router.register(this.adapter);await this.manager.restore();}
}
@Module({imports:[DomainEventsModule,MessagesModule,WhatsappConversationsModule],
  controllers:[ConnectionsController,RealtimeController],
  providers:[IntegrationPolicy,EncryptedStateStore,ConnectionRegistry,ConnectionManager,IncomingPipeline,BaileysSocketFactory,
    BaileysOutboundAdapter,IntegrationLifecycle,RealtimeAccess,AdminGuard,{provide:SDK_LOADER,useValue:loadBaileys},
    {provide:WHATSAPP_STATE,useExisting:EncryptedStateStore},{provide:SOCKET_FACTORY,useExisting:BaileysSocketFactory}],
  exports:[ConnectionManager]})
export class WhatsappIntegrationModule {}
