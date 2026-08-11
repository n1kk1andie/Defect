import { NextResponse } from "next/server";
import { storageIsDurable, vercelBlobToken } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Temporary storage diagnostic. Reports ONLY booleans + the build's git sha/branch —
// no secret values — so we can see, from inside the running function, whether the Blob
// token actually reaches this deployment's runtime. Safe to remove once storage works.
export async function GET() {
  const anyRwValue = Object.values(process.env).some((v) => typeof v === "string" && v.startsWith("vercel_blob_rw_"));
  return NextResponse.json({
    onVercel: !!process.env.VERCEL,
    storageDurable: storageIsDurable(),
    hasBlobReadWriteToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    anyEnvValueLooksLikeRwToken: anyRwValue,
    tokenResolved: !!vercelBlobToken(),
    hasBlobStoreId: !!process.env.BLOB_STORE_ID,
    hasBlobWebhookKey: !!process.env.BLOB_WEBHOOK_PUBLIC_KEY,
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      env: process.env.VERCEL_ENV || null,
    },
  });
}
