"use client";
import { useEffect, useId, useRef } from "react";
import { CreditCard, X, Zap } from "lucide-react";
import { brl } from "@/lib/browser";
import { calendarBatches, moneyValue, shortDate, sumKnown } from "@/lib/report-presentation";
import type { Json } from "@/lib/types";
import { Button, Status } from "./ui";

function AmountLine({ label, value, debit = false, total = false }: { label: string; value: unknown; debit?: boolean; total?: boolean }) {
  const amount = moneyValue(value);
  return <div className={total ? "statement-total" : undefined}><dt>{label}</dt><dd>{amount === null ? "Não informado" : `${debit && amount > 0 ? "− " : ""}${brl(amount)}`}</dd></div>;
}

export function ReceivableDayDrawer({ day, onClose }: { day: Json; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const batches = calendarBatches(day);
  useEffect(() => {
    const element = dialog.current!, trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const date = new Date(`${day.payment_date}T12:00:00Z`);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return <dialog ref={dialog} className="receivable-day-drawer" aria-labelledby={titleId} aria-modal="true" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const targets = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
    const first = targets[0], last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="receivable-drawer-header">
      <div className="receivable-drawer-title"><h2 id={titleId}>Recebíveis de {dateLabel}</h2><Button variant="quiet" aria-label="Fechar detalhes" autoFocus onClick={onClose}><X size={20} aria-hidden="true" /></Button></div>
      <p>{new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(date)} · {batches.length} {batches.length === 1 ? "lote" : "lotes"}</p>
      {batches.length > 0 && <dl className="receivable-day-totals">{[["net", "Líquido previsto"], ["paid", "Pago"], ["open", "Em aberto"]].map(([field, label]) => {
        const sum = sumKnown(batches, field);
        return <div key={field}><dt>{label}</dt><dd>{sum.count !== sum.total || sum.amount === null ? "Não informado" : brl(sum.amount)}</dd></div>;
      })}</dl>}
    </header>
    <div className="receivable-drawer-content" tabIndex={0} role="region" aria-label="Lotes da data selecionada">
      {!batches.length ? <div className="receivable-day-empty"><h3>Nenhum recebível nesta data</h3><p>Nenhum lote para {shortDate(day.payment_date)}. Feche os detalhes e selecione outra data.</p></div> : batches.map((batch, index) => {
        const Icon = batch.kind === "Pix" ? Zap : CreditCard;
        const partial = batch.status === "PARTIALLY_SETTLED", paid = batch.status === "SETTLED" || partial;
        const display = moneyValue(paid ? batch.paid : batch.net);
        return <article className="receivable-batch" key={`${batch.kind}-${batch.id || index}`}>
          <div className="receivable-batch-heading"><h3>{batch.id ? `Repasse #${String(batch.id).slice(0, 8)}` : `Lote ${index + 1}`}</h3><Status value={batch.status || "UNKNOWN"} /></div>
          <p className="receivable-batch-amount">{display === null ? "Valor não informado" : brl(display)}</p>
          {partial && <p className="receivable-partial">pago de {batch.net === null ? "valor não informado" : brl(batch.net)}</p>}
          <p className="receivable-merchant">{batch.merchant_name || batch.legal_name || batch.trading_name || "Estabelecimento não informado"}</p>
          <p className="receivable-payment-kind"><Icon size={16} aria-hidden="true" />{batch.kind === "Pix" ? "Pix" : /CREDIT|CREDITO/.test(batch.transaction_type || "") ? "Cartão de crédito" : /DEBIT|DEBITO/.test(batch.transaction_type || "") ? "Cartão de débito" : "Cartão"}</p>
          <dl className="receivable-statement">
            <AmountLine label="Bruto" value={batch.gross_amount} />
            <AmountLine label="MDR" value={batch.mdr_amount} debit />
            <AmountLine label="Taxa de antecipação" value={batch.anticipation_fee_amount} debit />
            {moneyValue(batch.three_ds_fee_amount) !== null && Number(batch.three_ds_fee_amount) !== 0 && <AmountLine label="Taxa de 3DS" value={batch.three_ds_fee_amount} debit />}
            {moneyValue(batch.adjustment_amount) !== null && Number(batch.adjustment_amount) !== 0 && <AmountLine label="Ajustes" value={batch.adjustment_amount} debit />}
            <AmountLine label={partial ? "Líquido previsto" : "Líquido"} value={batch.net} total />
            <AmountLine label="Pago" value={batch.paid} />
            <AmountLine label="Em aberto" value={batch.open} />
          </dl>
        </article>;
      })}
    </div>
  </dialog>;
}
