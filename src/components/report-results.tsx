"use client";
import { OperationalList, ReceivablesCalendar } from "./operational-results";
import { brl } from "@/lib/browser";
import type { Json } from "@/lib/types";
import type { ReportName } from "@/lib/report-catalog";
import { Button, Empty, Status } from "./ui";
const labels: Record<string, string> = {
  paid: "Valor pago", kind: "Meio", open: "A receber", mdr_amount: "MDR", anticipation_fee_amount: "Taxa de antecipação", merchant_net_amount: "Líquido do lojista", paid_amount: "Valor pago",
  document_type: "Tipo de documento", document_number: "CPF / CNPJ", person_name: "Nome da pessoa", commercial_relationships: "Vínculos comerciais",
  id: "ID", description: "Descrição", amount: "Valor", amount_due_now: "Valor a pagar agora", currency: "Moeda", count: "Quantidade", total: "Total", total_amount: "Valor total", total_count: "Quantidade total", gross_amount: "Valor bruto", net_amount: "Valor líquido", fee_amount: "Taxas", status: "Status", billing_type: "Tipo", payment_methods: "Meios de pagamento", created_at: "Criado em", updated_at: "Atualizado em", expires_at: "Expira em", approved_at: "Aprovado em", payment_date: "Data do pagamento", date: "Data", transaction_date: "Data da venda", transaction_timestamp: "Horário da venda", nsu_host: "NSU host", cod_autorizacao: "Autorização", valor: "Valor", estado: "Estado", produto: "Produto", num_parcelas: "Parcelas", installments: "Parcelas", sales_channel: "Canal", payment_amount: "Valor do repasse", payment_institution_name: "Instituição", payment_institution_ispb: "ISPB", payment_scheme_name: "Arranjo", settlement_request_status: "Status da liquidação", reference_date: "Data de referência", nu_liquid: "Liquidação", legal_name: "Razão social", trading_name: "Nome fantasia", merchant_id: "Merchant ID", partner_id: "Partner ID", external_reference: "Referência externa", today_sales: "Vendas de hoje", today_quantity: "Quantidade de hoje", last_7_days: "Últimos 7 dias", last_30_days: "Últimos 30 dias", last_360_days: "Últimos 360 dias", mdr_last_7_days: "MDR · 7 dias", mdr_last_30_days: "MDR · 30 dias", mdr_last_360_days: "MDR · 360 dias", brand: "Bandeira", product: "Produto", payment_type: "Meio de pagamento", name: "Nome", cnpj: "CNPJ", type: "Tipo", event_type: "Evento", occurred_at: "Ocorrido em", reversal_available: "Estorno disponível", reversals: "Estornos", payment_method: "Meio de pagamento", payment_link_id: "ID do link", history_id: "ID do repasse", filters: "Filtros", merchant: "Estabelecimento", recurrence: "Recorrência", kpis: "Indicadores", totals: "Totais", card_batches: "Lotes de cartão", pix_batches: "Lotes Pix", checkout_url: "Endereço do checkout", has_transactions: "Possui transações",
};
export const fieldLabel = (key: string) => labels[key] || key.replaceAll("_", " ");
const moneyKeys = /^(amount|amount_due_now|valor|payment_amount|total_amount|gross_amount|net_amount|fee_amount|total_gross|total_net|mdr_amount|anticipation_fee_amount|merchant_net_amount|paid_amount|paid|open)$/;
export function Value({ name, value }: { name: string; value: any }) {
  if (value === null || value === undefined) return <>—</>;
  if (typeof value === "object") {
    if (!Array.isArray(value) && Object.values(value).every(v => v === null || typeof v !== "object")) return <span className="report-inline">{Object.entries(value).map(([k, v]) => <span key={k}><span className="muted">{fieldLabel(k)}: </span><Value name={k} value={v} /></span>)}</span>;
    return <details><summary>Ver dados</summary><pre className="json-view">{JSON.stringify(value, null, 2)}</pre></details>;
  }
  if (name === "status") return <Status value={String(value)} />;
  if (typeof value === "boolean") return <>{value ? "Sim" : "Não"}</>;
  if (moneyKeys.test(name) && value !== "" && Number.isFinite(Number(value))) return <span className="money">{brl(value)}</span>;
  if (value === "ONE_TIME") return <>Avulsa</>;
  if (value === "RECURRING") return <>Recorrente</>;
  return <>{String(value)}</>;
}
export function DataTable({ rows, title, action, fields }: { rows: Json[]; title: string; action?: (row: Json) => React.ReactNode; fields?: string[] }) {
  if (!rows.length) return <p className="subtle-note">Nenhum registro em {title.toLowerCase()}.</p>;
  const available = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const preferred = fields?.filter(k => available.includes(k));
  const columns = preferred?.length ? preferred : available;
  return <div className="table-scroll report-table" tabIndex={0} role="region" aria-label={title}><table><caption className="sr-only">{title}</caption><thead><tr>{action && <th scope="col">Consulta</th>}{columns.map(k => <th key={k} scope="col">{fieldLabel(k)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id || i}>{action && <td>{action(row)}</td>}{columns.map(k => <td key={k}><Value name={k} value={row[k]} /></td>)}</tr>)}</tbody></table></div>;
}
export function Details({ data }: { data: Json }) {
  return <dl className="detail-list">{Object.entries(data).map(([k, v]) => <div key={k}><dt>{fieldLabel(k)}</dt><dd><Value name={k} value={v} /></dd></div>)}</dl>;
}
function Series({ rows }: { rows: Json[] }) {
  // Only chart the documented date/amount series; unknown shapes remain in the table.
  const points = rows.filter(r => typeof r.date === "string" && r.amount != null && Number.isFinite(Number(r.amount)));
  if (!points.length) return null;
  const max = Math.max(...points.map(r => Math.abs(Number(r.amount))), 1);
  return <figure className="report-chart"><figcaption>Volume diário de vendas</figcaption><div className="report-bars">{points.map((r, i) => <div key={`${r.date}-${i}`}><span>{r.date}</span><meter min={0} max={max} value={Math.max(0, Number(r.amount))} aria-label={`Volume em ${r.date}`}/><strong>{brl(r.amount)}</strong></div>)}</div></figure>;
}
export function ReportResults({ name, data, navigate, changeMonth }: { name: ReportName; data: Json; navigate: (name: ReportName, fields: Record<string, string>) => void; changeMonth?: (month: string) => void }) {
  if (name === "merchants" || name === "transactions" || name === "liquidations") return <OperationalList key={name + JSON.stringify(data)} name={name} rows={data.data || []} />;
  if (name === "dashboard") return <>
    <h2>{data.merchant?.name || "Vendas do estabelecimento"}</h2><p className="subtle-note">{data.merchant?.cnpj}{data.filters?.today ? ` · Referência: ${data.filters.today}` : ""}</p>
    {data.has_transactions === false && <p className="notice">A API não encontrou transações para este estabelecimento.</p>}
    <Details data={data.kpis || {}} /><Series rows={data.daily_volume || []} />
    <h3>Volume diário</h3><DataTable title="Volume diário" rows={data.daily_volume || []} />
    <h3>Distribuição por bandeira</h3><DataTable title="Distribuição por bandeira" rows={data.brand_distribution || []} />
    <h3>Meios de pagamento</h3><DataTable title="Meios de pagamento" rows={data.payment_type_distribution || []} />
    <h3>Transações recentes</h3><DataTable title="Transações recentes" rows={data.recent_transactions || []} />
  </>;
  if (name === "summary") return <><h2>Totais do período</h2><Details data={data.totals || {}} />{[["by_product", "Por produto"], ["by_status", "Por status"], ["by_date", "Por data"]].map(([key, title]) => <section key={key}><h3>{title}</h3><DataTable title={title} rows={data[key] || []} /></section>)}</>;
  if (name === "receivables") return <ReceivablesCalendar key={data.month} data={data} changeMonth={changeMonth} />;
  if (name === "link" || name === "payment") return <><h2>{name === "link" ? data.description || "Detalhes do link" : "Detalhes do pagamento"}</h2><Details data={data} />{name === "link" && data.id && <div className="action-row"><Button variant="secondary" onClick={() => navigate("payments", { payment_link_id: data.id })}>Consultar pagamentos</Button><Button variant="secondary" onClick={() => navigate("history", { payment_link_id: data.id })}>Consultar histórico</Button></div>}</>;
  const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : [];
  const columns: Record<string, string[]> = { transactions: ["transaction_date", "transaction_timestamp", "nsu_host", "valor", "estado", "produto", "num_parcelas", "sales_channel"], liquidations: ["payment_date", "legal_name", "payment_amount", "product", "payment_institution_name", "settlement_request_status"], links: ["description", "id", "billing_type", "amount", "status", "created_at"], payments: ["id", "status", "amount", "installments", "created_at"] };
  return rows.length ? <DataTable title={name === "links" ? "Links" : name === "payments" ? "Pagamentos" : "Histórico"} rows={rows} fields={columns[name]} action={name === "links" ? row => row.id && <Button variant="secondary" onClick={() => navigate("link", { payment_link_id: row.id })}>Consultar link</Button> : name === "payments" ? row => row.id && <Button variant="secondary" onClick={() => navigate("payment", { payment_id: row.id })}>Consultar pagamento</Button> : undefined} /> : <Empty title="Nenhum resultado para os filtros">A consulta foi concluída. Ajuste os filtros para buscar outros registros.</Empty>;
}
