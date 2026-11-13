// Shared plumbing for the API routes: who's asking, JSON answers, and one
// shape for refusals.
import { NextResponse } from "next/server";
import { getActor, requestInfo } from "@/lib/session";
import { can, type Actor } from "@/lib/roles";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The actor, or a 401/403 response. Pass a permission check to require it. */
export async function actorOr(check?: (a: Actor) => boolean): Promise<{ actor: Actor; requestId: string } | { response: NextResponse }> {
  const a = await getActor();
  if (!a) return { response: json({ error: "Sign in to continue." }, 401) };
  if (!can.view(a)) return { response: json({ error: "You don't have access to Pulsus Quality here. Ask an administrator to add you." }, 403) };
  if (check && !check(a)) return { response: json({ error: "Your role can't do that." }, 403) };
  return { actor: a, requestId: (await requestInfo())?.requestId || "" };
}

/** Turn a lib Result into a response. */
export function result<T>(r: { ok: true; value: T } | { ok: false; error: string; status?: number }, wrap: (v: T) => unknown = (v) => v) {
  return r.ok ? json(wrap(r.value)) : json({ error: r.error }, r.status ?? 400);
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === "object" ? (b as Record<string, unknown>) : {}; } catch { return {}; }
}
