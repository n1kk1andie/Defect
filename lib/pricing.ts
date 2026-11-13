// Quality's price, as Pulsus Platform publishes it (GET <platform>/api/pricing,
// the one place prices are set). Quality never states a price of its own; it
// reads the "quality" entry, else the "assurance" bundle it is sold in today.

export interface QualityPrice { monthly: number; currency: string; includes: string | null; trialDays: number | null; product: string }

export function qualityPrice(list: unknown): QualityPrice | null {
  const l = list as { currency?: unknown; trialDays?: unknown; products?: unknown } | null;
  if (!l || !Array.isArray(l.products)) return null;
  const products = l.products as { key?: unknown; name?: unknown; monthly?: unknown; includes?: unknown; retired?: unknown }[];
  const p = products.find((x) => x && x.key === "quality" && !x.retired) || products.find((x) => x && x.key === "assurance" && !x.retired);
  if (!p || typeof p.monthly !== "number" || !Number.isFinite(p.monthly) || p.monthly <= 0) return null;
  return {
    monthly: p.monthly,
    currency: typeof l.currency === "string" && /^[A-Z]{3}$/.test(l.currency) ? l.currency : "USD",
    includes: typeof p.includes === "string" && p.includes.trim() ? p.includes.trim().slice(0, 120) : null,
    trialDays: typeof l.trialDays === "number" && l.trialDays > 0 && l.trialDays < 366 ? Math.round(l.trialDays) : null,
    product: typeof p.name === "string" ? p.name : String(p.key),
  };
}

export function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); }
  catch { return `${currency} ${amount}`; }
}
