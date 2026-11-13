// Attribute sampling for file, chart, transaction and record reviews. Pure and
// tested (tests/sampling.test.mjs); the browser re-runs the same code to check
// a selection. Design: docs/quality-model.md §5.
//
//   Sample size (statistical): the smallest n such that, if k = ⌈n × EDR⌉
//   deviations were found, the one-sided upper confidence bound on the
//   deviation rate would not exceed the tolerable rate (TDR) — the binomial
//   basis of the AICPA tables (59 at 95% / 5% / 0%, 45 at 90%, 29 at 95% /
//   10%, 93 at 95% / 5% / 1%). For a population under 5,000 the exact
//   hypergeometric form is used, which can only make n smaller.
//   Selection: the population is ordered by item id, then shuffled with a
//   Fisher–Yates walk driven by mulberry32 seeded from the FNV-1a hash of the
//   seed text. Same population + same seed = same items, on any machine.
//   Evaluation: the sample deviation rate, and the one-sided upper deviation
//   limit at the plan's confidence (Clopper–Pearson; its hypergeometric form
//   for a population under 5,000, matching how the size was worked out). The control is effective
//   when the upper limit is at or below the TDR.

export const CONFIDENCES = [0.9, 0.95, 0.99] as const;

// ── distributions ────────────────────────────────────────────────────────────

function lnFact(n: number): number { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }
const lfCache = new Map<number, number>();
const lf = (n: number) => { let v = lfCache.get(n); if (v === undefined) { v = lnFact(n); if (lfCache.size < 20000) lfCache.set(n, v); } return v; };
const lnChoose = (n: number, k: number) => (k < 0 || k > n ? -Infinity : lf(n) - lf(k) - lf(n - k));

/** P(X ≤ k) for X ~ Binomial(n, p). */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(lnChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}

/** P(X ≤ k) for X ~ Hypergeometric(population N, D deviations in it, sample n). */
export function hyperCdf(k: number, N: number, D: number, n: number): number {
  let s = 0;
  for (let i = Math.max(0, n - (N - D)); i <= Math.min(k, D, n); i++) s += Math.exp(lnChoose(D, i) + lnChoose(N - D, n - i) - lnChoose(N, n));
  return Math.min(1, s);
}

// ── sample size ──────────────────────────────────────────────────────────────

export interface SizeInput { confidence: number; tdr: number; edr: number; population?: number | null }
export interface SizeResult { n: number; allowed: number; basis: "binomial" | "hypergeometric" | "whole population"; note: string }

export function sampleSize({ confidence, tdr, edr, population }: SizeInput): SizeResult {
  if (!(confidence > 0 && confidence < 1)) throw new Error("Confidence must be between 0 and 1.");
  if (!(tdr > 0 && tdr < 1)) throw new Error("The tolerable deviation rate must be between 0% and 100%.");
  if (!(edr >= 0 && edr < tdr)) throw new Error("The expected deviation rate must be below the tolerable rate.");
  const risk = 1 - confidence;
  const N = population && population > 0 ? Math.floor(population) : null;
  const small = N !== null && N < 5000;
  for (let n = 1; n <= 5000; n++) {
    const k = Math.ceil(n * edr - 1e-9);
    if (k >= n) continue;
    if (N !== null && n >= N) return { n: N, allowed: Math.ceil(N * edr - 1e-9), basis: "whole population", note: "The population is no larger than the sample needed, so every item is tested." };
    const p = small ? hyperCdf(k, N!, Math.floor(tdr * N!) + 0, n) : binomCdf(k, n, tdr);
    if (p <= risk) return { n, allowed: k, basis: small ? "hypergeometric" : "binomial", note: k ? `Up to ${k} deviation${k === 1 ? "" : "s"} can be found and the control still relied on.` : "No deviations can be found if the control is to be relied on." };
  }
  throw new Error("That combination needs a sample over 5,000. Raise the tolerable rate or lower the confidence.");
}

// ── evaluation ───────────────────────────────────────────────────────────────

/** Clopper–Pearson one-sided upper bound on the deviation rate: the p at which P(X ≤ k | n, p) = 1 − confidence. */
export function upperLimit(k: number, n: number, confidence: number): number {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  const risk = 1 - confidence;
  let lo = k / n, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (binomCdf(k, n, mid) > risk) lo = mid; else hi = mid; }
  return hi;
}

