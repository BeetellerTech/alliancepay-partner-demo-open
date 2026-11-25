let activeContextId = "";
import type { Json } from "./types";
export class ApiError extends Error { constructor(message: string, public status: number, public details?: any, public requestId?: string) { super(message); } }
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", ...(activeContextId ? { "X-Demo-Context": activeContextId } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "login" && data.source !== "upstream") window.location.assign("/login");
    throw new ApiError(data.error || `HTTP ${response.status}`, response.status, data.fields || data.details, data.requestId);
  }
  if (["config", "context", "context/clear", "logout"].includes(path)) activeContextId = data.contextId || "";
  return data;
}
export function describeError(error: unknown) {
  if (error instanceof ApiError) {
    const details = Array.isArray(error.details) ? error.details.map((x: any) => x.message || "").join(" ") : typeof error.details?.detail === "string" ? error.details.detail : "";
    return `${error.message} ${details}${error.requestId ? ` Referência: ${error.requestId}` : ""}`.trim();
  }
  return error instanceof Error && error.name !== "TimeoutError" ? error.message : "A conexão foi interrompida. Atualize a tentativa antes de tentar novamente.";
}
export const brl = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
export const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
export function browserPayload() {
  return { http_accept_browser_value: "text/html,application/xhtml+xml", http_browser_java_script_enabled: true, http_browser_java_enabled: navigator.javaEnabled?.() ?? false, http_browser_language: navigator.language, http_browser_color_depth: screen.colorDepth, http_browser_screen_height: screen.height, http_browser_screen_width: screen.width, http_browser_time_difference: new Date().getTimezoneOffset(), user_agent_browser_value: navigator.userAgent };
}
export async function encryptCard(pem: string, card: { number: string; month: string; year: string; cvv: string }) {
  const bytes = Uint8Array.from(atob(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "")), x => x.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", bytes, { name: "RSA-OAEP", hash: "SHA-1" }, false, ["encrypt"]);
  const encrypt = async (value: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(value)))));
  const [number, expiration_month, expiration_year, security_code] = await Promise.all([encrypt(card.number), encrypt(card.month), encrypt(card.year), encrypt(card.cvv)]);
  return { number, expiration_month, expiration_year, security_code };
}
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function createThreeDsController(container: HTMLElement) {
  let active: { key: string; frame: HTMLIFrameElement; pending?: Promise<any> } | undefined;
  const completed = new Set<string>();
  function dispose() { active?.frame.remove(); active = undefined; }
  return {
    dispose,
    async handle(resource: Json, continueMethod: () => Promise<any>, signal: AbortSignal) {
      const action = resource.next_action;
      if (!action) { if (resource.status !== "AUTHENTICATING") dispose(); return; }
      if (action.type === "THREE_DS_DECOUPLED") { dispose(); return; }
      const challenge = action.type === "THREE_DS_CHALLENGE";
      if (!challenge && action.type !== "THREE_DS_METHOD") throw new Error("Ação 3DS desconhecida. Atualize a tentativa.");
      const value = challenge ? action.creq : action.three_ds_method_data;
      if (!action.url || !value) throw new Error("O banco ainda não retornou os dados completos da autenticação. Atualize o status.");
      const target = new URL(action.url);
      if (target.protocol !== "https:" || target.username || target.password) throw new Error("Endereço 3DS inválido.");
      const key = JSON.stringify([resource.id, action.type, action.url, value]);
      if (active?.key !== key) {
        dispose();
        const frame = document.createElement("iframe"); frame.name = `three-ds-${crypto.randomUUID()}`;
        frame.title = challenge ? "Autenticação do cartão pelo banco emissor" : "Verificação do navegador";
        frame.hidden = !challenge; frame.className = "three-ds-frame"; container.append(frame);
        const form = document.createElement("form"); form.method = "POST"; form.action = target.href; form.target = frame.name; form.hidden = true;
        const input = document.createElement("input"); input.name = challenge ? "creq" : "threeDSMethodData"; input.value = value; input.type = "hidden"; form.append(input); document.body.append(form);
        try { form.submit(); } finally { form.remove(); }
        active = { key, frame };
      }
      if (challenge || completed.has(key)) return;
      const current = active;
      current.pending ??= (async () => { await wait(10000, signal); if (active !== current) return; const result = await continueMethod(); completed.add(key); return result; })().finally(() => { current.pending = undefined; });
      return current.pending;
    },
  };
}
