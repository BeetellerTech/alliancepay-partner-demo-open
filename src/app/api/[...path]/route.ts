import { getConnection, configureConnection, clearConnection, connectionView, withConnection } from "@/lib/connection";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, safeData } from "@/lib/errors";
import { checkCode, checkOrigin, clientIp, COOKIE, newSession, rateLimit, session } from "@/lib/session";
import { query } from "@/lib/db";
import { gateway, GatewayError } from "@/lib/gateway";
import { attemptSchema, cardSchema, confirmSchema, pixSchema, uuid } from "@/lib/validation";
import { checkoutPath, createOrder, event, executeOperation, getCheckout, getOperation, getOrder, orderView, payloadFingerprint, refreshOperation, refreshOrder, saveOperation } from "@/lib/orders";
import { tokenFromUrl, type Json, type Kind, type Order } from "@/lib/types";
import { enforceRequirements } from "@/lib/requirements";
import { runReport } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "Envie os dados como JSON.");
  if (Number(request.headers.get("content-length")) > 16000) throw new AppError(413, "Requisição muito grande.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 16000) throw new AppError(413, "Requisição muito grande.");
  try { return JSON.parse(text); } catch { throw new AppError(400, "JSON inválido."); }
}
async function validateAttempt(order: Order, kind: Kind, payload: Json, request: Request) {
  const checkout = await getCheckout(order);
  if (!checkout.available) throw new AppError(409, "Este link não está disponível para novas tentativas. Consulte a tentativa existente.");
  if (kind === "card-tokenizations") return z.object({}).strict().parse(payload);
  if (kind === "pix-payments") {
    const parsed = pixSchema.parse(payload);
    if (!checkout.payment_methods.includes("PIX")) throw new AppError(400, "Pix não habilitado neste link.");
    if (checkout.recurring_acceptance?.steps?.pix_payment?.can_start === false) throw new AppError(409, "O Pix desta recorrência já foi iniciado.");
    if (parsed.card_setup_id) {
      const found = await query("SELECT id FROM demo_operations WHERE order_id=$1 AND kind='card-setups' AND upstream_id=$2", [order.id, parsed.card_setup_id]);
      if (!found.length) throw new AppError(400, "Adesão não pertence a esta cobrança.");
    }
    enforceRequirements(checkout.checkout_requirements_by_payment_method?.PIX || checkout.checkout_requirements, parsed);
    return parsed;
  }
  const parsed = cardSchema.parse(payload);
  if (kind === "card-setups") {
    if (parsed.payment_method !== "CREDIT" || parsed.installments !== 1 || parsed.recurring_consent !== true || !parsed.consent_terms_version || parsed.apply_payment_method_to_remaining_installments !== undefined) throw new AppError(400, "A adesão exige crédito, uma parcela e consentimento dos termos.");
    if (checkout.checkout_mode !== "CARD_SETUP" && !checkout.checkout_requirements_by_payment_method?.PIX?.card_setup_required) throw new AppError(400, "Este link não permite adesão de cartão.");
    if (checkout.recurring_acceptance?.steps?.card_setup?.can_start === false) throw new AppError(409, "A adesão desta recorrência já foi iniciada.");
  } else {
    if (checkout.checkout_mode !== "PAYMENT") throw new AppError(400, "Este link permite apenas cadastro de cartão, sem cobrança imediata.");
    if (!checkout.payment_methods.includes(parsed.payment_method) || parsed.installments > checkout.max_installments) throw new AppError(400, "Meio de pagamento ou parcelamento não permitido.");
  }
  if (checkout.billing_type === "RECURRING" && (!parsed.recurring_consent || !parsed.consent_terms_version)) throw new AppError(400, "Confirme os termos da recorrência.");
  if (parsed.apply_payment_method_to_remaining_installments && !checkout.recovery?.can_apply_payment_method_to_remaining_installments) throw new AppError(400, "A atualização das próximas ocorrências não está habilitada.");
  const methods = await query("SELECT id FROM demo_operations WHERE order_id=$1 AND kind='card-tokenizations' AND response->>'status'='READY' AND response->>'payment_method_id'=$2", [order.id, parsed.payment_method_id]);
  if (!methods.length) throw new AppError(400, "Tokenize o cartão nesta cobrança antes de continuar.");
  enforceRequirements(checkout.checkout_requirements_by_payment_method?.[parsed.payment_method] || checkout.checkout_requirements, parsed);
  return { ...parsed, browser: { ...parsed.browser, ip_address: clientIp(request), user_agent_browser_value: request.headers.get("user-agent") || parsed.browser.user_agent_browser_value } };
}
async function route(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await params).path;
    const method = request.method;
    if (method === "POST") checkOrigin(request);
    if (path.join("/") === "health" && method === "GET") {
      await query("SELECT 1");
      return json({ status: "ok", environment: "SESSION" });
    }
    if (path.join("/") === "login" && method === "POST") {
      await rateLimit(`login:${clientIp(request)}`, 10, 600);
      const value = z.object({ code: z.string().min(1).max(256) }).strict().parse(await body(request));
      if (!process.env.DEMO_ACCESS_CODE_HASH) throw new AppError(503, "O código de acesso ainda não foi configurado.");
      if (!checkCode(value.code)) throw new AppError(401, "Código de acesso inválido.");
      await newSession(); return json({ ok: true });
    }
    const sid = await session();
    await rateLimit(`session:${sid}:${method}`, method === "POST" ? 25 : 180);
    if (path[0] === "logout" && method === "POST") {
      clearConnection(sid);
      await query("UPDATE demo_sessions SET expires_at=now() WHERE id=$1", [sid]);
      (await cookies()).delete(COOKIE); return json({ ok: true });
    }
    if (path[0] === "config" && path.length === 1 && method === "GET") {
      return json({ ...connectionView(getConnection(sid)), maxAmount: Number(process.env.DEMO_MAX_AMOUNT || 1000) });
    }
    if (path.join("/") === "context" && method === "POST") {
      const input = z.object({ environment: z.enum(["HML", "PROD"]), client_id: z.string().trim().min(1).max(512), client_secret: z.string().min(1).max(2048) }).strict().parse(await body(request));
      return json(connectionView(configureConnection(sid, input)));
    }
    if (path.join("/") === "context/clear" && method === "POST") { clearConnection(sid); return json({ configured: false }); }
    const ctx = getConnection(sid);
    if (!ctx) throw new AppError(409, "Configure o contexto na tela Integração para continuar.");
    if (method === "POST" && request.headers.get("x-demo-context") !== ctx.id) throw new AppError(409, "O contexto mudou. Atualize a página antes de continuar.");
    return await withConnection(ctx, async () => {
    if (path[0] === "reports" && path.length === 2 && method === "GET") {
      if (request.headers.get("x-demo-context") !== ctx.id) throw new AppError(409, "O contexto mudou. Atualize a página antes de consultar.");
      return json(await runReport(path[1], new URL(request.url).searchParams));
    }
    if (path[0] === "creation-options" && path.length === 1 && method === "GET") {
      if (request.headers.get("x-demo-context") !== ctx.id) throw new AppError(409, "O contexto mudou. Atualize a página antes de continuar.");
      const search = new URL(request.url).searchParams;
      const merchantId = uuid.parse(search.get("acquirer_registration_id"));
      const type = search.get("billing_type") === "RECURRING" ? "RECURRING" : "ONE_TIME";
      const result = await gateway().request(`/acquiring/payment-links/creation-options/?acquirer_registration_id=${encodeURIComponent(merchantId)}&billing_type=${type}`);
      return json(result.data, result.status);
    }
    if (path[0] !== "orders") throw new AppError(404, "Rota não encontrada.");
    if (path.length === 1) {
      if (method === "GET") return json(await query("SELECT id,description,amount,billing_type,state,link,created_at,updated_at FROM demo_orders WHERE session_id=$1 AND context_id=$2 ORDER BY created_at DESC LIMIT 100", [sid, ctx.id]));
      if (method === "POST") return json(await createOrder(await body(request), sid), 201);
    }
    const id = uuid.parse(path[1]);
    let order = await getOrder(id, sid);
    if (path.length === 2 && method === "GET") {
      if (new URL(request.url).searchParams.has("refresh")) order = await refreshOrder(order);
      return json(await orderView(order));
    }
    if (path[2] === "checkout" && method === "GET" && path.length === 3) return json(await getCheckout(order));
    if (path[2] === "history" && method === "GET" && path.length === 3) {
      if (!order.link_id) throw new AppError(409, "O link ainda não está disponível.");
      const result = await gateway().request(`/acquiring/payment-links/${order.link_id}/history/?limit=100&offset=0`);
      return json(safeData(result.data), result.status);
    }
    if (path.length === 3 && ["card-tokenizations", "payments", "pix-payments", "card-setups"].includes(path[2]) && method === "POST") {
      const input = attemptSchema.parse(await body(request));
      // Retrying an existing reservation never creates a new upstream write, even when the link closed.
      const previous = await query("SELECT * FROM demo_operations WHERE id=$1 AND order_id=$2", [input.request_id, id]);
      if (previous.length) {
        const old = previous[0];
        let normalized: Json = path[2] === "card-tokenizations" ? z.object({}).strict().parse(input.payload) : path[2] === "pix-payments" ? pixSchema.parse(input.payload) : cardSchema.parse(input.payload);
        if (normalized.browser) normalized = { ...normalized, browser: { ...normalized.browser, ip_address: clientIp(request), user_agent_browser_value: request.headers.get("user-agent") || normalized.browser.user_agent_browser_value } };
        if (old.kind !== path[2] || old.payload_hash !== payloadFingerprint(normalized)) throw new AppError(409, "A mesma tentativa deve manter seus dados originais.");
        return json(old, old.state === "UNCERTAIN" || old.state === "SENDING" ? 202 : 200);
      }
      const kind = path[2] as Kind;
      const payload = await validateAttempt(order, kind, input.payload, request);
      const op = await executeOperation(order, kind, input.request_id, payload);
      return json(op, op.http_status || 202);
    }
    if (path[2] === "operations" && path[3]) {
      let op = await getOperation(uuid.parse(path[3]), id);
      if (path.length === 4 && method === "GET") { op = await refreshOperation(order, op); return json(op, op.http_status || 202); }
      if (path[4] === "confirm" && path.length === 5 && method === "POST" && op.kind === "card-tokenizations") {
        if (op.response?.status === "READY") return json(op);
        if (!op.upstream_id || ["FAILED", "EXPIRED"].includes(op.response?.status)) throw new AppError(409, "Esta tokenização não pode ser confirmada.");
        const payload = confirmSchema.parse(await body(request));
        const result = await gateway().request(`${checkoutPath(order)}/card-tokenizations/${op.upstream_id}/confirm`, { method: "POST", body: payload });
        return json(await saveOperation(op, result), result.status);
      }
      if (path[4] === "continue" && path.length === 5 && method === "POST" && ["payments", "card-setups"].includes(op.kind)) {
        z.object({}).strict().parse(await body(request));
        if (!op.upstream_id) throw new AppError(409, "Atualize a tentativa para recuperar seu ID.");
        const result = await gateway().request(`${checkoutPath(order)}/${op.kind}/${op.upstream_id}/three-ds/continue`, { method: "POST", body: {} });
        return json(await saveOperation(op, result), result.status);
      }
    }
    if (path[2] === "actions" && path.length === 3 && method === "POST") {
      const input = z.object({ action: z.enum(["cancel", "cancel-agreement", "reversal", "recovery", "reprocess"]), request_id: uuid, target_id: uuid.optional() }).strict().parse(await body(request));
      if (!order.link_id) throw new AppError(409, "O link ainda não foi confirmado.");
      const base = `/acquiring/payment-links/${order.link_id}`;
      if (input.action === "cancel" || input.action === "cancel-agreement") {
        const result = await gateway().request(`${base}/${input.action === "cancel" ? "cancel" : "agreement/cancel"}`, { method: "POST", body: {} });
        await event(id, input.action, result.status, result.requestId);
        return json(await orderView(await refreshOrder(order)), result.status);
      }
      if (!input.target_id) throw new AppError(400, "Selecione a operação.");
      if (input.action === "reversal") {
        const known = await query("SELECT id FROM demo_operations WHERE order_id=$1 AND upstream_id=$2 AND kind=ANY($3)", [id, input.target_id, ["payments", "pix-payments", "reprocess"]]);
        if (!known.length) throw new AppError(404, "Pagamento não pertence a esta cobrança.");
        const op = await executeOperation(order, "reversal", input.request_id, {}, `${base}/payments/${input.target_id}/reversal`, input.target_id);
        return json(op, op.http_status || 202);
      }
      order = await refreshOrder(order);
      const installments = order.link?.recurrence?.installments || order.checkout?.recurrence?.installments || [];
      if (!installments.some((i: Json) => i.id === input.target_id)) throw new AppError(404, "Ocorrência não pertence a esta cobrança.");
      if (input.action === "reprocess") {
        const op = await executeOperation(order, "reprocess", input.request_id, {}, `${base}/agreement/installments/${input.target_id}/reprocess`, input.target_id);
        return json(op, op.http_status || 202);
      }
      const result = await gateway().request(`${base}/agreement/installments/${input.target_id}/recovery-link`, { method: "POST", body: {} });
      await event(id, "recovery.created", result.status, result.requestId);
      const recoveredLink = result.data;
      if (recoveredLink.id && recoveredLink.checkout_url) {
        const existing = await query("SELECT id FROM demo_orders WHERE session_id=$1 AND link_id=$2 AND context_id=$3", [sid, recoveredLink.id, ctx.id]);
        let recoveryOrderId = existing[0]?.id;
        if (!recoveryOrderId) {
          recoveryOrderId = randomUUID();
          await query("INSERT INTO demo_orders(id,session_id,description,amount,billing_type,state,link_id,public_token,link,create_payload) VALUES($1,$2,$3,$4,$5,'READY',$6,$7,$8,$9)", [recoveryOrderId, sid, recoveredLink.description || `Recuperação: ${order.description}`, recoveredLink.amount_due_now || recoveredLink.amount || order.amount, recoveredLink.billing_type || "RECURRING", recoveredLink.id, tokenFromUrl(recoveredLink.checkout_url), JSON.stringify(safeData(recoveredLink)), JSON.stringify({ parent_order_id: id, installment_id: input.target_id })]);
        }
        await query("UPDATE demo_orders SET context_id=$2,environment=$3 WHERE id=$1 AND session_id=$4", [recoveryOrderId, ctx.id, ctx.environment, sid]);
        return json({ ...safeData(recoveredLink), demo_order_id: recoveryOrderId }, result.status);
      }
      return json(safeData(recoveredLink), result.status);
    }
    throw new AppError(404, "Rota não encontrada.");
    });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "Confira os campos informados.", fields: error.issues.map(i => ({ path: i.path.join("."), message: i.message })) }, 400);
    if (error instanceof AppError) return json({ error: error.message, details: error.details, requestId: error.requestId, source: error instanceof GatewayError ? "upstream" : "demo" }, error.status);
    // Do not log provider bodies, personal data, card fields, database URLs, or secrets.
    console.error("demo_request_failed", { type: error instanceof Error ? error.name : "Unknown" });
    return json({ error: "Não foi possível concluir esta etapa. Atualize o status antes de repetir uma operação." }, 500);
  }
}
export { route as GET, route as POST };
