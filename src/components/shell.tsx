"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Code2, Link2, LogOut, ShieldCheck, ChartNoAxesCombined, CalendarDays, ArrowLeftRight, Search, Store } from "lucide-react";
import { api } from "@/lib/browser";
import { useConnection } from "./connection-provider";
import { BrandLogo, VisualThemeSelector } from "./visual-theme";
export function Shell({ children }: { children: React.ReactNode }) {
  const { config } = useConnection();
  const path = usePathname(), router = useRouter();
  async function logout() { await api("logout", {}); router.push("/login"); router.refresh(); }
  if (path === "/login") return children;
  return <div className="app-shell"><a className="skip" href="#main">Ir para o conteúdo</a><aside className="sidebar">
    <Link href="/" className="brand"><BrandLogo /></Link>
    <div className="workspace-name">Demo de pagamentos<span>Workspace do parceiro</span></div>
    <nav aria-label="Navegação principal"><Link className={path === "/" || path === "/nova" || path.startsWith("/cobrancas/") ? "active" : ""} href="/"><Link2 size={19} />Cobranças</Link><Link className={path === "/estabelecimentos" ? "active" : ""} href="/estabelecimentos"><Store size={19} />Estabelecimentos</Link><Link className={path === "/vendas" ? "active" : ""} href="/vendas"><ChartNoAxesCombined size={19} />Vendas</Link><Link className={path === "/recebiveis" ? "active" : ""} href="/recebiveis"><CalendarDays size={19} />Recebíveis</Link><Link className={path === "/repasses" ? "active" : ""} href="/repasses"><ArrowLeftRight size={19} />Repasses</Link><Link className={path === "/links" ? "active" : ""} href="/links"><Search size={19} />Links do parceiro</Link><Link className={path === "/integracao" ? "active" : ""} href="/integracao"><Code2 size={19} />Integração</Link></nav>
    <div className="sidebar-bottom"><button onClick={logout}><LogOut size={17} />Sair da demo</button></div>
  </aside><div className="main-shell"><header className="topbar"><span className="environment" data-environment={config.environment}><span />{config.environment || "Sem contexto"}</span><VisualThemeSelector /><span className="topbar-note"><ShieldCheck size={16} />{config.environment === "PROD" ? "Produção · Operações reais" : config.environment === "HML" ? "Homologação" : "Configure a integração"}</span><button className="mobile-logout" onClick={logout} aria-label="Sair da demo"><LogOut size={16} />Sair</button></header><main id="main" key={config.contextId || "unconfigured"}>{!config.configured && path !== "/integracao" && <p className="notice"><Link href="/integracao">Defina o ambiente e as credenciais em Integração para começar.</Link></p>}{children}</main><footer>Demo de pagamentos · API AlliancePay<span>{config.environment ? `Contexto da sessão: ${config.environment}` : "Sem conexão ativa"}</span></footer></div></div>;
}
