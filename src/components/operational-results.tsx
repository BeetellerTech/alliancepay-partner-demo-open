"use client";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, List, X } from "lucide-react";
import type { Json } from "@/lib/types";
import { brl } from "@/lib/browser";
import { calendarBatches, documentLabel, isSale, merchantName, shortDate, sumKnown } from "@/lib/report-presentation";
import { Button, Empty, Status } from "./ui";
import { Details, Value } from "./report-results";
import { ReceivableDayDrawer } from "./receivable-day-drawer";

export function FinancialStrip({ rows, fields, scope = "Nesta página" }: { rows: Json[]; fields: [string, string][]; scope?: string }) {
  return <dl className="financial-strip">{fields.map(([field, label]) => { const sum = sumKnown(rows, field); return <div key={field}><dt>{label}</dt><dd>{sum.amount === null ? "—" : brl(sum.amount)}</dd><small>{scope}{sum.count < sum.total ? ` · ${sum.count}/${sum.total} valores informados` : ""}</small></div>; })}</dl>;
}
export function OperationalList({ name, rows }: { name: "merchants" | "transactions" | "liquidations"; rows: Json[] }) {
  const [selected, setSelected] = useState<Json | null>(null), detailsHeading = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const merchant = name === "merchants", sales = name === "transactions";
  const title = merchant ? "Estabelecimentos" : sales ? "Transações" : "Repasses";
  const fields = merchant ? ["identity", "document_number", "status", "id"] : sales ? ["nsu_host", "produto", "sales_channel", "transaction_date", "valor", "mdr_amount", "anticipation_fee_amount", "merchant_net_amount", "estado"] : ["payment_date", "identity", "payment_amount", "product", "payment_institution_name", "settlement_request_status", "nu_liquid"];
  const titles: Record<string, string> = { identity: "Estabelecimento", document_number: "CPF / CNPJ", status: "Status", id: "ID do EC", nsu_host: "NSU", produto: "Pagamento", sales_channel: "Canal", transaction_date: "Data", valor: "Valor bruto", mdr_amount: "Taxa MDR", anticipation_fee_amount: "Antecipação", merchant_net_amount: "Líquido", estado: "Status", payment_date: "Data de pagamento", payment_amount: "Valor", product: "Operação", payment_institution_name: "Instituição", settlement_request_status: "Status", nu_liquid: "Código de liquidação" };
  function cell(row: Json, key: string) {
    if (key === "identity") return <><strong>{merchantName(row)}</strong>{row.legal_name && row.legal_name !== merchantName(row) && <small>{row.legal_name}</small>}</>;
    if (key === "document_number") return documentLabel(row[key]);
    if (key.endsWith("date")) return shortDate(row[key]);
    if (["status", "estado", "settlement_request_status"].includes(key)) return row[key] ? <Status value={row[key]} label={merchant && row[key] === "ACTIVE" ? "Ativo" : undefined} /> : "—";
    return <Value name={key} value={row[key]} />;
  }
  function open(row: Json, button: HTMLButtonElement) { trigger.current = button; setSelected(row); requestAnimationFrame(() => detailsHeading.current?.focus()); }
  if (!rows.length) return <Empty title={merchant ? "Nenhum estabelecimento encontrado" : `Nenhum ${sales ? "registro de venda" : "repasse"} no período`}>{merchant ? "Confira os filtros e se o parceiro possui vínculos comerciais ativos no ambiente selecionado." : "Ajuste o período ou o estabelecimento para buscar outros registros."}</Empty>;
  return <>
    {sales && <FinancialStrip rows={rows.filter(isSale)} fields={[["valor", "Volume bruto"], ["mdr_amount", "MDR"], ["anticipation_fee_amount", "Antecipação"], ["merchant_net_amount", "Líquido do lojista"]]} scope="Nesta página · vendas não canceladas" />}
    {!merchant && !sales && <FinancialStrip rows={rows} fields={[["payment_amount", "Valor dos repasses"]]} />}
    <div className="table-scroll operational-table" role="region" aria-label={title} tabIndex={0}><table><thead><tr>{fields.map(key => <th scope="col" key={key}>{titles[key]}</th>)}<th scope="col"><span className="sr-only">Detalhes</span></th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{fields.map(key => <td key={key} className={key === "id" ? "identifier-cell" : ""}>{cell(row, key)}</td>)}<td><Button variant="quiet" aria-label={`Ver detalhes ${merchant ? merchantName(row) : row.nsu_host || shortDate(row.payment_date)}`} onClick={e => open(row, e.currentTarget)}><ArrowRight size={18} /></Button></td></tr>)}</tbody></table></div>
    <div className="operational-cards">{rows.map((row, index) => <article key={row.id || index}><div className="operational-card-heading"><strong>{merchant ? merchantName(row) : sales ? `NSU ${row.nsu_host || "não informado"}` : merchantName(row)}</strong><Status value={row.status || row.estado || row.settlement_request_status || "UNKNOWN"} label={merchant && row.status === "ACTIVE" ? "Ativo" : undefined} /></div><dl>{fields.filter(key => !["identity", "status", "estado", "settlement_request_status"].includes(key)).map(key => <div key={key}><dt>{titles[key]}</dt><dd>{cell(row, key)}</dd></div>)}</dl><Button variant="quiet" onClick={e => open(row, e.currentTarget)}>Ver detalhes<ArrowRight size={16} /></Button></article>)}</div>
    {selected && <section className="record-details" aria-label="Detalhes do registro"><div className="section-toolbar"><h2 ref={detailsHeading} tabIndex={-1}>{merchant ? merchantName(selected) : sales ? `Venda · ${selected.nsu_host || "Detalhes"}` : "Detalhes do repasse"}</h2><Button variant="quiet" aria-label="Fechar detalhes" onClick={() => { setSelected(null); trigger.current?.focus(); }}><X size={18} /></Button></div><Details data={selected} /></section>}
  </>;
}

