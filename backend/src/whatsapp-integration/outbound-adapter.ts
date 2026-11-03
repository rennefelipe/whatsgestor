import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, Inject, Injectable, Logger, HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isUUID } from 'class-validator';
import { OutboundAdapter, OutboundRequest } from '../messages/outbound-router';
import { MessagesService } from '../messages/messages.service';
import { FilePolicy, type FileMetadata } from '../messages/file-policy';
import { PrivateFileStorage } from '../messages/private-file-storage';
import { WhatsappConversationsService } from '../whatsapp-conversations/whatsapp-conversations.service';
import { DomainEvents } from '../events/domain-events';
import { ConnectionManager } from './connection-manager';
import { IntegrationPolicy } from './integration-policy';
import { WHATSAPP_STATE, codedError, type StateStore } from './contracts';
import { ReceiveMetrics } from './receive-metrics';
import { normalizeJid, messageTime } from './normalize-message';

async function convertWebmAudioToOgg(content: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-nostdin',
      '-f', 'webm', '-i', 'pipe:0',
      '-map', '0:a:0', '-vn',
      '-c:a', 'libopus', '-b:a', '32k',
      '-f', 'ogg', 'pipe:1'
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Tempo limite excedido na conversao de audio.'));
    }, 30000);

    function finish(error?: Error, result?: Buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 20 * 1024 * 1024) {
        child.kill();
        finish(new Error('Audio convertido excedeu o limite permitido.'));
        return;
      }
      chunks.push(chunk);
    });

    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error('Falha na conversao WebM para OGG.'));
      } else {
        finish(undefined, Buffer.concat(chunks));
      }
    });

    child.stdin.on('error', () => undefined);
    child.stdin.end(content);
  });
}
interface Attempt {owner:string;connectionId:string;conversationId:string;remoteJid:string;digest:string;
  state:'prepared'|'sending'|'confirmed'|'persisted'|'uncertain';reservedId:string;providerId?:string;timestamp?:string;
  text?:string;file?:{key:string;metadata:FileMetadata};result?:unknown;reviewed?:boolean}
