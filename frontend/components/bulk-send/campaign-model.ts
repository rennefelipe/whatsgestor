import type { Recipient } from "@/services/api/bulk-send";

export const CAMPAIGN_VARIABLES = ["responsavel", "shopping", "loja", "grupo", "funcao"] as const;
export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number];
export const VARIABLE_LABELS: Record<CampaignVariable, string> = { responsavel: "Responsável", shopping: "Shopping", loja: "Loja", grupo: "Grupo", funcao: "Função" };
export interface CampaignSchedule {
  mode: "immediate" | "scheduled";
  date: string; time: string; timeZone: string;
  dailyLimit: number; intervalSeconds: number;
  days: number[]; startTime: string; endTime: string;
  pauseOnFailure: boolean; retryEnabled: boolean; maxRetries: number; retryAfterMinutes: number;
}
export const defaultSchedule = (): CampaignSchedule => ({ mode: "immediate", date: "", time: "09:00", timeZone: "America/Sao_Paulo", dailyLimit: 100, intervalSeconds: 60, days: [1,2,3,4,5], startTime: "09:00", endTime: "18:00", pauseOnFailure: true, retryEnabled: false, maxRetries: 1, retryAfterMinutes: 60 });
export interface AttachmentMetadata { id: string; name: string; size: number; type: string }
export interface PreparedAttachment extends AttachmentMetadata { file?: File }
export interface CampaignDraft {
  id: string; name: string; text: string; updatedAt: string;
  selectionId: string | null; revisionId: string | null;
  schedule: CampaignSchedule; attachments: AttachmentMetadata[];
}
export interface MessageTemplate { id: string; name: string; text: string; updatedAt: string }
export interface LocalCampaignLibrary { version: 1; drafts: CampaignDraft[]; templates: MessageTemplate[] }
export const emptyLibrary = (): LocalCampaignLibrary => ({ version: 1, drafts: [], templates: [] });
export const newLocalId=()=>typeof crypto.randomUUID==="function"?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");
export const LOCAL_STORAGE_NOTICE = "Rascunhos e modelos ficam neste navegador e usuário. Não são compartilhados com os demais atendentes. Anexos devem ser selecionados novamente após recarregar.";
const storageKey = (owner: string) => `whatsgestor.campaign-preparation.v1.${owner}`;
export function readLibrary(storage: Pick<Storage, "getItem">, owner: string): LocalCampaignLibrary {
  const raw=storage.getItem(storageKey(owner));
  if(!raw)return emptyLibrary();
  const value: unknown=JSON.parse(raw);
  if(!value||typeof value!=="object")throw Error("Biblioteca local inválida. Nenhum dado foi substituído.");
  const library=value as LocalCampaignLibrary;
  const text=(s:unknown):s is string=>typeof s==="string";
  if(library.version!==1||!Array.isArray(library.drafts)||!Array.isArray(library.templates)||library.drafts.length>50||library.templates.length>50)throw Error("Biblioteca local incompatível. Nenhum dado foi substituído.");
  if(!library.drafts.every(d=>d&&text(d.id)&&text(d.name)&&text(d.text)&&text(d.updatedAt)&&!Number.isNaN(Date.parse(d.updatedAt))&&(d.selectionId===null||text(d.selectionId))&&(d.revisionId===null||text(d.revisionId))&&isSchedule(d.schedule)&&Array.isArray(d.attachments)&&d.attachments.every(a=>a&&text(a.id)&&text(a.name)&&text(a.type)&&Number.isFinite(a.size)&&a.size>0)))throw Error("Rascunhos locais inválidos. Nenhum dado foi substituído.");
  if(!library.templates.every(t=>t&&text(t.id)&&text(t.name)&&text(t.text)&&text(t.updatedAt)))throw Error("Modelos locais inválidos. Nenhum dado foi substituído.");
  return library;
}
function isSchedule(v: unknown): v is CampaignSchedule {
  if(!v||typeof v!=="object")return false;
  const s=v as CampaignSchedule;
  return ["immediate","scheduled"].includes(s.mode)&&[s.date,s.time,s.timeZone,s.startTime,s.endTime].every(x=>typeof x==="string")&&[s.dailyLimit,s.intervalSeconds,s.maxRetries,s.retryAfterMinutes].every(Number.isFinite)&&Array.isArray(s.days)&&s.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6)&&typeof s.pauseOnFailure==="boolean"&&typeof s.retryEnabled==="boolean";
}
export function writeLibrary(storage: Pick<Storage,"setItem">,owner:string,library:LocalCampaignLibrary) {
  // Explicit saves only. Store metadata, never File contents, contacts or auth.
  const safe={...library,drafts:library.drafts.map(d=>({...d,attachments:d.attachments.map(({id,name,size,type})=>({id,name,size,type}))}))};
  storage.setItem(storageKey(owner),JSON.stringify(safe));
}
export function usedVariables(text:string):string[] {return [...new Set(Array.from(text.matchAll(/(?<!\{)\{([^{}]+)\}(?!\})/g),m=>m[1].trim()))];}
export function variableValue(row:Recipient|undefined,key:string):string {
  if(!row)return "";
  const values:Record<string,string|null>={responsavel:row.names.filter(Boolean).join(" / "),shopping:row.shopping,loja:row.storeName,grupo:row.group,funcao:row.role};
  return values[key]?.trim()||"";
}
export function renderCampaignText(text:string,row?:Recipient):string {return text.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g,(_token,key:string)=>variableValue(row,key.trim())||`[${key.trim()}: não informado]`);}
export function validateMessage(name:string,text:string,rows:Recipient[]):string[] {
  const errors:string[]=[];
  if(!name.trim())errors.push("Informe o nome da campanha.");
  if(!text.trim())errors.push("Escreva a mensagem.");
  if(name.length>120)errors.push("O nome deve ter até 120 caracteres.");
  if(text.length>10000)errors.push("O texto de preparação deve ter até 10.000 caracteres.");
  if(text.includes("{{")||text.includes("}}"))errors.push("Use uma chave por variável, por exemplo {responsavel}.");
  const stripped=text.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g,"");
  if(/[{}]/.test(stripped))errors.push("Há uma variável com chaves incompletas ou inválidas.");
  for(const key of usedVariables(text)){
    if(!(CAMPAIGN_VARIABLES as readonly string[]).includes(key)){errors.push(`Variável não reconhecida: {${key}}.`);continue;}
    const missing=rows.filter(r=>!variableValue(r,key)).length;
    if(missing)errors.push(`${missing} destinatário(s) carregado(s) sem ${VARIABLE_LABELS[key as CampaignVariable].toLowerCase()}.`);
  }
  return errors;
}
export const ATTACHMENT_ACCEPT=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.ogg,.opus,.m4a,.mp4,.webm";
export const MAX_ATTACHMENT_SIZE=16*1024*1024;
const mimeTypes:Record<string,string[]>={jpg:["image/jpeg"],jpeg:["image/jpeg"],png:["image/png"],webp:["image/webp"],pdf:["application/pdf"],mp3:["audio/mpeg","audio/mp3"],ogg:["audio/ogg","application/ogg"],opus:["audio/ogg","audio/opus"],m4a:["audio/mp4","audio/x-m4a"],mp4:["video/mp4"],webm:["video/webm","audio/webm"]};
export function attachmentIssue(file:Pick<File,"name"|"size"|"type">,existing:AttachmentMetadata[]):string|null {
  const ext=file.name.split(".").pop()?.toLowerCase()||"";
  if(!mimeTypes[ext])return `${file.name}: formato não aceito na preparação.`;
  if(!Number.isFinite(file.size)||file.size<=0)return `${file.name}: arquivo vazio ou inválido.`;
  if(file.size>MAX_ATTACHMENT_SIZE)return `${file.name}: excede o limite de preparação de 16 MB.`;
  if(file.type&&!mimeTypes[ext].includes(file.type.toLowerCase()))return `${file.name}: tipo informado incompatível com a extensão.`;
  if(existing.some(a=>a.name===file.name&&a.size===file.size))return `${file.name}: arquivo já adicionado.`;
  if(existing.length>=10)return "Prepare no máximo dez anexos por rascunho.";
  return null;
}
export function formatBytes(size:number){return size<1024*1024?`${Math.ceil(size/1024)} KB`:`${(size/1024/1024).toFixed(1)} MB`;}
export const TIME_ZONES=["America/Sao_Paulo","America/Manaus","America/Rio_Branco"];
const validTime=(s:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function validateSchedule(s:CampaignSchedule,now=new Date()):string[] {
  const errors:string[]=[];
  if(!Number.isInteger(s.dailyLimit)||s.dailyLimit<1||s.dailyLimit>10000)errors.push("O limite diário deve ser um inteiro de 1 a 10.000.");
  if(!Number.isInteger(s.intervalSeconds)||s.intervalSeconds<1||s.intervalSeconds>86400)errors.push("O intervalo deve ser um inteiro de 1 a 86.400 segundos.");
  if(!s.days.length||new Set(s.days).size!==s.days.length||s.days.some(d=>!Number.isInteger(d)||d<0||d>6))errors.push("Selecione dias da semana válidos.");
  if(!validTime(s.startTime)||!validTime(s.endTime)||s.startTime>=s.endTime)errors.push("A janela deve começar antes de terminar, no mesmo dia.");
  if(!TIME_ZONES.includes(s.timeZone))errors.push("Selecione um fuso horário disponível.");
  if(s.retryEnabled&&(!Number.isInteger(s.maxRetries)||s.maxRetries<1||s.maxRetries>3||!Number.isInteger(s.retryAfterMinutes)||s.retryAfterMinutes<1||s.retryAfterMinutes>10080))errors.push("Defina de uma a três tentativas e espera de 1 a 10.080 minutos. O reenvio continuará dependendo de confirmação futura.");
  if(!["immediate","scheduled"].includes(s.mode))errors.push("Selecione o modo da programação.");
  if(s.mode==="scheduled"){
    const day=new Date(`${s.date}T00:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==s.date||!validTime(s.time)){errors.push("Informe data e horário válidos para o agendamento.");}
    else if(TIME_ZONES.includes(s.timeZone)){
      if(!s.days.includes(day.getUTCDay()))errors.push("O agendamento está fora dos dias permitidos.");
      if(s.time<s.startTime||s.time>=s.endTime)errors.push("O horário agendado está fora da janela permitida.");
      // Convert the chosen wall time using the IANA timezone, not this browser's timezone.
      const [year,month,date]=s.date.split("-").map(Number),[hour,minute]=s.time.split(":").map(Number);
      const wall=Date.UTC(year,month-1,date,hour,minute);let utc=wall;
      const formatter=new Intl.DateTimeFormat("en-GB",{timeZone:s.timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
      for(let n=0;n<3;n++){const parts=Object.fromEntries(formatter.formatToParts(new Date(utc)).map(p=>[p.type,p.value]));const rendered=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);utc+=wall-rendered;}
      if(utc<=now.getTime())errors.push("O agendamento deve estar no futuro, no fuso selecionado.");
    }
  }
  return errors;
}
