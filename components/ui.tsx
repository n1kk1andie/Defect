"use client";
// Building blocks shared by every screen.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { bandInfo, legend, type BandKey, type FamilyKey, type BandOverrides } from "@/lib/bands";

export function Card({ title, sub, actions, children, className = "", flush = false, id }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean; id?: string }) {
  const hid = useId();
  return (
    <section className={`card ${flush ? "flush" : ""} ${className}`} aria-labelledby={title ? hid : undefined} id={id}>
      {(title || actions) && (
        <div className="card-h">
          <div className="grow">
            {title && <h2 className="h2" id={hid}>{title}</h2>}
            {sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ value, label, band, icon, href, onClick }: { value: ReactNode; label: string; band?: BandKey | "none"; icon?: IconName; href?: string; onClick?: () => void }) {
  const inner = (
    <div className="stat-row">
      {icon && <span className="badge sm" aria-hidden="true"><Icon name={icon} /></span>}
      <div className="grow">
        <div className="stat-v tone" data-band={band}>{value}</div>
        <div className="stat-l">{label}</div>
      </div>
    </div>
  );
  if (href) return <a className="stat" href={href}>{inner}</a>;
  if (onClick) return <button type="button" className="stat" onClick={onClick} style={{ textAlign: "left", width: "100%", cursor: "pointer", font: "inherit" }}>{inner}</button>;
  return <div className="stat">{inner}</div>;
}

export function BandPill({ band, children, lg = false, label }: { band: BandKey | "none"; children: ReactNode; lg?: boolean; label?: boolean }) {
  return (
    <span className={`pill ${lg ? "lg" : ""}`} data-band={band}>
      <i className="dot" aria-hidden="true" />
      {children}
      {label && band !== "none" && <span className="sr"> ({bandInfo(band).label})</span>}
    </span>
  );
}

export function Legend({ family, overrides }: { family: FamilyKey; overrides?: BandOverrides }) {
  return (
    <div className="legend" aria-label="Colour bands">
      {legend(family, overrides).map((b) => (
        <span key={b.key} data-band={b.key}><i className="swatch" aria-hidden="true" />{b.label} {b.range}</span>
      ))}
      <span data-band="none"><i className="swatch" aria-hidden="true" />Not reviewed</span>
    </div>
  );
}

export function Chips<T extends string | number>({ label, options, value, onChange, scroll = true }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; scroll?: boolean }) {
  return (
    <div className={`chips ${scroll ? "scroll" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} className="chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button type="button" key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Select({ label, value, onChange, options, hideLabel = true, id }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hideLabel?: boolean; id?: string }) {
  const auto = useId();
  const sid = id || auto;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <label htmlFor={sid} className={hideLabel ? "sr" : "sub"}>{label}</label>
      <select id={sid} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="sub" style={{ display: "block", marginTop: 4 }}>{hint}</small>}
    </label>
  );
}

export function Msg({ kind = "err", children }: { kind?: "err" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`msg ${kind}`} role={kind === "err" ? "alert" : "status"}>{children}</div>;
}

export function Empty({ icon = "info", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="badge" style={{ margin: "0 auto 10px" }} aria-hidden="true"><Icon name={icon} /></span>
      <div className="h2" style={{ marginBottom: 4 }}>{title}</div>
      {children && <div className="sub" style={{ maxWidth: 460, margin: "0 auto" }}>{children}</div>}
    </div>
  );
}

/** A side sheet (bottom sheet on phones): a modal dialog with focus kept inside and Escape to close. */
export function Sheet({ title, sub, onClose, children, footer }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const hid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab" && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select, textarea")).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={hid} ref={ref}>
        <div className="sheet-h">
          <div className="grow">
            <h2 className="h2" id={hid} style={{ fontSize: 19 }}>{title}</h2>
            {sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHead({ eyebrow, title, accent, lede, right }: { eyebrow: string; title: ReactNode; accent?: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  return (
    <header className="row between wrap" style={{ alignItems: "flex-end", marginBottom: 8 }}>
      <div className="grow" style={{ minWidth: 260 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="headline">{title}{accent && <> <span className="accent">{accent}</span></>}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {right && <div className="row wrap" style={{ marginBottom: 18 }}>{right}</div>}
    </header>
  );
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
