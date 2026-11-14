"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Demo deployments only (the root layout mounts it when DEMO_MODE is "1"):
// tells the Pulsus platform which demo pages a registered visitor explored.
// Once per page navigation, at most once a minute per path; the platform reads
// the visitor's pz_demo cookie (credentials: "include") and records it.
const TRACK_URL = "https://executive.pulsus.tech/api/demo/track";
const DEDUPE_MS = 60 * 1000;
const sent = new Map<string, number>();

export default function DemoBeacon({ app }: { app: string }) {
  const path = usePathname();
  useEffect(() => {
    if (!path) return;
    const key = `pz_demo_track:${app}:${path}`;
    const now = Date.now();
    let last = sent.get(key) ?? 0;
    try { last = Math.max(last, Number(sessionStorage.getItem(key)) || 0); } catch { /* storage blocked */ }
    if (now - last < DEDUPE_MS) return;
    sent.set(key, now);
    try { sessionStorage.setItem(key, String(now)); } catch { /* storage blocked */ }
    try {
      void fetch(TRACK_URL, {
        method: "POST",
        mode: "cors",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, path }),
      }).catch(() => {});
    } catch { /* never let tracking break a page */ }
  }, [app, path]);
  return null;
}
