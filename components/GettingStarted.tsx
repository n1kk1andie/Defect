"use client";
// The demo's "Getting started" card: the six things the guided tour talks
// about, as steps a visitor can follow at their own pace. Each step opens its
// screen and is ticked once that screen has been seen (in this browser). The
// tour's second stop outlines this card. DEMO ONLY: the Shell shows it on Pulse
// and mounts it on every screen, so every screen seen counts.
import { useEffect, useState } from "react";
import Link from "next/link";

export interface StartStep {
  /** The screen the step opens, and that ticks it once seen. */
  path: string;
  label: string;
  detail: string;
}

/** What the tour walks through, in its order (components/demoTourStops.ts). */
export const START_STEPS: StartStep[] = [
  { path: "/", label: "See where quality stands", detail: "Pulse: the defect rate, every branch and process area, and the trend." },
  { path: "/inspect", label: "Go and see", detail: "Inspect: inspections and field visits on a phone, approved by a supervisor." },
  { path: "/actions", label: "Turn findings into action", detail: "Actions: an owner, a due date, the root cause and independent verification." },
  { path: "/insights", label: "Find what keeps coming back", detail: "Insights: recurring issues, the watchlist and the resolution gap." },
  { path: "/risk", label: "Rank every branch by risk", detail: "Risk: a score from 0 to 100, the reasons, and how often to visit." },
  { path: "/report", label: "Take it to the committee", detail: "Report: the executive report, and the committee report as PDF or Excel." },
];

const KEY = "pulsus.qualityStart.seen";
function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

export default function GettingStarted({ show, path, onTour }: {
  /** On Pulse only; mounted everywhere so every screen seen counts. */
  show: boolean;
  /** The screen on show now (it counts as seen). */
  path: string;
  onTour: () => void;
}) {
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    const was = readSeen();
    const now = was.includes(path) ? was : [...was, path];
    setSeen(now);
    if (now !== was) { try { localStorage.setItem(KEY, JSON.stringify(now)); } catch { /* private window: ticks last this visit only */ } }
  }, [path]);
  if (!show) return null;
  const done = START_STEPS.filter((s) => seen.includes(s.path)).length;
  const next = START_STEPS.findIndex((s) => !seen.includes(s.path));
  return (
    <section className="card startcard" data-tour="start" aria-labelledby="start-title">
      <div className="startcard-head">
        <h2 id="start-title" className="h2" style={{ margin: 0 }}>Getting started</h2>
        <span className="startcard-meta">
          <span className="sub">{done} of {START_STEPS.length} done</span>
          <button type="button" className="startcard-tour" onClick={onTour}>▶ Watch the tour</button>
        </span>
      </div>
      <ol className="startsteps">
        {START_STEPS.map((s, i) => {
          const ok = seen.includes(s.path);
          return (
            <li key={s.path} className={ok ? "done" : i === next ? "next" : ""}>
              <span className="startnum" aria-hidden="true">{ok ? "✓" : i + 1}</span>
              <span>
                <Link className="startlink" href={s.path}>{s.label}</Link>
                {ok && <span className="sr"> (done)</span>}
                <span className="startdetail">{s.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
