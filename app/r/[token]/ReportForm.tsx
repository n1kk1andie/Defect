"use client";
// The report-an-issue form: what kind, what happened, where, an optional photo
// (shrunk on the phone before it is sent) and optional contact details.
// Turnstile appears when the deployment has a site key.
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { CATEGORIES, CATEGORY_INFO, type IssueCategory } from "@/lib/issueInfo";
import { Icon } from "@/components/icons";

/** Shrink a photo to at most 2000 px on its long side as JPEG; fall back to the original. */
async function shrink(file: File): Promise<Blob> {
  try {
    if (!file.type.startsWith("image/") || file.size < 600_000) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.82));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

export function ReportForm({ token, via, siteKey, unit }: { token: string; via: "qr" | "link"; siteKey: string; unit: string }) {
  const [cat, setCat] = useState<IssueCategory | "">("");
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!cat) { setErr("Choose what kind of issue it is."); return; }
    if (desc.trim().length < 10) { setErr("Describe what you saw (a sentence or two)."); return; }
    setBusy(true);
    try {
      const fd = new FormData(form.current!);
      fd.delete("photo");
      if (photo) { const b = await shrink(photo); fd.append("photo", b, b === photo ? photo.name : "photo.jpg"); }
      fd.set("category", cat); fd.set("via", via);
      const r = await fetch(`/api/public/report/${token}`, { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { ref?: string; error?: string };
      if (!r.ok) { setErr(j.error || "That didn't send. Please try again."); (window as { turnstile?: { reset: () => void } }).turnstile?.reset(); }
      else setDone(j.ref || "");
    } catch { setErr("That didn't send: check your connection and try again."); }
    setBusy(false);
  };

  if (done !== null) return (
    <div className="rpt-done" role="status">
      <span className="badge" aria-hidden="true" data-band="worldClass" style={{ background: "var(--bp)", color: "var(--bt)" }}><Icon name="check" /></span>
      <h2 className="h2" style={{ fontSize: 20, margin: "10px 0 4px" }}>Thank you. It&apos;s been sent.</h2>
      <p style={{ margin: 0 }}>The {unit} team has your report{done ? <> as <strong>{done}</strong></> : ""}. A supervisor will look at it and decide what to do.</p>
      <button type="button" className="btn mt2" onClick={() => { setDone(null); setCat(""); setDesc(""); setPhoto(null); setPreview(null); }}>Report something else</button>
    </div>
  );

  return (
    <form ref={form} onSubmit={submit} noValidate className="rpt-form">
      <fieldset className="rpt-cats">
        <legend>What kind of issue is it?</legend>
        {CATEGORIES.map((c) => (
          <label key={c} className={`rpt-cat${cat === c ? " on" : ""}`}>
            <input type="radio" name="category" value={c} checked={cat === c} onChange={() => setCat(c)} />
            <span><strong>{CATEGORY_INFO[c].label}</strong><span className="sub">{CATEGORY_INFO[c].hint}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="field"><span>What happened, or what did you see?</span>
        <textarea className="textarea" name="description" required minLength={10} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe it in a sentence or two" /></label>
      <label className="field"><span>Where exactly? <span className="sub">(optional)</span></span><input className="input" name="location" maxLength={200} placeholder="e.g. front counter, ward 4 sluice, car park" /></label>
      <div className="field">
        <span>Photo <span className="sub">(optional)</span></span>
        <label className="btn" style={{ alignSelf: "flex-start" }}>
          <Icon name="camera" />{photo ? "Change photo" : "Add a photo"}
          <input type="file" name="photo" accept="image/*" capture="environment" className="sr" onChange={(e) => { const f = e.target.files?.[0] ?? null; setPhoto(f); setPreview(f ? URL.createObjectURL(f) : null); }} />
        </label>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="The photo you chose" className="rpt-photo" />}
      </div>
      <details className="rpt-more">
        <summary>Add your name or contact details <span className="sub">(optional)</span></summary>
        <label className="field"><span>Your name</span><input className="input" name="name" maxLength={120} autoComplete="name" /></label>
        <label className="field"><span>Email or phone, if you&apos;d like a reply</span><input className="input" name="contact" maxLength={160} autoComplete="email" /></label>
      </details>
      <div className="rpt-hp" aria-hidden="true"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {siteKey && <>
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
        <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" data-size="flexible" />
      </>}
      {err && <div className="msg err" role="alert">{err}</div>}
      <button type="submit" className="btn primary rpt-send" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
      <p className="sub" style={{ fontSize: 12.5, margin: 0 }}>Reports go to {unit}&apos;s supervisors. Don&apos;t include anyone&apos;s private medical or financial details.</p>
    </form>
  );
}
