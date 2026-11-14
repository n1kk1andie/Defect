// Shown only to a customer company whose plan isn't paid (its trial ended or
// its account is suspended): proxy.ts sends them here. "View plan & billing"
// goes to the company's billing page on Pulsus Platform.
import { cookies } from "next/headers";
import { platformSession, platformUrl, PLATFORM_COOKIE } from "@/lib/platform-jwt";
import { cachePlan } from "@/lib/planCache";
import { AccountFrame } from "@/components/account/AccountFrame";

export const dynamic = "force-dynamic";

export default async function LicencePage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  // The proxy sends a lapsed company here without passing on its identity; record the lapse from its own
  // verified session, so the REST API refuses its keys too (and lets them work again once it's paid).
  try {
    const s = await platformSession((await cookies()).get(PLATFORM_COOKIE)?.value);
    if (s?.company?.plan) await cachePlan(s.company.id, s.company.plan);
  } catch { /* an unknown or invalid company id: nothing to record */ }
  const suspended = reason === "suspended";
  return (
    <AccountFrame
      title={suspended ? "Your company's account is suspended. Your data is safe." : "Your free trial has ended. Your data is safe."}
      sub={suspended ? "Pulsus Quality is paused until your company's plan is active again." : "Choose a plan to carry on. Your reviews, actions and settings are kept exactly as you left them."}
    >
      <div className="sf-form">
        <a className="sf-btn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", color: "#fff" }} href={`${platformUrl()}/company#billing`} target="_top">View plan &amp; billing</a>
        <p className="sf-note" style={{ textAlign: "center" }}>Only your company&apos;s owner or an admin can change the plan.</p>
      </div>
    </AccountFrame>
  );
}
