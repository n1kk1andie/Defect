// Shown only to a customer company whose plan isn't paid (its trial ended or
// its account is suspended): proxy.ts sends them here. "View plan & billing"
// goes to the company's billing page on Pulsus Platform.
import { cookies } from "next/headers";
import { platformSession, platformUrl, PLATFORM_COOKIE } from "@/lib/platform-jwt";
import { cachePlan } from "@/lib/planCache";
import { ShieldMark, Tagline } from "@/components/Brand";

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
    <main id="main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 480, textAlign: "center", padding: 32 }}>
        <ShieldMark className="brand-mark" title="Pulsus Quality" />
        <h1 className="headline" style={{ fontSize: 30 }}>{suspended ? "Your company's account is suspended." : "Your free trial has ended."}<span className="accent">Your data is safe.</span></h1>
        <p className="lede" style={{ margin: "12px auto" }}>{suspended ? "Pulsus Quality is paused until your company's plan is active again." : "Choose a plan to carry on. Your reviews, actions and settings are kept exactly as you left them."}</p>
        <a className="btn primary" href={`${platformUrl()}/company#billing`} target="_top">View plan &amp; billing</a>
        <p className="sub mt">Only your company&apos;s owner or an admin can change the plan.</p>
        <Tagline className="mt" />
      </div>
    </main>
  );
}
