// Server-side admin auth: a password is verified on the server and exchanged for a
// signed, httpOnly session cookie. The password can be changed in-app; the new
// scrypt hash is persisted to storage and takes precedence over ADMIN_PASSWORD.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getStorage } from "@/lib/storage";

export const SESSION_COOKIE = "vmbs_session";
const MAX_AGE = 60 * 60 * 12; // 12h
const CRED_BLOB = "admin-credentials.json";

// Built-in default admin password. This makes sign-in work out of the box with
// NO Vercel setup required (no ADMIN_PASSWORD env var, no Blob store). It can be
// overridden by setting ADMIN_PASSWORD, or by changing the password in-app
// (Settings → Admin password), which persists a scrypt hash to storage.
const DEFAULT_ADMIN_PASSWORD = "pa55w0rd";

/** The effective admin password from env, falling back to the built-in default. */
function envOrDefaultPassword(): string {
  const fromEnv = (process.env.ADMIN_PASSWORD || "").trim();
  return fromEnv || DEFAULT_ADMIN_PASSWORD;
}

interface StoredCredential { alg: "scrypt"; salt: string; hash: string; updatedAt: string; }

function secret(): string {
  return process.env.SESSION_SECRET || "vmbs-dev-secret-change-me";
}
function b64url(s: string): string { return Buffer.from(s).toString("base64url"); }
function sign(payload: string): string { return createHmac("sha256", secret()).update(payload).digest("base64url"); }

export function createSessionToken(now: number): string {
  const body = b64url(JSON.stringify({ role: "admin", exp: now + MAX_AGE * 1000 }));
  return `${body}.${sign(body)}`;
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
export function verifySessionToken(token: string | undefined, now: number): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  if (!safeEqual(sig, sign(body))) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.role === "admin" && typeof p.exp === "number" && p.exp > now;
  } catch { return false; }
}

function hashPassword(pw: string, salt: string): string { return scryptSync(pw, salt, 64).toString("hex"); }

async function readStoredCredential(): Promise<StoredCredential | null> {
  try {
    const buf = await getStorage().read(CRED_BLOB);
    if (!buf) return null;
    const c = JSON.parse(buf.toString("utf8")) as StoredCredential;
    return c?.alg === "scrypt" && c.salt && c.hash ? c : null;
  } catch { return null; }
}

export async function setPassword(newPassword: string): Promise<void> {
  const salt = randomBytes(16).toString("hex");
  const cred: StoredCredential = { alg: "scrypt", salt, hash: hashPassword(newPassword.trim(), salt), updatedAt: new Date().toISOString() };
  await getStorage().write(CRED_BLOB, Buffer.from(JSON.stringify(cred), "utf8"), "application/json");
}

// Admin password precedence: an in-app password (persisted to storage) takes
// precedence; otherwise the ADMIN_PASSWORD env var is used; otherwise a built-in
// default applies. Sign-in always works without any Vercel configuration.
export async function checkPassword(submitted: string): Promise<boolean> {
  // Trim surrounding whitespace on both sides — env values pasted into a host often
  // carry a trailing space/newline, which would otherwise reject a correct password.
  const pw = (submitted || "").trim();
  const stored = await readStoredCredential();
  if (stored) return safeEqual(hashPassword(pw, stored.salt), stored.hash);
  return safeEqual(pw, envOrDefaultPassword());
}

/** Whether admin auth is usable. Always true — a built-in default password
 *  guarantees sign-in works even with no env var or storage configured. */
export async function adminConfigured(): Promise<boolean> {
  return true;
}

export function isAdmin(now: number): boolean {
  return verifySessionToken(cookies().get(SESSION_COOKIE)?.value, now);
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
