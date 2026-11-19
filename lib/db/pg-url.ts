// Strict TLS for the Postgres connection string, made explicit.
//
// node-postgres currently treats sslmode=prefer, require and verify-ca as
// aliases for verify-full (checking the certificate chain and the host name),
// warns about it on every connection, and will change that meaning in its next
// major version, when "require" would stop checking the certificate. The
// hosted database (Neon) presents a publicly trusted certificate for its own
// host names, pooled and direct, so verify-full is what we want and what we
// already get: this pins it, so an upgrade cannot quietly weaken it.
//
// For any host other than this machine, every sslmode / uselibpqcompat / ssl
// parameter is replaced by sslmode=verify-full. A local database (localhost,
// 127.x, ::1, or a Unix socket) is left exactly as written, for development.
// sslrootcert, if a provider ever needs its own CA, is kept and still honoured.

const LOCAL_HOSTS = new Set(["localhost", "::1", "[::1]"]);

/** True for a database on this machine: no TLS policy is imposed on it. */
export function isLocalPgHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "" || h.startsWith("/") || LOCAL_HOSTS.has(h) || h.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(h);
}

const TLS_PARAMS = ["sslmode", "uselibpqcompat", "ssl"];

/** The connection string with sslmode=verify-full for a remote host; a local or unparsable one is returned unchanged. */
export function strictPgUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return url;
  const socketHost = u.searchParams.get("host") || "";
  if (isLocalPgHost(u.hostname) && (!socketHost || isLocalPgHost(socketHost))) return url;
  for (const p of TLS_PARAMS) u.searchParams.delete(p);
  u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}
