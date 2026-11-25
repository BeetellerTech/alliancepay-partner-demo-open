"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, CreditCard, LockKeyhole, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { api, brl, browserPayload, createThreeDsController, describeError, encryptCard, wait } from "@/lib/browser";
import { canShowPix, isPaid, terminal, type Json, type Operation } from "@/lib/types";
import { Button, ErrorNotice, Status, statusLabel } from "./ui";
import { requiresSection } from "@/lib/requirements";
import { useConnection } from "./connection-provider";

export function Checkout({ orderId, initialOperations }: { orderId: string; initialOperations: Operation[] }) {
  const { config } = useConnection();
  const [checkout, setCheckout] = useState<Json | null>(null), [operations, setOperations] = useState(initialOperations);
  const [method, setMethod] = useState("CREDIT"), [selectedId, setSelectedId] = useState<string | null>(null);
  const [recurringViaPix, setRecurringViaPix] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [stage, setStage] = useState("");
  const [qr, setQr] = useState(""), [copied, setCopied] = useState(false), [paused, setPaused] = useState(false);
  const frameHost = useRef<HTMLDivElement>(null), controller = useRef<ReturnType<typeof createThreeDsController> | null>(null);
  const operation = operations.find(op => op.id === selectedId) || operations.filter(op => ["payments", "pix-payments", "card-setups"].includes(op.kind)).at(-1);
  const resource = operation?.response;
  const update = useCallback((op: Operation) => { setOperations(old => old.some(x => x.id === op.id) ? old.map(x => x.id === op.id ? op : x) : [...old, op]); }, []);
  const reloadCheckout = useCallback(async () => { const value = await api<Json>(`orders/${orderId}/checkout`); setCheckout(value); return value; }, [orderId]);
  useEffect(() => { let cancelled = false; api<Json>(`orders/${orderId}/checkout`).then(value => { if (!cancelled) { setCheckout(value); setMethod(value.checkout_mode === "CARD_SETUP" ? "CREDIT" : value.payment_methods?.[0] || "CREDIT"); } }).catch(e => { if (!cancelled) setError(describeError(e)); }); return () => { cancelled = true; }; }, [orderId]);
  useEffect(() => { if (!frameHost.current) return; controller.current = createThreeDsController(frameHost.current); return () => { controller.current?.dispose(); }; }, []);
  useEffect(() => {
    if (!operation || terminal(resource, operation.kind) || operation.state === "REJECTED") return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; const started = Date.now();
    const seconds = operation.kind === "pix-payments" ? Number(resource?.poll_after_seconds) || 5 : resource?.next_action?.type === "THREE_DS_DECOUPLED" ? Number(resource.next_action.poll_after_seconds) || 20 : 20;
    async function tick() {
      if (stopped) return;
      if (Date.now() - started > 300000) { setPaused(true); return; }
      try { const next = await api<Operation>(`orders/${orderId}/operations/${operation!.id}`); if (!stopped) { update(next); if (terminal(next.response, next.kind)) { await reloadCheckout(); return; } } }
      catch (e) { if (!stopped) setError(describeError(e)); }
      if (!stopped) timer = setTimeout(tick, Math.max(1, seconds) * 1000);
    }
    timer = setTimeout(tick, Math.max(1, seconds) * 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [operation?.id, operation?.state, resource?.status, orderId, update, reloadCheckout]);
  useEffect(() => {
    if (!operation || !resource || !controller.current) return;
    if (terminal(resource, operation.kind)) { controller.current.dispose(); return; }
    const abort = new AbortController();
    controller.current.handle(resource, () => api(`orders/${orderId}/operations/${operation.id}/continue`, {}), abort.signal).then(value => { if (value) update(value); }).catch(e => { if (!abort.signal.aborted) setError(describeError(e)); });
    return () => abort.abort();
  }, [resource, operation?.id, orderId, update]);
  useEffect(() => {
    let active = true;
    if (resource && canShowPix(resource)) QRCode.toDataURL(resource.copy_paste, { width: 256, margin: 2, color: { dark: "#242424", light: "#ffffff" } }).then(value => { if (active) setQr(value); });
    return () => { active = false; };
  }, [resource?.copy_paste, resource?.pix?.can_pay]);
  async function recover() {
    setBusy(true); setError("");
    try { const view = await api<Json>(`orders/${orderId}`); setOperations(view.operations); await reloadCheckout(); if (operation) update(await api(`orders/${orderId}/operations/${operation.id}`)); }
    catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  const requirements = checkout?.checkout_requirements_by_payment_method?.[method] || checkout?.checkout_requirements || {};
  const isRecurring = checkout?.billing_type === "RECURRING";
  const usingPixRecurrence = recurringViaPix || operations.some(op => ["pix-payments", "card-setups"].includes(op.kind) && op.state !== "REJECTED");
  const setup = checkout?.checkout_mode === "CARD_SETUP" || (isRecurring && method !== "PIX" && usingPixRecurrence && checkout?.checkout_requirements_by_payment_method?.PIX?.card_setup_required);
  const financialActive = operations.some(op => ["payments", "pix-payments"].includes(op.kind) && op.state !== "REJECTED" && !terminal(op.response, op.kind));
  const setupActive = operations.some(op => op.kind === "card-setups" && op.state !== "REJECTED" && !terminal(op.response, op.kind));
  const blocked = setup ? setupActive || checkout?.recurring_acceptance?.steps?.card_setup?.can_start === false : financialActive || (method === "PIX" && checkout?.recurring_acceptance?.steps?.pix_payment?.can_start === false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!checkout || busy || blocked) return;
    const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setError(""); setPaused(false);
    try {
      const phone = requiresSection(requirements.phone) ? { country_code: "55", area_code: String(data.get("area_code") || ""), number: String(data.get("phone") || "").replace(/\D/g, "") } : undefined;
      const payer: Json = { name: String(data.get("payer_name") || "").trim() };
      if (data.get("document")) payer.document = String(data.get("document")).replace(/\D/g, "");
      if (method === "PIX") {
        setStage("Emitindo cobrança Pix…");
        const op = await api<Operation>(`orders/${orderId}/pix-payments`, { request_id: crypto.randomUUID(), payload: { ...(payer.name || payer.document ? { payer } : {}), ...(phone ? { phone } : {}) } });
        update(op); setSelectedId(op.id); await reloadCheckout(); return;
      }
      payer.email = String(data.get("email") || "");
      const number = String(data.get("card_number") || "").replace(/\D/g, ""), expiration = String(data.get("expiration") || "").split("/"), month = expiration[0]?.padStart(2, "0"), year = expiration[1]?.length === 2 ? `20${expiration[1]}` : expiration[1];
      if (!/^\d{13,19}$/.test(number) || !/^(0[1-9]|1[0-2])$/.test(month) || !/^20\d{2}$/.test(year || "")) throw new Error("Confira o número e a validade do cartão (MM/AAAA).");
      setStage("Preparando tokenização…");
      let token = await api<Operation>(`orders/${orderId}/card-tokenizations`, { request_id: crypto.randomUUID(), payload: {} }); update(token);
      if (!token.response?.public_key || (token.response.expires_at && new Date(token.response.expires_at).getTime() <= Date.now())) throw new Error("A API não retornou uma chave de tokenização válida. Atualize a tentativa.");
      const encrypted = await encryptCard(token.response.public_key, { number, month, year, cvv: String(data.get("cvv") || "") });
      // Clear sensitive DOM inputs immediately; ciphertext is never put in persistent browser storage.
      for (const name of ["card_number", "expiration", "cvv"]) { const input = form.elements.namedItem(name) as HTMLInputElement | null; if (input) input.value = ""; }
      setStage("Confirmando cartão…");
      token = await api(`orders/${orderId}/operations/${token.id}/confirm`, { payment_method: method, card: { brand: data.get("brand"), number: encrypted.number, expiration_month: encrypted.expiration_month, expiration_year: encrypted.expiration_year } }); update(token);
      for (let i = 0; token.response?.status === "PROCESSING" && i < 20; i++) { await wait(1500); token = await api(`orders/${orderId}/operations/${token.id}`); update(token); }
      if (token.response?.status !== "READY" || !token.response.payment_method_id) throw new Error("O cartão ainda não está pronto. Consulte a tokenização antes de pagar.");
      const payload: Json = { payment_method_id: token.response.payment_method_id, payment_method: method, installments: setup ? 1 : Number(data.get("installments") || 1), card: { security_code: encrypted.security_code }, payer, browser: browserPayload(), ...(phone ? { phone } : {}) };
      if (requiresSection(requirements.billing_address)) payload.billing_address = { country: "BR", zip_code: String(data.get("zip_code") || "").replace(/\D/g, ""), state: data.get("state"), city: data.get("city"), street: data.get("street"), district: data.get("district"), street_number: data.get("street_number") };
      if (isRecurring || setup) { payload.recurring_consent = data.get("consent") === "on"; payload.consent_terms_version = "demo-context-v2"; }
      if (data.get("apply_remaining") === "on") payload.apply_payment_method_to_remaining_installments = true;
      setStage(setup ? "Cadastrando cartão…" : "Enviando pagamento…");
      const op = await api<Operation>(`orders/${orderId}/${setup ? "card-setups" : "payments"}`, { request_id: crypto.randomUUID(), payload });
      encrypted.security_code = ""; update(op); setSelectedId(op.id); await reloadCheckout();
    } catch (e) { setError(describeError(e)); const view = await api<Json>(`orders/${orderId}`).catch(() => null); if (view) setOperations(view.operations); }
    finally { setBusy(false); setStage(""); }
  }
  const paid = resource && operation && isPaid(resource, operation.kind);
  const showPix = resource && canShowPix(resource);
  const setupComplete = resource?.status === "COMPLETED" && operation?.kind === "card-setups";
  const resultStep = financialActive || setupActive || paid || setupComplete;
  const optionalPayer = method === "PIX" && !requirements.payer?.required && !requirements.payer?.required_fields?.length && !requiresSection(requirements.phone);
  const payerFields = <><h3>Dados do pagador</h3><label htmlFor="payer-name">Nome completo{method === "PIX" && !requirements.payer?.required ? " (opcional)" : ""}</label><input id="payer-name" name="payer_name" required={method !== "PIX" || requirements.payer?.required_fields?.includes("name")} autoComplete="name" maxLength={255} />
      <div className="form-grid">{method !== "PIX" && <div><label htmlFor="payer-email">E-mail</label><input id="payer-email" name="email" type="email" required autoComplete="email" /></div>}<div><label htmlFor="payer-document">CPF ou CNPJ{!requirements.payer?.required_fields?.includes("document") ? " (opcional)" : ""}</label><input id="payer-document" name="document" inputMode="numeric" maxLength={18} required={requirements.payer?.required_fields?.includes("document")} /></div></div>
      {(requiresSection(requirements.phone)) && <div className="form-grid"><div><label htmlFor="area-code">DDD</label><input id="area-code" name="area_code" required inputMode="numeric" pattern="[0-9]{2}" /></div><div><label htmlFor="phone">Telefone</label><input id="phone" name="phone" required inputMode="tel" /></div></div>}</>;
  return <div className="checkout-layout"><section className="panel checkout-form"><div className="section-title"><div><h2>Checkout próprio</h2><p className="checkout-description">Escolha como pagar e acompanhe a confirmação por aqui.</p></div><span className="secure-label"><LockKeyhole size={14} />Conexão protegida</span></div>
    <ol className="checkout-progress" aria-label="Etapas do checkout"><li className={!resultStep ? "current" : ""} aria-current={!resultStep ? "step" : undefined}><span className="step-mark" aria-hidden="true">{resultStep ? <Check size={14} /> : "1"}</span>Dados e pagamento</li><li className={resultStep ? "current" : ""} aria-current={resultStep ? "step" : undefined}><span className="step-mark" aria-hidden="true">2</span>Confirmação</li></ol>
    {!checkout && !error && <div className="checkout-loading" role="status"><span>Consultando checkout…</span><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>}
    <ErrorNotice message={error} />
    {checkout?.recurring_acceptance && <div className="recurring-steps"><strong>Aceite da recorrência</strong><Status value={checkout.recurring_acceptance.status} /><div>{checkout.recurring_acceptance.required_steps.map((step: string) => <span key={step} className={checkout?.recurring_acceptance?.pending_steps?.includes(step) ? "" : "done"}><Check size={15} />{step === "PIX_PAYMENT" ? "Pagamento Pix" : "Cadastro do cartão"}</span>)}</div><small>A recorrência só está ativa quando ambas as etapas forem confirmadas.</small></div>}
    {paid && <div className="payment-success" role="status"><div><Check size={24} /></div><h3>Pagamento confirmado</h3><p>A API do ambiente selecionado confirmou o recebimento de {brl(resource.amount)}.</p></div>}
    {resource?.status === "COMPLETED" && operation?.kind === "card-setups" && <div className="notice success"><ShieldCheck size={20} /><span>Cartão cadastrado. {checkout?.recurring_acceptance?.pending_steps?.includes("PIX_PAYMENT") ? "Conclua também o pagamento Pix para ativar a recorrência." : "As cobranças futuras seguem o calendário da recorrência."}</span></div>}
    {operation && !paid && <div className="operation-status" role="status"><div><strong>{operation.kind === "card-setups" ? "Adesão do cartão" : operation.kind === "pix-payments" ? "Pagamento Pix" : "Pagamento com cartão"}</strong><Status value={resource?.status || operation.state} /></div>{resource?.next_action?.type === "THREE_DS_CHALLENGE" && <p>Conclua a autenticação abaixo, diretamente com o banco emissor.</p>}{resource?.next_action?.type === "THREE_DS_METHOD" && <p>O banco está verificando este navegador. Aguarde.</p>}{resource?.next_action?.type === "THREE_DS_DECOUPLED" && <p>Autorize no aplicativo do seu banco e mantenha esta página aberta.</p>}{operation.state === "UNCERTAIN" && <p>Resultado ainda não confirmado. Acompanhamos a mesma tentativa para evitar duplicidade.</p>}{paused && <p>A consulta automática foi pausada. A tentativa foi preservada; você pode atualizar o status.</p>}<Button variant="secondary" onClick={recover} busy={busy}><RefreshCw size={15} />Atualizar status</Button></div>}
    <div ref={frameHost} className="three-ds-container" />
    {showPix && <div className="pix-payment"><h3>Pague com Pix</h3><p>Use o aplicativo da instituição para ler o QR Code ou copie o código.</p>{qr && <img src={qr} width={240} height={240} alt="QR Code Pix da cobrança" />}<label htmlFor="pix-code">Pix copia e cola</label><textarea id="pix-code" readOnly value={resource.copy_paste} rows={3} /><Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(resource.copy_paste); setCopied(true); } catch { setError("Selecione o código acima e copie manualmente."); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Código copiado" : "Copiar código Pix"}</Button>{resource.expires_at && <small>Válido até {new Date(resource.expires_at).toLocaleString("pt-BR")}</small>}</div>}
    {checkout && checkout.available && (isRecurring || (!financialActive && !setupActive && !paid && !setupComplete)) && <form method="post" onSubmit={submit} autoComplete="off"><fieldset className="checkout-fields" disabled={busy}>{isRecurring && checkout.checkout_mode === "PAYMENT" && checkout.checkout_requirements_by_payment_method?.PIX?.card_setup_required && !operations.some(op => ["payments", "pix-payments", "card-setups"].includes(op.kind) && op.state !== "REJECTED") && <fieldset><legend>Primeira ocorrência da recorrência</legend><div className="segmented"><button type="button" aria-pressed={!recurringViaPix} className={!recurringViaPix ? "selected" : ""} onClick={() => { setRecurringViaPix(false); setMethod("CREDIT"); }}>Pagar com cartão</button><button type="button" aria-pressed={recurringViaPix} className={recurringViaPix ? "selected" : ""} onClick={() => { setRecurringViaPix(true); setMethod("PIX"); }}>Pix + cadastro de cartão</button></div><small>No fluxo Pix, você pode cadastrar o cartão antes ou depois de pagar.</small></fieldset>}<fieldset className="payment-methods"><legend>Como deseja pagar?</legend><div className="segmented">{(checkout.checkout_mode === "CARD_SETUP" ? ["CREDIT"] : checkout.payment_methods).map((m: string) => <button key={m} type="button" aria-label={m === "PIX" ? "Pix" : m === "DEBIT" ? "Débito" : isRecurring && usingPixRecurrence ? "Cadastrar cartão" : "Crédito"} aria-pressed={method === m} className={method === m ? "selected" : ""} onClick={() => { setMethod(m); if (m === "PIX") setRecurringViaPix(true); }}>{m === "PIX" ? <QrCode size={18} /> : <CreditCard size={18} />}<span className="method-copy"><strong>{m === "PIX" ? "Pix" : m === "DEBIT" ? "Débito" : isRecurring && usingPixRecurrence ? "Cadastrar cartão" : "Crédito"}</strong><small>{m === "PIX" ? "QR Code ou copia e cola" : m === "DEBIT" ? "À vista no cartão" : setup ? "Para as próximas cobranças" : "À vista ou parcelado"}</small></span></button>)}</div></fieldset>
      <details className={optionalPayer ? "payer-optional" : "payer-required"} open={!optionalPayer || undefined}><summary>Adicionar dados do pagador (opcional)</summary>{payerFields}</details>
      {method !== "PIX" && <><h3>Cartão</h3><label htmlFor="card-number">Número do cartão</label><input id="card-number" name="card_number" required inputMode="numeric" autoComplete="off" maxLength={23} placeholder="0000 0000 0000 0000" /><div className="form-grid"><div><label htmlFor="expiration">Validade</label><input id="expiration" name="expiration" required placeholder="MM/AAAA" inputMode="numeric" maxLength={7} /></div><div><label htmlFor="cvv">Código de segurança</label><input id="cvv" name="cvv" type="password" inputMode="numeric" required pattern="[0-9]{3,4}" maxLength={4} autoComplete="off" /></div></div><div className="form-grid"><div><label htmlFor="brand">Bandeira</label><select id="brand" name="brand">{["VISA", "MASTERCARD", "ELO", "HIPERCARD", "AMEX"].map(b => <option key={b}>{b}</option>)}</select></div><div><label htmlFor="card-installments">Parcelas</label><select id="card-installments" name="installments" disabled={setup || method === "DEBIT"}>{Array.from({ length: setup || method === "DEBIT" ? 1 : Math.max(1, Math.min(12, checkout.max_installments || 1)) }, (_, i) => <option value={i + 1} key={i}>{i + 1}x de {brl(Number(checkout.amount_due_now ?? checkout.amount) / (i + 1))}</option>)}</select></div></div>
      {(requiresSection(requirements.billing_address)) && <><h3>Endereço de cobrança</h3><div className="form-grid">{[["zip_code", "CEP"], ["state", "UF"], ["city", "Cidade"], ["district", "Bairro"], ["street", "Rua"], ["street_number", "Número"]].map(([name, label]) => <div key={name}><label htmlFor={name}>{label}</label><input id={name} name={name} required maxLength={name === "state" ? 2 : 100} /></div>)}</div></>}
      {(isRecurring || setup) && <div className="consent"><label><input name="consent" type="checkbox" required /><span>Autorizo o cadastro deste cartão e as cobranças do calendário exibido, conforme os <a href="/termos" target="_blank" rel="noreferrer">termos da recorrência</a>.</span></label>{checkout.recovery?.can_apply_payment_method_to_remaining_installments && !setup && <label><input name="apply_remaining" type="checkbox" /><span>Aplicar este cartão também às próximas ocorrências.</span></label>}</div>}</>}
      <div className="checkout-submit">{blocked && <p className="notice">Há uma tentativa em andamento. Atualize o status para retomá-la.</p>}<Button type="submit" busy={busy} disabled={blocked} className="pay-button">{busy ? stage : method === "PIX" ? "Gerar Pix" : setup ? "Cadastrar cartão" : `Pagar ${brl(checkout.amount_due_now ?? checkout.amount)}`}</Button><p className="subtle-note"><LockKeyhole size={13} />{method === "PIX" ? "Após gerar o Pix, conclua o pagamento no aplicativo do seu banco." : "Dados do cartão protegidos. Número e código de segurança não são salvos."}</p></div>
    </fieldset></form>}
    {checkout && !checkout.available && !operation && <div className="notice">Este link não está disponível para pagamento. Consulte o status da cobrança.</div>}
  </section><aside className="order-summary"><div className="summary-top"><span>Resumo do pedido</span><Status value={checkout?.status || "CREATED"} /></div><h2>{checkout?.description || "Carregando cobrança"}</h2><p>{checkout?.merchant?.name || "Estabelecimento do contexto"}</p><dl><div><dt>{setup ? "Cobrança agora" : "Total a pagar"}</dt><dd className="summary-amount">{brl(checkout?.amount_due_now ?? checkout?.amount)}</dd></div></dl><details className="summary-details" open={isRecurring || undefined}><summary>Detalhes do pedido</summary><dl><div><dt>Tipo</dt><dd>{isRecurring ? "Recorrente" : "Avulsa"}</dd></div></dl>{checkout?.recurrence?.installments?.length > 0 && <div className="schedule"><h3>Calendário da recorrência</h3>{checkout?.recurrence?.installments?.map((i: Json) => <div key={i.id || i.sequence}><span>{i.due_date?.split("-").reverse().join("/")}<small>{i.status ? statusLabel(i.status) : `Ocorrência ${i.sequence}`}</small></span><strong>{brl(i.amount)}</strong></div>)}</div>}
    <details className="attempt-timeline"><summary>Tentativas desta cobrança<span>({operations.filter(o => o.kind !== "card-tokenizations").length})</span></summary>{operations.filter(o => o.kind !== "card-tokenizations").length ? operations.filter(o => o.kind !== "card-tokenizations").map(o => <button key={o.id} onClick={() => setSelectedId(o.id)} className={operation?.id === o.id ? "current" : ""}><span className="timeline-dot" /><span><strong>{o.kind === "pix-payments" ? "Pix" : o.kind === "card-setups" ? "Cadastro de cartão" : o.kind === "reversal" ? "Estorno" : "Cartão"}</strong><small>{statusLabel(o.response?.status || o.state)}</small></span></button>) : <p>As etapas do pagamento aparecerão aqui.</p>}</details></details><div className="summary-hml"><ShieldCheck size={19} /><span>{config.environment === "PROD" ? "Produção · Operações reais" : config.environment === "HML" ? "Homologação" : "Contexto da sessão"}<small>{config.environment === "PROD" ? "Este pagamento será processado em produção." : config.environment === "HML" ? "Utilize apenas dados de teste." : "Confira o ambiente antes de pagar."}</small></span></div></aside></div>;
}
