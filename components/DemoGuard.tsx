"use client";
import { useEffect } from "react";

/**
 * Demo deployments only: makes it harder for a casual visitor to lift the
 * page's code or copy its addresses. It turns off the right-click menu (outside
 * text fields), the "view source", "save page" and developer-tools shortcuts,
 * and dragging images or links out of the page.
 *
 * A deterrent, not a lock: whatever a browser shows, a determined person can
 * still read. What actually protects the product is that the server code never
 * leaves the server, the browser code is minified with no source maps, and the
 * repositories are private.
 *
 * Renders nothing and adds nothing unless NEXT_PUBLIC_DEMO_MODE is "1" (inlined
 * at build time), so production builds compile it away.
 */
export default function DemoGuard() {
  useEffect(() => {
    if ((process.env.NEXT_PUBLIC_DEMO_MODE || "") !== "1") return;
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onMenu = (e: MouseEvent) => { if (!editable(e.target)) e.preventDefault(); };
    const onDrag = (e: DragEvent) => { if (e.target instanceof HTMLImageElement || e.target instanceof HTMLAnchorElement) e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (
        k === "f12" ||
        (mod && (k === "u" || k === "s")) ||                          // view source, save page
        (mod && (e.shiftKey || e.altKey) && ["i", "j", "c", "k"].includes(k)) // developer tools
      ) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("contextmenu", onMenu);
    document.addEventListener("dragstart", onDrag);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("dragstart", onDrag);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return null;
}
