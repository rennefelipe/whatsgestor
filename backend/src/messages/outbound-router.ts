import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { FileMetadata } from './file-policy';
import type { UserResponse } from '../users/users.service';
export interface OutboundRequest {conversationId:string;actor:Pick<UserResponse,'id'|'isAdmin'|'isActive'>;key:string;text?:unknown;file?:{content:Buffer;metadata:FileMetadata}}
export interface OutboundAdapter { available(conversationId:string):Promise<boolean>;assertAvailable?(id:string):Promise<void>;send(request:OutboundRequest):Promise<unknown>;
  pending?(id:string,actor:OutboundRequest['actor']):Promise<unknown>;attempt?(id:string,key:string,actor:OutboundRequest['actor']):Promise<unknown>;review?(id:string,key:string,actor:OutboundRequest['actor']):Promise<unknown> }
@Injectable()
export class OutboundRouter {
  private adapter?:OutboundAdapter;
  register(adapter:OutboundAdapter){this.adapter=adapter;}
  async available(id:string){return await this.adapter?.available(id)??false;}
  async requireAvailable(id:string){if(this.adapter?.assertAvailable)return this.adapter.assertAvailable(id);if(!await this.available(id))throw new ServiceUnavailableException({statusCode:503,code:'MESSAGE_PROVIDER_UNAVAILABLE',message:'Provedor WhatsApp indisponivel.',dispatchAttempted:false});}
  async pending(id:string,actor:OutboundRequest['actor']){return this.adapter?.pending?this.adapter.pending(id,actor):null;}
  async attempt(id:string,key:string,actor:OutboundRequest['actor']){if(!this.adapter?.attempt)throw new ServiceUnavailableException();return this.adapter.attempt(id,key,actor);}
  async review(id:string,key:string,actor:OutboundRequest['actor']){if(!this.adapter?.review)throw new ServiceUnavailableException();return this.adapter.review(id,key,actor);}
  async send(request:OutboundRequest){await this.requireAvailable(request.conversationId);return this.adapter!.send(request);}
}
