"use client";
import { useRef, useState } from "react";
import type { Recipient } from "@/services/api/bulk-send";
import { Icon } from "../icons";
import { ATTACHMENT_ACCEPT, CAMPAIGN_VARIABLES, VARIABLE_LABELS, attachmentIssue, newLocalId, formatBytes, renderCampaignText, validateMessage } from "./campaign-model";
import type { PreparedAttachment, MessageTemplate } from "./campaign-model";
export function CampaignMessage({name,text,onName,onText,attachments,onAttachments,templates,onSaveTemplate,previewRows,previewTotal,previewPage,previewBusy,previewError,onPreviewPage,exampleKey,onExampleKey}:{
  name:string;text:string;onName:(value:string)=>void;onText:(value:string)=>void;
  attachments:PreparedAttachment[];onAttachments:(value:PreparedAttachment[])=>void;
  templates:MessageTemplate[];onSaveTemplate:()=>void;
  previewRows:Recipient[];previewTotal:number;previewPage:number;previewBusy:boolean;previewError:string;
  onPreviewPage:(page:number)=>void;exampleKey:string;onExampleKey:(key:string)=>void;
}){
  const textarea=useRef<HTMLTextAreaElement>(null);const [attachmentErrors,setAttachmentErrors]=useState<string[]>([]);
  const example=previewRows.find(r=>r.key===exampleKey)||previewRows[0];
  function insert(key:string){const element=textarea.current;const start=element?.selectionStart??text.length,end=element?.selectionEnd??start,token=`{${key}}`;onText(text.slice(0,start)+token+text.slice(end));requestAnimationFrame(()=>{element?.focus();element?.setSelectionRange(start+token.length,start+token.length);});}
  const errors=validateMessage(name,text,previewRows);
  return <div className="bulk-editor-grid">
    <section className="bulk-panel"><div className="bulk-panel-heading"><div><h2>Mensagem da campanha</h2><p>Prepare o conteúdo e personalize a conversa.</p></div><Icon name="edit"/></div><div className="bulk-panel-body bulk-form-stack">
      <label className="bulk-field">Nome da campanha <span className="bulk-field-hint">Obrigatório · identificação interna</span><input id="bulk-campaign-name" value={name} maxLength={120} onChange={e=>onName(e.target.value)} placeholder="Dê um nome à campanha"/></label>
      <div><label className="bulk-field" htmlFor="bulk-message">Mensagem <span className="bulk-field-hint">Obrigatória · use as variáveis abaixo para personalizar</span></label><textarea ref={textarea} id="bulk-message" rows={9} value={text} maxLength={10000} onChange={e=>onText(e.target.value)} placeholder="Escreva sua mensagem…"/>
        <div className="bulk-variable-actions">{CAMPAIGN_VARIABLES.map(key=><button type="button" key={key} className="secondary-button" onClick={()=>insert(key)}>+ {VARIABLE_LABELS[key]}</button>)}<span className="bulk-character-count" aria-live="polite">{text.length.toLocaleString("pt-BR")} / 10.000 caracteres</span></div>
        {!!errors.length&&<ul className="bulk-validation" aria-label="Validações da mensagem" role="status">{errors.map(error=><li key={error}>{error}</li>)}</ul>}
      </div>
      <div><h3>Anexos preparados <span className="bulk-field-hint">· opcionais</span></h3><label className="bulk-attachment-zone"><span><Icon name="paperclip"/> Selecionar arquivos</span><input aria-label="Anexar arquivos à campanha" type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={e=>{const next=[...attachments],issues:string[]=[];for(const file of Array.from(e.target.files||[])){const reattach=next.findIndex(a=>!a.file&&a.name===file.name&&a.size===file.size);const issue=attachmentIssue(file,next.filter((_,index)=>index!==reattach));if(issue){issues.push(issue);continue;}const prepared={id:reattach>=0?next[reattach].id:newLocalId(),name:file.name,size:file.size,type:file.type||"Tipo não informado",file};if(reattach>=0)next[reattach]=prepared;else next.push(prepared);}onAttachments(next);setAttachmentErrors(issues);e.target.value="";}}/><small>Até 10 arquivos · 16 MB por arquivo. Validação de preparação por tipo, extensão e tamanho; nenhum arquivo é enviado.</small></label>
        {!!attachmentErrors.length&&<ul className="bulk-validation" role="alert">{attachmentErrors.map((error,index)=><li key={index}>{error}</li>)}</ul>}
        <div className="bulk-attachments">{attachments.map(file=><div className="bulk-attachment" key={file.id}><Icon name="paperclip"/><div><strong>{file.name}</strong><small>{formatBytes(file.size)} · {file.type}</small>{!file.file&&<span className="bulk-badge bulk-warning">Selecione o arquivo novamente</span>}</div><button type="button" className="secondary-button" onClick={()=>onAttachments(attachments.filter(a=>a.id!==file.id))} aria-label={`Remover anexo ${file.name}`}>Remover</button></div>)}</div>
      </div>
    </div></section>
    <aside className="bulk-panel"><div className="bulk-panel-heading"><div><h2>Prévia por destinatário</h2><p>Somente informações da seleção real.</p></div><Icon name="whatsapp"/></div><div className="bulk-panel-body bulk-preview-area">
      <label className="bulk-field">Destinatário de exemplo<select id="bulk-example" value={example?.key||""} disabled={previewBusy||!previewRows.length} onChange={e=>onExampleKey(e.target.value)}>{!previewRows.length&&<option value="">Nenhum selecionado disponível</option>}{previewRows.map(row=><option key={row.key} value={row.key}>{row.names.join(" / ")||"Responsável não informado"} · {row.storeName||"Sem loja"} · {row.role||"Sem função"}</option>)}</select></label>
      <div className="bulk-preview-pagination"><button type="button" className="secondary-button" disabled={previewBusy||previewPage<=1} onClick={()=>onPreviewPage(previewPage-1)}>Exemplos anteriores</button><small>Página {previewPage} · {previewTotal} selecionado(s)</small><button type="button" className="secondary-button" disabled={previewBusy||previewPage*25>=previewTotal} onClick={()=>onPreviewPage(previewPage+1)}>Mais exemplos</button></div>
      {previewBusy&&<p role="status">Carregando destinatários selecionados…</p>}{previewError&&<p className="form-error" role="alert">{previewError} <button type="button" className="secondary-button" onClick={()=>onPreviewPage(previewPage)}>Tentar novamente</button></p>}
      <div className="bulk-phone"><div className="bulk-phone-heading"><Icon name="user"/><div><strong>{example?.names.join(" / ")||"Nenhum destinatário"}</strong><small>Prévia · sem envio</small></div></div><div className="bulk-chat-surface"><div className="bulk-message-bubble" data-testid="campaign-preview">{example?renderCampaignText(text,example)||"Sua mensagem aparecerá aqui.":"Selecione destinatários para visualizar as variáveis."}</div></div></div>
      <p className="bulk-helper">Variáveis ausentes aparecem identificadas. A validação de dados abrange os {previewRows.length} destinatários carregados nesta página; não comprova todos os selecionados.</p>
      <div className="bulk-templates"><h3>Modelos deste navegador</h3>{!templates.length&&<p className="bulk-helper">Nenhum modelo salvo por este usuário.</p>}{templates.map(template=><button type="button" className="secondary-button" key={template.id} onClick={()=>onText(template.text)}><span>{template.name}</span><span>Usar →</span></button>)}<button type="button" className="secondary-button" disabled={!name.trim()||!text.trim()} onClick={onSaveTemplate}><Icon name="plus"/> Salvar como modelo local</button></div>
    </div></aside>
  </div>;
}
