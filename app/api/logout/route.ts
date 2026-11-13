// Sign out: clear the Pulsus session cookie here and on the shared .pulsus.tech
// domain (where the platform set it), plus the demo persona.
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const host = (req.headers.get("host") || "").split(":")[0];
  for (const name of ["exec_auth", "pq_persona"]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
    if (host.endsWith(".pulsus.tech")) res.cookies.set(name, "", { path: "/", maxAge: 0, domain: ".pulsus.tech" });
  }
  return res;
}
