import { Controller,ForbiddenException,Get,Injectable,Query,Req,Res,UnauthorizedException,OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import { DomainEvents,type DomainEvent } from '../events/domain-events';
import { User } from '../users/entities/user.entity';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';

@Injectable()
export class RealtimeAccess {
  constructor(private readonly database:DataSource){}
  async allowed(userId:string,event:Partial<DomainEvent>,connectionId?:string):Promise<boolean>{
    const user=await this.database.getRepository(User).findOneBy({id:userId,isActive:true});
    if(!user)throw new UnauthorizedException();
    if(connectionId&&event.connectionId&&event.connectionId!==connectionId)return false;
    if(user.isAdmin)return true;
    if(event.type==='connection.changed'&&connectionId&&event.connectionId===connectionId)return !!await this.database.getRepository(WhatsappConversation).findOneBy({connectionId,assignedUserId:userId});
    if(!event.conversationId)return false;
    return !!await this.database.getRepository(WhatsappConversation).findOneBy({id:event.conversationId,assignedUserId:userId,
      ...(connectionId?{connectionId}:{})});
  }
  async connection(userId:string,connectionId?:string){
    const user=await this.database.getRepository(User).findOneBy({id:userId,isActive:true});
    if(!user)throw new UnauthorizedException();
    if(user.isAdmin)return;
    if(!connectionId||!await this.database.getRepository(WhatsappConversation).findOneBy({connectionId,assignedUserId:userId}))throw new ForbiddenException('Conexao nao autorizada.');
  }
}
@Controller('whatsapp-events')
export class RealtimeController implements OnModuleDestroy {
  private readonly sessions=new Map<string,Set<()=>void>>();
  constructor(private readonly events:DomainEvents,private readonly access:RealtimeAccess){}
  @Get()
  async stream(@CurrentUser()user:UserResponse,@Query('connectionId')connectionId:string|undefined,@Req()request:any,@Res()response:any){
    if(request.query.token||request.query.access_token)throw new UnauthorizedException('Utilize Authorization Bearer.');
    if(connectionId&&!isUUID(connectionId))throw new ForbiddenException('Conexao invalida.');
    await this.access.connection(user.id,connectionId);
    const all=[...this.sessions.values()].reduce((sum,values)=>sum+values.size,0);
    const mine=this.sessions.get(user.id)??new Set<()=>void>();
    if(all>=64||mine.size>=4)throw new ForbiddenException('Limite de assinaturas atingido.');
    const token=request.headers.authorization?.split(' ')[1];
    let expiration:number;try{expiration=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).exp*1000;}catch{throw new UnauthorizedException();}
    if(!Number.isFinite(expiration)||expiration<=Date.now())throw new UnauthorizedException();
    response.status(200);response.setHeader('Content-Type','text/event-stream');response.setHeader('Cache-Control','private, no-store');
    response.setHeader('X-Accel-Buffering','no');response.flushHeaders();
    let closed=false,busy=false;
    const queue:DomainEvent[]=[],timers=new Set<NodeJS.Timeout>();
    const close=()=>{if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);for(const timer of timers)clearTimeout(timer);mine.delete(close);if(!mine.size)this.sessions.delete(user.id);response.end();};
    const write=async(value:unknown)=>{
      if(closed)return;
      if(!response.write(`data: ${JSON.stringify(value)}\n\n`))await new Promise<void>((resolve,reject)=>{
        const finish=()=>{clearTimeout(timer);timers.delete(timer);response.off('drain',drain);response.off('close',finishClose);};
        const drain=()=>{finish();resolve();},finishClose=()=>{finish();reject(new Error('SSE_CLOSED'));};
        const timer=setTimeout(()=>{finish();reject(new Error('SSE_BACKPRESSURE'));},5000);timer.unref();timers.add(timer);
        response.once('drain',drain);response.once('close',finishClose);
      });
    };
    const pump=async()=>{
      if(busy||closed)return;busy=true;
      try{while(queue.length&&!closed){if(Date.now()>=expiration){close();break;}
        const event=queue.shift()!;if(await this.access.allowed(user.id,event,connectionId))await write(event);
      }}catch{close();}finally{busy=false;}
    };
    const unsubscribe=this.events.subscribe(event=>{
      if(closed)return;
      if(connectionId&&event.connectionId&&event.connectionId!==connectionId)return;
      if(queue.length>=32){close();return;}queue.push(event);void pump();
    });
    const heartbeat=setInterval(()=>{void(async()=>{
      try{if(Date.now()>=expiration){close();return;}await this.access.connection(user.id,connectionId);if(!busy)await write({type:'heartbeat',at:new Date().toISOString()});}catch{close();}
    })();},15000);heartbeat.unref();
    mine.add(close);this.sessions.set(user.id,mine);response.once('close',close);
    try{await write({type:'resync_required',at:new Date().toISOString()});}catch{close();}
  }
  onModuleDestroy(){for(const values of [...this.sessions.values()])for(const close of [...values])close();}
}
