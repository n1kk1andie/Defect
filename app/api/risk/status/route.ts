// Pulsus Risk calls back with its decision on a proposal (docs/risk-contract.md):
// POST { id, company_id, risk_ref, status: "accepted" | "rejected", reason, decided_by, decided_at }
// with Authorization: Bearer $RISK_INTAKE_KEY.
import { NextResponse } from "next/server";
import { recordDecision, riskKeyMatches } from "@/lib/riskLink";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!riskKeyMatches(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Send a JSON object." }, { status: 400 });
  const r = await recordDecision(b);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
