"use client";
import { AlertCircle, ArrowUpRight, LoaderCircle } from "lucide-react";
import type { ReactNode, ButtonHTMLAttributes } from "react";
export function Button({ children, busy, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button {...props} disabled={props.disabled || busy} className={`button ${variant} ${props.className || ""}`}>{busy && <LoaderCircle size={17} className="spin" />}{children}</button>;
}
export function ErrorNotice({ message }: { message?: string | null }) { return message ? <div className="notice error" role="alert"><AlertCircle size={20} /><span>{message}</span></div> : null; }
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty"><div className="empty-mark"><ArrowUpRight size={28} /></div><h2>{title}</h2><p>{children}</p>{action}</div>; }
const labels: Record<string, string> = { SETTLED: "Pago", PARTIALLY_SETTLED: "Parcialmente pago", PENDING: "Pendente", INACTIVE: "Inativo", UNKNOWN: "Não informado", READY: "Disponível", ACTIVE: "Disponível", APPROVED: "Aprovado", PAID: "Pago", COMPLETED: "Concluído", CONFIRMED: "Confirmado", CREATED: "Criado", CREATING: "Criando link", SENDING: "Enviando", KNOWN: "Registrado", UNCERTAIN: "A confirmar", REJECTED: "Não iniciado", AUTHENTICATING: "Autenticando", PROCESSING: "Processando", VALIDATING: "Validando", PENDING_CONFIRMATION: "Aguardando confirmação", WAITING_PAYMENT: "Aguardando pagamento", ISSUING: "Emitindo Pix", ISSUANCE_UNKNOWN: "Emissão a confirmar", UNDER_REVIEW: "Em análise", AWAITING_STEPS: "Etapas pendentes", EXPIRED: "Expirado", FAILED: "Falhou", DECLINED: "Recusado", CANCELED: "Cancelado", CANCELLED: "Cancelado", IN_PROGRESS: "Em andamento", NOT_STARTED: "Não iniciado", REVERSED: "Estornado", REFUNDED: "Devolvido" };
export function statusLabel(value: string) { return labels[value] || value; }
export function Status({ value, label }: { value: string; label?: string }) {
  const tone = ["SETTLED", "APPROVED", "PAID", "COMPLETED", "CONFIRMED", "REVERSED", "REFUNDED"].includes(value) ? "success" : ["FAILED", "DECLINED", "REJECTED"].includes(value) ? "failure" : ["READY", "ACTIVE", "EXPIRED", "CANCELED", "CANCELLED"].includes(value) ? "neutral" : "waiting";
  return <span className={`status ${tone}`}><span />{label || statusLabel(value)}</span>;
}
