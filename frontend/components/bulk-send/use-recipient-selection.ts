"use client";
import { useEffect, useState } from "react";
import { getContactOptions, getContactTypes } from "@/services/api/contacts";
import { ApiRequestError } from "@/services/api/client";
import { createRecipientSelection, getRecipientSelection, updateRecipientSelection, getLatestRecipientSelection, getSelectionOperation, recoverSelectionOperation } from "@/services/api/bulk-send";
import type { RecipientFilters, RecipientSelection, SelectionOperation } from "@/services/api/bulk-send";
import type { ContactOptions, ContactType } from "@/types/api";
import { writeSelectionToken } from "./selection-token";
const message=(error:unknown)=>error instanceof Error?error.message:"Não foi possível carregar a seleção.";
export function useRecipientSelection(ownerId:string|undefined){
  const [data, setData] = useState<RecipientSelection | null>(null);
  const [filters, setFilters] = useState<RecipientFilters>({});
  const [options, setOptions] = useState<ContactOptions>({
    organizationContexts: [],
    storeNames: [],
  });
  const [roles, setRoles] = useState<ContactType[]>([]);
  const [optionsReady, setOptionsReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<"query" | "selected">("query");
  const [operation, setOperation] = useState<SelectionOperation | null>(null);
  const editingBlocked = busy || operation?.status === "building";
  useEffect(() => {
    if (!operation || operation.status !== "building") return;
    const timer = setInterval(() => {
      void getSelectionOperation(operation.requestId)
        .then(async (result) => {
          setOperation(result);
          if (result.status === "completed" && !busy) {
            const restored = await getRecipientSelection(result.selectionId);
            setData(restored);
            setFilters(restored.filters);
            setView("query");
          }
        })
        .catch(() => {
          /* The explicit reload action reports database unavailability. */
        });
    }, 1500);
    return () => clearInterval(timer);
  }, [operation, busy]);

  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    const load = async () => {
      const [loadedOptions, loadedRoles] = await Promise.all([
        getContactOptions(controller.signal),
        getContactTypes(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setOptions(loadedOptions);
      setRoles(loadedRoles);
      setOptionsReady(true);
      const latest = await getLatestRecipientSelection(controller.signal);
      const selection =
        latest ??
        (await createRecipientSelection({}, controller.signal, setOperation));
      if (controller.signal.aborted) return;
      writeSelectionToken(ownerId, selection.id);
      setData(selection);
      setOperation(selection.operation);
      setFilters(selection.filters);
      setView("query");
      setError("");
    };
    void load()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setError(message(error));
          setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [ownerId, reload]);

  async function run(
    action: Parameters<typeof updateRecipientSelection>[1],
    extra: Parameters<typeof updateRecipientSelection>[2] = {},
    desiredView = view,
  ) {
    if (editingBlocked) return;
    setBusy(true);
    setError("");
    try {
      if (!data && action !== "filter") return;
      let current = data;
      // A failed preference read hides cached eligibility, but must not discard
      // the existing server selection when the operator retries the filters.
      if (!current) current = await getLatestRecipientSelection();
      const result = current
        ? await updateRecipientSelection(current, action, extra, setOperation)
        : await createRecipientSelection(
            extra.filters ?? {},
            undefined,
            setOperation,
          );
      if (!data && ownerId) writeSelectionToken(ownerId, result.id);
      const desiredPage =
        action === "add" || action === "remove" ? (data?.page ?? 1) : 1;
      const shown =
        desiredView === "selected" || desiredPage > 1
          ? await getRecipientSelection(result.id, desiredPage, desiredView)
          : result;
      setData(shown);
      setOperation(shown.operation);
      setView(desiredView);
      return true;
    } catch (error) {
      setError(message(error));
      if (
        error instanceof ApiRequestError &&
        (error.status === 0 || error.status >= 500)
      )
        setData(null);
      // On version conflict reload the authoritative server state before retrying.
      if (data && error instanceof ApiRequestError && error.status === 409) {
        try {
          const current = await getRecipientSelection(data.id, 1, desiredView);
          setData(current);
          setFilters(current.filters);
          setView(desiredView);
        } catch {
          setData(null);
        }
      }
      if (error instanceof ApiRequestError && [404, 410].includes(error.status))
        setData(null);
    } finally {
      setBusy(false);
    }
  }

  const pendingFilters =
    JSON.stringify(filters) !== JSON.stringify(data?.filters ?? {});
  async function page(number: number, desiredView = view) {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      setData(await getRecipientSelection(data.id, number, desiredView));
      setView(desiredView);
    } catch (error) {
      setError(message(error));
      setData(null);
    } finally {
      setBusy(false);
    }
  }


  async function recover() {
    if (!operation || busy || !operation.recoverable) return;
    setBusy(true);
    try {
      const restored = await recoverSelectionOperation(operation.id);
      setData(restored); setFilters(restored.filters); setOperation(restored.operation);
      setView("query"); setError("");
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  async function restore(id:string) {
    if (editingBlocked) return null;
    setBusy(true); setError("");
    try {
      const restored=await getRecipientSelection(id);
      setData(restored); setFilters(restored.filters); setOperation(restored.operation); setView("query");
      if(ownerId)writeSelectionToken(ownerId,restored.id);
      return restored;
    } catch(failure) {setError(message(failure));return null;}
    finally {setBusy(false);}
  }
  return {data,filters,setFilters,options,roles,optionsReady,busy,error,view,operation,editingBlocked,pendingFilters,run,page,recover,restore,reload:()=>{setBusy(true);setReload(value=>value+1);}};
}
