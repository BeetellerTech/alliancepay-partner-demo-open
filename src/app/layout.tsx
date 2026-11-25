import { ConnectionProvider } from "@/components/connection-provider";
import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { Shell } from "@/components/shell";
import { VisualThemeProvider } from "@/components/visual-theme";
import "./globals.css";
import "./colmeia.css";
import "./operations.css";
const roboto = Roboto({ subsets: ["latin"], variable: "--font-roboto", display: "swap" });
export const metadata: Metadata = { title: { default: "AlliancePay · Demo do parceiro", template: "%s · AlliancePay Demo" }, description: "Demonstração da integração de parceiros AlliancePay em HML e produção.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="pt-BR" className={roboto.variable}><body><VisualThemeProvider><ConnectionProvider><Shell>{children}</Shell></ConnectionProvider></VisualThemeProvider></body></html>; }
