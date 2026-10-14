"use client";
import { ProfileAvatar } from "../profile-avatar";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getContacts } from "@/services/api/contacts";
import { updateWhatsappConversationContact } from "@/services/api/whatsapp-conversations";
import type { Contact, WhatsappConversation } from "@/types/api";
import { Icon } from "../icons";

interface ConversationContactModalProps {
  conversation: WhatsappConversation;
  mode: "link" | "unlink";
  onClose: () => void;
  onSaved: (conversation: WhatsappConversation) => void;
}

export function ConversationContactModal({
  conversation,
  mode,
  onClose,
  onSaved,
}: ConversationContactModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [retry, setRetry] = useState(0);
  const isUnlinking = mode === "unlink";
  const term = search.trim();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (isUnlinking || term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const results = await getContacts(
          {
            organizationId: "",
            contactTypeId: "",
            isActive: "true",
            search: term,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) setContacts(results);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearchError(
            error instanceof Error
              ? error.message
              : "Não foi possível pesquisar contatos.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term, isUnlinking, retry]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      savingRef.current ||
      (!isUnlinking && (!selectedContact || isSearching))
    )
      return;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError("");
    try {
      const updated = await updateWhatsappConversationContact(
        conversation.id,
        isUnlinking ? null : selectedContact!.id,
      );
      onSaved(updated);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o vínculo.",
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal conversation-contact-modal"
      aria-labelledby="conversation-contact-title"
      aria-describedby="conversation-contact-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!savingRef.current) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || savingRef.current) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header className="modal-header">
        <div>
          <h2 id="conversation-contact-title">
            {isUnlinking ? "Desvincular contato" : "Vincular contato"}
          </h2>
          <p id="conversation-contact-description">
            {isUnlinking
              ? "Confirme a remoção do vínculo com o contato cadastrado."
              : "Pesquise e selecione um contato já cadastrado."}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Fechar"
          disabled={isSaving}
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          {saveError && (
            <div className="form-error" role="alert">
              {saveError}
            </div>
          )}
          {isUnlinking ? (
            <p className="conversation-contact-confirmation">
              Desvincular{" "}
              <strong>
                {conversation.contact?.contactName || "o contato cadastrado"}
              </strong>{" "}
              desta conversa? O nome original da conversa voltará a ser exibido.
            </p>
          ) : (
            <>
              <div className="form-field">
                <label htmlFor="conversation-contact-search">
                  Nome ou telefone
                </label>
                <input
                  autoFocus
                  id="conversation-contact-search"
                  maxLength={200}
                  disabled={isSaving}
                  value={search}
                  placeholder="Digite pelo menos 2 caracteres"
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.trim() !== term) {
                      setContacts([]);
                      setSelectedContact(null);
                      setSearchError("");
                      setSaveError("");
                      setIsSearching(value.trim().length >= 2);
                    }
                    setSearch(value);
                  }}
                />
              </div>
              {searchError && (
                <div className="form-error" role="alert">
                  {searchError}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isSaving || isSearching}
                    onClick={() => {
                      setSearchError("");
                      setIsSearching(true);
                      setRetry((value) => value + 1);
                    }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
              <div
                className="conversation-contact-results"
                aria-busy={isSearching}
              >
                {term.length < 2 ? (
                  <p role="status">
                    Digite um nome ou telefone para pesquisar contatos ativos.
                  </p>
                ) : isSearching ? (
                  <p role="status">Pesquisando contatos...</p>
                ) : !searchError && contacts.length === 0 ? (
                  <p role="status">Nenhum contato ativo encontrado.</p>
                ) : (
                  contacts.map((contact) => (
                    <label
                      className="conversation-contact-option"
                      key={contact.id}
                    >
                      <input
                        type="radio"
                        name="conversation-contact"
                        value={contact.id}
                        disabled={isSaving}
                        checked={selectedContact?.id === contact.id}
                        onChange={() => {
                          setSelectedContact(contact);
                          setSaveError("");
                        }}
                      />
                      <ProfileAvatar
                        name={contact.contactName}
                        contactId={contact.id}
                      />
                      <span>
                        <strong>{contact.contactName}</strong>
                        <span>{contact.phone || "Telefone não informado"}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
              {selectedContact && (
                <p className="conversation-contact-confirmation">
                  Vincular <strong>{selectedContact.contactName}</strong> a esta
                  conversa?
                </p>
              )}
            </>
          )}
        </div>
        <footer className="modal-footer">
          <button
            autoFocus={isUnlinking}
            className="secondary-button"
            type="button"
            disabled={isSaving}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={
              isSaving || (!isUnlinking && (!selectedContact || isSearching))
            }
          >
            {isSaving
              ? isUnlinking
                ? "Desvinculando..."
                : "Vinculando..."
              : isUnlinking
                ? "Confirmar desvinculação"
                : "Confirmar vínculo"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