/** The same bound for a finite population (under 5,000): the smallest share D/N of deviations in the population at which P(X ≤ k) ≤ 1 − confidence. */
export function upperLimitFinite(k: number, n: number, N: number, confidence: number): number {
  if (n >= N) return k / N;
  const risk = 1 - confidence;
  for (let D = k; D <= N; D++) if (hyperCdf(k, N, D, n) <= risk) return D / N;
  return 1;
}

export interface Evaluation { n: number; deviations: number; rate: number; upper: number; confidence: number; tdr: number; effective: boolean; projected: number | null; conclusion: string }

export function evaluate(n: number, deviations: number, confidence: number, tdr: number, population?: number | null): Evaluation {
  const rate = n ? deviations / n : 0;
  const upper = population && population < 5000 ? upperLimitFinite(deviations, n, population, confidence) : upperLimit(deviations, n, confidence);
  const effective = upper <= tdr + 1e-12;
  const projected = population ? Math.round(rate * population) : null;
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  const conclusion = effective
    ? `${deviations} deviation${deviations === 1 ? "" : "s"} in ${n}: at ${Math.round(confidence * 100)}% confidence the population deviation rate is at most ${pc(upper)}, within the tolerable ${pc(tdr)}. The control can be relied on.`
    : `${deviations} deviation${deviations === 1 ? "" : "s"} in ${n} (${pc(rate)}): at ${Math.round(confidence * 100)}% confidence the population deviation rate could be as high as ${pc(upper)}, above the tolerable ${pc(tdr)}. The control can't be relied on; extend the testing or raise an action.`;
  return { n, deviations, rate, upper, confidence, tdr, effective, projected, conclusion };
}

// ── populations, strata and seeded selection ─────────────────────────────────

export interface PopItem { id: string; stratum?: string; value?: number }

