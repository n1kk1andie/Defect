// The Command Center's platform token, checked the same way everywhere in
// Pulsus Quality: the front-door proxy (proxy.ts) and the server routes both use
// this one module. Web Crypto + fetch only and no imports, so it runs in either
// runtime (and loads directly in the unit tests).
// The same rules as the other Pulsus products (Communiqué lib/platformToken.js):
//
//   signature  RS256 against a key the Command Center publishes (/api/jwks).
//   key id     the token's kid must name a published key: an unknown kid
//              refreshes the key list once (a rotation), then is refused —
//              never a fallback to another key.
//   issuer     a staff session (pulsus-command-center) or a customer company's
//              session (pulsus-company, which must name its company).
//   audience   the suite ("pulsus-suite") — required. The Command Center has
//              set it on every session since August 2026 and sessions last at
//              most 30 days, so no current token is without it.
//   expiry     exp in the future.
//   revocation the Command Center's /api/session/status says whether the
//              session is still current (removed from the company, role
//              changed, deprovisioned by SCIM, "Sign out everywhere"). Each
//              answer is kept for at most 60 seconds per token, so access ends
//              within a minute. A Command Center that can't be reached leaves
//              the session as it was: an outage must not sign everyone out.
//
// A demo deployment (DEMO_MODE=1) verifies against the demo Command Center's
// own fictional keys; production trusts one endpoint, exactly as configured.

export const PLATFORM_COOKIE = "exec_auth";
export const PLATFORM_JWT_ISSUER = "pulsus-command-center";
export const COMPANY_JWT_ISSUER = "pulsus-company";
export const SUITE_AUDIENCE = "pulsus-suite";

const PROD_HUB = "https://executive.pulsus.tech";
const DEMO_HUB = "https://demo-executive.pulsus.tech";
const isDemoEnv = () => (process.env.DEMO_MODE || "").trim() === "1";
const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^["']+|["']+$/g, "").trim() : "");

/** Where the Command Center publishes its keys: PLATFORM_JWKS_URL, else the demo hub on a demo, else production. */
export function jwksUrl(): string {
  return clean(process.env.PLATFORM_JWKS_URL) || `${isDemoEnv() ? DEMO_HUB : PROD_HUB}/api/jwks`;
}

/** The Command Center's base URL: PLATFORM_URL, else the JWKS host when one is configured, else the demo hub on a demo, else production. */
export function platformUrl(): string {
  const set = clean(process.env.PLATFORM_URL).replace(/\/+$/, "");
  if (set) return set;
  const jwks = clean(process.env.PLATFORM_JWKS_URL);
  if (jwks) { try { return new URL(jwks).origin; } catch { /* fall through */ } }
  return isDemoEnv() ? DEMO_HUB : PROD_HUB;
}

type Jwk = Record<string, string>;
let jwksCache: Jwk[] | null = null;
let jwksAt = 0;

/** The published key with exactly this kid, or null (no kid, unknown kid). */
export function keyFor(keys: Jwk[], kid: unknown): Jwk | null {
  if (!kid || typeof kid !== "string" || !Array.isArray(keys)) return null;
  return keys.find((k) => k && k.kid === kid) || null;
}

async function jwksKeys(force = false): Promise<Jwk[]> {
  const now = Date.now();
  // A forced refresh (a token naming a key we don't have) is allowed at most once a minute.
  if (jwksCache && now - jwksAt < (force ? 60 * 1000 : 5 * 60 * 1000)) return jwksCache;
  // A demo collects keys from the configured endpoint AND its own hub, so a
  // stale PLATFORM_JWKS_URL on the demo project can't lock every visitor out.
  // Production: one endpoint, exactly as configured — no widening of trust.
  const urls = [jwksUrl()];
  const hub = `${DEMO_HUB}/api/jwks`;
  if (isDemoEnv() && !urls.includes(hub)) urls.push(hub);
  const keys: Jwk[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) continue;
      for (const k of (((await r.json()).keys as Jwk[]) || [])) keys.push(k);
    } catch { /* try the next endpoint */ }
  }
  if (!keys.length) throw new Error("jwks unavailable");
  jwksCache = keys;
  jwksAt = now;
  return jwksCache;
}

function b64urlBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlStr = (s: string) => new TextDecoder().decode(b64urlBytes(s));

