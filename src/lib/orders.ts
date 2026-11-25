import { connection } from "./connection";
import { createHash, randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { gateway, GatewayError } from "./gateway";
import { AppError, isGenericUpstreamFailure, safeData } from "./errors";
import { createOrderSchema, uuid } from "./validation";
import { terminal, tokenFromUrl, type Order, type Operation, type Kind, type Json } from "./types";

export async function getOrder(id: string, sessionId?: string) {
  const [order] = await query<Order>(`SELECT * FROM demo_orders WHERE id=$1${sessionId ? " AND session_id=$2" : ""}`, sessionId ? [id, sessionId] : [id]);
  if (!order) throw new AppError(404, "Cobrança não encontrada nesta sessão.");
  if ((order as any).context_id !== connection().id) throw new AppError(409, "Esta cobrança pertence a outro contexto. Não pode ser operada na conexão atual.");
  return order;
}
export async function orderView(order: Order) {
  const operations = await query<Operation>("SELECT * FROM demo_operations WHERE order_id=$1 ORDER BY created_at", [order.id]);
  const events = await query("SELECT kind,status,request_id,created_at FROM demo_events WHERE order_id=$1 ORDER BY id DESC LIMIT 100", [order.id]);
  const { public_token: _token, session_id: _session, create_payload: _payload, ...visible } = order;
  return { ...visible, operations: operations.map(({ payload_hash: _hash, ...op }) => op), events };
}
export function checkoutPath(order: Order) {
  if (!order.public_token || !/^[A-Za-z0-9_-]{1,128}$/.test(order.public_token)) throw new AppError(409, "O link ainda não foi confirmado. Atualize a cobrança.");
  return `/acquiring/payment-links/public/${order.public_token}`;
}
export async function event(orderId: string, kind: string, status: number, requestId?: string | null) {
  await query("INSERT INTO demo_events(order_id,kind,status,request_id) VALUES($1,$2,$3,$4)", [orderId, kind, status, requestId || null]);
}
export async function createOrder(input: unknown, sessionId: string) {
  const value = createOrderSchema.parse(input);
  const ctx = connection();
  const { request_id: id, ...fields } = value;
  const payload = { ...fields, external_reference: `demo-${id}` };
  const inserted = await query<Order>("INSERT INTO demo_orders(id,session_id,description,amount,billing_type,state,create_payload,context_id,environment) VALUES($1,$2,$3,$4,$5,'CREATING',$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *", [id, sessionId, value.description, value.amount || value.recurrence!.installments[0].amount, value.billing_type, JSON.stringify(payload), ctx.id, ctx.environment]);
  if (!inserted.length) return orderView(await getOrder(id, sessionId));
  try {
    const result = await gateway().request("/acquiring/payment-links/", { method: "POST", body: payload });
    if (!result.data.id || !result.data.checkout_url) throw new GatewayError(502, "A criação retornou dados incompletos. Consulte a cobrança antes de criar outra.");
    const token = tokenFromUrl(result.data.checkout_url);
    await query("UPDATE demo_orders SET state='READY',link_id=$2,public_token=$3,link=$4,updated_at=now() WHERE id=$1", [id, result.data.id, token, JSON.stringify(safeData(result.data))]);
    await event(id, "link.created", result.status, result.requestId);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 504;
    await query("UPDATE demo_orders SET state=$2,last_error=$3,updated_at=now() WHERE id=$1", [id, status >= 500 || status === 429 || isGenericUpstreamFailure(error) ? "UNCERTAIN" : "REJECTED", JSON.stringify({ status, message: error instanceof AppError ? error.message : "Resultado de criação incerto.", details: error instanceof AppError ? safeData(error.details) : null, requestId: error instanceof AppError ? error.requestId : null })]);
    await event(id, "link.create.error", status, error instanceof AppError ? error.requestId : null);
    throw error;
  }
  return orderView(await getOrder(id));
}
export async function refreshOrder(order: Order) {
  if (!order.link_id) {
    if (order.state === "UNCERTAIN" || order.state === "CREATING") {
      const ec = uuid.parse(order.create_payload.acquirer_registration_id);
      const result = await gateway().request(`/acquiring/payment-links/?acquirer_registration_id=${encodeURIComponent(ec)}&limit=100&offset=0`);
      const list = result.data.results || result.data.items || result.data.data || [];
      const found = Array.isArray(list) ? list.find((link: Json) => link.external_reference === `demo-${order.id}`) : undefined;
      if (found?.id && found.checkout_url) {
        await query("UPDATE demo_orders SET state='READY',link_id=$2,public_token=$3,link=$4,updated_at=now() WHERE id=$1", [order.id, found.id, tokenFromUrl(found.checkout_url), JSON.stringify(safeData(found))]);
        order = await getOrder(order.id);
      }
    }
    if (!order.link_id) return order;
  }
  const result = await gateway().request(`/acquiring/payment-links/${order.link_id}`);
  await query("UPDATE demo_orders SET link=$2,updated_at=now() WHERE id=$1", [order.id, JSON.stringify(safeData(result.data))]);
  return getOrder(order.id);
}
export async function getCheckout(order: Order) {
  const result = await gateway().request(checkoutPath(order));
  if (!Array.isArray(result.data.payment_methods) || typeof result.data.available !== "boolean") throw new GatewayError(502, "Contrato do checkout incompleto.");
  await query("UPDATE demo_orders SET checkout=$2,updated_at=now() WHERE id=$1", [order.id, JSON.stringify(safeData(result.data))]);
  return result.data;
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function payloadFingerprint(value: Json) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export async function reserveOperation(order: Order, kind: Kind, requestId: string, payload: Json, targetId?: string) {
  const hash = payloadFingerprint(payload);
  return transaction(async client => {
    await client.query("SELECT id FROM demo_orders WHERE id=$1 FOR UPDATE", [order.id]);
    const old = (await client.query<Operation>("SELECT * FROM demo_operations WHERE id=$1", [requestId])).rows[0];
    if (old) {
      if (old.order_id !== order.id || old.kind !== kind || old.payload_hash !== hash) throw new AppError(409, "A mesma tentativa deve manter seus dados originais.");
      return { operation: old, created: false };
    }
    const kinds = ["payments", "pix-payments"].includes(kind) ? ["payments", "pix-payments"] : [kind];
    const active = (await client.query<Operation>("SELECT * FROM demo_operations WHERE order_id=$1 AND kind=ANY($2) AND state <> 'REJECTED'", [order.id, kinds])).rows;
    if (active.some(op => (op.state === "UNCERTAIN" || op.state === "SENDING" || !terminal(op.response, op.kind)) && (!targetId || op.target_id === targetId))) {
      throw new AppError(409, "Já existe uma tentativa em andamento. Atualize seu status para continuar.");
    }
    const op = (await client.query<Operation>("INSERT INTO demo_operations(id,order_id,kind,idempotency_key,state,payload_hash,target_id) VALUES($1,$2,$3,$4,'SENDING',$5,$6) RETURNING *", [requestId, order.id, kind, randomUUID(), hash, targetId || null])).rows[0];
    return { operation: op, created: true };
  });
}
export async function saveOperation(op: Operation, result: { data: Json; status: number; requestId?: string | null }) {
  const upstreamId = (op.kind === "reprocess" ? result.data.payment_id : result.data.id) || result.data.payment?.id || op.upstream_id;
  if (op.kind === "reprocess" && result.data.payment_status) result = { ...result, data: { ...result.data, status: result.data.payment_status } };
  await query("UPDATE demo_operations SET state=$2,upstream_id=$3,response=$4,http_status=$5,request_id=$6,updated_at=now() WHERE id=$1", [op.id, upstreamId ? "KNOWN" : "UNCERTAIN", upstreamId || null, JSON.stringify(safeData(result.data)), result.status, result.requestId || null]);
  await event(op.order_id, `${op.kind}.${result.data.status || "updated"}`, result.status, result.requestId);
  return getOperation(op.id, op.order_id);
}
export async function getOperation(id: string, orderId: string) {
  const [op] = await query<Operation>("SELECT * FROM demo_operations WHERE id=$1 AND order_id=$2", [id, orderId]);
  if (!op) throw new AppError(404, "Tentativa não encontrada nesta cobrança.");
  return op;
}
export async function executeOperation(order: Order, kind: Kind, requestId: string, payload: Json, path?: string, targetId?: string) {
  const reserved = await reserveOperation(order, kind, requestId, payload, targetId);
  if (!reserved.created) return reserved.operation;
  const op = reserved.operation;
  try {
    return await saveOperation(op, await gateway().request(path || `${checkoutPath(order)}/${kind}`, { method: "POST", body: payload, key: op.idempotency_key }));
  } catch (error) {
    const status = error instanceof AppError ? error.status : 504;
    // 409, 429, network errors and 5xx cannot prove that an operation was not submitted.
    const uncertain = status >= 500 || status === 409 || status === 429 || isGenericUpstreamFailure(error);
    await query("UPDATE demo_operations SET state=$2,http_status=$3,request_id=$4,updated_at=now() WHERE id=$1", [op.id, uncertain ? "UNCERTAIN" : "REJECTED", status, error instanceof AppError ? error.requestId || null : null]);
    await event(order.id, `${kind}.error`, status, error instanceof AppError ? error.requestId : null);
    throw error;
  }
}
export async function refreshOperation(order: Order, op: Operation) {
  if (op.state === "REJECTED") return op;
  let path: string;
  if (op.kind === "reversal") {
    return saveOperation(op, await gateway().request(`/acquiring/payment-links/${order.link_id}/payments/${op.target_id}/reversal`, { method: "POST", body: {}, key: op.idempotency_key }));
  }
  if (op.kind === "reprocess") {
    if (!op.upstream_id) return saveOperation(op, await gateway().request(`/acquiring/payment-links/${order.link_id}/agreement/installments/${op.target_id}/reprocess`, { method: "POST", body: {}, key: op.idempotency_key }));
    path = `/acquiring/payment-links/${order.link_id}/payments/${op.upstream_id}`;
  } else if (op.upstream_id) path = `${checkoutPath(order)}/${op.kind}/${op.upstream_id}`;
  else if (["payments", "pix-payments"].includes(op.kind)) path = `${checkoutPath(order)}/${op.kind}/by-idempotency-key`;
  else if (op.kind === "card-setups") {
    const checkout = await getCheckout(order);
    if (!checkout.card_setup?.id) return op;
    path = `${checkoutPath(order)}/card-setups/${checkout.card_setup.id}`;
  } else if (op.kind === "card-tokenizations") {
    // This recovery has a known empty payload and reuses the original tokenization key.
    return saveOperation(op, await gateway().request(`${checkoutPath(order)}/card-tokenizations`, { method: "POST", body: {}, key: op.idempotency_key }));
  } else return op;
  try { return await saveOperation(op, await gateway().request(path, { key: op.idempotency_key })); }
  catch (error) { if (error instanceof AppError && error.status === 404 && !op.upstream_id) return op; throw error; }
}