@Injectable()
export class BaileysOutboundAdapter implements OutboundAdapter {
  private readonly tails=new Map<string,Promise<unknown>>();
  private readonly logger=new Logger('WhatsAppSend');
  constructor(private readonly manager:ConnectionManager,private readonly policy:IntegrationPolicy,
    @Inject(WHATSAPP_STATE)private readonly store:StateStore,private readonly messages:MessagesService,
    private readonly conversations:WhatsappConversationsService,private readonly files:PrivateFileStorage,
    private readonly filePolicy:FilePolicy,private readonly events:DomainEvents){}
  async available(id:string){if(!this.policy.enabled||!this.policy.allowSending)return false;
    const conversation=await this.conversations.findOne(id);try{this.manager.readySocket(conversation.connectionId);return true;}catch{return false;}}
  async assertAvailable(id:string){
    const conversation=await this.conversations.findOne(id);
    if(!this.policy.enabled||!this.policy.allowSending)throw new HttpException({code:this.policy.enabled?'MESSAGE_SEND_DISABLED':'MESSAGE_PROVIDER_UNAVAILABLE',message:this.policy.enabled?'Envio desabilitado pela politica administrativa. Nenhuma mensagem foi enviada.':'Integracao WhatsApp desabilitada.',dispatchAttempted:false},this.policy.enabled?403:503);
    try{this.manager.readySocket(conversation.connectionId,true);}catch(error){
      if((error as any)?.code==='WHATSAPP_COMMUNICATION_RESTRICTED')throw new HttpException({code:'WHATSAPP_COMMUNICATION_RESTRICTED',message:'Envio temporariamente restrito pelo WhatsApp.',dispatchAttempted:false},423);
      throw new HttpException({code:'MESSAGE_PROVIDER_UNAVAILABLE',message:'Conexao WhatsApp indisponivel para envio. Nenhuma mensagem foi enviada.',dispatchAttempted:false},503);
    }
  }
  private view(key:string,value:Attempt){return {id:key.slice(key.lastIndexOf('|')+1),kind:value.file?.metadata.kind??'text',originalName:value.file?.metadata.originalName??null,
    state:value.reviewed?'reviewed':value.state==='persisted'?'registered':value.state==='sending'&&!this.tails.has(key)?'uncertain':value.state,message:value.state==='persisted'?value.result:null};}
  async pending(id:string,actor:OutboundRequest['actor']){
    const conversation=await this.conversations.findOne(id);if(!actor.isActive)throw new ForbiddenException();
    const values=(await this.store.entries<Attempt>('outbox')).filter(entry=>entry.value.conversationId===id&&entry.value.file&&!entry.value.reviewed&&entry.value.state!=='persisted'&&(actor.isAdmin||conversation.assignedUserId===actor.id||entry.value.owner===actor.id));
    return values.length?this.view(values[0].key,values[0].value):null;
  }
  async attempt(id:string,attemptId:string,actor:OutboundRequest['actor']){
    const conversation=await this.conversations.findOne(id),key=conversation.connectionId+'|'+id+'|'+attemptId,value=await this.store.get<Attempt>('outbox',key);
    if(!value)throw new NotFoundException();if(!actor.isActive||!actor.isAdmin&&conversation.assignedUserId!==actor.id&&value.owner!==actor.id)throw new ForbiddenException();
    return this.view(key,value);
  }
  async review(id:string,attemptId:string,actor:OutboundRequest['actor']){
    await this.messages.authorizePreparation(id,actor);const conversation=await this.conversations.findOne(id),key=conversation.connectionId+'|'+id+'|'+attemptId;
    if(this.tails.has(key))throw new ConflictException('Envio em andamento.');
    const work=Promise.resolve().then(async()=>{
    const value=await this.store.get<Attempt>('outbox',key);if(!value)throw new NotFoundException();
    if(!actor.isAdmin&&value.owner!==actor.id)throw new ForbiddenException();
    if(!['uncertain','sending'].includes(value.state))throw new ConflictException('Somente envio incerto pode ser revisado.');
    const reviewed={...value,reviewed:true};await this.store.put('outbox',key,reviewed);return this.view(key,reviewed);
    });this.tails.set(key,work);try{return await work;}finally{if(this.tails.get(key)===work)this.tails.delete(key);}
  }
  async send(request:OutboundRequest):Promise<unknown> {
    if(request.file)this.filePolicy.validate(request.file.content,request.file.metadata);
    request={...request,actor:{...request.actor},...(request.file?{file:{content:Buffer.from(request.file.content),metadata:{...request.file.metadata}}}:{})};
    // Recheck attendance at dispatch, including repeated requests. Idempotency
    // never becomes a way to bypass current permissions.
    await this.messages.authorizePreparation(request.conversationId,request.actor);
    if(!isUUID(request.key))throw new BadRequestException({code:'IDEMPOTENCY_KEY_REQUIRED',message:'Cabecalho Idempotency-Key UUID obrigatorio.'});
    const conversation=await this.conversations.findOne(request.conversationId);
    await this.assertAvailable(request.conversationId);
    const jid=normalizeJid(conversation.remoteJid);if(!jid)throw new BadRequestException('Identidade da conversa invalida.');
    const text=request.file?undefined:this.filePolicy.text(request.text);
    const file=request.file?{content:request.file.content,metadata:this.filePolicy.validate(request.file.content,request.file.metadata)}:undefined;
    const digest=createHash('sha256').update(JSON.stringify({text,metadata:file?.metadata})).update(file?.content??Buffer.alloc(0)).digest('hex');
    const key=conversation.connectionId+'|'+conversation.id+'|'+request.key;
    const previous=this.tails.get(key)??Promise.resolve();
    const work=previous.catch(()=>undefined).then(async()=>{
      await this.messages.authorizePreparation(request.conversationId,request.actor);
      let attempt=await this.store.get<Attempt>('outbox',key);
      if(attempt&&(attempt.digest!==digest||attempt.owner!==request.actor.id))throw new ConflictException('Chave de idempotencia ja utilizada.');
      if(attempt?.state==='persisted')return attempt.result;
      if(attempt?.state==='sending'||attempt?.state==='uncertain')throw new ConflictException({code:'SEND_CONFIRMATION_UNCERTAIN',message:'Envio sem confirmacao conclusiva; revisao necessaria. Nao sera reenviado automaticamente.'});
      const socket=this.manager.readySocket(conversation.connectionId,true);
      if(!attempt) {
        if(!socket.reserveMessageId)throw codedError('PROVIDER_ID_RESERVATION_UNAVAILABLE');
        attempt={owner:request.actor.id,conversationId:conversation.id,connectionId:conversation.connectionId,remoteJid:jid,digest,
          state:'prepared',reservedId:socket.reserveMessageId(),text};
        if(file){const saved=await this.files.save(file.content,file.metadata);attempt.file={key:saved.key,metadata:this.filePolicy.metadata(file.metadata)};}
        await this.store.put('outbox',key,attempt);
      }
      let content:Buffer|undefined;
      if(attempt.file){const opened=await this.files.open(attempt.file.key);try{content=await opened.handle.readFile();}finally{await opened.handle.close();}this.filePolicy.validate(content,attempt.file.metadata);}
      if(attempt.state!=='confirmed') {
        const metadata=attempt.file?.metadata;
        let sendContent = content;
        let sendMimeType = metadata?.mimeType;
        if (metadata?.kind === 'audio' && metadata.mimeType === 'audio/webm' && content) {
          sendContent = await convertWebmAudioToOgg(content);
          sendMimeType = 'audio/ogg; codecs=opus';
        }
        const payload:Record<string,unknown>=metadata?{[metadata.kind==='document'?'document':metadata.kind]:sendContent,mimetype:sendMimeType,
          fileName:metadata.originalName,...(metadata.kind==='audio'?{ptt:true}:{})}:{text:attempt.text};
        attempt.state='sending';await this.store.put('outbox',key,attempt);
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(codedError('SEND_TIMEOUT')),this.policy.sendTimeoutMs);timer.unref();
        try {
          const ack=await socket.send(jid,payload,attempt.reservedId,controller.signal);
          if(controller.signal.aborted)throw controller.signal.reason;
          if(typeof ack?.key?.id!=='string'||!ack.key.id||ack.key.fromMe!==true||normalizeJid(ack.key.remoteJid)!==jid)throw codedError('PROVIDER_ACK_INVALID');
          attempt.providerId=ack.key.id;attempt.timestamp=(messageTime(ack.messageTimestamp)??new Date()).toISOString();
          attempt.state='confirmed';await this.store.put('outbox',key,attempt);
        }catch(error){attempt.state='uncertain';await this.store.put('outbox',key,attempt);
          new ReceiveMetrics(v=>this.logger.log(JSON.stringify(v))).error('send_confirmation_failed',error);throw codedError('SEND_CONFIRMATION_UNCERTAIN',409);
        }finally{clearTimeout(timer);}
      }
      // Confirmed ACK survives SQL failure. A retry persists it without another
      // provider call; a crash in 'sending' remains uncertain and is never sent again.
      const result=await this.messages.ingest({connectionId:attempt.connectionId,remoteJid:attempt.remoteJid,whatsappMessageId:attempt.providerId!,fromMe:true,
        origin:'outgoing',messageType:attempt.file?.metadata.kind??'text',textContent:attempt.text??null,messageTimestamp:new Date(attempt.timestamp!),status:'sent'},
        attempt.file&&content?{metadata:attempt.file.metadata,content}:undefined);
      attempt.state='persisted';attempt.result=result.message;await this.store.put('outbox',key,attempt);
      this.events.emit({type:'message.created',connectionId:attempt.connectionId,conversationId:attempt.conversationId,messageId:result.message.id});
      return result.message;
    });
    this.tails.set(key,work);try{return await work;}finally{if(this.tails.get(key)===work)this.tails.delete(key);}
  }
}