/** Does the payload name the suite audience? Required (no transition left). */
export function audienceOk(payload: Record<string, unknown> | null | undefined): boolean {
  const aud = payload && payload.aud;
  if (typeof aud === "string") return aud === SUITE_AUDIENCE;
  return Array.isArray(aud) && aud.includes(SUITE_AUDIENCE);
}

/** The claim rules for a platform SESSION (not a service grant). */
export function sessionClaimsOk(p: Record<string, unknown>): boolean {
  if (p.iss !== PLATFORM_JWT_ISSUER && p.iss !== COMPANY_JWT_ISSUER) return false;
  if (p.iss === COMPANY_JWT_ISSUER && !(typeof p.company_id === "string" && p.company_id.trim())) return false;
  return audienceOk(p);
}

/** Signature (a published kid, RS256), expiry and the caller's claim checks → the payload, or null. */
export async function verifySigned(token: string | undefined, claimsOk: (p: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
  if (!token || token.split(".").length !== 3) return null;
  const [h, p, sig] = token.split(".");
  let header: Record<string, string>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlStr(h));
    payload = JSON.parse(b64urlStr(p));
  } catch {
    return null;
  }
  if (!header || header.alg !== "RS256") return null;
  if (!payload || typeof payload !== "object" || !claimsOk(payload)) return null;
  if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) return null;

  let keys: Jwk[];
  try { keys = await jwksKeys(); } catch { return null; }
  let jwk = keyFor(keys, header.kid);
  if (!jwk) { try { jwk = keyFor(await jwksKeys(true), header.kid); } catch { jwk = null; } }
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key,
      b64urlBytes(sig) as unknown as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
    );
    return ok ? payload : null;
  } catch {
    return null;
  }
}

/** The issuer a token claims (unverified — only to route between checks). */
export function claimedIssuer(token: string | undefined): string | null {
  if (!token || token.split(".").length !== 3) return null;
  try { const iss = JSON.parse(b64urlStr(token.split(".")[1])).iss; return typeof iss === "string" ? iss : null; } catch { return null; }
}

// ── revocation status ───────────────────────────────────────────────────────
export const STATUS_TTL_MS = 60_000;
/** Reasons that end a session. Anything else ("invalid": the Command Center
 *  couldn't read a token we verified — a configuration mismatch) is unknown. */
export const REVOKED = new Set(["signed_out", "company_signed_out", "membership_changed", "company_inactive"]);

export type SessionStatus = { active: boolean; reason?: string; checked: boolean };
const statusCache = new Map<string, { at: number; value: SessionStatus }>();

async function cacheKey(token: string): Promise<string> {
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return token.slice(-64); }
}

