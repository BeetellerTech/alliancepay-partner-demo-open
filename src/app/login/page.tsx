"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, describeError } from "@/lib/browser";
import { Button, ErrorNotice } from "@/components/ui";
import { BrandLogo, VisualThemeSelector } from "@/components/visual-theme";
export default function Login() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return <main className="login-page"><section className="login-story"><BrandLogo large /><div><h1>Uma integração.<br /> Todo o caminho<br /> do pagamento.</h1><p>Crie uma cobrança, experimente o checkout e acompanhe cada etapa na API do ambiente selecionado.</p><div className="login-capabilities"><span>Cartão + 3DS</span><span>Pix</span><span>Recorrência</span></div></div><p className="login-foot">Demo do parceiro · BeetellerTech</p></section><section className="login-form-area"><VisualThemeSelector /><form method="post" action="/api/login" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const code = String(new FormData(form).get("code")); setBusy(true); setError(""); try { await api("login", { code }); form.reset(); router.push("/"); router.refresh(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } }}>
    <div className="login-lock"><LockKeyhole size={25} /></div><h2>Entre na demonstração</h2><p>Use o código de acesso compartilhado pela equipe para iniciar sua sessão.</p><label htmlFor="code">Código de acesso</label><input disabled={!ready} id="code" name="code" type="password" autoComplete="current-password" required maxLength={256} placeholder="Digite seu código" /><ErrorNotice message={error} /><Button type="submit" busy={busy} disabled={!ready}>Acessar demo<ArrowRight size={18} /></Button><div className="login-disclaimer"><ShieldCheck size={20} /><p>HML utiliza dados de teste. PROD realiza operações reais. Confira o contexto da sessão.</p></div></form></section></main>;
}
