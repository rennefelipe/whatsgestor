import { createAttachmentAttemptId } from './attachment-selection';
const memory=new Map<string,{digest:string;key:string}>();
/** Keep only a fingerprint and UUID, never the draft text, across reloads. */
export async function textAttemptKey(conversationId:string,text:string):Promise<string>{
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const name='whatsgestor:text-attempt:'+conversationId;
  let previous=memory.get(name);
  try{previous??=JSON.parse(sessionStorage.getItem(name)??'null');}catch{/* In-memory idempotency remains available. */}
  const value=previous?.digest===digest?previous:{digest,key:createAttachmentAttemptId()};memory.set(name,value);
  try{sessionStorage.setItem(name,JSON.stringify(value));}catch{/* Do not persist plaintext as a fallback. */}
  return value.key;
}
export function clearTextAttempt(conversationId:string){const name='whatsgestor:text-attempt:'+conversationId;memory.delete(name);try{sessionStorage.removeItem(name);}catch{}}
