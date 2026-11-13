// Demo only: switch persona ({ persona: email }) or reset the sample data ({ reset: true }, demo admin).
import { cookies } from "next/headers";
import { actorOr, body, json } from "@/lib/api";
import { PERSONA_COOKIE, personaFor } from "@/lib/demo/personas";
import { resetDemo } from "@/lib/demo/seed";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
const isDemo = () => (process.env.DEMO_MODE || "").trim() === "1";

export async function POST(req: Request) {
  if (!isDemo()) return json({ error: "Not found." }, 404);
  const b = await body(req);
  if (b.reset === true) {
    const g = await actorOr(can.manage); if ("response" in g) return g.response;
    await resetDemo(g.actor.email);
    return json({ ok: true });
  }
  const p = personaFor(String(b.persona || ""));
  if (!p) return json({ error: "Unknown persona." }, 400);
  (await cookies()).set(PERSONA_COOKIE, p.email, { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: true, maxAge: 60 * 60 * 24 * 7 });
  return json({ ok: true, persona: p });
}
