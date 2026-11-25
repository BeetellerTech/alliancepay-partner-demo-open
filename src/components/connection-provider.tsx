"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/browser";
import type { Json } from "@/lib/types";
const Context = createContext<{ config: Json; refresh: () => Promise<void> }>({ config: {}, refresh: async () => {} });
export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Json>({}); const path = usePathname();
  async function refresh() { if (path === "/login") { setConfig({}); return; } try { setConfig(await api("config")); } catch { setConfig({}); } }
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [path]);
  return <Context.Provider value={{ config, refresh }}>{children}</Context.Provider>;
}
export const useConnection = () => useContext(Context);
