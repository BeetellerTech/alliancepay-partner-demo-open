import type { Json } from "./types";
export function moneyValue(value: unknown): number | null {
  return (typeof value === "number" || typeof value === "string") && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}
export function sumKnown(rows: Json[], field: string) {
  const values = rows.map(row => moneyValue(row[field])).filter((value): value is number => value !== null);
  return { amount: values.length ? values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100 : null, count: values.length, total: rows.length };
}
export function isSale(row: Json) { return !/DENIED|DECLINED|NEGAD|RECUSAD|REVERSED|REFUNDED|ESTORN|DESFAZIMENTO|CANCEL|FAILED/.test(String(row.estado || row.status || "").toUpperCase()); }
export function documentLabel(value: unknown) {
  const v = String(value || "").replace(/\D/g, "");
  if (v.length === 14) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (v.length === 11) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return String(value || "Não informado");
}
export function shortDate(value: unknown) { const date = String(value || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join("/") : String(value || "—"); }
export function merchantName(row: Json) { return row.trading_name || row.legal_name || row.person_name || row.name || "Estabelecimento"; }
export function calendarBatches(day: Json) {
  return [...(day.card_batches || []).map((row: Json) => ({ ...row, kind: "Cartão" })), ...(day.pix_batches || []).map((row: Json) => ({ ...row, kind: "Pix" }))].map(row => {
    const net = moneyValue(row.merchant_net_amount ?? row.net_amount), actualPaid = moneyValue(row.paid_amount);
    const paid = row.status === "SETTLED" ? actualPaid ?? net : row.status === "PARTIALLY_SETTLED" ? actualPaid : 0;
    const open = row.status === "SETTLED" ? 0 : net !== null && paid !== null ? Math.max(0, net - paid) : null;
    return { ...row, net, paid, open };
  });
}
