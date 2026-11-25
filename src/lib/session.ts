import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import { query } from "./db";
import { AppError } from "./errors";
export const COOKIE = "alliancepay_demo";
function secret() { const key = process.env.SESSION_SECRET; if (!key || key.length < 32) throw new AppError(503, "A sessão da demo ainda não foi configurada."); return key; }
function signature(value: string) { return createHmac("sha256", secret()).update(value).digest("hex"); }
export function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function checkCode(code: string) { const hash = process.env.DEMO_ACCESS_CODE_HASH; return !!hash && equal(createHash("sha256").update(code).digest("hex"), hash); }
export async function newSession() {
  const id = randomUUID(), expires = new Date(Date.now() + 24 * 3600 * 1000);
  await query("INSERT INTO demo_sessions(id,expires_at) VALUES($1,$2)", [id, expires]);
  (await cookies()).set(COOKIE, `${id}.${signature(id)}`, { httpOnly: true, secure: process.env.APP_URL?.startsWith("https:"), sameSite: "strict", path: "/", expires });
  return id;
}
export async function session() {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) throw new AppError(401, "Entre com o código de acesso da demo.");
  const [id, sig] = value.split(".");
  if (!/^[0-9a-f-]{36}$/.test(id || "") || !sig || !equal(signature(id), sig)) throw new AppError(401, "Sua sessão expirou. Entre novamente.");
  if (!(await query("SELECT id FROM demo_sessions WHERE id=$1 AND expires_at>now()", [id])).length) throw new AppError(401, "Sua sessão expirou. Entre novamente.");
  return id;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || "http://localhost:3000").origin;
  if (origin !== expected) throw new AppError(403, "Origem da requisição não permitida.");
}
export function clientIp(request: Request) {
  const ip = process.env.TRUST_DEMO_PROXY === "true" ? request.headers.get("x-demo-client-ip") : "127.0.0.1";
  if (!ip || !isIP(ip)) throw new AppError(400, "Não foi possível identificar a conexão do pagador.");
  return ip;
}
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const bucket = createHash("sha256").update(key + ":" + Math.floor(Date.now() / (seconds * 1000))).digest("hex");
  const [row] = await query("INSERT INTO demo_rate_limits(bucket,count,expires_at) VALUES($1,1,now()+($2 * interval '1 second')) ON CONFLICT(bucket) DO UPDATE SET count=demo_rate_limits.count+1 RETURNING count", [bucket, seconds]);
  if (row.count > limit) throw new AppError(429, "Muitas solicitações. Aguarde um minuto e tente novamente.");
}
