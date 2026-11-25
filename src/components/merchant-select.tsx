"use client";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/browser";
import type { Json } from "@/lib/types";
import { useConnection } from "./connection-provider";
import { Button, ErrorNotice } from "./ui";

export function MerchantSelect({ id, value, onChange, valueKind = "id", required = false, disabled = false }: {
  id: string; value: string; onChange: (value: string) => void;
  valueKind?: "id" | "cnpj"; required?: boolean; disabled?: boolean;
}) {
  const { config } = useConnection();
  const [merchants, setMerchants] = useState<Json[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setMerchants([]); setError("");
    if (!config.contextId) return;
    setLoading(true);
    async function load() {
      const found = new Map<string, Json>();
      for (let page = 1; ; page++) {
        const response = await api(`reports/merchants?status=ACTIVE&per_page=500&page=${page}`);
        if (!current) return;
        if (response.contextId !== config.contextId) throw new Error("O contexto mudou. Atualize a página para carregar os estabelecimentos.");
        for (const merchant of response.data.data) if (merchant.status === "ACTIVE") found.set(merchant.id, merchant);
        if (page >= response.data.num_pages) break;
        if (response.data.actual_page !== page || page >= 1000) throw new Error("Não foi possível carregar toda a lista de estabelecimentos. Tente novamente.");
      }
      if (current) setMerchants(Array.from(found.values()));
    }
    void load().catch(e => { if (current) setError(describeError(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [config.contextId, retry]);
  const hint = `${id}-hint`;
  return <>
    <label htmlFor={id}>Estabelecimento{required ? " *" : ""}</label>
    <select id={id} name={id} value={value} required={required} disabled={disabled || !config.configured || loading} aria-describedby={hint} aria-busy={loading} onChange={e => onChange(e.target.value)}>
      <option value="">{required ? "Selecione um estabelecimento" : "Todos"}</option>
      {merchants.map(merchant => {
        const document = String(merchant.document_number || "").replace(/\D/g, "");
        const usable = valueKind !== "cnpj" || (merchant.document_type === "CNPJ" && /^\d{14}$/.test(document));
        return <option key={merchant.id} value={valueKind === "cnpj" && usable ? document : merchant.id} disabled={!usable}>
          {merchant.trading_name || merchant.legal_name || merchant.person_name || merchant.id}{merchant.document_number ? ` — ${merchant.document_number}` : ""}{!usable ? " (sem CNPJ)" : ""}
        </option>;
      })}
    </select>
    <small id={hint} className="subtle-note">{loading ? "Carregando estabelecimentos ativos…" : error ? "Não foi possível carregar os ECs ativos." : !merchants.length ? "Nenhum estabelecimento ativo encontrado." : required ? "Escolha o EC desta cobrança." : "Todos consulta sem filtro de estabelecimento."}{valueKind === "cnpj" && " Esta consulta usa o CNPJ do EC selecionado."}</small>
    <ErrorNotice message={error} />
    {error && <Button type="button" variant="secondary" disabled={disabled} onClick={() => setRetry(v => v + 1)}>Tentar carregar ECs novamente</Button>}
  </>;
}
