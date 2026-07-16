// Server-side auth. Historically this was a single admin password exchanged for a
// signed, httpOnly session cookie. It now supports **named accounts with roles**:
//
//   • admin      — full access (data upload/export, account management, every screen)
//   • supervisor — reviews & publishes inspector submissions for their branch
//   • inspector  — keys reviews for their branch, tracked until a supervisor publishes
//
// The gear/login flow returns the account's role, and the client shows screens based
// on it. The legacy admin password still works out of the box (sign in with username
// "admin", or leave the username blank) so nothing breaks with no configuration.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getStorage } from "@/lib/storage";

export const SESSION_COOKIE = "vmbs_session";
const MAX_AGE = 60 * 60 * 12; // 12h
const CRED_BLOB = "admin-credentials.json"; // legacy admin password (scrypt)
const ACCOUNTS_BLOB = "accounts.json"; // inspector / supervisor / extra admin accounts

// Built-in default admin password. This makes sign-in work out of the box with
// NO Vercel setup required (no ADMIN_PASSWORD env var, no Blob store). It can be
// overridden by setting ADMIN_PASSWORD, or by changing the password in-app
// (Settings → Admin password), which persists a scrypt hash to storage.
const DEFAULT_ADMIN_PASSWORD = "pa55w0rd";

export type Role = "inspector" | "supervisor" | "admin";
export const ROLES: Role[] = ["inspector", "supervisor", "admin"];
export function isRole(x: unknown): x is Role { return typeof x === "string" && (ROLES as string[]).includes(x); }

/** A decoded, verified session — who is signed in and what they may do. */
export interface Session { role: Role; username: string; branch: string | null; exp: number; }

/** The effective admin password from env, falling back to the built-in default. */
function envOrDefaultPassword(): string {
  const fromEnv = (process.env.ADMIN_PASSWORD || "").trim();
  return fromEnv || DEFAULT_ADMIN_PASSWORD;
}

interface StoredCredential { alg: "scrypt"; salt: string; hash: string; updatedAt: string; }

/** A named account. Passwords are stored scrypt-hashed, never in plaintext. */
export interface Account { username: string; role: Role; alg: "scrypt"; salt: string; hash: string; branch: string | null; createdAt: string; }
/** Account without secrets — safe to send to the client. */
export interface PublicAccount { username: string; role: Role; branch: string | null; createdAt: string; }

function secret(): string {
  return process.env.SESSION_SECRET || "vmbs-dev-secret-change-me";
}
function b64url(s: string): string { return Buffer.from(s).toString("base64url"); }
function sign(payload: string): string { return createHmac("sha256", secret()).update(payload).digest("base64url"); }

/** Mint a signed session token carrying the account's role, username and branch. */
export function createSessionToken(now: number, session: { role: Role; username: string; branch: string | null }): string {
  const body = b64url(JSON.stringify({ role: session.role, user: session.username, branch: session.branch ?? null, exp: now + MAX_AGE * 1000 }));
  return `${body}.${sign(body)}`;
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Decode and verify a session token. Returns null if missing, tampered or expired.
 *  Tolerates legacy tokens (role only, no username/branch) minted before accounts. */
export function readSessionToken(token: string | undefined, now: number): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!isRole(p.role) || typeof p.exp !== "number" || p.exp <= now) return null;
    return { role: p.role, username: typeof p.user === "string" ? p.user : p.role, branch: typeof p.branch === "string" ? p.branch : null, exp: p.exp };
  } catch { return null; }
}

function hashPassword(pw: string, salt: string): string { return scryptSync(pw, salt, 64).toString("hex"); }
function makeHash(pw: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(pw.trim(), salt) };
}

async function readStoredCredential(): Promise<StoredCredential | null> {
  try {
    const buf = await getStorage().read(CRED_BLOB);
    if (!buf) return null;
    const c = JSON.parse(buf.toString("utf8")) as StoredCredential;
    return c?.alg === "scrypt" && c.salt && c.hash ? c : null;
  } catch { return null; }
}

export async function setPassword(newPassword: string): Promise<void> {
  const { salt, hash } = makeHash(newPassword);
  const cred: StoredCredential = { alg: "scrypt", salt, hash, updatedAt: new Date().toISOString() };
  await getStorage().write(CRED_BLOB, Buffer.from(JSON.stringify(cred), "utf8"), "application/json");
}

// ---- Shared role passwords (Inspector / Supervisor) ----
// Staff sign in by role: they pick a role, type their name, and enter one password
// shared across that role. The admin sets these; until set, they fall back to the
// admin default so sign-in works out of the box.
const ROLE_PW_BLOB = "role-passwords.json";
const ROLE_LOGIN_ROLES: Role[] = ["inspector", "supervisor"];

// Built-in shared passwords per staff role, used until an admin sets a custom one
// (Settings → Role sign-in passwords) or overrides via env. Officer = the inspector
// role. These make role sign-in work out of the box, like the admin default password.
const ROLE_DEFAULT_PW: Partial<Record<Role, string>> = { inspector: "0ff1cer", supervisor: "5uperv1sor" };
const ROLE_ENV_KEY: Partial<Record<Role, string>> = { inspector: "OFFICER_PASSWORD", supervisor: "SUPERVISOR_PASSWORD" };
function roleDefaultPassword(role: Role): string {
  const key = ROLE_ENV_KEY[role];
  const fromEnv = key ? (process.env[key] || "").trim() : "";
  return fromEnv || ROLE_DEFAULT_PW[role] || envOrDefaultPassword();
}

