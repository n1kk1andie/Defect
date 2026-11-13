import { actorOr, body, json } from "@/lib/api";
import { listMembers, setMember } from "@/lib/company";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ members: await listMembers(g.actor.tenant) });
}

/** { email, name?, roles: Role[], unitIds?: string[], status?: "active" | "removed" } */
export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const r = await setMember(g.actor, (await body(req)) as never, g.requestId);
  return r.ok ? json({ member: r.member }) : json({ error: r.error }, 400);
}
