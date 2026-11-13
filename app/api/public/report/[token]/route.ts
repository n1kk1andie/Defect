// The public report-an-issue form posts here (multipart: category, description,
// location, name, contact, photo, cf-turnstile-response, website = honeypot).
// No sign-in: the token names the site. See lib/issues.ts.
import { NextResponse } from "next/server";
import { submitReport, MAX_PHOTO } from "@/lib/issues";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the form again." }, { status: 400 });
  const photo = form.get("photo");
  let file: { type: string; bytes: Buffer } | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_PHOTO) return NextResponse.json({ error: "Photos can be up to 10 MB." }, { status: 413 });
    file = { type: photo.type || "application/octet-stream", bytes: Buffer.from(await photo.arrayBuffer()) };
  }
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip");
  const r = await submitReport(token, {
    category: form.get("category"), description: form.get("description"), location: form.get("location"), name: form.get("name"), contact: form.get("contact"),
    website: form.get("website"), turnstile: form.get("cf-turnstile-response"),
  }, file, { ip, source: form.get("via") === "qr" ? "qr" : "link" });
  return r.ok ? NextResponse.json(r.value, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: r.error }, { status: r.status ?? 400, headers: { "Cache-Control": "no-store" } });
}
