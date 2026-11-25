import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { AppError, safeData } from "./errors";
import type { Json } from "./types";

export class GatewayError extends AppError {}
export function createGatewayClient({ baseUrl, clientId, clientSecret, fetcher = fetch, now = Date.now }:
  { baseUrl: string; clientId: string; clientSecret: string; fetcher?: typeof fetch; now?: () => number }) {
  const url = new URL(baseUrl);
  if (!["https://api-hml.alliancepay.app", "https://api.alliancepay.app"].includes(url.origin) && !(process.env.NODE_ENV === "test" && url.hostname === "127.0.0.1")) {
    throw new AppError(503, "Ambiente de integração inválido.");
  }
  const redact = (value: any): any => typeof value === "string" ? value.replaceAll(clientSecret, "[redacted]").replaceAll(clientId, "[redacted]") : Array.isArray(value) ? value.map(redact) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,redact(v)])) : value;
  let token = "", until = 0, flight: Promise<string> | undefined;
  async function exchange() {
    if (!clientId || !clientSecret) throw new AppError(503, "Configure as credenciais no contexto da sessão.");
    const response = await fetcher(`${url.origin}/oauth/token`, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new GatewayError(response.status, "A autenticação no ambiente selecionado falhou.", safeData(redact(data)), response.headers.get("x-request-id"));
    if (!data?.access_token || !Number.isFinite(Number(data.expires_in))) throw new GatewayError(502, "Resposta OAuth inválida.");
    token = data.access_token; until = now() + Math.max(0, Math.min(Number(data.expires_in), 3600) - 60) * 1000;
    return token;
  }
  async function getToken() {
    if (token && now() < until) return token;
    flight ??= exchange().finally(() => { flight = undefined; });
    return flight;
  }
  return {
    async request(path: string, options: { method?: "GET" | "POST"; body?: Json; key?: string; signal?: AbortSignal } = {}) {
      const target = new URL(path, url.origin);
      if (target.origin !== url.origin || !target.pathname.startsWith("/acquiring/")) throw new AppError(400, "Destino de integração inválido.");
      const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${await getToken()}`, "X-Request-Id": randomUUID() };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.key) headers["Idempotency-Key"] = options.key;
      let response: Response;
      try {
        response = await fetcher(target, { method: options.method || "GET", headers, cache: "no-store", redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
      } catch { throw new GatewayError(504, "A API não confirmou o resultado. Consulte a tentativa existente antes de repetir."); }
      const requestId = response.headers.get("x-request-id");
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) { token = ""; until = 0; }
        throw new GatewayError(response.status, `A API selecionada retornou HTTP ${response.status}.`, safeData(redact(data)), requestId);
      }
      if (!data || typeof data !== "object") throw new GatewayError(502, "A API retornou uma resposta inválida.", undefined, requestId);
      return { data: redact(data) as Json, status: response.status, requestId };
    },
  };
}
const globals = globalThis as unknown as { demoGatewayScope?: AsyncLocalStorage<ReturnType<typeof createGatewayClient>> };
export const gatewayScope = globals.demoGatewayScope ??= new AsyncLocalStorage<ReturnType<typeof createGatewayClient>>();
export function gateway() { const client = gatewayScope.getStore(); if (!client) throw new AppError(409, "Configure o contexto da sessao."); return client; }
