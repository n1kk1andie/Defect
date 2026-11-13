// Saved reports: list; create.
import { actorOr, body, json, result } from "@/lib/api";
import { emailConfigured, listSavedReports, saveReport } from "@/lib/reportBuilder";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ reports: await listSavedReports(g.actor), email: emailConfigured() });
}

export async function POST(req: Request) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await saveReport(g.actor, null, await body(req), g.requestId), (report) => ({ report }));
}
