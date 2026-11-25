import { z } from "zod";
import { GatewayError, type createGatewayClient } from "./gateway";
import { requestPartnerSales } from "./partner-sales";

const scopePage = z.object({
  data: z.array(z.object({ commercial_relationships: z.array(z.object({ partner_id: z.uuid().nullable(), active: z.boolean() })) })),
  actual_page: z.number().int().nonnegative(), qty_elements: z.number().int().nonnegative(),
});

export async function requestPartnerReport(client: ReturnType<typeof createGatewayClient>, name: string, path: string) {
  const url = new URL(path, "https://api.alliancepay.app");
  if (!["receivables", "liquidations"].includes(name) || url.searchParams.has("merchant_id")) return requestPartnerSales(client, name, path);

  const signal = AbortSignal.timeout(28000);
  try {
    // PARTNER_API restricts both merchants AND relationships to the OAuth owner.
    // Resolve on this client on every query; never trust a browser-supplied ID or
    // share a cached partner across credentials/environments.
    const response = await client.request("/acquiring/onboarding/acquirer-registrations/?page=1&per_page=1", { signal });
    const parsed = scopePage.safeParse(response.data);
    if (!parsed.success) throw new GatewayError(502, "A API não informou o parceiro da integração para consultar todos os estabelecimentos.", undefined, response.requestId);
    const { data, actual_page, qty_elements } = parsed.data;
    if (!data.length && qty_elements === 0) return {
      status: 200, requestId: response.requestId,
      data: name === "receivables" ? { month: url.searchParams.get("month"), results: [] } : { data: [], totals: { payment_amount: "0.00" }, actual_page: 1, num_pages: 1, qty_elements: 0, per_page: Number(url.searchParams.get("per_page")) },
    };
    const partners = new Set(data.flatMap(ec => ec.commercial_relationships.filter(r => r.active && r.partner_id).map(r => r.partner_id!)));
    if (actual_page !== 1 || qty_elements < data.length || !data.length || partners.size !== 1) throw new GatewayError(502, "Não foi possível identificar com segurança o parceiro da credencial. A consulta de todos não foi realizada.", undefined, response.requestId);
    url.searchParams.set("partner_id", [...partners][0]);
    return await client.request(url.pathname + url.search, { signal });
  } catch (error) {
    if (signal.aborted) throw new GatewayError(504, "A consulta de todos os estabelecimentos excedeu o tempo disponível. Tente novamente.");
    throw error;
  }
}
