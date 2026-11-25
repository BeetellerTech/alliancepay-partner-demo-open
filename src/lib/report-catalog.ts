export type ReportName = "merchants" | "dashboard" | "transactions" | "summary" | "receivables" | "liquidations" | "links" | "link" | "payments" | "payment" | "history";
export type ReportField = { name: string; label: string; type?: "date" | "month" | "number"; required?: boolean; options?: string[]; initial?: string; hint?: string; max?: number; merchant?: "id" | "cnpj" };
const merchant: ReportField = { name: "merchant_id", label: "Estabelecimento", merchant: "id" };
const cnpj: ReportField = { name: "cnpj", label: "Estabelecimento", merchant: "cnpj" };
const dates = (start: string, end: string): ReportField[] => [{ name: start, label: "Data inicial", type: "date", required: true }, { name: end, label: "Data final", type: "date", required: true }];
const link: ReportField = { name: "payment_link_id", label: "ID do link", required: true };
const size = (name: string, max: number): ReportField => ({ name, label: "Itens por página", type: "number", initial: "50", max });
export const reports: Record<ReportName, { title: string; description: string; fields: ReportField[]; paging?: "page" | "offset" }> = {
  merchants: { title: "ECs do parceiro", description: "Estabelecimentos com vínculo comercial ativo com o parceiro da credencial. Sem filtros, inclui ECs pendentes, ativos e inativos.", paging: "page", fields: [{ name: "search", label: "Nome ou documento", hint: "Busque por razão social, nome fantasia ou documento completo." }, { ...merchant, name: "id" }, { name: "document_type", label: "Tipo de documento", options: ["CPF", "CNPJ"] }, { name: "status", label: "Status", options: ["PENDING", "ACTIVE", "INACTIVE"] }, size("per_page", 500)] },
  dashboard: { title: "Dashboard de vendas", description: "Indicadores e evolução das vendas do estabelecimento.", fields: [merchant] },
  transactions: { title: "Transações", description: "Consulte vendas por período, CNPJ e NSU.", paging: "page", fields: [cnpj, ...dates("firstdate", "lastdate"), { name: "nsu_host", label: "NSU host" }, size("per_page", 500)] },
  summary: { title: "Resumo de vendas", description: "Totais e agrupamentos por produto, status e data.", fields: [cnpj, ...dates("firstdate", "lastdate")] },
  receivables: { title: "Agenda de recebíveis", description: "Lotes de cartão e Pix agrupados por data de pagamento.", fields: [{ name: "month", label: "Mês de pagamento", type: "month", required: true }, merchant] },
  liquidations: { title: "Repasses liquidados", description: "Consulte um intervalo de até 31 dias.", paging: "page", fields: [...dates("start_date", "end_date"), merchant, size("per_page", 200)] },
  links: { title: "Links do parceiro", description: "Links da API, incluindo os criados fora desta demo. Os resultados respeitam o acesso da credencial atual.", paging: "offset", fields: [{ ...merchant, name: "acquirer_registration_id" }, { name: "billing_type", label: "Tipo de cobrança", options: ["ONE_TIME", "RECURRING"] }, { name: "status", label: "Status", options: ["ACTIVE", "CARD_REGISTERED", "CANCELED", "PAID", "EXPIRED"] }, { name: "external_reference", label: "Referência externa" }, { name: "created_from", label: "Criado a partir de", type: "date" }, { name: "created_to", label: "Criado até", type: "date" }, size("limit", 500)] },
  link: { title: "Detalhes do link", description: "Consulte um link pelo UUID e acompanhe seus pagamentos e histórico.", fields: [link] },
  payments: { title: "Pagamentos do link", description: "Pagamentos vinculados ao link, com filtro de status.", paging: "offset", fields: [link, { name: "status", label: "Status", options: ["CREATED", "AUTHENTICATING", "PROCESSING", "PENDING_CONFIRMATION", "APPROVED", "DECLINED", "FAILED", "EXPIRED"] }, size("limit", 500)] },
  payment: { title: "Detalhes do pagamento", description: "Acompanhe um pagamento, inclusive o retornado por um reprocessamento.", fields: [link, { name: "payment_id", label: "ID do pagamento", required: true }] },
  history: { title: "Histórico do link", description: "Eventos de pagamentos, autenticações, estornos e recorrência.", paging: "offset", fields: [link, size("limit", 500)] },
};
export const reportGroups: Record<string, { title: string; intro: string; operations: ReportName[] }> = {
  estabelecimentos: { title: "Estabelecimentos", intro: "Encontre os ECs do parceiro e seus identificadores para as demais consultas.", operations: ["merchants"] },
  vendas: { title: "Vendas", intro: "Acompanhe transações, taxas e o valor líquido das suas vendas.", operations: ["transactions", "summary", "dashboard"] },
  recebiveis: { title: "Recebíveis", intro: "Consulte o calendário de recebimentos e os lotes de cada dia.", operations: ["receivables"] },
  repasses: { title: "Repasses", intro: "Acompanhe as transferências, a instituição de destino e a liquidação.", operations: ["liquidations"] },
  links: { title: "Links do parceiro", intro: "Consulte links e pagamentos diretamente na API do contexto atual.", operations: ["links", "link", "payments", "payment", "history"] },
};
