import { codedError } from './contracts';

export function storageError(code:string,cause:unknown,context:Record<string,unknown>={}):Error {
  return Object.assign(codedError(code),{cause,storageContext:context});
}
/** Explicit allowlist: never log messages, stacks, paths, keys or payloads. */
export function storageDetails(error:any):Record<string,unknown> {
  const causes:Array<string|number>=[];let current=error;
  const result:Record<string,unknown>={};
  for(let depth=0;current&&depth<8;depth++,current=current.cause){
    const code=current.code;
    if((typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(code))||Number.isInteger(code))causes.push(code);
    if(['TypeError','SyntaxError','RangeError'].includes(current.name))result.errorType=current.name;
    for(const name of ['operation','namespace','phase']){
      const value=current.storageContext?.[name];
      if(result[name]===undefined&&typeof value==='string'&&/^[a-z_-]{1,40}$/.test(value))result[name]=value;
    }
    for(const name of ['recordBytes','limitBytes']){
      const value=current.storageContext?.[name];if(Number.isSafeInteger(value)&&value>=0)result[name]=value;
    }
    if(current.killed===true)result.processKilled=true;
    if(current.signal==='SIGTERM'||current.signal==='SIGKILL')result.processSignal=current.signal;
  }
  if(causes.length)result.causeCodes=causes;
  return result;
}