/** FNV-1a, 32-bit: the seed text's number. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const byId = (a: PopItem, b: PopItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Draw n items from a population, reproducibly: sort by id, Fisher–Yates with mulberry32(fnv1a(seed + "|" + label)). */
export function drawSeeded(items: PopItem[], n: number, seed: string, label = ""): PopItem[] {
  const pool = [...items].sort(byId);
  const rnd = mulberry32(fnv1a(`${seed}|${label}`));
  const k = Math.min(n, pool.length);
  for (let i = 0; i < k; i++) { const j = i + Math.floor(rnd() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, k);
}

export interface Allocation { stratum: string; population: number; sample: number; census: boolean }

/** Proportional allocation across strata (largest remainder, at least one per non-empty stratum); items at or above `censusAbove` are all tested. */
export function allocate(items: PopItem[], n: number, opts: { stratify: boolean; censusAbove?: number | null }): Allocation[] {
  const census = opts.censusAbove != null ? items.filter((i) => (i.value ?? -Infinity) >= opts.censusAbove!) : [];
  const rest = items.filter((i) => !census.includes(i));
  const out: Allocation[] = [];
  if (census.length) out.push({ stratum: `Every item ≥ ${opts.censusAbove}`, population: census.length, sample: census.length, census: true });
  const left = Math.max(0, n - census.length);
  if (!opts.stratify) { out.push({ stratum: "All", population: rest.length, sample: Math.min(left, rest.length), census: false }); return out; }
  const groups = new Map<string, number>();
  for (const i of rest) groups.set(i.stratum || "Unstratified", (groups.get(i.stratum || "Unstratified") || 0) + 1);
  const names = Array.from(groups.keys()).sort();
  const total = rest.length;
  const raw = names.map((s) => ({ s, q: total ? (groups.get(s)! / total) * left : 0 }));
  const alloc = raw.map((r) => ({ s: r.s, k: Math.min(groups.get(r.s)!, Math.max(left >= names.length ? 1 : 0, Math.floor(r.q))) }));
  let used = alloc.reduce((t, a) => t + a.k, 0);
  const order = raw.map((r, i) => ({ i, rem: r.q - Math.floor(r.q) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let pass = 0; used < Math.min(left, total) && pass < 10; pass++) for (const o of order) { if (used >= Math.min(left, total)) break; if (alloc[o.i].k < groups.get(alloc[o.i].s)!) { alloc[o.i].k++; used++; } }
  while (used > left) { const big = alloc.filter((a) => a.k > 1).sort((a, b) => b.k - a.k)[0]; if (!big) break; big.k--; used--; }
  for (const a of alloc) out.push({ stratum: a.s, population: groups.get(a.s)!, sample: a.k, census: false });
  return out;
}

export interface Selection { items: (PopItem & { stratum: string })[]; allocation: Allocation[] }

/** Select a stratified (or simple) random sample, reproducibly from the seed. */
export function select(items: PopItem[], n: number, seed: string, opts: { stratify: boolean; censusAbove?: number | null }): Selection {
  const allocation = allocate(items, n, opts);
  const picked: (PopItem & { stratum: string })[] = [];
  for (const a of allocation) {
    const members = a.census ? items.filter((i) => (i.value ?? -Infinity) >= opts.censusAbove!) : items.filter((i) => (opts.censusAbove == null || (i.value ?? -Infinity) < opts.censusAbove) && (!opts.stratify || (i.stratum || "Unstratified") === a.stratum));
    const got = a.census ? [...members].sort(byId) : drawSeeded(members, a.sample, seed, opts.stratify ? a.stratum : "");
    for (const g of got) picked.push({ ...g, stratum: a.census ? a.stratum : opts.stratify ? a.stratum : g.stratum || "" });
  }
  return { items: picked, allocation };
}

/** Parse a pasted or uploaded population: "id" or "id, stratum" or "id, stratum, value" per line; a header row is skipped. */
export function parsePopulation(text: string): PopItem[] {
  const out: PopItem[] = [];
  const seen = new Set<string>();
  for (const line of String(text || "").split(/\r?\n/)) {
    const cells = line.split(/\t|,|;/).map((c) => c.trim()).filter((c, i) => i < 3);
    const id = (cells[0] || "").slice(0, 80);
    if (!id || seen.has(id)) continue;
    if (out.length === 0 && /^(id|ref|reference|file|account|chart|record|item)s?\b/i.test(id) && cells.length > 1 && Number.isNaN(Number(cells[2]))) continue;
    seen.add(id);
    const v = cells[2] !== undefined && cells[2] !== "" ? Number(cells[2].replace(/[^0-9.\-]/g, "")) : undefined;
    out.push({ id, ...(cells[1] ? { stratum: cells[1].slice(0, 60) } : {}), ...(v !== undefined && Number.isFinite(v) ? { value: v } : {}) });
    if (out.length >= 50000) break;
  }
  return out;
}

/** A synthetic population of N numbered items when only the size is known: P-0001 … */
export const numbered = (N: number, prefix = "ITEM"): PopItem[] => Array.from({ length: Math.min(50000, Math.max(0, Math.floor(N))) }, (_, i) => ({ id: `${prefix}-${String(i + 1).padStart(String(N).length, "0")}` }));

/** A plain-language statement of the method, for the plan and the evidence pack. */
export function methodText(p: { method: string; confidence?: number | null; tdr?: number | null; edr?: number | null; seed: string; stratify: boolean; censusAbove?: number | null; size: number; population: number }): string {
  const pc = (x?: number | null) => `${((x ?? 0) * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const how = p.method === "statistical" ? `Statistical attribute sampling at ${pc(p.confidence)} confidence, tolerable deviation rate ${pc(p.tdr)}, expected ${pc(p.edr)}: a sample of ${p.size} from ${p.population}.` : `Judgmental (fixed) sample of ${p.size} from ${p.population}; results are reported but not projected statistically.`;
  const strata = p.stratify ? " Stratified in proportion to each stratum's size, at least one per stratum." : "";
  const census = p.censusAbove != null ? ` Every item valued at ${p.censusAbove} or more is tested.` : "";
  return `${how}${strata}${census} Random selection: items ordered by id, then a Fisher–Yates shuffle driven by mulberry32 seeded with the FNV-1a hash of “${p.seed}”. Anyone with the same population and seed gets the same items.`;
}