/** The Command Center's answer for this token. `checked` is false when it couldn't be asked (fail open). */
export async function sessionStatus(
  token: string | undefined,
  base: string = platformUrl(),
  { fetchImpl = fetch, nowMs = Date.now(), timeoutMs = 2500 }: { fetchImpl?: typeof fetch; nowMs?: number; timeoutMs?: number } = {},
): Promise<SessionStatus> {
  if (!token || !base) return { active: true, checked: false };
  const key = await cacheKey(token);
  const hit = statusCache.get(key);
  if (hit && nowMs - hit.at < STATUS_TTL_MS) return hit.value;
  let value: SessionStatus = { active: true, checked: false };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${base.replace(/\/+$/, "")}/api/session/status`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal: ctl.signal,
    });
    if (r.ok) {
      const d = (await r.json()) as { active?: unknown; reason?: unknown } | null;
      if (d && d.active === false && typeof d.reason === "string" && REVOKED.has(d.reason)) value = { active: false, reason: d.reason, checked: true };
      else if (d && d.active === true) value = { active: true, checked: true };
    }
  } catch { /* unreachable: leave the session as it was */ } finally { clearTimeout(t); }
  if (statusCache.size > 5000) statusCache.clear();
  // A failed check is retried sooner (10 s) than a real answer is kept.
  statusCache.set(key, { at: value.checked ? nowMs : nowMs - STATUS_TTL_MS + 10_000, value });
  return value;
}

/** For tests. */
export function clearStatusCache(): void { statusCache.clear(); }

/** A verified, still-current platform session → its payload, or null. */
export async function currentSession(token: string | undefined): Promise<Record<string, unknown> | null> {
  const payload = await verifySigned(token, sessionClaimsOk);
  if (!payload) return null;
  return (await sessionStatus(token)).active ? payload : null;
}

// ── what the server routes use ──────────────────────────────────────────────

/** Verify the platform session (signature, kid, issuer, audience, expiry, not
 *  revoked) and return its payload, or null. */
export async function platformJwtPayload(token: string | undefined): Promise<Record<string, unknown> | null> {
  return currentSession(token);
}

/** Verify the platform session and return its lower-cased email claim, or null. */
export async function platformJwtEmail(token: string | undefined): Promise<string | null> {
  const payload = await platformJwtPayload(token);
  if (!payload) return null;
  const email = String((payload.email as string) || (payload.sub as string) || "").trim().toLowerCase();
  return email || null;
}

// The suite's signed service grant: the Command Center reading ONE company's
// figures server to server for ONE purpose (its lib/jwtIssuer.ts
// issueServiceGrant). Its own issuer and audience — so a session check never
// takes it for a session — at most five minutes, no email. The one scope Quality
// answers: "quality.pulse" (/api/pulse, the Command Center brief's summary feed).
export const SERVICE_GRANT_ISSUER = "pulsus-service-grant";
export const SERVICE_GRANT_AUDIENCE = "pulsus-module-read";
/** The claim rules for a service grant for exactly this scope. */
export function serviceGrantClaimsOk(x: Record<string, unknown>, scope: string): boolean {
  return x.iss === SERVICE_GRANT_ISSUER && (x.aud === SERVICE_GRANT_AUDIENCE || (Array.isArray(x.aud) && x.aud.includes(SERVICE_GRANT_AUDIENCE))) &&
    x.typ === "service-grant" && x.scope === scope && typeof x.iat === "number" && typeof x.exp === "number" && x.exp - x.iat <= 300;
}

/** The company a Bearer service grant is for (scope must match), or null. */
export async function serviceGrantCompany(authorization: string | null, scope: string): Promise<{ id: string; name: string } | null> {
  const a = String(authorization || "");
  if (!a.startsWith("Bearer ")) return null;
  const p = await verifySigned(a.slice(7).trim(), (x) => serviceGrantClaimsOk(x, scope));
  const id = p && typeof p.company_id === "string" ? p.company_id : "";
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return null;
  const name = typeof p!.company_name === "string" && p!.company_name.trim() ? (p!.company_name as string).trim().slice(0, 80) : id;
  return { id, name };
}

// ── the session, as Quality reads it ───────────────────────────────────────────
/** A verified platform session: who, whether they are the platform operator,
 *  and — for a customer company's session — the company, the member's role in
 *  it and the modules the company is entitled to. */
export interface PlatformSession {
  email: string;
  operator: boolean;
  company: { id: string; name: string; role: string; modules: string[]; plan?: SessionPlan } | null;
}

/** The company's plan as its session carries it (Command Center lib/platform/planClaims.ts). */
export interface SessionPlan { standing: "trial" | "active" | "past_due" | "suspended" | "ended"; trialEndsAt: string | null }
const STANDINGS = ["trial", "active", "past_due", "suspended", "ended"] as const;

/** Read a verified session payload into a PlatformSession (null without an email). */
export function sessionFrom(payload: Record<string, unknown> | null): PlatformSession | null {
  if (!payload) return null;
  const email = String((payload.email as string) || (payload.sub as string) || "").trim().toLowerCase();
  if (!email) return null;
  if (payload.iss !== COMPANY_JWT_ISSUER) return { email, operator: payload.iss === PLATFORM_JWT_ISSUER && payload.op === true, company: null };
  const id = String(payload.company_id || "");
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return null;
  return {
    email,
    operator: false,
    company: {
      id,
      name: typeof payload.company_name === "string" ? payload.company_name.slice(0, 80) : id,
      role: typeof payload.role === "string" ? payload.role : "viewer",
      modules: Array.isArray(payload.modules) ? payload.modules.filter((m): m is string => typeof m === "string") : [],
      ...((STANDINGS as readonly string[]).includes(String(payload.standing))
        ? { plan: { standing: payload.standing as SessionPlan["standing"], trialEndsAt: typeof payload.trial_ends_at === "string" && !Number.isNaN(Date.parse(payload.trial_ends_at)) ? payload.trial_ends_at : null } }
        : {}),
    },
  };
}

/** Verify (signature, kid, issuer, audience, expiry, not revoked) and read the session. */
export async function platformSession(token: string | undefined): Promise<PlatformSession | null> {
  return sessionFrom(await currentSession(token));
}
