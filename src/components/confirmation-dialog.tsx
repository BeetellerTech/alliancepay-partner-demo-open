"use client";
import { useEffect, useRef } from "react";
import { Button } from "./ui";
export function ConfirmationDialog({ title, text, busy, onClose, onConfirm }: { title: string; text: string; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className="confirmation" aria-labelledby="confirmation-title" aria-describedby="confirmation-description" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <h2 id="confirmation-title">{title}</h2><p id="confirmation-description">{text}</p><div className="action-row"><Button variant="secondary" autoFocus onClick={onClose} disabled={busy}>Voltar</Button><Button variant="danger" busy={busy} onClick={onConfirm}>Confirmar solicitação</Button></div>
  </dialog>;
}
