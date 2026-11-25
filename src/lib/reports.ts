import { z } from "zod";
import { AppError, safeData } from "./errors";
import { connection } from "./connection";
import { gateway, GatewayError } from "./gateway";
import type { ReportName } from "./report-catalog";
import { requestPartnerReport } from "./partner-reports";
const uuid = z.string().uuid();
const date = z.iso.date();
const text = z.string().trim().min(1).max(255);
const page = { page: z.coerce.number().int().min(1).max(1000000).default(1), per_page: z.coerce.number().int().min(1).max(500).default(50) };
const offset = { limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).max(1000000).default(0) };
const owner = { merchant_id: uuid.optional() };
const period = { firstdate: date, lastdate: date, cnpj: z.string().transform(v => v.replace(/[.\/\-\s]/g, "")).pipe(z.string().regex(/^\d{14}$/, "Informe um CNPJ com 14 dígitos.")).optional() };
const schemas = {
  merchants: z.object({ ...page, id: uuid.optional(), search: text.optional(), document_type: z.enum(["CPF", "CNPJ"]).optional(), status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]).optional() }).strict(),
  dashboard: z.object({ merchant_id: uuid.optional() }).strict(),
  transactions: z.object({ ...period, ...page, nsu_host: text.optional() }).strict().refine(v => v.firstdate <= v.lastdate, "A data inicial deve ser anterior ou igual à final."),
  summary: z.object(period).strict().refine(v => v.firstdate <= v.lastdate, "A data inicial deve ser anterior ou igual à final."),
  receivables: z.object({ ...owner, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
  liquidations: z.object({ ...owner, ...page, per_page: z.coerce.number().int().min(1).max(200).default(50), start_date: date, end_date: date }).strict().refine(v => v.start_date <= v.end_date && (Date.parse(v.end_date) - Date.parse(v.start_date)) / 86400000 < 31, "O intervalo inclusivo deve ter entre 1 e 31 dias."),
  links: z.object({ ...offset, acquirer_registration_id: uuid.optional(), billing_type: z.enum(["ONE_TIME", "RECURRING"]).optional(), status: z.enum(["ACTIVE", "CARD_REGISTERED", "CANCELED", "PAID", "EXPIRED"]).optional(), external_reference: text.optional(), created_from: date.optional(), created_to: date.optional() }).strict().refine(v => !v.created_from || !v.created_to || v.created_from <= v.created_to, "Confira o período de criação."),
  link: z.object({ payment_link_id: uuid }).strict(),
  payments: z.object({ ...offset, payment_link_id: uuid, status: z.enum(["CREATED", "AUTHENTICATING", "PROCESSING", "PENDING_CONFIRMATION", "APPROVED", "DECLINED", "FAILED", "EXPIRED"]).optional() }).strict(),
  payment: z.object({ payment_link_id: uuid, payment_id: uuid }).strict(),
  history: z.object({ ...offset, payment_link_id: uuid }).strict(),
};
// Only documented read operations can be dispatched; callers never supply a URL.
export function buildReportRequest(name: string, search: URLSearchParams) {
  if (!Object.hasOwn(schemas, name)) throw new AppError(404, "Consulta não encontrada.");
  const input: Record<string, string> = {};
  for (const [key, value] of search) {
    if (key in input) throw new AppError(400, "Filtros duplicados não são permitidos.");
    input[key] = value;
  }
  const parsed = schemas[name as ReportName].parse(input) as Record<string, string | number>;
  const { payment_link_id: link, payment_id: payment, ...params } = parsed;
  const paths: Record<ReportName, string> = {
    merchants: "/acquiring/onboarding/acquirer-registrations/",
    dashboard: "/acquiring/fiserv-transactions/merchant-dashboard", transactions: "/acquiring/fiserv-transactions/list", summary: "/acquiring/fiserv-transactions/summary",
    receivables: "/acquiring/settlements/batches/by-payment-month", liquidations: "/acquiring/settlements/liquidation-results/", links: "/acquiring/payment-links/",
    link: `/acquiring/payment-links/${link}`, payments: `/acquiring/payment-links/${link}/payments/`, payment: `/acquiring/payment-links/${link}/payments/${payment}`, history: `/acquiring/payment-links/${link}/history/`,
  };
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return paths[name as ReportName] + (query.size ? `?${query}` : "");
}
export async function runReport(name: string, search: URLSearchParams) {
  const ctx = connection();
  const result = await requestPartnerReport(gateway(), name, buildReportRequest(name, search));
  const object = z.record(z.string(), z.unknown()), rows = z.array(object);
  const paged = z.object({ data: rows, actual_page: z.number().int().nonnegative(), num_pages: z.number().int().nonnegative(), qty_elements: z.number().int().nonnegative() });
  const listed = z.object({ results: rows, count: z.number().int().nonnegative() });
  const responses: Record<ReportName, z.ZodType> = {
    dashboard: z.object({ merchant: object, kpis: object, daily_volume: rows, brand_distribution: rows, payment_type_distribution: rows, recent_transactions: rows }),
    merchants: paged.extend({ data: z.array(z.object({ id: uuid, document_type: z.enum(["CPF", "CNPJ"]), document_number: z.string().nullable(), status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]), commercial_relationships: rows })), per_page: z.number().int().positive() }),
    transactions: paged, liquidations: paged,
    summary: z.object({ totals: object.optional(), by_product: rows.optional(), by_status: rows.optional(), by_date: rows.optional() }),
    receivables: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), results: z.array(z.object({ payment_date: date, card_batches: rows, pix_batches: rows })) }),
    links: listed, payments: listed, history: listed,
    link: z.object({ id: uuid, status: z.string() }), payment: z.object({ id: uuid, status: z.string() }),
  };
  if (!responses[name as ReportName].safeParse(result.data).success) throw new GatewayError(502, "A API retornou dados fora do formato documentado para esta consulta.", undefined, result.requestId);
  return { data: safeData(result.data), requestId: result.requestId, status: result.status, contextId: ctx.id };
}
