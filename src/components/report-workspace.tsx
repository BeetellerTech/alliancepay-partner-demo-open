"use client";
import { MerchantSelect } from "./merchant-select";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, describeError } from "@/lib/browser";
import { reportGroups, reports, type ReportName } from "@/lib/report-catalog";
import type { Json } from "@/lib/types";
import { useConnection } from "./connection-provider";
import { ReportResults } from "./report-results";
import { Button, ErrorNotice, statusLabel } from "./ui";
function defaults(name: ReportName) {
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return Object.fromEntries(reports[name].fields.map(f => [f.name, f.initial || (f.type === "month" ? today.slice(0, 7) : f.type === "date" && f.required ? f.name.endsWith("date") && ["firstdate", "start_date"].includes(f.name) ? today.slice(0, 8) + "01" : today : "")]));
}
export function ReportWorkspace({ group }: { group: keyof typeof reportGroups }) {
  const { config } = useConnection(); const section = reportGroups[group];
  const [name, setName] = useState<ReportName>(section.operations[0]);
  const [fields, setFields] = useState<Record<string, string>>(() => defaults(section.operations[0]));
  const [result, setResult] = useState<Json | null>(null), [submitted, setSubmitted] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { generation.current++; }, []);
  const definition = reports[name];
  function choose(next: ReportName, values: Record<string, string> = {}) {
    generation.current++; setName(next); setFields({ ...defaults(next), ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => reports[next].fields.some(f => f.name === k && (!f.options || f.options.includes(v))))), ...values });
    setResult(null); setSubmitted(null); setError(""); setBusy(false);
  }
  async function consult(values: Record<string, string>, paging = false) {
    const current = ++generation.current; setBusy(true); setError(""); setResult(null);
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
    try {
      const response = await api(`reports/${name}?${new URLSearchParams(clean)}`);
      if (current !== generation.current) return;
      if (response.contextId !== config.contextId) throw new Error("O contexto mudou. Atualize a página antes de consultar.");
      setResult(response); setSubmitted(clean);
      if (paging) heading.current?.focus();
    } catch (e) { if (current === generation.current) setError(describeError(e)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => {
    if (group === "estabelecimentos" && config.contextId) {
      void consult(defaults("merchants"));
    }
  }, [group, config.contextId]);
  const pageSize = Number(result?.data?.per_page || submitted?.per_page || submitted?.limit || 50), pageNumber = Number(result?.data?.actual_page || submitted?.page || 1), offset = Number(submitted?.offset || 0);
  const rows = result?.data?.data || result?.data?.results || [];
  const total = result?.data?.qty_elements ?? result?.data?.count;
  const more = definition.paging === "page" ? result?.data?.num_pages != null ? pageNumber < result.data.num_pages : rows.length >= pageSize : total != null ? offset + rows.length < total : rows.length >= pageSize;
  function paginate(direction: number) { if (submitted) void consult({ ...submitted, ...(definition.paging === "page" ? { page: String(pageNumber + direction) } : { offset: String(Math.max(0, offset + direction * pageSize)) }) }, true); }
  const dateFields = definition.fields.filter(f => f.type === "date" && f.required);
  function period(days: number) {
    const end = new Date(), start = new Date(end); start.setDate(end.getDate() - days + 1);
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    setFields({ ...fields, [dateFields[0].name]: format(start), [dateFields[1].name]: format(end) });
  }
  return <><nav className="breadcrumbs" aria-label="Caminho da página"><Link href="/">Cobranças</Link><span>/</span><span>{section.title}</span></nav><div className="page-heading"><div><h1>{section.title}</h1><p>{section.intro}</p></div>{group === "links" && <Link className="button primary" href="/nova">Nova cobrança</Link>}</div>
    {section.operations.length > 1 && <nav className="tabs report-tabs" aria-label="Consultas disponíveis">{section.operations.map(op => <button id={op === name ? "report-operation" : undefined} type="button" key={op} disabled={!config.configured || busy} aria-current={op === name ? "page" : undefined} className={op === name ? "active" : ""} onClick={() => choose(op)}>{reports[op].title}</button>)}</nav>}
    <form className="panel form-panel report-filters" onSubmit={e => { e.preventDefault(); void consult(fields); }}><h2 className="sr-only">Filtros</h2>{name === "liquidations" && <p className="subtle-note">Consulte até 31 dias por vez.</p>}
      <fieldset disabled={busy || !config.configured}><legend className="sr-only">Filtros da consulta</legend>{dateFields.length === 2 && <div className="period-presets" aria-label="Períodos rápidos">{[[1, "Hoje"], [7, "Últimos 7 dias"], [30, "Últimos 30 dias"]].map(([days, label]) => <Button key={days} type="button" variant="quiet" onClick={() => period(Number(days))}>{label}</Button>)}</div>}<div className="report-fields">{definition.fields.map(f => <div key={f.name}>{f.merchant ? <MerchantSelect id={`filter-${f.name}`} value={fields[f.name] || ""} valueKind={f.merchant} onChange={value => setFields({ ...fields, [f.name]: value })} /> : <><label htmlFor={`filter-${f.name}`}>{f.label}{f.required ? " *" : ""}</label>{f.options ? <select id={`filter-${f.name}`} value={fields[f.name] || ""} onChange={e => setFields({ ...fields, [f.name]: e.target.value })}>{!f.initial && <option value="">Todos</option>}{f.options.map(v => <option key={v} value={v}>{v === "ONE_TIME" ? "Avulsa" : v === "RECURRING" ? "Recorrente" : name === "merchants" && v === "ACTIVE" ? "Ativo" : statusLabel(v)}</option>)}</select> : <input id={`filter-${f.name}`} type={f.type || "text"} required={f.required} value={fields[f.name] || ""} min={f.type === "number" ? 1 : undefined} max={f.max} maxLength={255} onChange={e => setFields({ ...fields, [f.name]: e.target.value })} aria-describedby={f.hint ? `hint-${f.name}` : undefined} />}{f.hint && <small id={`hint-${f.name}`} className="subtle-note">{f.hint}</small>}</>}</div>)}</div><div className="form-actions"><div className="action-row"><Button variant="quiet" type="button" onClick={() => { setFields(defaults(name)); setResult(null); setSubmitted(null); setError(""); }}>Limpar filtros</Button><Button type="submit" busy={busy}>Consultar</Button></div></div></fieldset>
    </form><ErrorNotice message={error} />
    <section className="panel report-output" aria-busy={busy} aria-label="Resultado da consulta"><h2 ref={heading} tabIndex={-1}>{name === "merchants" ? "Estabelecimentos cadastrados" : name === "transactions" ? "Transações do período" : name === "liquidations" ? "Transferências" : definition.title}</h2>
      {busy ? <p role="status" className="loading">Consultando a API do contexto atual…</p> : !result ? <p className="subtle-note">Informe os filtros e selecione Consultar. Os dados serão obtidos diretamente de {config.environment || "seu ambiente"}.</p> : <>
        <p className="subtle-note">{typeof total === "number" ? `${total} registro(s) · ` : ""}{config.environment}{submitted && dateFields.length === 2 ? ` · ${submitted[dateFields[0].name]?.split("-").reverse().join("/")} a ${submitted[dateFields[1].name]?.split("-").reverse().join("/")}` : ""}</p>
        <ReportResults name={name} data={result.data} changeMonth={month => { const next = { ...(submitted || fields), month }; setFields(next); void consult(next); }} navigate={(next, values) => { choose(next, { ...(next === "payment" ? { payment_link_id: submitted?.payment_link_id || "" } : {}), ...values }); document.getElementById("report-operation")?.focus(); window.scrollTo({ top: 0, behavior: "instant" }); }} />
        {definition.paging && submitted && <nav className="report-pagination" aria-label="Paginação dos resultados"><Button variant="secondary" disabled={busy || (definition.paging === "page" ? pageNumber <= 1 : offset <= 0)} onClick={() => paginate(-1)}>Anterior</Button><span>{definition.paging === "page" ? `Página ${pageNumber}${result.data.num_pages ? ` de ${result.data.num_pages}` : ""}` : `${rows.length ? offset + 1 : 0}–${offset + rows.length}${total != null ? ` de ${total}` : ""}`}</span><Button variant="secondary" disabled={busy || !more} onClick={() => paginate(1)}>Próxima</Button></nav>}
        <details className="report-raw"><summary>Ver resposta técnica (dados sensíveis omitidos)</summary><pre className="json-view">{JSON.stringify(result.data, null, 2)}</pre></details>
      </>}
    </section></>;
}
