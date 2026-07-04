// Pluggable storage for persisted objects (uploaded datasets + admin credential).
//
// Driver is chosen by env:
//   BLOB_READ_WRITE_TOKEN present -> vercel-blob  (production on Vercel)
//   (none)                        -> local-fs     (./.data, dev only)
//
// Vercel's filesystem is read-only/ephemeral, so uploads must go to object storage
// (Vercel Blob) to survive cold starts. Blobs are PRIVATE; reads use a short-lived
// presigned GET URL.

export interface StorageDriver {
  name: "vercel-blob" | "local-fs";
  read(key: string): Promise<Buffer | null>;
  write(key: string, buf: Buffer, contentType?: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Vercel Blob R/W token — normally BLOB_READ_WRITE_TOKEN, but a connected store
 *  can expose it under another name; the value always starts with "vercel_blob_rw_". */
export function vercelBlobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const v of Object.values(process.env)) {
    if (typeof v === "string" && v.startsWith("vercel_blob_rw_")) return v;
  }
  return undefined;
}

const vercelDriver: StorageDriver = {
  name: "vercel-blob",
  async read(key) {
    const { issueSignedToken, presignUrl } = await import("@vercel/blob");
    const token = vercelBlobToken();
    try {
      const signed = await issueSignedToken({ pathname: key, operations: ["get"], token });
      const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname: key, access: "private" });
      const res = await fetch(presignedUrl, { cache: "no-store" });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null; // nothing stored yet
    }
  },
  async write(key, buf, contentType = "application/octet-stream") {
    const { put } = await import("@vercel/blob");
    await put(key, buf, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, token: vercelBlobToken() });
  },
  async remove(key) {
    const { del } = await import("@vercel/blob");
    try { await del(key, { token: vercelBlobToken() }); } catch { /* already gone */ }
  },
};

function localDir(): string {
  return process.env.DATA_DIR || ".data";
}
const localDriver: StorageDriver = {
  name: "local-fs",
  async read(key) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    try { return await fs.readFile(path.join(localDir(), key)); } catch { return null; }
  },
  async write(key, buf) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(localDir(), { recursive: true });
    await fs.writeFile(path.join(localDir(), key), buf);
  },
  async remove(key) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    try { await fs.unlink(path.join(localDir(), key)); } catch { /* already gone */ }
  },
};

export function getStorage(): StorageDriver {
  return vercelBlobToken() ? vercelDriver : localDriver;
}
