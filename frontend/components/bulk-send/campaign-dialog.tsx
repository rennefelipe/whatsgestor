"use client";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "../icons";
export function CampaignDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;if(dialog&&!dialog.open)dialog.showModal();return()=>{dialog?.close();};},[]);
  return <dialog ref={ref} className="bulk-dialog bulk-wizard" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="bulk-panel-heading"><div><p className="eyebrow">Envio em Lote</p><h2>{title}</h2></div><button type="button" className="secondary-button bulk-icon-button" aria-label="Fechar janela" onClick={onClose}><Icon name="close"/></button></div>
    <div className="bulk-panel-body">{children}</div>
  </dialog>;
}
