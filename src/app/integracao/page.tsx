"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, describeError } from "@/lib/browser";
import { useConnection } from "@/components/connection-provider";
import { Button, ErrorNotice } from "@/components/ui";
export default function Integration() {
  const { config, refresh } = useConnection(); const router = useRouter();
  const [ready, setReady] = useState(false), [environment, setEnvironment] = useState("HML"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState("");
  useEffect(() => { setReady(true); }, []);
  return <><div className="page-heading"><div><h1>Contexto da integração</h1><p>Escolha a conexão usada em toda a sua sessão.</p></div></div><div className="integration-layout"><section className="panel manage-panel">
    <h2>Conexão atual</h2><dl className="detail-list"><div><dt>Ambiente</dt><dd>{config.environment || "Não conectado"}</dd></div><div><dt>Endpoint</dt><dd className="code-value">{config.baseUrl || "—"}</dd></div></dl>
    <form method="post" autoComplete="off" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget, data = new FormData(form); setBusy(true); setError(""); setResult(""); try { await api("context", { environment, client_id: String(data.get("client_id")), client_secret: String(data.get("client_secret")) }); form.reset(); await refresh(); router.push("/estabelecimentos"); } catch (e) { setError(describeError(e)); } finally { form.reset(); setBusy(false); } }}>
      <fieldset disabled={!ready || busy}><legend>Definir contexto</legend><label htmlFor="environment">Ambiente</label><select id="environment" value={environment} onChange={e => setEnvironment(e.target.value)}><option value="HML">HML — Homologação</option><option value="PROD">PROD — Produção, operações reais</option></select>
      {environment === "PROD" && <p className="notice">Neste contexto, cobranças e pagamentos são operações reais de produção.</p>}
      <label htmlFor="client_id">Client ID</label><input id="client_id" name="client_id" required maxLength={512} autoComplete="off" />
      <label htmlFor="client_secret">Client secret</label><input id="client_secret" name="client_secret" type="password" required maxLength={2048} autoComplete="off" />
      <p className="subtle-note">Após conectar, os ECs serão listados pela API na tela Estabelecimentos. Os filtros e a criação de cobranças terão sua própria seleção de EC, sem digitar IDs.</p>
      <p className="subtle-note">Credenciais somente na memória do servidor, por até 24 horas. Ao sair, desconectar ou reiniciar a aplicação, informe-as novamente. Trocar o contexto inicia uma nova lista; cobranças anteriores não serão operadas pela nova conexão.</p>
      <Button type="submit" busy={busy}>Aplicar contexto à sessão</Button></fieldset>
    </form><ErrorNotice message={error} />
    {config.configured && <div className="form-actions"><Button variant="secondary" busy={busy} onClick={async () => { setBusy(true); setError(""); try { const data = await api("reports/merchants?per_page=1"); setResult(JSON.stringify(data, null, 2)); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } }}>Verificar conexão</Button><Button variant="quiet" onClick={async () => { await api("context/clear", {}); setResult(""); await refresh(); }}>Desconectar</Button></div>}
    {result && <pre className="json-view">{result}</pre>}
  </section><section className="integration-notes"><h2>Um contexto por sessão</h2><p>Ambiente e parceiro acompanham sua navegação. Escolha o estabelecimento em cada consulta ou cobrança. Outros usuários mantêm suas próprias conexões.</p><p>Client ID, client secret e token OAuth não são gravados em banco, arquivos, cookies ou armazenamento do navegador. O cookie contém apenas a identificação assinada da sessão.</p><p>Registros de cobrança continuam persistidos com contexto e ambiente. A consulta automática acompanha tentativas enquanto a tela está aberta. Após perder o contexto, não há reconciliação com credenciais antigas.</p></section></div></>;
}
