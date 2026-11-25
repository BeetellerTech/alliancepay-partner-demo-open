export type Json = Record<string, any>;
export type Kind = "card-tokenizations" | "payments" | "pix-payments" | "card-setups" | "reversal" | "reprocess";
export interface Operation {
  id: string; order_id: string; kind: Kind; idempotency_key: string;
  upstream_id: string | null; state: string; response: Json | null;
  http_status: number | null; request_id: string | null; created_at: string;
  updated_at: string; payload_hash: string; target_id: string | null;
}
export interface Order {
  id: string; session_id: string; description: string; amount: string;
  billing_type: string; state: string; link_id: string | null;
  public_token: string | null; link: Json | null; checkout: Json | null;
  create_payload: Json; created_at: string; updated_at: string;
}
export const terminal = (resource: Json | null | undefined, kind: string) => {
  if (!resource) return false;
  if (kind === "pix-payments" && resource.status === "APPROVED") return resource.pix?.phase === "PAID";
  const statuses = kind === "card-setups" ? ["COMPLETED", "FAILED", "EXPIRED", "CANCELED"]
    : kind === "card-tokenizations" ? ["READY", "FAILED", "EXPIRED"]
    : ["APPROVED", "DECLINED", "FAILED", "EXPIRED", "CANCELED", "REVERSED", "REFUNDED", "COMPLETED"];
  return statuses.includes(resource.status);
};
export function canShowPix(resource: Json) {
  return resource.pix?.can_pay === true && typeof resource.copy_paste === "string" && resource.copy_paste.length > 0
    && (!resource.expires_at || new Date(resource.expires_at).getTime() > Date.now()) && !terminal(resource, "pix-payments");
}
export function isPaid(resource: Json, kind: string) {
  return resource.status === "APPROVED" && (kind !== "pix-payments" || resource.pix?.phase === "PAID");
}
export function tokenFromUrl(value: string) {
  const url = new URL(value);
  const token = url.pathname.split("/").filter(Boolean).at(-1) || "";
  if (url.protocol !== "https:" || !/^[A-Za-z0-9_-]{1,128}$/.test(token)) throw new Error("checkout_url inválida");
  return token;
}
