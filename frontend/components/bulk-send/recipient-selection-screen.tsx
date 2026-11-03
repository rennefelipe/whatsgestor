"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";
import type { IconName } from "../icons";
import { getRecipientSelection } from "@/services/api/bulk-send";
import type { Recipient } from "@/services/api/bulk-send";
import { useRecipientSelection } from "./use-recipient-selection";
import { CampaignRecipients } from "./campaign-recipients";
import { CampaignMessage } from "./campaign-message";
import { CampaignSchedule } from "./campaign-schedule";
import { CampaignReview } from "./campaign-review";
import { CampaignHistory } from "./campaign-history";
import { defaultSchedule, emptyLibrary, LOCAL_STORAGE_NOTICE, newLocalId, readLibrary, writeLibrary } from "./campaign-model";
import type { CampaignDraft, CampaignSchedule as Schedule, LocalCampaignLibrary, PreparedAttachment } from "./campaign-model";
import "./campaign.css";

const steps: Array<{label:string;icon:IconName}>=[{label:'Destinatários',icon:'contacts'},{label:'Mensagem',icon:'edit'},{label:'Programação',icon:'clock'},{label:'Revisão',icon:'check'},{label:'Histórico',icon:'refresh'}];
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Não foi possível concluir a operação.';
export function RecipientSelectionScreen({onOpenContacts}:{onOpenContacts:(phone?:string)=>void}){
  const {user}=useAuth();
  return <CampaignWorkspace key={user?.id||'no-session'} ownerId={user?.id} onOpenContacts={onOpenContacts}/>;
}
function CampaignWorkspace({ownerId,onOpenContacts}:{ownerId:string|undefined;onOpenContacts:(phone?:string)=>void}){
  const selection=useRecipientSelection(ownerId),{data,busy,operation}=selection;
  const [step,setStep]=useState(0),[name,setName]=useState(''),[text,setText]=useState('');
  const [schedule,setSchedule]=useState<Schedule>(defaultSchedule);
  const [attachments,setAttachments]=useState<PreparedAttachment[]>([]);
  const [library,setLibrary]=useState<LocalCampaignLibrary>(emptyLibrary),[libraryReady,setLibraryReady]=useState(false);
  const [libraryError,setLibraryError]=useState(''),[notice,setNotice]=useState(''),[draftId,setDraftId]=useState<string|null>(null);
  const [previewCursor,setPreviewCursor]=useState({binding:'',page:1}),[previewReload,setPreviewReload]=useState(0),[exampleKey,setExampleKey]=useState('');
  const [preview,setPreview]=useState<{requestKey:string;rows:Recipient[];total:number;error:string}>({requestKey:'',rows:[],total:0,error:''});
  const selectionId=data?.id,version=data?.version,hasPublishedRevision=data?.hasPublishedRevision;
  const previewBinding=`${selectionId}:${version}`;
  const previewPage=previewCursor.binding===previewBinding?previewCursor.page:1;
  const previewKey=`${previewBinding}:${previewPage}:${previewReload}:${step}`;
  const setPreviewPage=(page:number)=>setPreviewCursor({binding:previewBinding,page});
  useEffect(()=>{
    if(!ownerId)return;
    let cancelled=false;
    void Promise.resolve().then(()=>{
      if(cancelled)return;
      try{setLibrary(readLibrary(localStorage,ownerId));setLibraryReady(true);}
      catch(error){setLibraryError(`${errorMessage(error)} O editor continua disponível, mas não sobrescreverá a biblioteca local.`);}
    });
    return()=>{cancelled=true;};
  },[ownerId]);
  useEffect(()=>{
    if((step!==1&&step!==3)||!selectionId||version===undefined||!hasPublishedRevision)return;
    const controller=new AbortController();
    void getRecipientSelection(selectionId,previewPage,'selected',controller.signal).then(result=>{
      if(!controller.signal.aborted)setPreview({requestKey:previewKey,rows:result.items,total:result.total,error:''});
    }).catch(error=>{if(!controller.signal.aborted)setPreview({requestKey:previewKey,rows:[],total:0,error:errorMessage(error)});});
    return()=>controller.abort();
  },[selectionId,version,hasPublishedRevision,previewPage,previewReload,step,previewKey]);
  const previewIsCurrent=preview.requestKey===previewKey;
  const previewRows=previewIsCurrent?preview.rows:[];
  const previewBusy=(step===1||step===3)&&!!hasPublishedRevision&&!previewIsCurrent;
  function persist(next:LocalCampaignLibrary):boolean{
    if(!ownerId||!libraryReady){setLibraryError('O armazenamento local não está disponível; o conteúdo do editor permanece nesta tela.');return false;}
    try{writeLibrary(localStorage,ownerId,next);setLibrary(next);setLibraryError('');return true;}
    catch{setLibraryError('Não foi possível salvar neste navegador. Verifique espaço e permissões. O conteúdo permanece nesta tela.');return false;}
  }
  function saveDraft(){
    if(!name.trim()){setNotice('Informe o nome da campanha antes de salvar o rascunho.');setStep(1);return;}
    if(![schedule.dailyLimit,schedule.intervalSeconds,schedule.maxRetries,schedule.retryAfterMinutes].every(Number.isFinite)){setNotice('Corrija os campos numéricos da programação antes de salvar.');setStep(2);return;}
    if(!draftId&&library.drafts.length>=50){setNotice('Limite de 50 rascunhos locais atingido. Nenhum registro foi substituído.');return;}
    const id=draftId||newLocalId();
    const draft:CampaignDraft={id,name:name.trim(),text,updatedAt:new Date().toISOString(),selectionId:data?.id||null,revisionId:data?.revisionId||null,schedule,attachments:attachments.map(({id,name,size,type})=>({id,name,size,type}))};
    if(persist({...library,drafts:[draft,...library.drafts.filter(d=>d.id!==id)]})){setDraftId(id);setNotice('Rascunho salvo neste navegador e usuário. Os dados da seleção permanecem no SQL; os arquivos dos anexos não são armazenados.');}
  }
  async function restoreDraft(draft:CampaignDraft){
    if(busy)return;
    setDraftId(draft.id);setName(draft.name);setText(draft.text);setSchedule(draft.schedule);
    setAttachments(draft.attachments.map(metadata=>({...metadata,file:attachments.find(a=>a.id===metadata.id&&a.name===metadata.name&&a.size===metadata.size)?.file})));
    setStep(1);
    if(draft.selectionId){
      const restored=await selection.restore(draft.selectionId);
      if(!restored){setNotice('Texto recuperado. A seleção vinculada não pôde ser carregada; confira o erro e escolha uma seleção válida. A seleção atual não foi substituída.');return;}
      setNotice(restored.revisionId!==draft.revisionId?'Rascunho recuperado. A seleção SQL possui uma revisão diferente da salva: confira os destinatários e revalide antes de continuar.':'Rascunho local recuperado e seleção consultada no SQL. Reanexe os arquivos que não estiverem disponíveis.');
    }else setNotice('Rascunho recuperado sem seleção vinculada. Escolha os destinatários e reanexe os arquivos necessários.');
  }
  function saveTemplate(){
    if(!name.trim()||!text.trim()){setNotice('Informe nome e mensagem para salvar um modelo.');return;}
    if(library.templates.length>=50){setNotice('Limite de 50 modelos locais atingido. Nenhum modelo foi substituído.');return;}
    if(persist({...library,templates:[{id:newLocalId(),name:name.trim(),text,updatedAt:new Date().toISOString()},...library.templates]}))setNotice('Modelo salvo apenas neste navegador e usuário.');
  }
  function go(next:number){setStep(next);}
  return <main className="main-content recipient-content bulk-wizard" aria-busy={busy}>
    <header className="bulk-heading"><div><p className="eyebrow">Campanhas WhatsApp</p><h1>Envio em Lote</h1><p className="page-subtitle">Selecione o público, prepare a mensagem e revise a campanha.</p></div><div className="bulk-heading-actions"><span className="bulk-badge bulk-info">{draftId?'Rascunho local':'Em preparação'}</span><button type="button" className="secondary-button" onClick={()=>onOpenContacts()}><Icon name="contacts"/> Abrir Contatos</button></div></header>
    <nav className="bulk-steps" aria-label="Etapas da campanha">{steps.map((item,index)=><button type="button" key={item.label} className={`bulk-step ${step===index?'is-active':''}`} aria-current={step===index?'step':undefined} onClick={()=>go(index)}><span className="bulk-step-number">{index+1}</span><span><Icon name={item.icon}/>{item.label}</span></button>)}</nav>
    <div className="bulk-progress" role="progressbar" aria-label={`Etapa ${step+1} de 5: ${steps[step].label}`} aria-valuemin={1} aria-valuemax={5} aria-valuenow={step+1}><span style={{width:`${(step+1)*20}%`}}/></div>
    <div className="bulk-stage-caption"><strong>Etapa {step+1} de 5 · {steps[step].label}</strong><span>Preparação de campanha · disparo indisponível</span></div>
    {notice&&<div className="bulk-callout bulk-info" role="status"><span>{notice}</span><button type="button" className="secondary-button bulk-icon-button" aria-label="Dispensar aviso" onClick={()=>setNotice('')}><Icon name="close"/></button></div>}
    {libraryError&&<div className="form-error" role="alert">{libraryError}</div>}
    {selection.error&&<div className="form-error" role="alert">{selection.error} <button type="button" className="secondary-button" disabled={busy} onClick={selection.reload}>Reabrir seleção</button></div>}
    {operation&&operation.status!=='completed'&&<div className="bulk-callout bulk-warning" role="status"><div><strong>{operation.status==='failed'?'Operação interrompida':'Processando seleção'}</strong><p>Tentativa {operation.attempt} · {operation.processed}/{operation.total||'…'} registros. A revisão anterior permanece até a publicação integral.</p><p>{operation.errors.at(-1)?.message}</p>{!operation.recoverable&&<small>Recuperação disponível após {new Date(operation.leaseExpiresAt).toLocaleString('pt-BR')}, se não concluir.</small>}</div><button type="button" className="secondary-button" disabled={busy||!operation.recoverable} onClick={()=>void selection.recover()}>Recuperar operação</button></div>}
    {data?.preferencesStatus==='not_configured'&&<div className="bulk-callout bulk-warning" role="status">Preferências de não recebimento sem armazenamento configurado. A seleção é preparatória e não autoriza envio; o gerenciamento permanente continua em Contatos.</div>}
    <div hidden={step!==0}><CampaignRecipients selection={selection} onOpenContacts={onOpenContacts}/></div>
    {step===1&&<CampaignMessage name={name} text={text} onName={setName} onText={setText} attachments={attachments} onAttachments={setAttachments} templates={library.templates} onSaveTemplate={saveTemplate} previewRows={previewRows} previewTotal={previewIsCurrent?preview.total:0} previewPage={previewPage} previewBusy={previewBusy} previewError={previewIsCurrent?preview.error:''} onPreviewPage={page=>{setPreviewPage(page);setPreviewReload(n=>n+1);}} exampleKey={exampleKey} onExampleKey={setExampleKey}/>}
    {step===2&&<CampaignSchedule value={schedule} onChange={setSchedule}/>}
    {step===3&&<CampaignReview name={name} text={text} schedule={schedule} attachments={attachments} selection={data} previewRows={previewRows} exampleKey={exampleKey} previewBusy={previewBusy} previewError={previewIsCurrent?preview.error:''} onEdit={go} onRevalidate={()=>void selection.run('review')} busy={selection.editingBlocked}/>}
    {step===4&&<CampaignHistory drafts={library.drafts} onRestore={draft=>void restoreDraft(draft)} busy={selection.editingBlocked}/>}
    {busy&&<p className="bulk-loading" role="status">Atualizando destinatários…</p>}
    <footer className="bulk-footer"><button type="button" className="secondary-button" disabled={step===0} onClick={()=>go(step-1)}>← Etapa anterior</button><div className="bulk-actions"><button type="button" className="secondary-button" disabled={!libraryReady||busy} onClick={saveDraft}><Icon name="paperclip"/> Salvar rascunho local</button>{step<4&&<button type="button" className="primary-button" onClick={()=>go(step+1)}>Próximo: {steps[step+1].label} →</button>}</div></footer>
    <p className="bulk-local-notice"><Icon name="store"/> {LOCAL_STORAGE_NOTICE}</p>
  </main>;
}
