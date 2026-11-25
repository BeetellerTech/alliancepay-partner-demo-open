"use client";
import { useConnection } from "./connection-provider";
import { MerchantSelect } from "./merchant-select";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CreditCard, Plus, QrCode, Trash2 } from "lucide-react";
import { api, brl, describeError } from "@/lib/browser";
import { Button, ErrorNotice } from "./ui";
import { cents, localToday, makeSchedule, scheduleError, shiftDate, type ChargeRow } from "@/lib/charge-schedule";
import type { Json } from "@/lib/types";

const steps = ["Estabelecimento", "Sobre a cobrança", "Como receber", "Revisar"];
const methodNames: Record<string, string> = { CREDIT: "Cartão de crédito", DEBIT: "Cartão de débito", PIX: "Pix" };
export default function ChargeCreate() {
  const router = useRouter(), { config } = useConnection();
  const heading = useRef<HTMLHeadingElement>(null), sending = useRef(false);
  const [step, setStep] = useState(0), [merchantId, setMerchantId] = useState(""), [merchantLabel, setMerchantLabel] = useState("");
  const [type, setType] = useState("ONE_TIME"), [name, setName] = useState(""), [description, setDescription] = useState("");
  const [methods, setMethods] = useState(["CREDIT", "PIX"]), [amount, setAmount] = useState("10.00"), [installments, setInstallments] = useState(1);
  const [options, setOptions] = useState<Json | null>(null), [optionsFor, setOptionsFor] = useState(""), [optionsError, setOptionsError] = useState(""), [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [created, setCreated] = useState<Json | null>(null), [copied, setCopied] = useState(false);
  const [total, setTotal] = useState("30.00"), [entry, setEntry] = useState("10.00"), [count, setCount] = useState(2);
  const [start, setStart] = useState(() => shiftDate(localToday(), 1, "MONTHLY")), [frequency, setFrequency] = useState<"MONTHLY" | "WEEKLY">("MONTHLY");
  const [rows, setRows] = useState<ChargeRow[]>(() => makeSchedule("30.00", "10.00", 2, shiftDate(localToday(), 1, "MONTHLY"), "MONTHLY", localToday()));
  const [generatorDirty, setGeneratorDirty] = useState(false);
  const optionsKey = `${config.contextId}:${merchantId}:${type}`;
  const optionsReady = !!options && optionsFor === optionsKey;
  const maxInstallments = Math.min(12, Number(options?.payment_methods?.find((m: Json) => m.type === "CREDIT")?.max_installments) || 1);
  const recurring = type === "RECURRING", today = localToday();
  const allowed = (method: string) => optionsReady && !!options?.payment_methods?.some((m: Json) => m.type === method) && (!recurring || method === "CREDIT" || (method === "PIX" && rows[0]?.due_date === today));
  const effectiveMethods = methods.filter(allowed);
  const scheduleTotal = rows.reduce((sum, row) => sum + (Number.isFinite(cents(row.amount)) ? cents(row.amount) : 0), 0) / 100;
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tipo") === "recorrente") setType("RECURRING"); }, []);
  useEffect(() => {
    if (!merchantId) return;
    let current = true; setOptionsError("");
    api(`creation-options?billing_type=${type}&acquirer_registration_id=${encodeURIComponent(merchantId)}`).then(data => {
      if (!current) return;
      setOptions(data); setOptionsFor(optionsKey);
      setMethods(v => {
        const available = (data.payment_methods || []).map((m: Json) => m.type as string);
        const selected = v.filter(m => available.includes(m));
        return type === "RECURRING" ? ["CREDIT", ...(selected.includes("PIX") ? ["PIX"] : [])] : selected.length ? selected : available;
      });
      setInstallments(1);
    }).catch(e => { if (current) { setOptionsError(describeError(e)); setOptions(null); } });
    return () => { current = false; };
  }, [type, merchantId, config.contextId, optionsKey, retry]);
  function move(next: number) { setStep(next); setError(""); requestAnimationFrame(() => heading.current?.focus()); }
  function regenerate() {
    try { setRows(makeSchedule(total, entry, count, start, frequency, today)); setGeneratorDirty(false); setError(""); }
    catch (e) { setError(describeError(e)); }
  }
  function validatePayment() {
    if (!optionsReady) return "Aguarde as condições de pagamento do estabelecimento.";
    if (!effectiveMethods.length || (recurring && !effectiveMethods.includes("CREDIT"))) return "Este estabelecimento não possui os meios necessários para esta cobrança.";
    if (recurring && generatorDirty) return "Atualize o calendário para aplicar as condições informadas.";
    return recurring ? scheduleError(rows, today) : "";
  }
  async function submit() {
    const invalid = validatePayment();
    if (invalid) { setError(invalid); return; }
    if (sending.current) return;
    sending.current = true; setBusy(true); setError("");
    const requestId = crypto.randomUUID();
    const payload: Json = { request_id: requestId, acquirer_registration_id: merchantId, name: name.trim(), description: description.trim(), billing_type: type, payment_methods: effectiveMethods, max_installments: effectiveMethods.includes("CREDIT") ? Math.min(installments, maxInstallments) : 1 };
    if (recurring) payload.recurrence = { installments: rows.map(row => ({ ...row, amount: Number(row.amount).toFixed(2), card_installments: Math.min(row.card_installments, maxInstallments) })) };
    else payload.amount = Number(amount).toFixed(2);
    try { const order = await api("orders", payload); if (order.state === "READY" && /^https:\/\//i.test(order.link?.checkout_url || "")) setCreated(order); else router.push(`/cobrancas/${order.id}`); }
    catch (e) {
      setError(describeError(e));
      const saved = await api<Json>(`orders/${requestId}`).catch(() => null);
      if (saved) router.push(`/cobrancas/${requestId}`);
      else { sending.current = false; setBusy(false); }
    }
  }
  if (created) return <section className="panel charge-success"><div className="success-mark"><Check size={28} /></div><h1>Link criado</h1><p>{created.link?.name || name} está pronto para compartilhar.</p><label htmlFor="created-url">Link de pagamento</label><input id="created-url" readOnly value={created.link.checkout_url} /><div className="action-row"><Button onClick={async () => { try { await navigator.clipboard.writeText(created.link.checkout_url); setCopied(true); } catch { setError("Selecione o endereço acima e copie manualmente."); } }}>{copied ? "Link copiado" : "Copiar link"}</Button><Link className="button secondary" href={`/cobrancas/${created.id}`}>Abrir cobrança na demo<ArrowRight size={17} /></Link><Link href="/" className="button quiet">Voltar às cobranças</Link></div><ErrorNotice message={error || optionsError} /></section>;
  return <>
    <Link href="/" className="back"><ArrowLeft size={16} />Cobranças</Link>
    <div className="page-heading"><div><h1>Nova cobrança</h1><p>Crie um link avulso ou organize uma cobrança recorrente.</p></div></div>
    <ol className="charge-steps" aria-label="Etapas da cobrança">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><button type="button" disabled={busy || index > step} onClick={() => move(index)}><span>{index < step ? <Check size={16} /> : index + 1}</span>{label}</button></li>)}</ol>
    <div className={`create-layout ${step === 3 ? "review-layout" : ""}`}>
      <form method="post" className="panel form-panel charge-form" onSubmit={e => { e.preventDefault(); if (step === 3) void submit(); else { const invalid = step === 2 ? validatePayment() : ""; if (invalid) setError(invalid); else move(step + 1); } }}>
        <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
        <fieldset disabled={busy} className="wizard-fields"><legend className="sr-only">{steps[step]}</legend>
        {step === 0 && <><p className="subtle-note">Escolha o estabelecimento que receberá esta cobrança.</p><MerchantSelect id="order-merchant" value={merchantId} onChange={value => { setMerchantId(value); setError(""); setMerchantLabel((document.getElementById("order-merchant") as HTMLSelectElement)?.selectedOptions[0]?.text || value); }} required /></>}
        {step === 1 && <><div className="segmented" aria-label="Tipo da cobrança">{[["ONE_TIME", "Link avulso"], ["RECURRING", "Link recorrente"]].map(([value, label]) => <button type="button" key={value} aria-pressed={type === value} className={type === value ? "selected" : ""} onClick={() => { setType(value); setError(""); }}>{label}</button>)}</div><label htmlFor="charge-name">Nome do pagamento</label><input id="charge-name" required maxLength={255} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Plano de acompanhamento" /><label htmlFor="description">O que o cliente está pagando?</label><textarea id="description" required minLength={3} maxLength={180} value={description} onChange={e => setDescription(e.target.value)} placeholder="Descreva o produto ou serviço desta cobrança" rows={3} /></>}
        {step === 2 && <>
          <p className="subtle-note">{recurring ? "Entrada + parcelas cobradas no cartão que o cliente cadastrar." : "Defina o valor e os meios de pagamento que o cliente poderá escolher."}</p>
          {recurring ? <>
            <div className="form-grid"><div><label htmlFor="total">Valor total (R$)</label><input id="total" type="number" min="0.02" max="12000" step="0.01" required value={total} onChange={e => { setTotal(e.target.value); setGeneratorDirty(true); }} /></div><div><label htmlFor="entry">Entrada (R$)</label><input id="entry" type="number" min="0" max="1000" step="0.01" required value={entry} onChange={e => { setEntry(e.target.value); setGeneratorDirty(true); }} /><small>Paga hoje. Use zero para começar sem entrada.</small></div><div><label htmlFor="count">Quantas parcelas após a entrada?</label><select id="count" value={count} onChange={e => { setCount(Number(e.target.value)); setGeneratorDirty(true); }}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1} parcelas</option>)}</select></div><div><label htmlFor="frequency">Repetir</label><select id="frequency" value={frequency} onChange={e => { setFrequency(e.target.value as "MONTHLY" | "WEEKLY"); setGeneratorDirty(true); }}><option value="MONTHLY">Mensalmente</option><option value="WEEKLY">Semanalmente</option></select></div><div><label htmlFor="start">Primeira parcela</label><input id="start" type="date" min={today} required value={start} onChange={e => { setStart(e.target.value); setGeneratorDirty(true); }} /></div><div className="generator-action"><Button type="button" variant="secondary" onClick={regenerate}>Atualizar calendário</Button></div></div>
            {generatorDirty && <p className="notice">As condições mudaram. Atualize o calendário antes de continuar.</p>}
            <div className="schedule-heading"><h3>Calendário de cobranças</h3><span>{rows.length} cobranças · {brl(scheduleTotal)}</span></div>
            <div className="schedule-rows">{rows.map((row, i) => <div className="schedule-row" key={i}><strong>{i + 1}</strong><div><label htmlFor={`due-${i}`}>Vencimento {i + 1}</label><input id={`due-${i}`} type="date" min={today} required value={row.due_date} onChange={e => setRows(rows.map((r, n) => n === i ? { ...r, due_date: e.target.value } : r))} /></div><div><label htmlFor={`value-${i}`}>Valor {i + 1} (R$)</label><input id={`value-${i}`} type="number" min="0.01" max="1000" step="0.01" required value={row.amount} onChange={e => setRows(rows.map((r, n) => n === i ? { ...r, amount: e.target.value } : r))} /></div><Button type="button" variant="quiet" disabled={rows.length <= 2} aria-label={`Remover cobrança ${i + 1}`} onClick={() => setRows(rows.filter((_, n) => n !== i))}><Trash2 size={17} /></Button></div>)}</div>
            <Button type="button" variant="quiet" disabled={rows.length >= 12} onClick={() => setRows([...rows, { amount: rows.at(-1)!.amount, due_date: shiftDate(rows.at(-1)!.due_date || today, 1, frequency), card_installments: 1 }])}><Plus size={16} />Adicionar cobrança</Button><small>Edite as datas e valores acima. O total do calendário será usado na criação.</small>
          </> : <div className="form-grid"><div><label htmlFor="amount">Valor a receber (R$)</label><input id="amount" type="number" step="0.01" min="0.01" max="1000" required value={amount} onChange={e => setAmount(e.target.value)} /></div><div><label htmlFor="installments">Parcelamento no cartão</label><select id="installments" disabled={!effectiveMethods.includes("CREDIT")} value={Math.min(installments, maxInstallments)} onChange={e => setInstallments(Number(e.target.value))}>{Array.from({ length: maxInstallments }, (_, i) => <option key={i} value={i + 1}>{i + 1 === 1 ? "À vista" : `Até ${i + 1}x`}</option>)}</select><small>O cliente escolhe dentro do limite habilitado.</small></div></div>}
          <fieldset><legend>Meios de pagamento</legend><div className="method-options">{Object.entries(methodNames).map(([method, label]) => <label key={method} className={`method-option ${effectiveMethods.includes(method) ? "checked" : ""}`}>{method === "PIX" ? <QrCode size={19} /> : <CreditCard size={19} />}<span>{label}</span><input type="checkbox" checked={effectiveMethods.includes(method)} disabled={!allowed(method) || (recurring && method === "CREDIT")} onChange={() => setMethods(v => v.includes(method) ? v.filter(m => m !== method) : [...v, method])} /></label>)}</div>{recurring && <small>Crédito obrigatório. Pix pode pagar somente a primeira cobrança com vencimento hoje.</small>}</fieldset>
          {!optionsReady && !optionsError && <p role="status">Carregando condições do estabelecimento…</p>}
          {!optionsReady && optionsError && <Button type="button" variant="secondary" onClick={() => { setError(""); setRetry(retry + 1); }}>Tentar carregar condições novamente</Button>}
          {optionsReady && (!effectiveMethods.length || (recurring && !allowed("CREDIT"))) && <p role="alert" className="notice">Não há meios de pagamento habilitados para este tipo de cobrança. Escolha outro estabelecimento ou tipo.</p>}
        </>}
        {step === 3 && <>
          <p className="subtle-note">Confira as condições antes de criar o link no ambiente {config.environment}.</p>
          <section className="review-section"><div><h3>{name}</h3><p>{description}</p></div><Button type="button" variant="quiet" onClick={() => move(1)}>Editar cobrança</Button></section>
          <dl className="detail-list"><div><dt>Estabelecimento</dt><dd>{merchantLabel}</dd></div><div><dt>Tipo</dt><dd>{recurring ? "Link recorrente" : "Link avulso"}</dd></div><div><dt>Valor total</dt><dd className="money">{brl(recurring ? scheduleTotal : amount)}</dd></div><div><dt>Meios de pagamento</dt><dd>{effectiveMethods.map(m => methodNames[m]).join(" · ")}</dd></div>{!recurring && <div><dt>Parcelamento</dt><dd>Até {effectiveMethods.includes("CREDIT") ? Math.min(installments, maxInstallments) : 1}x</dd></div>}</dl>
          {recurring && <div className="review-schedule">{rows.map((row, i) => <div key={i}><span>Cobrança {i + 1}</span><span>{row.due_date.split("-").reverse().join("/")}</span><strong>{brl(row.amount)}</strong></div>)}</div>}
          <Button type="button" variant="quiet" onClick={() => move(2)}>Editar condições</Button>
        </>}
        </fieldset><ErrorNotice message={error || optionsError} />
        <div className="form-actions">{step ? <Button type="button" variant="secondary" disabled={busy} onClick={() => move(step - 1)}><ArrowLeft size={16} />Voltar</Button> : <Link href="/" className="button quiet">Cancelar</Link>}<Button type="submit" busy={busy} disabled={step === 0 ? !merchantId : step >= 2 ? !optionsReady || !effectiveMethods.length || (recurring && !effectiveMethods.includes("CREDIT")) : false}>{step === 3 ? "Criar cobrança" : "Continuar"}<ArrowRight size={17} /></Button></div>
      </form>
      {step !== 3 && <aside className="create-summary"><h2>O que o cliente vai ver</h2><p className="charge-preview-name">{name || "Nome do pagamento"}</p><p>{description || "A descrição do produto ou serviço aparecerá aqui."}</p><dl><div><dt>{recurring ? "Total do calendário" : "Valor a receber"}</dt><dd>{brl(recurring ? scheduleTotal : amount)}</dd></div><div><dt>Tipo de link</dt><dd>{recurring ? "Recorrente" : "Avulso"}</dd></div>{recurring && <div><dt>Cobranças programadas</dt><dd>{rows.length}</dd></div>}<div><dt>Ambiente</dt><dd>{config.environment || "Não configurado"}</dd></div></dl><p className="subtle-note">{recurring ? "O cliente cadastra o cartão para as cobranças futuras e acompanha a confirmação da entrada." : "O cliente escolhe entre os meios de pagamento habilitados para o estabelecimento."}</p></aside>}
    </div>
  </>;
}
