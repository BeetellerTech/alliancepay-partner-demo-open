"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type VisualTheme = "sendyu" | "alliancepay";
const storageKey = "demo-visual-theme";
const VisualThemeContext = createContext<{ theme: VisualTheme; select: (theme: VisualTheme) => void }>({ theme: "sendyu", select: () => {} });

export function VisualThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<VisualTheme>("sendyu");
  useEffect(() => {
    // Only the visual preference is stored. Changing it never remounts checkout.
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === "sendyu" || saved === "alliancepay") setTheme(saved);
      } catch { /* The selector also works when storage is unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  function select(value: VisualTheme) {
    setTheme(value);
    try { localStorage.setItem(storageKey, value); } catch { /* Keep the in-memory preference. */ }
  }
  return <VisualThemeContext.Provider value={{ theme, select }}><div className="theme-root" data-theme={theme}>{children}</div></VisualThemeContext.Provider>;
}

export function VisualThemeSelector() {
  const { theme, select } = useContext(VisualThemeContext);
  return <div className="visual-theme-selector" role="group" aria-label="Visual da demo">
    <span>Visual da demo</span>
    <div>{([ ["sendyu", "Sendyu"], ["alliancepay", "AlliancePay"] ] as const).map(([value, label]) =>
      <button type="button" key={value} aria-pressed={theme === value} onClick={() => select(value)}>{label}</button>
    )}</div>
  </div>;
}

export function BrandLogo({ large = false }: { large?: boolean }) {
  const { theme } = useContext(VisualThemeContext);
  return <img src={theme === "sendyu" ? "/sendyu.svg" : "/alliancepay.svg"} alt={theme === "sendyu" ? "Sendyu" : "AlliancePay"} width={large ? 215 : 172} height={large ? 48 : 40} className="brand-logo" />;
}
