// A site's link as a QR code: ?format=svg (default) or png, ?download=1 for a file.
import QRCode from "qrcode";
import { actorOr, json } from "@/lib/api";
import { listLinks } from "@/lib/issues";
import { isSupervisor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ unitId: string }> }) {
  const g = await actorOr(isSupervisor); if ("response" in g) return g.response;
  const { unitId } = await ctx.params;
  const link = (await listLinks(g.actor)).find((l) => l.unitId === unitId);
  if (!link) return json({ error: "Not found." }, 404);
  const u = new URL(req.url);
  const url = `${process.env.APP_URL ? link.url : `${u.origin}${link.path}`}?via=qr`;
  const slug = link.unitName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const disp = u.searchParams.get("download") ? `attachment; filename="report-an-issue-${slug}.${u.searchParams.get("format") === "png" ? "png" : "svg"}"` : "inline";
  if (u.searchParams.get("format") === "png") {
    const png = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 720 });
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Content-Disposition": disp, "Cache-Control": "no-store" } });
  }
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": disp, "Cache-Control": "no-store" } });
}
