import { NextRequest, NextResponse } from "next/server";
import {
  ssoEnabled, exchangeCode, decodeIdToken, claimsValid, emailFromClaims, nameFromClaims, resolveRole,
} from "@/lib/msauth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

// Microsoft redirects here with ?code&state. Verify state (CSRF), exchange the
// code for an id_token (PKCE), validate the token, map the verified email to a
// role (supervisor / inspector — NEVER admin), then issue the same signed
// session cookie the role/admin login uses and land on the app. The admin
// password gate is untouched: SSO never grants admin.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OAUTH_COOKIE = "ms_oauth";

function back(req: NextRequest, error: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = `?sso_error=${encodeURIComponent(error)}`;
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  if (!ssoEnabled()) return back(req, "sso");
  if (req.nextUrl.searchParams.get("error")) return back(req, "sso");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  let saved: { state?: string; nonce?: string; verifier?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_COOKIE)?.value || "{}");
  } catch {
    /* no/invalid cookie */
  }
  if (!code || !state || !saved.state || state !== saved.state || !saved.verifier) {
    return back(req, "sso_state");
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/microsoft/callback`;
  const tok = await exchangeCode({ code, redirectUri, verifier: saved.verifier });
  if (!tok.idToken) return back(req, "sso_token");

  const claims = decodeIdToken(tok.idToken);
  if (!claims || !claimsValid(claims, saved.nonce || "")) return back(req, "sso_token");

  const email = emailFromClaims(claims);
  if (!email) return back(req, "sso_email");

  const role = resolveRole(email);
  if (!role) return back(req, "not_authorized");

  const username = nameFromClaims(claims) || email.split("@")[0];
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(Date.now(), { role, username, branch: null }),
    sessionCookieOptions,
  );
  res.cookies.set(OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
