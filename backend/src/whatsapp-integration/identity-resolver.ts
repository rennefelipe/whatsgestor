import type { DataSource } from 'typeorm';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { normalizeJid } from './normalize-message';
import { codedError,type StateStore } from './contracts';
export class IdentityResolver {
  private index?:Promise<{links:Map<string,any>;phones:Map<string,Set<string>>}>;
  constructor(private readonly store:StateStore,private readonly database:DataSource){}
  private identities(){
    return this.index??=(async()=>{
      const links=new Map<string,any>(),phones=new Map<string,Set<string>>();
      for(const {value}of await this.store.entries<any>('identity-links')){
        links.set(value.connectionId+'|'+value.lid,value);
        const key=value.connectionId+'|'+value.pn,set=phones.get(key)??new Set<string>();set.add(value.lid);phones.set(key,set);
      }return {links,phones};
    })().catch(error=>{this.index=undefined;throw error;});
  }
  private pair(first:unknown,second:unknown){
    const a=normalizeJid(first),b=normalizeJid(second),isLid=(id:string)=>/@(?:lid|hosted\.lid)$/.test(id);
    if(!a||!b||a.endsWith('@g.us')||b.endsWith('@g.us')||isLid(a)===isLid(b))throw codedError('IDENTITY_MAPPING_INVALID',422);
    return {a,b,lid:isLid(a)?a:b,pn:isLid(a)?b:a};
  }
  async known(connectionId:string,first:unknown,second:unknown):Promise<boolean>{
    let pair;try{pair=this.pair(first,second);}catch{return false;}
    const {lid,pn,a,b}=pair,index=await this.identities(),evidence=index.links.get(connectionId+'|'+lid);
    if(!evidence||evidence.pn!==pn||!evidence.canonical||[...(index.phones.get(connectionId+'|'+pn)??[])].some(id=>id!==lid))return false;
    return await this.store.get('aliases',connectionId+'|'+a)===evidence.canonical&&await this.store.get('aliases',connectionId+'|'+b)===evidence.canonical;
  }
  async learn(connectionId:string,first:unknown,second:unknown):Promise<string> {
    const {a,b,lid,pn}=this.pair(first,second),index=await this.identities();
    const evidence=index.links.get(connectionId+'|'+lid);
    if(evidence&&evidence.pn!==pn)throw codedError('IDENTITY_MAPPING_CONFLICT',409);
    if([...(index.phones.get(connectionId+'|'+pn)??[])].some(id=>id!==lid))throw codedError('IDENTITY_MAPPING_CONFLICT',409);
    const repository=this.database.getRepository(WhatsappConversation);
    const rowA=await repository.findOneBy({connectionId,remoteJid:a}),rowB=await repository.findOneBy({connectionId,remoteJid:b});
    if(rowA&&rowB&&rowA.id!==rowB.id)throw codedError('IDENTITY_MAPPING_CONFLICT',409);
    const mappedA=await this.store.get<string>('aliases',connectionId+'|'+a),mappedB=await this.store.get<string>('aliases',connectionId+'|'+b);
    if(mappedA&&mappedB&&mappedA!==mappedB)throw codedError('IDENTITY_MAPPING_CONFLICT',409);
    const canonical=rowA?.remoteJid??rowB?.remoteJid??mappedA??mappedB??lid;
    // The durable evidence is authoritative; interrupted cache writes can be replayed.
    await this.store.put('identity-links',connectionId+'|'+lid,{connectionId,lid,pn,canonical});
    index.links.set(connectionId+'|'+lid,{connectionId,lid,pn,canonical});index.phones.set(connectionId+'|'+pn,new Set([lid]));
    await this.store.put('aliases',connectionId+'|'+a,canonical);await this.store.put('aliases',connectionId+'|'+b,canonical);
    return canonical;
  }
  async resolve(connectionId:string,jid:string):Promise<string>{
    const direct=await this.store.get<string>('aliases',connectionId+'|'+jid);if(direct)return direct;
    const index=await this.identities(),link=index.links.get(connectionId+'|'+jid);
    if(link)return link.canonical;
    const lids=index.phones.get(connectionId+'|'+jid);if(lids&&lids.size>1)throw codedError('IDENTITY_MAPPING_CONFLICT',409);
    return lids?.size?index.links.get(connectionId+'|'+[...lids][0]).canonical:jid;
  }
}