async function readRolePasswords(): Promise<Partial<Record<Role, StoredCredential>>> {
  try {
    const buf = await getStorage().read(ROLE_PW_BLOB);
    if (!buf) return {};
    const parsed = JSON.parse(buf.toString("utf8"));
    const out: Partial<Record<Role, StoredCredential>> = {};
    for (const r of ROLE_LOGIN_ROLES) { const c = parsed?.[r]; if (c?.alg === "scrypt" && c.salt && c.hash) out[r] = c; }
    return out;
  } catch { return {}; }
}

/** Set the shared password for a role (admin action). */
export async function setRolePassword(role: Role, newPassword: string): Promise<void> {
  if (!ROLE_LOGIN_ROLES.includes(role)) throw new Error("Not a sign-in role.");
  const store = await readRolePasswords();
  const { salt, hash } = makeHash(newPassword);
  store[role] = { alg: "scrypt", salt, hash, updatedAt: new Date().toISOString() };
  await getStorage().write(ROLE_PW_BLOB, Buffer.from(JSON.stringify(store), "utf8"), "application/json");
}

/** Which role passwords have been set by an admin (vs. still using the default). */
export async function rolePasswordStatus(): Promise<Record<string, boolean>> {
  const store = await readRolePasswords();
  return { inspector: !!store.inspector, supervisor: !!store.supervisor };
}

/** Verify a role's shared password. Uses the admin-set password if present, otherwise
 *  the built-in per-role default (Officer/Supervisor), so role sign-in works out of box. */
export async function checkRoleLogin(role: Role, password: string): Promise<boolean> {
  if (!ROLE_LOGIN_ROLES.includes(role)) return false;
  const pw = (password || "").trim();
  const cred = (await readRolePasswords())[role];
  if (cred) return safeEqual(hashPassword(pw, cred.salt), cred.hash);
  return safeEqual(pw, roleDefaultPassword(role));
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

// ---- Account registry (inspector / supervisor / extra admins) ----

function normUser(u: string): string { return (u || "").trim().toLowerCase(); }

async function readAccounts(): Promise<Account[]> {
  try {
    const buf = await getStorage().read(ACCOUNTS_BLOB);
    if (!buf) return [];
    const parsed = JSON.parse(buf.toString("utf8"));
    const list = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    return list.filter((a: any) => a && typeof a.username === "string" && isRole(a.role) && a.alg === "scrypt" && a.salt && a.hash);
  } catch { return []; }
}
async function writeAccounts(list: Account[]): Promise<void> {
  await getStorage().write(ACCOUNTS_BLOB, Buffer.from(JSON.stringify({ accounts: list }, null, 2), "utf8"), "application/json");
}

function toPublic(a: Account): PublicAccount { return { username: a.username, role: a.role, branch: a.branch, createdAt: a.createdAt }; }

/** All named accounts, secrets stripped — the "admin" login is implicit and not listed. */
export async function listAccounts(): Promise<PublicAccount[]> {
  const list = await readAccounts();
  return list.map(toPublic).sort((x, y) => x.username.localeCompare(y.username));
}

/** Create (or overwrite) a named account. Username is stored lowercased and unique. */
export async function upsertAccount(input: { username: string; password: string; role: Role; branch?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = normUser(input.username);
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) return { ok: false, error: "Username must be 2–32 chars: letters, numbers, . _ -" };
  if (username === "admin") return { ok: false, error: "“admin” is reserved for the built-in admin login." };
  if (!isRole(input.role)) return { ok: false, error: "Unknown role." };
  if ((input.password || "").trim().length < 4) return { ok: false, error: "Password must be at least 4 characters." };
  const list = await readAccounts();
  const { salt, hash } = makeHash(input.password);
  const existing = list.find((a) => a.username === username);
  const account: Account = {
    username, role: input.role, alg: "scrypt", salt, hash,
    branch: input.branch?.trim() || null,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  const next = list.filter((a) => a.username !== username).concat(account);
  await writeAccounts(next);
  return { ok: true };
}

/** Remove a named account. */
export async function removeAccount(username: string): Promise<void> {
  const u = normUser(username);
  const list = await readAccounts();
  await writeAccounts(list.filter((a) => a.username !== u));
}

/** Verify a username + password and, on success, return the role/branch to put in the
 *  session. The built-in admin login ("admin", or a blank username) is checked against
 *  the legacy admin password so existing deployments keep working. */
export async function checkLogin(username: string, password: string): Promise<{ role: Role; username: string; branch: string | null } | null> {
  const uname = normUser(username);
  const pw = (password || "").trim();

  // Named account (may itself be an admin account created in-app).
  if (uname && uname !== "admin") {
    const acct = (await readAccounts()).find((a) => a.username === uname);
    if (!acct) return null;
    return safeEqual(hashPassword(pw, acct.salt), acct.hash) ? { role: acct.role, username: acct.username, branch: acct.branch } : null;
  }

  // Built-in admin login: blank username or "admin".
  if (await checkPassword(pw)) return { role: "admin", username: "admin", branch: null };
  return null;
}

/** Whether admin auth is usable. Always true — a built-in default password
 *  guarantees sign-in works even with no env var or storage configured. */
export async function adminConfigured(): Promise<boolean> {
  return true;
}

/** The current verified session, or null if signed out. */
export function getSession(now: number): Session | null {
  return readSessionToken(cookies().get(SESSION_COOKIE)?.value, now);
}

export function isAdmin(now: number): boolean {
  return getSession(now)?.role === "admin";
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
