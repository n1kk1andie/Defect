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

// ── Demo namespacing ─────────────────────────────────────────────────────────
// A demo deployment writes every object under a reserved "demo/" prefix. This
// lives in the storage layer so it covers every call site — the seeder, the
// uploaded datasets and the admin credential alike — and so a caller added
// later inherits it without having to know it exists.
//
// It exists because DEMO_MODE alone is not isolation. The demo projects share
// their repos with production, and a demo project handed a production Blob
// token would otherwise write onto production's exact keys. The VERCEL_ENV
// preview guard does not catch that: a dedicated demo project reports
// "production". This does.
//
// isDemo() is inlined rather than imported so the storage layer keeps no
// dependencies of its own.
const DEMO_PREFIX = "demo/";

function demoDeployment(): boolean {
  return (process.env.DEMO_MODE || "").trim() === "1";
}

/** The key a given logical key resolves to on this deployment. */
export function storageKey(key: string): string {
  if (!demoDeployment()) return key;
  return key.startsWith(DEMO_PREFIX) ? key : DEMO_PREFIX + key;
}

/** True when demo namespacing is actually in force. */
export function demoNamespacingActive(): boolean {
  return !demoDeployment() || storageKey("probe") === DEMO_PREFIX + "probe";
}

function withDemoNamespace(driver: StorageDriver): StorageDriver {
  if (!demoDeployment()) return driver;
  return {
    name: driver.name,
    read: (key) => driver.read(storageKey(key)),
    write: (key, buf, contentType) => driver.write(storageKey(key), buf, contentType),
    remove: (key) => driver.remove(storageKey(key)),
  };
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
    const file = path.join(localDir(), key);
    // dirname(), not localDir(): a namespaced key ("demo/x.json") is a
    // subdirectory, and writeFile does not create one.
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
  },
  async remove(key) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    try { await fs.unlink(path.join(localDir(), key)); } catch { /* already gone */ }
  },
};

export function getStorage(): StorageDriver {
  return withDemoNamespace(vercelBlobToken() ? vercelDriver : localDriver);
}

/** Whether writes will actually persist. Local dev writes to disk fine; on Vercel the
 *  serverless filesystem is read-only, so a connected Blob store (its token) is required.
 *  Used to fail writes with a clear message instead of a raw read-only-filesystem 500. */
export function storageIsDurable(): boolean {
  return !!vercelBlobToken() || !process.env.VERCEL;
}
