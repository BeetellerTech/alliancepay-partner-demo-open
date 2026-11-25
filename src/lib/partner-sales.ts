import { z } from "zod";
import { GatewayError, type createGatewayClient } from "./gateway";
import type { Json } from "./types";

type Client = ReturnType<typeof createGatewayClient>;
const merchantPage = z.object({
  data: z.array(z.object({
    id: z.uuid(), document_number: z.string().nullable().optional(),
  })),
  actual_page: z.number().int().nonnegative(), num_pages: z.number().int().nonnegative(), qty_elements: z.number().int().nonnegative(),
});

async function loadMerchants(client: Client, signal: AbortSignal) {
  const found = new Map<string, z.infer<typeof merchantPage>["data"][number]>();
  let requestId: string | null = null;
  let expectedCount: number | undefined, expectedPages: number | undefined;
  for (let page = 1; ; page++) {
    const response = await client.request(`/acquiring/onboarding/acquirer-registrations/?page=${page}&per_page=500`, { signal });
    requestId = response.requestId;
    const parsed = merchantPage.safeParse(response.data);
    if (!parsed.success) throw new GatewayError(502, "A API não informou os estabelecimentos necessários para consultar todas as vendas.", undefined, requestId);
    const data = parsed.data;
    if (expectedCount !== undefined && (data.qty_elements !== expectedCount || data.num_pages !== expectedPages)) throw new GatewayError(502, "A lista de estabelecimentos mudou durante a consulta. Consulte novamente para obter um total consistente.", undefined, requestId);
    expectedCount = data.qty_elements; expectedPages = data.num_pages;
    if ((data.data.length > 0 && data.actual_page !== page) || (!data.data.length && (data.num_pages > page || data.qty_elements > 0))) throw new GatewayError(502, "A lista de estabelecimentos retornou uma página incompleta. A consulta de todos não foi realizada.", undefined, requestId);
    const before = found.size;
    for (const merchant of data.data) found.set(merchant.id, merchant);
    if (page >= data.num_pages) {
      if (found.size !== expectedCount) throw new GatewayError(502, "A lista de estabelecimentos está incompleta. Nenhum total parcial será exibido.", undefined, requestId);
      break;
    }
    if (found.size === before || page >= 1000) throw new GatewayError(502, "Não foi possível carregar todos os estabelecimentos. Nenhum total parcial será exibido.", undefined, requestId);
  }
  return { merchants: [...found.values()], requestId };
}

async function mapLimited<T, R>(items: T[], run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let index = 0, stopped = false;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (!stopped && index < items.length) {
      const current = index++;
      try { results[current] = await run(items[current]); }
      catch (error) { stopped = true; throw error; }
    }
  }));
  return results;
}

