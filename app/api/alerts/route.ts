// The alerts bell: GET what needs you now. POST { emailAlerts: boolean } turns
// your own daily email on or off; POST { test: true } sends you today's email
// now (only when the deployment sends email, never in a demo).
import { actorOr, body, json } from "@/lib/api";
import { alertsFor, digestEmail, emailConfigured, myEmailAlerts, sendEmail, setMyEmailAlerts } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  const [items, mine] = await Promise.all([alertsFor(g.actor), myEmailAlerts(g.actor)]);
  return json({ items, email: { configured: emailConfigured(), mine } });
}

export async function POST(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const b = await body(req);
  if (typeof b.emailAlerts === "boolean") {
    const ok = await setMyEmailAlerts(g.actor, b.emailAlerts, g.requestId);
    return ok ? json({ mine: b.emailAlerts }) : json({ error: "You aren't on the people list yet. Ask a Quality admin to add you." }, 400);
  }
  if (b.test === true) {
    if (!emailConfigured()) return json({ error: "Email isn't set up on this deployment." }, 400);
    const items = await alertsFor(g.actor);
    if (!items.length) return json({ sent: false, message: "Nothing needs you right now, so there's nothing to send." });
    const sent = await sendEmail(g.actor.email, digestEmail(g.actor.tenantName, g.actor.name, items));
    return sent ? json({ sent: true, message: `Sent to ${g.actor.email}.` }) : json({ error: "The email didn't send. Try again later." }, 502);
  }
  return json({ error: "Nothing to change." }, 400);
}
