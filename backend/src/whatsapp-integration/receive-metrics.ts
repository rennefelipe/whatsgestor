import { createHash } from 'node:crypto';
import { errorCode } from './contracts';
import { storageDetails } from './storage-diagnostics';

export const reference = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20);
export class ReceiveMetrics {
  readonly counters: Record<string, number> = {};
  lastEvent: { stage: string; at: string; messageRef?: string } | null = null;
  lastError: { stage: string; at: string; code: string | number | null } | null = null;
  lastPersistenceAt: string | null = null;
  lastMessageAt:string|null=null;
  lastTransportAt:string|null=null;
  lastRecentPersistenceAt:string|null=null;
  readonly history:Record<string,{status:'complete'|'paused';explicit:boolean;at:string}>={};
  communicationRestriction:{active:boolean;until:string|null;category:string|null}|null=null;
  historyStatus(update:any):void {
    if(!Number.isInteger(update?.syncType)||update.syncType<0||update.syncType>255||!['complete','paused'].includes(update.status)||typeof update.explicit!=='boolean')throw Object.assign(new Error('INVALID_HISTORY_STATUS'),{code:'INVALID_HISTORY_STATUS'});
    const previous=this.history[String(update.syncType)];
    if(previous?.status==='complete'&&previous.explicit&&(update.status!=='complete'||!update.explicit)){this.event('history_status_stale_ignored');return;}
    this.history[String(update.syncType)]={status:update.status,explicit:update.explicit,at:new Date().toISOString()};
    this.event(update.status==='paused'?'history_paused':update.explicit?'history_complete_explicit':'history_complete_inferred');
  }
  restriction(update:any):void {
    if(typeof update?.isActive!=='boolean')return;
    const date=update.timeEnforcementEnds==null?null:new Date(update.timeEnforcementEnds);
    const category=typeof update.enforcementType==='string'&&/^[A-Z_]{1,100}$/.test(update.enforcementType)?update.enforcementType:null;
    this.communicationRestriction={active:update.isActive,until:date&&Number.isFinite(date.getTime())?date.toISOString():null,category};
    this.event(update.isActive?'communication_restricted':'communication_restriction_cleared');
  }
  syncCompletedAt: string | null = null;
  offlineTerminalAt: string | null = null;
  receivedPendingNotifications = false;
  readonly startedAt = Date.now();
  constructor(private readonly sink: (value: Record<string, unknown>) => void = () => undefined) {}
  increment(stage:string,count=1){this.counters[stage]=(this.counters[stage]??0)+count;}
  batch(stage:string,eventType:'notify'|'append'|'history'|'mapping',count:number,result?:'queued'|'completed'|'unchanged'|'retained',reason?:'unsupported_content'|'invalid_identity_or_envelope'){
    const value={stage,at:new Date().toISOString(),eventType,count,...(result?{result}:{}),...(reason?{reason}:{})};
    this.increment(stage);this.lastEvent=value;this.sink(value);
  }
  event(stage: string, id?: string, durationMs?: number): void {
    this.counters[stage] = (this.counters[stage] ?? 0) + 1;
    const value = { stage, at: new Date().toISOString(), ...(id ? { messageRef: reference(id) } : {}) };
    this.lastEvent = value;
    if (stage === 'message_persisted') this.lastPersistenceAt = value.at;
    if(stage==='message_observed')this.lastMessageAt=value.at;
    if(stage==='transport_message')this.lastTransportAt=value.at;
    if(stage==='recent_message_persisted')this.lastRecentPersistenceAt=value.at;
    this.sink({ ...value, ...(durationMs !== undefined ? { durationMs: Math.max(0, Math.round(durationMs)) } : {}) });
  }
  error(stage: string, error: unknown): void {
    this.lastError = { stage, at: new Date().toISOString(), code: errorCode(error) };
    this.counters[stage] = (this.counters[stage] ?? 0) + 1;
    this.sink({ ...this.lastError, ...storageDetails(error) });
  }
}
