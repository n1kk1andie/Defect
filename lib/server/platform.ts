// Platform single sign-on for Pulsus Cash.
//
// The Pulsus Command Center issues its session as an HMAC-signed cookie on the
// parent domain (.pulsus.tech), so it also reaches cash.pulsus.tech. When a
// person has already signed into the Command Center, Cash honours that shared
// session — no second sign-in — provided the SAME secret is set (SESSION_SECRET)
// in both apps. This reader validates the Command Center's token and returns the
// signed-in email, or null.
//
// The Command Center token shape is `${emailB64}.${expMs}.${sigHex}`, where the
// signature is HMAC-SHA256 over `${emailB64}|${expMs}` (hex) and emailB64 is the
// base64url of the lowercased email — the exact payload the Command Center signs.
import { createHmac, timingSafeEqual } from "node:crypto";

export const PLATFORM_COOKIE = "exec_auth";

function secret(): string {
  return process.env.SESSION_SECRET || "cash-dev-secret-change-me";
}

export function readPlatformSession(token: string | undefined, now: number): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [emailB64, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || now > exp) return null;
  const expected = createHmac("sha256", secret()).update(`${emailB64}|${exp}`).digest("hex");
  try {
    const a = Buffer.from(sig, "hex"), b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    return Buffer.from(emailB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").trim().toLowerCase();
  } catch {
    return null;
  }
}

// ── Platform JWT verification (RS256) — no dependency, no secret ──────────────
// The Command Center signs the session with its private key; we verify with the
// PUBLIC keys it publishes at /api/jwks. Durable replacement for the shared HMAC.
const JWKS_URL = (process.env.PLATFORM_JWKS_URL || "").trim() || "https://executive.pulsus.tech/api/jwks";
const PLATFORM_JWT_ISSUER = "pulsus-command-center";
let jwksCache: Array<Record<string, string>> | null = null;
let jwksAt = 0;
async function jwksKeys(): Promise<Array<Record<string, string>>> {
  const now = Date.now();
  if (jwksCache && now - jwksAt < 5 * 60 * 1000) return jwksCache;
  const r = await fetch(JWKS_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("jwks " + r.status);
  jwksCache = ((await r.json()).keys as Array<Record<string, string>>) || [];
  jwksAt = now;
  return jwksCache;
}
function jwtB64urlBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function jwtB64urlStr(s: string): string { return new TextDecoder().decode(jwtB64urlBytes(s)); }
export async function verifyPlatformJwt(token: string | undefined): Promise<string | null> {
  if (!token || token.split(".").length !== 3) return null;
  const [h, p, sig] = token.split(".");
  let header: Record<string, string>, payload: Record<string, unknown>;
  try { header = JSON.parse(jwtB64urlStr(h)); payload = JSON.parse(jwtB64urlStr(p)); } catch { return null; }
  if (header.alg !== "RS256" || payload.iss !== PLATFORM_JWT_ISSUER) return null;
  if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) return null;
  let keys: Array<Record<string, string>>;
  try { keys = await jwksKeys(); } catch { return null; }
  const jwk = keys.find((k) => k.kid === header.kid) || keys[0];
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, jwtB64urlBytes(sig) as unknown as BufferSource, new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource);
    if (!ok) return null;
  } catch { return null; }
  const email = String((payload.email as string) || (payload.sub as string) || "").trim().toLowerCase();
  return email || null;
}
