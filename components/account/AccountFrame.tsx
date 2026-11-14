"use client";
// The frame around Pulsus Quality's own sign-in and sign-up pages: the Pulsus
// sign-in standard (components/SignInFrame) — one centred card on the family
// paper (navy by night), the Quality emblem big at the top with its name and
// subtitle, "Live. Signal. Clarity.", then the form; the suite footer below.
import type { ReactNode } from "react";
import { FooterLines } from "@/components/Brand";
import { SignInFrame, MicrosoftButton, type FrameBrand } from "@/components/SignInFrame";

export const QUALITY_BRAND: FrameBrand = {
  word: "Quality",
  sub: "Quality assurance",
  desc: "Branch reviews · defects · corrective actions",
  emblem: "/pulsus-quality-icon-day.png",
  emblemNight: "/pulsus-quality-icon-night.png",
};

/** The suite footer under every sign-in-like page. */
export function AccountFoot() {
  return (
    <>
      <p><a href="https://pulsus.tech/terms">Terms of Use</a> · <a href="https://pulsus.tech/privacy">Privacy Policy</a> · <a href="mailto:support@pulsus.tech">support@pulsus.tech</a></p>
      <p className="foot-lines"><FooterLines /></p>
    </>
  );
}

/** Just the suite's two footer lines: the licence screen standard's footer. */
export function SuiteFoot() {
  return <p className="foot-lines"><FooterLines /></p>;
}

export function AccountFrame({ title, sub, children, foot }: { title: string; sub?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return <SignInFrame brand={QUALITY_BRAND} title={title} lead={sub} foot={foot ?? <AccountFoot />}>{children}</SignInFrame>;
}

/** The licence screen standard in this frame: title, sentence, the full-width red button, the note, the two footer lines. */
export function LicenceNotice({ title, body, href, label, note }: { title: string; body: string; href: string; label: string; note: string }) {
  return (
    <SignInFrame brand={{ ...QUALITY_BRAND, desc: undefined }} foot={<SuiteFoot />}>
      <h2 className="sf-notice-title">{title}</h2>
      <p className="sf-notice-body">{body}</p>
      <a className="sf-btn sf-notice-cta" href={href} target="_top">{label}</a>
      <p className="sf-notice-note">{note}</p>
    </SignInFrame>
  );
}

export { MicrosoftButton };

/** POST JSON to the Pulsus account service from this page, with its cookies. */
export async function hubPost(hub: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(hub + path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store", body: JSON.stringify(body) });
  return { status: r.status, body: ((await r.json().catch(() => ({}))) || {}) as Record<string, unknown> };
}
