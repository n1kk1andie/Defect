// Work out a plan without saving it: the sample size and why, and the allocation across strata.
import { actorOr, body, json } from "@/lib/api";
import { planFrom } from "@/lib/samplingPlans";
import { allocate, methodText } from "@/lib/sampling";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const p = planFrom(await body(req));
  if (!p.ok) return json({ error: p.error }, 400);
  const v = p.value;
  return json({ size: v.size, population: v.items.length, note: v.note, listed: v.listed, strata: Array.from(new Set(v.items.map((i) => i.stratum).filter(Boolean))).length,
    allocation: allocate(v.items, v.size, { stratify: v.stratify, censusAbove: v.censusAbove }), method: methodText({ method: v.method, confidence: v.confidence, tdr: v.tdr, edr: v.edr, seed: v.seed, stratify: v.stratify, censusAbove: v.censusAbove, size: v.size, population: v.items.length }) });
}
