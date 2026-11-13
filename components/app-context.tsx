"use client";
// What every screen shares: the company's dataset and settings (loaded once by
// app/(app)/layout.tsx and refreshed after any change), who is signed in, the
// filters (Branch Defects or Operational Standard, year, unit, area —
// remembered on this device) and day/night.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { QualityData } from "@/lib/metrics";
import { years } from "@/lib/metrics";
import type { CompanySettings } from "@/lib/settings";
import type { Actor } from "@/lib/roles";
import type { Program } from "@/lib/company";
import { classify, type BandKey, type FamilyKey } from "@/lib/bands";

export interface Boot {
  actor: Actor;
  data: QualityData;
  settings: CompanySettings;
  program: Program;
  people: { email: string; name: string; roles: string[] }[];
  counts: { awaitingApproval: number; openActions: number; overdue: number; awaitingVerification: number; myDrafts: number; awaitingInspections: number };
  demo: boolean;
  platformUrl: string;
  /** Where "View plan & billing" goes. */
  billingUrl: string;
  now: string;
}

export interface Filters { mode: "defects" | "standard"; year: string; unit: number; area: number }

interface Ctx extends Boot {
  filters: Filters;
  setFilters: (p: Partial<Filters>) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  refresh: () => void;
  band: (family: FamilyKey, v: number | null | undefined) => BandKey | "none";
  unitName: (id: string | null | undefined) => string;
  areaName: (id: string | null | undefined) => string;
  latestYear: string;
}

const AppCtx = createContext<Ctx | null>(null);
const VIEW_KEY = "pq-view";

export function AppProvider({ boot, children }: { boot: Boot; children: ReactNode }) {
  const router = useRouter();
  const ys = years(boot.data.periods);
  const latestYear = ys[ys.length - 1] || String(new Date().getFullYear());
  const [filters, set] = useState<Filters>({ mode: "defects", year: latestYear, unit: -1, area: -1 });
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${VIEW_KEY}:${boot.actor.tenant}`) || "{}") as Partial<Filters>;
      set((f) => ({
        ...f,
        ...(saved.mode === "standard" && boot.data.scorecard ? { mode: "standard" } : {}),
        ...(saved.year && (saved.year === "all" || ys.includes(saved.year)) ? { year: saved.year } : {}),
        ...(typeof saved.unit === "number" && saved.unit < boot.data.units.length ? { unit: saved.unit } : {}),
        ...(typeof saved.area === "number" && saved.area < boot.data.areas.length ? { area: saved.area } : {}),
      }));
    } catch { /* storage blocked */ }
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilters = useCallback((p: Partial<Filters>) => {
    set((f) => {
      const next = { ...f, ...p };
      try { localStorage.setItem(`${VIEW_KEY}:${boot.actor.tenant}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [boot.actor.tenant]);

  const toggleTheme = useCallback(() => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pz-theme", next); } catch { /* ignore */ }
    setTheme(next);
  }, []);

  const value = useMemo<Ctx>(() => {
    const units = new Map(boot.program.units.map((u) => [u.id, u.name]));
    const areas = new Map(boot.program.areas.map((a) => [a.id, a.name]));
    for (const a of boot.data.areas) areas.set(a.id, a.name);
    return {
      ...boot, filters, setFilters, theme, toggleTheme, latestYear,
      refresh: () => router.refresh(),
      band: (family, v) => classify(family, v, boot.settings.bands) ?? "none",
      unitName: (id) => (id ? units.get(id) ?? "—" : "—"),
      areaName: (id) => (id ? areas.get(id) ?? "—" : "Whole branch"),
    };
  }, [boot, filters, setFilters, theme, toggleTheme, latestYear, router]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** POST/PATCH/DELETE JSON to an API route; returns the body or throws its error message. */
export async function api<T = Record<string, unknown>>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status}).`);
  return j;
}
