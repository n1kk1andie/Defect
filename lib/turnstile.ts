// Cloudflare Turnstile on the sign-up page: shown when the Pulsus account
// service hands out a site key (its GET /api/signup), else its signed sum is
// asked. A demo never shows it. Pure.
export const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function turnstileKey(check: { turnstile?: unknown } | null | undefined, demo: boolean): string {
  if (demo || !check) return "";
  const k = check.turnstile;
  return typeof k === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(k) ? k : "";
}

/** The Microsoft sign-in errors the account service sends back (?error=…), in plain words. */
export const SIGNIN_ERRORS: Record<string, string> = {
  credentials: "Incorrect email or password.",
  not_authorized: "This email doesn't have a Pulsus account. Ask your company's administrator to invite you, or start a free trial.",
  use_reset: "Use the link in your invitation email to set your password, or choose “Forgot password?” to get a new one.",
  company_suspended: "Your company's Pulsus subscription isn't active. Ask your company's owner to open Plan & billing.",
  company_inactive: "Your company's free trial has ended. Ask your company's owner to choose a plan.",
  license_required: "License required. Please contact your organisation's administrator.",
  membership_changed: "Your access changed. Please sign in again.",
  weak_password: "Choose a password of at least 12 characters.",
  mismatch: "The passwords don't match.",
  too_many: "Too many attempts. Please wait a few minutes and try again.",
  storage: "Couldn't save your password just now. Please try again.",
  challenge: "Please answer the quick check again.",
  challenge_expired: "The quick check expired. Please answer the new one.",
  reset_invalid: "This link is invalid or has expired. Use “Forgot password?” to get a new one.",
  reset_used: "This link has already been used. Use “Forgot password?” to get a new one.",
  bad_code: "That code didn't work. Try the newest code from your authenticator app.",
  mfa_expired: "That took too long. Please sign in again.",
  origin: "Sign-in isn't available from this address.",
  sso: "Microsoft sign-in isn't available right now.",
  sso_state: "Microsoft sign-in didn't complete. Please try again.",
  sso_token: "Microsoft sign-in didn't complete. Please try again.",
  sso_email: "Couldn't read your email from Microsoft. Please try again.",
  sso_required: "Your company signs in with single sign-on.",
  sso_domain: "Your company's single sign-on can only sign in addresses on its own domains.",
  not_a_member: "You signed in with your company, but you aren't a member on Pulsus yet. Ask your administrator to add you.",
  idp_mfa_required: "Your company requires multi-factor sign-in at your identity provider.",
  sso_unreachable: "Your company's identity provider couldn't be reached. Please try again.",
};
