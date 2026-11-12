// A demo deployment opens straight in.
//
// The demo (DEMO_MODE=1, demo-quality.pulsus.tech) is the fictional showcase:
// every figure in it is invented sample data. A visitor arriving there — directly,
// or framed inside about.pulsus.tech or demo-executive — lands in the dashboards
// with no sign-in page and no licence wall, as demo-ict and demo-panorama do.
// The padlock still signs the demo personas in, and every write route keeps its
// own role checks, so an anonymous visitor can look but not change anything.
//
// Production never sets DEMO_MODE, so this is inert there. Edge-safe: env only.

/** True only on a demo deployment. */
export function demoOpenView(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DEMO_MODE || "").trim().replace(/^["']+|["']+$/g, "") === "1";
}
