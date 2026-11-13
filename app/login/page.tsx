import { SignIn } from "./SignIn";
import { platformUrl } from "@/lib/platform-jwt";

// Pulsus Quality's own sign-in page, against the Pulsus account service.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const to = typeof next === "string" && /^\/(?![\/\\])/.test(next) && !/^\/(login|signup)(?:[/?#]|$)/.test(next) ? next : "/";
  return <SignIn hub={platformUrl()} next={to} error={typeof error === "string" ? error : ""} />;
}
