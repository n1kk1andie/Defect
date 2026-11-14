// Private object storage: Vercel Blob in production (BLOB_READ_WRITE_TOKEN, or
// a connected store's token under another name), the local disk (.data/blob)
// in development and the tests. Since the move to Postgres it holds only
// evidence files and photos, plus the legacy JSON the migrator reads.
//
// A demo deployment prefixes every key with "demo/", so a demo handed the
// wrong token could still never touch a production key.

export interface StorageDriver {
  name: "vercel-blob" | "local-fs";
  read(key: string): Promise<Buffer | null>;
  write(key: string, buf: Buffer, contentType?: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Vercel Blob R/W token — normally BLOB_READ_WRITE_TOKEN; a connected store's value always starts "vercel_blob_rw_". */
export function vercelBlobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  // Never another store's token: the backup store (BACKUP_BLOB_READ_WRITE_TOKEN) or a preview one.
  for (const [k, v] of Object.entries(process.env)) if (!/^(BACKUP_|PREVIEW_)/.test(k) && typeof v === "string" && v.startsWith("vercel_blob_rw_")) return v;
  return undefined;
}

const demo = () => (process.env.DEMO_MODE || "").trim() === "1";
export const storageKey = (key: string) => (demo() ? `demo/${key}` : key);

const vercelDriver: StorageDriver = {
  name: "vercel-blob",
  async read(key) {
    const { get } = await import("@vercel/blob");
    try {
      const r = await get(key, { access: "private", token: vercelBlobToken() });
      if (!r || !r.stream) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    } catch {
      return null;
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
  async list(prefix) {
    const { list } = await import("@vercel/blob");
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await list({ prefix, cursor, token: vercelBlobToken(), limit: 1000 });
      out.push(...r.blobs.map((b) => b.pathname));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor && out.length < 20000);
    return out;
  },
};

const localDir = () => process.env.DATA_DIR || ".data/blob";
const localDriver: StorageDriver = {
  name: "local-fs",
  async read(key) {
    const fs = await import("node:fs/promises"), path = await import("node:path");
    try { return await fs.readFile(path.join(localDir(), key)); } catch { return null; }
  },
  async write(key, buf) {
    const fs = await import("node:fs/promises"), path = await import("node:path");
    const p = path.join(localDir(), key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, buf);
  },
  async remove(key) {
    const fs = await import("node:fs/promises"), path = await import("node:path");
    try { await fs.unlink(path.join(localDir(), key)); } catch { /* already gone */ }
  },
  async list(prefix) {
    const fs = await import("node:fs/promises"), path = await import("node:path");
    const root = localDir();
    const out: string[] = [];
    async function walk(dir: string) {
      let ents: import("node:fs").Dirent[] = [];
      try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(path.relative(root, p).split(path.sep).join("/"));
      }
    }
    await walk(root);
    return out.filter((k) => k.startsWith(prefix));
  },
};

/** The driver, with demo key namespacing applied. */
export function getStorage(): StorageDriver {
  const base = vercelBlobToken() ? vercelDriver : localDriver;
  return {
    name: base.name,
    read: (k) => base.read(storageKey(k)),
    write: (k, b, t) => base.write(storageKey(k), b, t),
    remove: (k) => base.remove(storageKey(k)),
    list: async (p) => (await base.list(storageKey(p))).map((k) => (demo() ? k.replace(/^demo\//, "") : k)),
  };
}

/** Whether writes persist: on a hosted deployment a Blob store is required. */
export function storageIsDurable(): boolean {
  return !!vercelBlobToken() || !process.env.VERCEL;
}
