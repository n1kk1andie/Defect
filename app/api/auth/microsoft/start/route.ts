import { NextRequest, NextResponse } from "next/server";
import { ssoEnabled, authorizeUrl, randToken, pkceChallenge } from "@/lib/msauth";

// Begin Microsoft sign-in: build the authorize URL (PKCE + state + nonce) and
// stash the one-time secrets in a short-lived httpOnly cookie for the callback.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OAUTH_COOKIE = "ms_oauth";

export function GET(req: NextRequest) {
  if (!ssoEnabled()) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "?sso_error=sso";
    return NextResponse.redirect(url);
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/microsoft/callback`;
  const state = randToken();
  const nonce = randToken();
  const verifier = randToken(48);
  const challenge = pkceChallenge(verifier);

  const res = NextResponse.redirect(authorizeUrl({ redirectUri, state, nonce, challenge }));
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, nonce, verifier }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
