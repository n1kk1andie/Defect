// Shown only to a customer company whose own Pulsus subscription isn't active
// (its trial ended or its account is suspended): proxy.ts sends them here. The
// suite's licence screen standard (lib/licenseWall.ts): "Renew and pay" opens
// Pulsus Quality's own Renew and pay page (/renew), straight to Stripe.
import { cookies } from "next/headers";
import { platformSession, PLATFORM_COOKIE } from "@/lib/platform-jwt";
import { cachePlan } from "@/lib/planCache";
import { BILLING_NOTE, LICENSE_WALL_TITLE, PAUSED_MESSAGE, RENEW_LABEL, renewUrl } from "@/lib/licenseWall";
import { LicenceNotice } from "@/components/account/AccountFrame";

export const dynamic = "force-dynamic";

export default async function LicencePage() {
  // The proxy sends a lapsed company here without passing on its identity; record the lapse from its own
  // verified session, so the REST API refuses its keys too (and lets them work again once it's paid).
  try {
    const s = await platformSession((await cookies()).get(PLATFORM_COOKIE)?.value);
    if (s?.company?.plan) await cachePlan(s.company.id, s.company.plan);
  } catch { /* an unknown or invalid company id: nothing to record */ }
  return <LicenceNotice title={LICENSE_WALL_TITLE} body={PAUSED_MESSAGE} href={renewUrl()} label={RENEW_LABEL} note={BILLING_NOTE} />;
}
