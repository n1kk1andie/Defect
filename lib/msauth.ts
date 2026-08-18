// Microsoft Entra ID (Azure AD) sign-in for Pulsus Quality (Branch Defects) —
// OAuth2/OIDC authorization-code flow with PKCE. This is ADDITIVE and IDENTITY
// ONLY: people sign in as themselves with their company Microsoft account, and
// the verified email is mapped to one of the app's existing roles.
//
// It sits ALONGSIDE the existing role/admin logins (lib/auth.ts) — it does not
// replace them. Crucially it NEVER grants "admin": admin stays behind the admin
// password only. SSO can grant supervisor / inspector, never admin.
//
// INERT UNTIL CONFIGURED: with no AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET set
// (ssoEnabled() === false) nothing changes — the Microsoft button is not shown.
//
// Role mapping (configure in the Vercel project; sensible defaults):
//   SUPERVISOR_EMAILS    -> "supervisor" (defaults to sanchia.henry@myvmgroup.com)
//   ALLOWED_EMAIL_DOMAIN -> "inspector"  (any other company account; default
//                                         myvmgroup.com) — an inspector is anyone.

import { createHash, randomBytes } from "node:crypto";
import type { Role } from "./auth";
import { isDemo, DEMO_DOMAIN, DEMO_SUPERVISOR_EMAILS } from "./demo";

export interface MsConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  enabled: boolean;
}

export function msConfig(): MsConfig {
  const clientId = (process.env.AZURE_AD_CLIENT_ID || "").trim();
  const clientSecret = (process.env.AZURE_AD_CLIENT_SECRET || "").trim();
  const tenant = (process.env.AZURE_AD_TENANT_ID || "common").trim();
  return { clientId, clientSecret, tenant, enabled: !!(clientId && clientSecret) };
}

export const ssoEnabled = (): boolean => msConfig().enabled;

const authority = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;

export const randToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export function authorizeUrl(opts: { redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const { clientId, tenant } = msConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  return `${authority(tenant)}/authorize?${p.toString()}`;
}

export async function exchangeCode(opts: { code: string; redirectUri: string; verifier: string }): Promise<{ idToken?: string; error?: string }> {
  const { clientId, clientSecret, tenant } = msConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
    scope: "openid profile email",
  });
  try {
    const r = await fetch(`${authority(tenant)}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { error: String(d.error_description || d.error || `token ${r.status}`) };
    return { idToken: typeof d.id_token === "string" ? d.id_token : undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "token exchange failed" };
  }
}

export function decodeIdToken(idToken: string): Record<string, unknown> | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function claimsValid(claims: Record<string, unknown>, nonce: string): boolean {
  const { clientId, tenant } = msConfig();
  if (claims.aud !== clientId) return false;
  // Issuer must be Microsoft and match the token's own tenant id — binds the token
  // to a real Entra tenant even under the multi-tenant "common"/"organizations" default.
  const tid = typeof claims.tid === "string" ? claims.tid : "";
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  if (!tid || iss !== `https://login.microsoftonline.com/${tid}/v2.0`) return false;
  if (tenant && tenant !== "common" && tenant !== "organizations" && tid !== tenant) return false;
  if (nonce && claims.nonce !== nonce) return false;
  if (typeof claims.exp === "number" && Date.now() / 1000 > claims.exp + 60) return false;
  return true;
}

export function emailFromClaims(claims: Record<string, unknown>): string {
  const cand = [claims.email, claims.preferred_username, claims.upn].find(
    (v) => typeof v === "string" && (v as string).includes("@"),
  );
  return typeof cand === "string" ? cand.trim().toLowerCase() : "";
}

export function nameFromClaims(claims: Record<string, unknown>): string {
  const n = claims.name ?? claims.given_name;
  return typeof n === "string" ? n.trim() : "";
}

function emailList(name: string): string[] {
  return (process.env[name] || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

// The supervisor(s). Overridable via SUPERVISOR_EMAILS; in a demo deployment the
// default is the fictional demo supervisor, otherwise the real roster default.
function supervisorEmails(): string[] {
  const configured = emailList("SUPERVISOR_EMAILS");
  if (configured.length) return configured;
  return isDemo() ? DEMO_SUPERVISOR_EMAILS : ["sanchia.henry@myvmgroup.com"];
}

// The company email domain that resolves to "inspector" via SSO. Overridable via
// ALLOWED_EMAIL_DOMAIN; defaults to the fictional demo domain in demo mode so no
// real company domain is referenced, otherwise the real one.
function companyDomain(): string {
  const fallback = isDemo() ? DEMO_DOMAIN : "myvmgroup.com";
  return (process.env.ALLOWED_EMAIL_DOMAIN ?? fallback).trim().toLowerCase().replace(/^@/, "");
}

// Map a verified email to a role. Returns null if the person isn't a company
// account (and so isn't permitted to sign in via SSO). NEVER returns "admin":
// admin stays behind the admin password.
export function resolveRole(email: string): Role | null {
  const e = String(email || "").toLowerCase().trim();
  if (!e || !e.includes("@")) return null;
  if (supervisorEmails().includes(e)) return "supervisor";
  const dom = companyDomain();
  if (dom && dom !== "none" && dom !== "off" && e.endsWith("@" + dom)) return "inspector";
  if (emailList("INSPECTOR_EMAILS").includes(e)) return "inspector";
  return null;
}