export function ReceivablesCalendar({ data, changeMonth }: { data: Json; changeMonth?: (month: string) => void }) {
  const [view, setView] = useState("calendar"), [selected, setSelected] = useState<{ date: string; data: Json } | null>(null);
  const [year, month] = String(data.month).split("-").map(Number);
  const days: Json[] = data.results || [], all = days.flatMap(calendarBatches);
  const chosen = selected?.data === data ? days.find(day => day.payment_date === selected.date) || { payment_date: selected.date } : null;
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7, length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const heading = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  function navigateMonth(delta: number) { changeMonth?.(new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7)); }
  function dayLabel(day: Json) { const batches = calendarBatches(day); return batches.every(b => b.status === "SETTLED") ? "Pago" : batches.some(b => b.status === "PARTIALLY_SETTLED" || b.status === "SETTLED") ? "Parcial" : "Previsto"; }
  function amount(day: Json) { const total = sumKnown(calendarBatches(day), "net"); return total.amount === null ? "Valor não informado" : brl(total.amount); }
  return <>
    <FinancialStrip rows={all} fields={[["net", "Líquido do mês"], ["paid", "Recebido no mês"], ["open", "A receber"]]} scope="No mês consultado" />
    <div className="section-toolbar calendar-toolbar"><div className="month-navigation"><Button variant="quiet" aria-label="Mês anterior" onClick={() => navigateMonth(-1)}><ArrowLeft size={17} /></Button><h2>{heading}</h2><Button variant="quiet" aria-label="Mês seguinte" onClick={() => navigateMonth(1)}><ArrowRight size={17} /></Button></div><div className="segmented" aria-label="Visualização dos recebíveis"><button aria-pressed={view === "calendar"} className={view === "calendar" ? "selected" : ""} onClick={() => setView("calendar")}><CalendarDays size={16} />Calendário</button><button aria-pressed={view === "agenda"} className={view === "agenda" ? "selected" : ""} onClick={() => setView("agenda")}><List size={16} />Agenda</button></div></div>
    <p className="subtle-note">Selecione uma data para conferir os lotes. Valores previstos ainda não representam repasses liquidados.</p>
    {view === "calendar" ? <div className="receivables-calendar" aria-label={`Calendário de ${heading}`}><div className="calendar-week">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-days">{Array.from({ length: offset }, (_, i) => <span className="calendar-padding" key={`pad-${i}`} />)}{Array.from({ length }, (_, i) => { const date = `${data.month}-${String(i + 1).padStart(2, "0")}`, day = days.find(d => d.payment_date === date), hasBatches = day && calendarBatches(day).length > 0; return <button key={date} className={`${hasBatches ? "has-batches" : ""} ${chosen?.payment_date === date ? "selected" : ""}`} aria-pressed={chosen?.payment_date === date} aria-label={`${shortDate(date)}${hasBatches ? ` · ${amount(day)} · ${dayLabel(day)}` : " · Sem recebíveis"}`} aria-haspopup="dialog" onClick={() => setSelected({ date, data })}><span>{i + 1}</span>{hasBatches && <><strong>{amount(day)}</strong><small>{dayLabel(day)}</small><span className="calendar-count">{calendarBatches(day).length} lotes</span></>}</button>; })}</div></div> : <div className="receivables-agenda">{days.map(day => <button key={day.payment_date} aria-pressed={chosen?.payment_date === day.payment_date} aria-haspopup="dialog" onClick={() => setSelected({ date: day.payment_date, data })}><strong>{shortDate(day.payment_date)}</strong><span>{calendarBatches(day).length} lotes · {dayLabel(day)}</span><strong>{amount(day)}</strong><ArrowRight size={17} /></button>)}</div>}
    {!days.length && <Empty title="Nenhum recebível no mês">Confira o mês e o estabelecimento consultados.</Empty>}
    {chosen && <ReceivableDayDrawer key={chosen.payment_date} day={chosen} onClose={() => setSelected(null)} />}
  </>;
}
