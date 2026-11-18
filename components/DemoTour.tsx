"use client";
// The demo's guided tour: a short narrated show through Meridian Financial
// Group's quality programme, screen by screen (components/demoTourStops.ts).
//
// DEMO ONLY: the Shell mounts it on a demo build (NEXT_PUBLIC_DEMO_MODE=1). It
// starts by itself the first time a browser opens the demo's Pulse, and again
// from "▶ Tour" in the top bar. Each stop moves to its screen (through the
// app's own router), rings its menu item (the sidebar, or the tab bar and
// "More" on a phone), brings the part that matters into view, outlines it and
// shows a caption. It changes nothing: it only navigates. Pause, Back, Next or
// Close at any time (Esc closes, the arrow keys step).
//
// Narration: ONE recording (public/tour, made by scripts/make-tour-audio.ts),
// with public/tour/manifest.json saying where each stop starts. It plays
// straight through and the tour follows it; Next and Back move within it. A
// phone lets a page start sound only from a tap, so where the browser refuses,
// the tour carries on silently and the first tap anywhere starts the voice.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { STOPS, type Stop } from "./demoTourStops";

const STEP_MS = 13000;
const SEEN_KEY = "pulsus.qualityTour.seen";
const VOICE_KEY = "pulsus.qualityTour.voice";

