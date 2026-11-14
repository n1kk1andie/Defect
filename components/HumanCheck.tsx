"use client";
// The human check on the sign-in, forgot-password and sign-up forms
// (lib/humanCheck.ts). The account service's GET says what to prove:
//   { turnstile: siteKey } → Cloudflare Turnstile, managed and "interaction-
//     only": out of sight unless Cloudflare needs the visitor to click it;
//   { a, b, exp, sig }     → the signed one-time check, which the page completes
//     itself — nobody is ever asked a sum;
//   nothing                → no check (a demo).
// fields() resolves the body fields to send with the form (waiting for
// Cloudflare's pass when needed) and throws "challenge" / "check_failed" when
// the check didn't pass or couldn't load. Each pass is single-use, so the form
// calls next() after every send.
import { useCallback, useEffect, useRef, useState } from "react";

const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const WAIT_MS = 60_000;

interface TurnstileApi { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id?: string) => void }
type Win = Window & { turnstile?: TurnstileApi };

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  const w = window as Win;
  if (w.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TURNSTILE_JS; s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error("turnstile")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export type HumanOffer = { turnstile?: unknown; a?: unknown; b?: unknown; exp?: unknown; sig?: unknown } | null;

/** The signed one-time check, completed: the fields the service expects, or {} when it sent none. */
export function solveCheck(o: HumanOffer): Record<string, unknown> {
  const { a, b, exp, sig } = (o || {}) as Record<string, unknown>;
  return typeof a === "number" && typeof b === "number" && typeof exp === "number" && typeof sig === "string" ? { answer: a + b, exp, sig } : {};
}

export function turnstileKeyOf(o: HumanOffer): string {
  const k = o?.turnstile;
  return typeof k === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(k) ? k : "";
}

export function useHumanCheck(offer: HumanOffer, language?: string) {
  const siteKey = turnstileKeyOf(offer);
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const token = useRef("");
  const broken = useRef(false);
  const waiting = useRef<((t: string) => void)[]>([]);
  const [, bump] = useState(0);

  const settle = useCallback((t: string) => {
    token.current = t;
    if (t || broken.current) { const w = waiting.current; waiting.current = []; for (const f of w) f(t); }
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let gone = false;
    broken.current = false;
    loadScript().then(() => {
      const w = window as Win;
      if (gone || !box.current || !w.turnstile) return;
      const root = document.documentElement;
      const t = root.dataset.theme || root.dataset.pzTheme;
      id.current = w.turnstile.render(box.current, {
        sitekey: siteKey,
        appearance: "interaction-only",
        theme: t === "dark" || t === "light" ? t : "auto",
        ...(language ? { language } : {}),
        callback: (v: string) => { broken.current = false; settle(v); },
        "expired-callback": () => settle(""),
        "error-callback": () => { broken.current = true; settle(""); bump((n) => n + 1); },
      });
    }).catch(() => { broken.current = true; settle(""); });
    return () => {
      gone = true;
      const w = window as Win;
      if (id.current && w.turnstile) w.turnstile.remove(id.current);
      id.current = null; token.current = "";
    };
  }, [siteKey, language, settle]);

  /** The fields to send with the form. Throws "challenge" or "check_failed". */
  const fields = useCallback(async (): Promise<Record<string, unknown>> => {
    if (!siteKey) return solveCheck(offer);
    let t = token.current;
    if (!t && !broken.current) {
      t = await new Promise<string>((resolve) => {
        const done = (v: string) => { clearTimeout(timer); resolve(v); };
        const timer = setTimeout(() => { waiting.current = waiting.current.filter((f) => f !== done); resolve(""); }, WAIT_MS);
        waiting.current.push(done);
      });
    }
    if (!t) throw broken.current ? "check_failed" : "challenge";
    return { turnstile: t };
  }, [siteKey, offer]);

  /** Spend the current pass and ask Cloudflare for the next one. */
  const next = useCallback(() => {
    token.current = ""; broken.current = false;
    const w = window as Win;
    if (id.current && w.turnstile) w.turnstile.reset(id.current);
  }, []);

  return { box, fields, next, turnstile: !!siteKey };
}

/** Where the widget goes: takes no room until Cloudflare asks the visitor to click. */
export function HumanCheckBox({ check }: { check: { box: React.RefObject<HTMLDivElement | null>; turnstile: boolean } }) {
  return check.turnstile ? <div ref={check.box} className="human-check" /> : null;
}