function total(rows: Json[], field: string) {
  if (rows.some(row => row[field] == null || row[field] === "" || !Number.isFinite(Number(row[field])))) return null;
  return rows.reduce((sum, row) => sum + Math.round(Number(row[field]) * 100), 0) / 100;
}
function metrics(rows: Json[]) {
  const result: Json = {};
  for (const field of ["amount", "count", "gross_amount"]) if (rows.some(row => Object.hasOwn(row, field))) result[field] = total(rows, field);
  if (rows.some(row => Object.hasOwn(row, "percentage"))) result.percentage = result.amount == null || result.gross_amount == null ? null : result.gross_amount ? Math.round(result.amount / result.gross_amount * 10000) / 100 : 0;
  return result;
}
function grouped(dashboards: Json[], collection: string, key: string) {
  const groups = new Map<string, Json[]>();
  for (const dashboard of dashboards) for (const row of dashboard[collection]) {
    if (typeof row[key] !== "string") throw new GatewayError(502, "A API retornou um agrupamento de vendas incompleto.");
    groups.set(row[key], [...(groups.get(row[key]) || []), row]);
  }
  const result: Json[] = [...groups.entries()].map(([value, rows]) => ({ [key]: value, ...(rows[0].label ? { label: rows[0].label } : {}), ...metrics(rows) }));
  if (collection === "brand_distribution") {
    const amount = total(result, "amount");
    for (const row of result) row.percentage = amount == null || row.amount == null ? null : amount ? Math.round(row.amount / amount * 10000) / 100 : 0;
  }
  return result.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

export function combineDashboards(dashboards: Json[]) {
  const first = dashboards[0];
  if (dashboards.some(data => JSON.stringify(data.filters) !== JSON.stringify(first.filters))) throw new GatewayError(502, "Os estabelecimentos retornaram períodos diferentes. Consulte novamente para obter um total consistente.");
  const kpis: Json = {};
  for (const key of new Set(dashboards.flatMap(data => Object.keys(data.kpis)))) kpis[key] = metrics(dashboards.map(data => data.kpis[key] || {}));
  const recent = new Map<string, Json>();
  for (const dashboard of dashboards) for (const row of dashboard.recent_transactions) {
    if (typeof row.id !== "string") throw new GatewayError(502, "A API retornou uma transação sem identificador para consolidar o dashboard.");
    recent.set(row.id, { ...row, merchant: dashboard.merchant.name });
  }
  return {
    merchant: { name: "Todos os estabelecimentos do parceiro", cnpj: null }, filters: first?.filters || {},
    has_transactions: dashboards.some(data => data.has_transactions === true), kpis,
    daily_volume: grouped(dashboards, "daily_volume", "date"),
    brand_distribution: grouped(dashboards, "brand_distribution", "brand"),
    payment_type_distribution: grouped(dashboards, "payment_type_distribution", "type"),
    recent_transactions: [...recent.values()].sort((a, b) => String(b.transaction_timestamp || b.transaction_date || "").localeCompare(String(a.transaction_timestamp || a.transaction_date || ""))).slice(0, 10),
    aggregation: { merchant_count: dashboards.length, scope: "PARTNER" },
  };
}

const dashboardSchema = z.object({ merchant: z.record(z.string(), z.unknown()), filters: z.record(z.string(), z.unknown()), has_transactions: z.boolean(), kpis: z.record(z.string(), z.record(z.string(), z.unknown())), daily_volume: z.array(z.record(z.string(), z.unknown())), brand_distribution: z.array(z.record(z.string(), z.unknown())), payment_type_distribution: z.array(z.record(z.string(), z.unknown())), recent_transactions: z.array(z.record(z.string(), z.unknown())) });

const summaryMetrics = z.object({ transaction_count: z.number().int().nonnegative(), transaction_amount: z.union([z.number(), z.string()]) }).passthrough();
const summarySchema = z.object({
  totals: summaryMetrics,
  by_product: z.array(summaryMetrics.extend({ produto: z.string().nullable() })),
  by_status: z.array(summaryMetrics.extend({ estado: z.string().nullable() })),
  by_date: z.array(summaryMetrics.extend({ transaction_date: z.string().nullable() })),
});
function summaryTotals(rows: Json[]): Json {
  const fields = new Set(["transaction_count", "transaction_amount", ...rows.flatMap(row => Object.keys(row).filter(key => /_(amount|count)$/.test(key)))]);
  return Object.fromEntries([...fields].map(key => [key, total(rows, key)]));
}
function combineSummaries(results: Json[], params: URLSearchParams) {
  const result: Json = { filters: { firstdate: params.get("firstdate"), lastdate: params.get("lastdate"), cnpj: null }, totals: summaryTotals(results.map(data => data.totals)) };
  for (const [collection, key] of [["by_product", "produto"], ["by_status", "estado"], ["by_date", "transaction_date"]]) {
    const groups = new Map<string | null, Json[]>();
    for (const data of results) for (const row of data[collection]) groups.set(row[key], [...(groups.get(row[key]) || []), row]);
    result[collection] = [...groups.entries()].sort(([a], [b]) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)).map(([value, rows]) => ({ [key]: value, ...summaryTotals(rows) }));
  }
  return result;
}

