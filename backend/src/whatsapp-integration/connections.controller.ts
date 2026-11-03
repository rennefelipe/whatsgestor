import { Body, Controller, Get, Post, Patch, Param, ParseUUIDPipe, UseGuards, ForbiddenException,ConflictException } from '@nestjs/common';
import { IsBoolean, ValidateIf, IsString, MaxLength,MinLength,IsUUID,Equals } from 'class-validator';
import { Transform } from 'class-transformer';
import { DataSource } from 'typeorm';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { ConnectionRegistry } from './connection-registry';
import { ConnectionManager } from './connection-manager';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
class CreateConnection {@Transform(trim)@IsString()@MinLength(1)@MaxLength(150)name!:string;@ValidateIf((_,v)=>v!==undefined)@IsBoolean()isActive?:boolean;}
class UpdateConnection {@ValidateIf((_,v)=>v!==undefined)@Transform(trim)@IsString()@MinLength(1)@MaxLength(150)name?:string;@ValidateIf((_,v)=>v!==undefined)@IsBoolean()isActive?:boolean;}
class ActiveConnection {@IsBoolean()isActive!:boolean;}
class StartConnection {@ValidateIf((_,v)=>v!==undefined)@IsBoolean()allowPairing?:boolean;}
class RecoverPairing {@IsUUID()confirmation!:string;@Equals(true)acknowledgeCredentialReplacement!:boolean;}
@Controller('whatsapp-connections')
export class ConnectionsController {
  constructor(private readonly registry:ConnectionRegistry,private readonly manager:ConnectionManager,private readonly database:DataSource){}
  private async authorize(id:string,user:UserResponse){
    if(user.isAdmin)return;
    if(!await this.database.getRepository(WhatsappConversation).findOneBy({connectionId:id,assignedUserId:user.id}))throw new ForbiddenException('Conexao nao autorizada.');
  }
  @Get()async list(@CurrentUser()user:UserResponse){
    const rows=await this.registry.list(), result=[];
    for(const row of rows){try{await this.authorize(row.id,user);result.push({...row,...await this.manager.inspectStatus(row.id)});}catch(error){if(!(error instanceof ForbiddenException))throw error;}}
    return result;
  }
  @Post()@UseGuards(AdminGuard)create(@Body()body:CreateConnection){return this.registry.create(body.name.trim(),body.isActive);}
  @Patch(':id')@UseGuards(AdminGuard)async update(@Param('id',new ParseUUIDPipe())id:string,@Body()body:UpdateConnection){
    if(body.isActive===false)await this.manager.stop(id);return this.registry.update(id,body);
  }
  @Patch(':id/active')@UseGuards(AdminGuard)async active(@Param('id',new ParseUUIDPipe())id:string,@Body()body:ActiveConnection){
    if(!body.isActive)await this.manager.stop(id);return this.registry.update(id,body);
  }
  @Get(':id/status')async status(@Param('id',new ParseUUIDPipe())id:string,@CurrentUser()user:UserResponse){await this.authorize(id,user);const row=await this.registry.find(id);return {...row,...await this.manager.inspectStatus(id)};}
  @Get(':id/health')async health(@Param('id',new ParseUUIDPipe())id:string,@CurrentUser()user:UserResponse){return this.status(id,user);}
  @Get(':id/qr')@UseGuards(AdminGuard)async qr(@Param('id',new ParseUUIDPipe())id:string){await this.registry.find(id);return this.manager.qr(id);}
  @Post(':id/connect')@UseGuards(AdminGuard)connect(@Param('id',new ParseUUIDPipe())id:string,@Body()body:StartConnection){return this.manager.start(id,body.allowPairing===true);}
  @Post(':id/disconnect')@UseGuards(AdminGuard)async disconnect(@Param('id',new ParseUUIDPipe())id:string){await this.registry.find(id);return this.manager.stop(id);}
  @Post(':id/storage-retry')@UseGuards(AdminGuard)retryStorage(@Param('id',new ParseUUIDPipe())id:string){return this.manager.retryStorage(id);}
  @Post(':id/pairing-recovery')@UseGuards(AdminGuard)recover(@Param('id',new ParseUUIDPipe())id:string,@Body()body:RecoverPairing,@CurrentUser()user:UserResponse){return this.manager.recoverPairing(id,body.confirmation,body.acknowledgeCredentialReplacement,user.id);}
  @Post(':id/logout')@UseGuards(AdminGuard)logout(){throw new ConflictException({code:'SESSION_RESET_NOT_SUPPORTED',message:'Credenciais preservadas. Redefinicao de sessao exige procedimento separado.'});}
}
