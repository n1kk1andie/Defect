// GET /api/pulse: one company's quality summary for Pulsus Platform, server to
// server, under the suite's signed service grant for "quality.pulse" (at most
// five minutes, one company; lib/platform-jwt.ts). No session cookie is read.
import { serviceGrantCompany } from "@/lib/platform-jwt";
import { pulseFor } from "@/lib/pulse";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const company = await serviceGrantCompany(req.headers.get("authorization"), "quality.pulse");
  if (!company) return json({ error: "A service grant for quality.pulse is required." }, 401);
  return json(await pulseFor(company.id));
}
