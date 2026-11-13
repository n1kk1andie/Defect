import type { Metadata } from "next";
import { SignUp } from "./SignUp";
import { platformUrl } from "@/lib/platform-jwt";

// Pulsus Quality's own free-trial sign-up: the address stays quality.pulsus.tech throughout.
export const metadata: Metadata = { title: "Pulsus Quality — Start a free trial" };
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return <SignUp hub={platformUrl()} demo={(process.env.DEMO_MODE || "").trim() === "1"} />;
}