const transactionPage = z.object({
  data: z.array(z.object({ transaction: z.string().min(1), transaction_date: z.string().nullable(), transaction_timestamp: z.string().nullable().optional() }).passthrough()),
  actual_page: z.number().int().positive(), num_pages: z.number().int().nonnegative(), qty_elements: z.number().int().nonnegative(),
});
function transactionOrder(row: Json) {
  // Match the API's date/time ordering; preserve its order within each EC for ties.
  return `${row.transaction_date || ""}T${String(row.transaction_timestamp || "").match(/T(\d{2}:\d{2}:\d{2})/)?.[1] || "99:99:99"}`;
}
async function listTransactions(client: Client, url: URL, documents: string[], signal: AbortSignal) {
  const batchSize = 100, perPage = Number(url.searchParams.get("per_page"));
  async function read(document: string, page: number, expected?: number) {
    const query = new URLSearchParams(url.searchParams);
    query.set("cnpj", document); query.set("page", String(page)); query.set("per_page", String(batchSize));
    const result = await client.request(url.pathname + "?" + query, { signal });
    const parsed = transactionPage.safeParse(result.data);
    if (!parsed.success) throw new GatewayError(502, "A API retornou uma página de vendas incompleta.", undefined, result.requestId);
    const data = parsed.data;
    if (data.actual_page !== page || (expected !== undefined && expected !== data.qty_elements) || data.data.length !== Math.min(batchSize, Math.max(0, data.qty_elements - (page - 1) * batchSize)) || (data.qty_elements > 0 && data.num_pages !== Math.ceil(data.qty_elements / batchSize))) throw new GatewayError(502, "A lista de vendas mudou ou está incompleta. Consulte novamente; nenhum resultado parcial foi exibido.", undefined, result.requestId);
    return { document, page, offset: 0, data: data.data, total: data.qty_elements };
  }
  const streams = await mapLimited(documents, document => read(document, 1));
  const qty_elements = streams.reduce((sum, stream) => sum + stream.total, 0);
  const num_pages = Math.ceil(qty_elements / perPage), requested = Number(url.searchParams.get("page"));
  const actual_page = requested <= num_pages ? requested : 1;
  const start = (actual_page - 1) * perPage, end = Math.min(start + perPage, qty_elements);
  const data: Json[] = [], seen = new Set<string>();
  // Merge paged streams: only load more from an EC when its current page is consumed.
  // This keeps global pagination correct without downloading every sale in the period.
  for (let rank = 0; rank < end; rank++) {
    signal.throwIfAborted();
    let selected = -1;
    for (let i = 0; i < streams.length; i++) {
      const candidate = streams[i].data[streams[i].offset];
      if (candidate && (selected < 0 || transactionOrder(candidate) > transactionOrder(streams[selected].data[streams[selected].offset]))) selected = i;
    }
    if (selected < 0) throw new GatewayError(502, "A lista de vendas está incompleta. Nenhum resultado parcial foi exibido.");
    const stream = streams[selected], row = stream.data[stream.offset++];
    if (seen.has(row.transaction)) throw new GatewayError(502, "A lista de vendas mudou durante a consulta. Consulte novamente.");
    seen.add(row.transaction);
    if (rank >= start) data.push(row);
    if (rank + 1 < end && stream.offset === stream.data.length && stream.page * batchSize < stream.total) streams[selected] = await read(stream.document, stream.page + 1, stream.total);
  }
  return { data, actual_page, num_pages, qty_elements, per_page: perPage };
}

export async function requestPartnerSales(client: Client, name: string, path: string) {
  const url = new URL(path, "https://api.alliancepay.app");
  const unfiltered = (name === "transactions" || name === "summary") && !url.searchParams.has("cnpj");
  const dashboard = name === "dashboard" && !url.searchParams.has("merchant_id");
  if (!unfiltered && !dashboard) return client.request(path);
  const signal = AbortSignal.timeout(28000);
  try {
    // PARTNER_API lists only the credential owner's ECs. Never query global sales
    // or rely on the TENANT_ADMIN-only partner_id shortcut with API credentials.
    const { merchants, requestId } = await loadMerchants(client, signal);
    if (unfiltered) {
      const documents = [...new Set(merchants.map(merchant => {
        const document = (merchant.document_number || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        if (!/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(document)) throw new GatewayError(502, "Um estabelecimento não possui documento válido para consultar suas vendas. Nenhum total parcial será exibido.");
        return document;
      }))].sort();
      const data = name === "transactions" ? await listTransactions(client, url, documents, signal) : combineSummaries(await mapLimited(documents, async document => {
        const query = new URLSearchParams(url.searchParams); query.set("cnpj", document);
        const result = await client.request(url.pathname + "?" + query, { signal });
        const parsed = summarySchema.safeParse(result.data);
        if (!parsed.success) throw new GatewayError(502, "Um estabelecimento retornou resumo incompleto. Nenhum total parcial será exibido.", undefined, result.requestId);
        return parsed.data;
      }), url.searchParams);
      return { status: 200, requestId, data };
    }
    const dashboards = await mapLimited(merchants, async merchant => {
      const result = await client.request(`/acquiring/fiserv-transactions/merchant-dashboard?merchant_id=${merchant.id}`, { signal });
      const parsed = dashboardSchema.safeParse(result.data);
      if (!parsed.success) throw new GatewayError(502, "Um estabelecimento retornou dados incompletos. Nenhum total parcial será exibido.", undefined, result.requestId);
      return parsed.data;
    });
    return { status: 200, requestId, data: combineDashboards(dashboards) };
  } catch (error) {
    if (signal.aborted) throw new GatewayError(504, "A consulta de todos os estabelecimentos excedeu o tempo disponível. Nenhum total parcial foi exibido. Tente novamente ou selecione um estabelecimento.");
    throw error;
  }
}
