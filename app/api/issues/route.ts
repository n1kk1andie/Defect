// Reported issues for the people who triage them.
import { actorOr, json } from "@/lib/api";
import { listReports } from "@/lib/issues";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ issues: await listReports(g.actor) });
}
