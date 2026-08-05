import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { getStorage, storageIsDurable } from "@/lib/storage";
import { attachmentOwnerOrVisible } from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Audit sample-findings attachments for submissions.
//  • POST (multipart, field "file"): store the bytes privately, return { id, name, size, type }.
//    The reference is later saved onto the submission via /api/submissions.
//  • GET ?id=<id>: stream the file back to anyone allowed to see it (the uploader, or a
//    supervisor/admin who can see a submission carrying it).

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// Flat storage keys (no "/" — the local-fs driver doesn't create nested dirs).
const blobKey = (id: string) => `attachment-${id}`;
const metaKey = (id: string) => `attachment-${id}.json`;

interface AttachMeta { name: string; type: string; size: number; owner: string; }

export async function POST(req: NextRequest) {
  const s = getSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  if (s.role === "supervisor") return NextResponse.json({ ok: false, error: "Supervisors review submissions; they don’t key them." }, { status: 403 });
  if (!storageIsDurable()) return NextResponse.json({ ok: false, error: "Couldn’t upload: the app’s storage isn’t connected. An admin needs to connect a Vercel Blob store to this project and redeploy." }, { status: 503 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ ok: false, error: "The file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "Attachment is too large (max 15 MB)." }, { status: 400 });

  const id = randomUUID();
  const name = (file.name || "attachment").slice(0, 200);
  const type = (file.type || "application/octet-stream").slice(0, 120);
  const buf = Buffer.from(await file.arrayBuffer());

  const store = getStorage();
  await store.write(blobKey(id), buf, type);
  const meta: AttachMeta = { name, type, size: file.size, owner: s.username };
  await store.write(metaKey(id), Buffer.from(JSON.stringify(meta), "utf8"), "application/json");

  return NextResponse.json({ ok: true, attachment: { id, name, size: file.size, type } });
}

export async function GET(req: NextRequest) {
  const s = getSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return NextResponse.json({ ok: false, error: "Bad id." }, { status: 400 });

  const store = getStorage();
  const metaBuf = await store.read(metaKey(id));
  if (!metaBuf) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  let meta: AttachMeta;
  try { meta = JSON.parse(metaBuf.toString("utf8")); } catch { return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 }); }

  // Access: the uploader always; otherwise anyone who can see a submission carrying this id.
  const allowed = meta.owner === s.username || (await attachmentOwnerOrVisible(s, id));
  if (!allowed) return NextResponse.json({ ok: false, error: "You can’t access this attachment." }, { status: 403 });

  const buf = await store.read(blobKey(id));
  if (!buf) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const safeName = meta.name.replace(/[\r\n"]/g, "_");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": meta.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