/** Has this browser already been shown the tour? */
export function tourSeen(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
const markSeen = () => { try { window.localStorage.setItem(SEEN_KEY, "1"); } catch { /* shows again */ } };
const voicePref = (): boolean => { try { return window.localStorage.getItem(VOICE_KEY) !== "off"; } catch { return true; } };
const saveVoicePref = (on: boolean) => { try { window.localStorage.setItem(VOICE_KEY, on ? "on" : "off"); } catch { /* not kept */ } };

type Box = { top: number; left: number; width: number; height: number };
type Track = { file: string; marks: { id: string; start: number; end: number }[] };

const visible = (el: Element | null | undefined): el is Element => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
const boxOf = (r: DOMRect, pad: number): Box => ({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
const same = (a: Box | null, b: Box | null) => !!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** The screen on show: the Shell marks <main> with its path once that screen has rendered. */
const screen = (path: string) => document.querySelector(`main[data-tour-path="${path}"]`);
/** One of a stop's targets (see Stop.target), on its own screen only. */
function findOne(path: string, sel: string): Element | null {
  if (sel.startsWith("@")) return screen(path) ? document.querySelector(sel.slice(1)) : null;
  const root = screen(path);
  if (!root) return null;
  if (sel.startsWith("card:")) {
    const title = sel.slice(5).toLowerCase();
    return Array.from(root.querySelectorAll("section")).find((s) => {
      const h = s.querySelector(":scope > h2, :scope > .card-h h2");
      return !!h && (h.textContent || "").trim().toLowerCase().startsWith(title);
    }) ?? null;
  }
  return root.querySelector(sel);
}
const findTarget = (stop: Stop) => stop.target.map((s) => findOne(stop.path, s)).find(visible) ?? null;

/** The menu items that lead to a stop's screen: its sidebar link, or on a phone its tab (or "More"). */
function menuButtons(stop: Stop): Element[] {
  if (!stop.menu) return [];
  const side = document.querySelector(`.sidenav a[href="${stop.path}"]`);
  const tab = document.querySelector(`.tabbar a[href="${stop.path}"]`) ?? document.querySelector('.tabbar a[href="/more"]');
  return [side, tab].filter(visible);
}
/** On screen and on top at its centre (not under the top bar or the caption)? */
function uncovered(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}
/** The bottom of the sticky top bar, so an outlined part is never under it. */
const headerH = () => { const h = document.querySelector(".topbar")?.getBoundingClientRect(); return h && h.height > 0 && h.bottom > 0 && h.top <= 1 ? h.bottom : 0; };
const inBar = (el: Element) => !!el.closest(".topbar");

export default function DemoTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const pathRef = useRef(pathname); pathRef.current = pathname;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [box, setBox] = useState<Box | null>(null);
  const [rings, setRings] = useState<Box[]>([]);
  const [lift, setLift] = useState(16);
  const [elapsed, setElapsed] = useState(0);
  const target = useRef<Element | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const playingRef = useRef(true); playingRef.current = playing;
  const iRef = useRef(0); iRef.current = i;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ── The narration
  const [track, setTrack] = useState<Track | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceOnRef = useRef(true); voiceOnRef.current = voiceOn;
  const [blocked, setBlocked] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<Track | null>(null); trackRef.current = track;
  const startOf = (k: number) => trackRef.current?.marks[k]?.start ?? 0;
  const stopAt = (t: number) => { const m = trackRef.current?.marks ?? []; let k = 0; for (let n = 0; n < m.length; n++) if (t >= m[n].start - 0.05) k = n; return k; };

  useEffect(() => {
    if (!open || track) return;
    fetch("/tour/manifest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (m?.file && Array.isArray(m.marks) && m.marks.length === STOPS.length) setTrack({ file: m.file, marks: m.marks }); })
      .catch(() => null);
  }, [open, track]);

  const player = useCallback((): HTMLAudioElement | null => {
    const t = trackRef.current;
    if (!t) return null;
    let a = audio.current;
    if (!a) {
      a = audio.current = new Audio();
      a.preload = "auto";
      a.ontimeupdate = () => {
        const tk = trackRef.current; if (!tk) return;
        const k = stopAt(a!.currentTime);
        const m = tk.marks[k], next = tk.marks[k + 1]?.start ?? m.end + 1;
        if (k !== iRef.current) setI(k);
        setElapsed(STEP_MS * Math.min(1, Math.max(0, (a!.currentTime - m.start) / Math.max(0.5, next - m.start))));
      };
      a.onended = () => { setNarrating(false); setPlaying(false); setElapsed(STEP_MS); };
      a.onerror = () => { setNarrating(false); setTrack(null); };
    }
    if (!a.src.endsWith(`/tour/${t.file}`)) a.src = `/tour/${t.file}`;
    return a;
  }, []);
  const playFrom = useCallback((k: number) => {
    const a = player();
    if (!a) return;
    try { a.currentTime = startOf(k); } catch { /* not loaded yet */ }
    a.play().then(() => { setNarrating(true); setBlocked(false); }).catch((e: Error) => { if (e?.name === "NotAllowedError") { setNarrating(false); setBlocked(true); } });
  }, [player]);
  const silence = useCallback(() => { audio.current?.pause(); setNarrating(false); }, []);

  useEffect(() => {
    if (!open) return;
    setI(0); setPlaying(true); setElapsed(0); markSeen(); setVoiceOn(voicePref()); setBlocked(false);
  }, [open]);
  useEffect(() => {
    if (!open || !track) return;
    if (voiceOn) { if (!narrating && !blocked && playingRef.current) playFrom(iRef.current); } else silence();
  }, [open, track, voiceOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !blocked || !voiceOn) return;
    const on = () => { if (playingRef.current) playFrom(iRef.current); };
    document.addEventListener("pointerdown", on, true);
    document.addEventListener("keydown", on, true);
    return () => { document.removeEventListener("pointerdown", on, true); document.removeEventListener("keydown", on, true); };
  }, [open, blocked, voiceOn, playFrom]);
  useEffect(() => () => { audio.current?.pause(); }, []);

  const toggleVoice = () => { const on = !voiceOn; saveVoicePref(on); setVoiceOn(on); if (on) { setPlaying(true); playFrom(i); } else silence(); };
  const close = useCallback(() => { silence(); target.current = null; setBox(null); onClose(); }, [onClose, silence]);
  const step = useCallback((n: number) => {
    setElapsed(0);
    if (n >= STOPS.length) { close(); return; }
    const k = Math.max(0, n);
    setI(k);
    const a = audio.current;
    if (a && voiceOnRef.current && trackRef.current) { try { a.currentTime = startOf(k); } catch { /* ignore */ } }
  }, [close]);

  // Each stop: move to its screen, then wait for the part, bring it into view
  // under the top bar, and pan slowly down through it when it is taller than the room.
  useEffect(() => {
    if (!open) return;
    const stop = STOPS[i];
    target.current = null; setBox(null);
    if (pathRef.current !== stop.path) router.push(stop.path, { scroll: false });
    let tries = 0, later = 0, recheck = 0, pan = 0;
    const room = () => window.innerHeight - (dialog.current?.getBoundingClientRect().height ?? 240) - 40 - headerH();
    const place = (el: Element, smooth: boolean) => {
      if (inBar(el)) { window.scrollTo({ top: 0, behavior: smooth && !reduced ? "smooth" : "auto" }); return; }
      const off = el.getBoundingClientRect().top - (headerH() + 16);
      if (Math.abs(off) > 24) window.scrollTo({ top: Math.max(0, window.scrollY + off), behavior: smooth && !reduced ? "smooth" : "auto" });
    };
    const panThrough = (el: Element) => {
      later = window.setTimeout(() => {
        // A screen that loads late can undo the scroll: put the part back under the top bar.
        place(el, false);
        const r = el.getBoundingClientRect();
        // A long list (every inspection, every action) pans a screenful or so, not to its very end.
        const extra = inBar(el) ? 0 : Math.min(Math.max(0, r.bottom - (headerH() + 16 + room())), Math.round(window.innerHeight * 0.9));
        // A table wider than the screen (a phone) also slides sideways, so its last columns show.
        const wide = [el, ...Array.from(el.querySelectorAll("*"))].find((x) => x instanceof HTMLElement && x.scrollWidth > x.clientWidth + 24 && ["auto", "scroll"].includes(getComputedStyle(x).overflowX)) as HTMLElement | undefined;
        const wideMax = wide ? wide.scrollWidth - wide.clientWidth : 0;
        if (reduced || (extra <= 24 && !wide)) return;
        const from = window.scrollY, dur = Math.max(4000, Math.min(7000, 1200 + extra * 9));
        let t = 0, last = performance.now();
        const tick = (now: number) => {
          if (playingRef.current) t += now - last;
          last = now;
          const k = Math.min(1, t / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          window.scrollTo(0, from + extra * e);
          if (wide) wide.scrollLeft = wideMax * e;
          if (k < 1) pan = window.requestAnimationFrame(tick);
        };
        pan = window.requestAnimationFrame(tick);
      }, 1800);
    };
    // A screen reached through the router can take a few seconds to arrive.
    const find = window.setInterval(() => {
      tries++;
      const el = findTarget(stop);
      if (el || tries > 120) {
        window.clearInterval(find);
        if (el) {
          target.current = el;
          place(el, true);
          // The router may still scroll the new screen to the top after it arrives: check once more.
          recheck = window.setTimeout(() => { if (target.current === el && !inBar(el) && Math.abs(el.getBoundingClientRect().top - (headerH() + 16)) > 80 && el.getBoundingClientRect().top > room()) place(el, true); }, 700);
          panThrough(el);
        } else window.scrollTo(0, 0);
      }
    }, 100);
    return () => { window.clearInterval(find); window.clearTimeout(later); window.clearTimeout(recheck); window.cancelAnimationFrame(pan); };
  }, [open, i, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the outline on the part, the ring on the menu item, and the caption above the tab bar.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      // A screen that redraws after loading replaces the part: find it again.
      if (target.current && !target.current.isConnected) target.current = findTarget(STOPS[iRef.current]);
      const el = target.current;
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect();
        const capTop = dialog.current ? dialog.current.getBoundingClientRect().top - 8 : window.innerHeight;
        const top = inBar(el) ? r.top - 6 : Math.max(r.top - 6, headerH() + 2), bottom = Math.min(r.bottom + 6, capTop + 40);
        const next = bottom - top > 12 ? { top, left: r.left - 6, width: r.width + 12, height: bottom - top } : null;
        setBox((b) => (next ? (same(b, next) ? b : next) : b ? null : b));
      } else setBox((b) => (b ? null : b));
      const rs = menuButtons(STOPS[iRef.current]).filter(uncovered).map((b) => boxOf(b.getBoundingClientRect(), 3));
      setRings((was) => (was.length === rs.length && was.every((w, k) => same(w, rs[k])) ? was : rs));
      const br = document.querySelector(".tabbar")?.getBoundingClientRect();
      const up = br && br.height > 0 && br.bottom >= window.innerHeight - 48 && br.top > window.innerHeight / 2 ? Math.round(window.innerHeight - br.top) + 10 : 16;
      setLift((l) => (l === up ? l : up));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  // Without the voice the show moves on by its own timer.
  useEffect(() => {
    if (!open || !playing || narrating) return;
    const t = window.setInterval(() => setElapsed((e) => e + 100), 100);
    return () => window.clearInterval(t);
  }, [open, playing, narrating, i]);
  useEffect(() => { if (open && playing && !narrating && elapsed >= STEP_MS) step(i + 1); }, [open, playing, narrating, elapsed, i, step]);
  useEffect(() => {
    const a = audio.current;
    if (!a || !narrating) return;
    if (!playing) a.pause(); else if (a.paused) a.play().catch(() => null);
  }, [playing, narrating]);

  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(i + 1);
      else if (e.key === "ArrowLeft") step(i - 1);
      else if (e.key === " " && !["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"].includes((e.target as HTMLElement)?.tagName)) { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, i, step, close]);

  if (!open) return null;
  const stop = STOPS[i];
  const last = i === STOPS.length - 1;
  const font = "'IBM Plex Sans', system-ui, sans-serif";
  const btn: CSSProperties = { font: `600 13px/1 ${font}`, padding: "9px 13px", borderRadius: 10, border: "1px solid var(--line-2)", background: "var(--card)", color: "var(--ink)", cursor: "pointer" };
  const link: CSSProperties = { font: `600 12.5px/1 ${font}`, background: "none", border: "none", color: "var(--ink)", cursor: "pointer", padding: 4, whiteSpace: "nowrap" };
  const waiting = voiceOn && blocked;
  return (
    <>
      {box ? (
        <div aria-hidden data-tour-outline="" style={{ position: "fixed", top: box.top, left: box.left, width: box.width, height: box.height, borderRadius: 16, boxShadow: "0 0 0 3px var(--red), 0 0 0 9999px rgba(6,8,24,.5)", pointerEvents: "none", zIndex: 9998, transition: reduced ? undefined : "all .35s ease" }} />
      ) : <div aria-hidden style={{ position: "fixed", inset: 0, background: "rgba(6,8,24,.3)", pointerEvents: "none", zIndex: 9998 }} />}
      {rings.map((r, k) => (
        <div key={k} aria-hidden data-tour-ring="" style={{ position: "fixed", top: r.top, left: r.left, width: r.width, height: r.height, borderRadius: 12, boxShadow: "0 0 0 3px var(--red), 0 0 0 7px rgba(212,0,36,.25)", pointerEvents: "none", zIndex: 10000, animation: reduced ? undefined : "pq-tour-pulse 1.4s ease-in-out infinite" }} />
      ))}
      <style>{"@keyframes pq-tour-pulse{0%,100%{opacity:1}50%{opacity:.45}}"}</style>
      <div ref={dialog} role="dialog" aria-modal="false" aria-labelledby="pq-tour-title"
        style={{ position: "fixed", zIndex: 9999, left: 16, right: 16, bottom: lift, margin: "0 auto", maxWidth: 520, padding: "14px 16px 12px", background: "var(--card)", color: "var(--ink)", borderRadius: 16, border: "1px solid var(--line-2)", borderTop: "4px solid var(--red)", boxShadow: "0 16px 44px rgba(0,0,0,.35)", fontFamily: font }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--dim)", whiteSpace: "nowrap" }}>Tour · {i + 1} of {STOPS.length}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {track && (
              <button type="button" aria-pressed={voiceOn && !waiting} onClick={waiting ? () => playFrom(i) : toggleVoice}
                aria-label={waiting ? "Tap for sound" : voiceOn ? "Sound on: tap to turn it off" : "Turn the sound on"}
                style={waiting || !voiceOn ? { ...btn, padding: "6px 10px", fontSize: 12, borderColor: "var(--red)", color: "var(--red-ink)" } : link}>
                {waiting ? "🔈 Tap for sound" : voiceOn ? "🔊 Sound on" : "🔈 Sound off"}
              </button>
            )}
            <button type="button" style={link} onClick={close} aria-label="Close the tour">Close ✕</button>
          </span>
        </div>
        <div aria-live="polite">
          <div id="pq-tour-title" style={{ font: "700 16px/1.3 Sora, 'IBM Plex Sans', sans-serif", margin: "6px 0 4px" }}>{stop.title}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{stop.text}</div>
        </div>
        <div aria-hidden style={{ display: "flex", gap: 4, margin: "12px 0 10px" }}>
          {STOPS.map((_, k) => (
            <span key={k} style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--line-2)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", background: "var(--red)", width: k < i ? "100%" : k === i ? `${Math.min(100, (elapsed / STEP_MS) * 100)}%` : "0%" }} />
            </span>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={{ ...btn, opacity: i === 0 ? 0.45 : 1 }} onClick={() => step(i - 1)} disabled={i === 0}>← Back</button>
          <button type="button" style={btn} onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <button type="button" style={{ ...btn, background: "var(--red)", borderColor: "transparent", color: "#fff", fontWeight: 700 }} onClick={() => step(i + 1)}>{last ? "Start exploring" : "Next →"}</button>
        </div>
      </div>
    </>
  );
}
