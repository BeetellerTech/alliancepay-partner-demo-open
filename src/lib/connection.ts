import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { createGatewayClient, gatewayScope } from "./gateway";
export const environments = { HML: "https://api-hml.alliancepay.app", PROD: "https://api.alliancepay.app" } as const;
export type Connection = { id: string; environment: keyof typeof environments; expiresAt: number; client: ReturnType<typeof createGatewayClient> };
const globals = globalThis as unknown as { demoConnections?: Map<string, Connection>; demoConnectionTimers?: Map<string, ReturnType<typeof setTimeout>>; demoConnectionScope?: AsyncLocalStorage<Connection> };
const timers = globals.demoConnectionTimers ??= new Map<string, ReturnType<typeof setTimeout>>();
const connections = globals.demoConnections ??= new Map();
export const connectionScope = globals.demoConnectionScope ??= new AsyncLocalStorage<Connection>();
export function getConnection(sid: string) {
  const c = connections.get(sid);
  if (c && c.expiresAt <= Date.now()) { clearConnection(sid); return undefined; }
  return c;
}
export function clearConnection(sid: string) { clearTimeout(timers.get(sid)); timers.delete(sid); connections.delete(sid); }
export function configureConnection(sid: string, input: { environment: "HML" | "PROD"; client_id: string; client_secret: string }) {
  for (const [key, value] of connections) if (value.expiresAt <= Date.now()) clearConnection(key);
  if (!connections.has(sid) && connections.size >= 500) throw new AppError(503, "Limite de sessões conectadas. Tente novamente mais tarde.");
  const c: Connection = { id: randomUUID(), environment: input.environment, expiresAt: Date.now() + 24 * 3600000, client: createGatewayClient({ baseUrl: environments[input.environment], clientId: input.client_id, clientSecret: input.client_secret }) };
  return storeConnection(sid, c);
}
function storeConnection(sid: string, c: Connection) {
  clearConnection(sid);
  connections.set(sid, c);
  const timer = setTimeout(() => { if (connections.get(sid) === c) clearConnection(sid); }, c.expiresAt - Date.now());
  timer.unref(); timers.set(sid, timer);
  return c;
}
export function connection() { const c = connectionScope.getStore(); if (!c || c.expiresAt <= Date.now()) throw new AppError(409, "Configure o contexto na tela Integração para continuar."); return c; }
export function withConnection<T>(c: Connection, action: () => T): T { return connectionScope.run(c, () => gatewayScope.run(c.client, action)); }
export function connectionView(c?: Connection) { return { configured: !!c, contextId: c?.id, environment: c?.environment, baseUrl: c ? environments[c.environment] : undefined, expiresAt: c?.expiresAt }; }
