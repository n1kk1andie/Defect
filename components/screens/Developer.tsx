"use client";
// API keys (Settings → Connections → API keys): the REST API's keys, each
// named after what uses it, with scopes and an optional expiry. The secret is
// shown once. Rotating issues a new key and keeps the old one working for 24
// hours; revoking stops it at once. The demo shows sample keys and hides the
// address of the API.
import { useEffect, useState } from "react";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, fmtDate, fmtDateTime, Msg, Sheet } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SCOPES, SCOPE_INFO, type KeyView, type Scope } from "@/lib/integrationInfo";

const STATE: Record<KeyView["state"], { label: string; band: "strong" | "watch" | "attention" | "none" }> = {
  active: { label: "Active", band: "strong" }, expiring: { label: "Expires", band: "watch" }, expired: { label: "Expired", band: "attention" }, revoked: { label: "Revoked", band: "none" },
};
const ENDPOINTS: [string, string, Scope][] = [
  ["GET", "/api/v1/sites", "sites:read"],
  ["GET", "/api/v1/inspections", "inspections:read"],
  ["GET", "/api/v1/inspections/{id}", "inspections:read"],
  ["GET", "/api/v1/actions", "actions:read"],
  ["GET", "/api/v1/actions/{id}", "actions:read"],
  ["POST", "/api/v1/actions", "actions:write"],
  ["GET", "/api/v1/risk", "risk:read"],
  ["GET", "/api/v1/sampling", "sampling:read"],
  ["GET", "/api/v1/issues", "issues:read"],
  ["POST", "/api/v1/issues", "issues:write"],
];

export function Developer() {
  const { demo } = useApp();
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const load = () => api<{ keys: KeyView[] }>("/api/keys", "GET").then((r) => setKeys(r.keys)).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); setOrigin(window.location.origin); }, []);

  const change = async (k: KeyView, op: "rotate" | "revoke") => {
    if (op === "revoke" && !confirm(`Revoke "${k.name}"? Anything using it stops working at once.`)) return;
    if (op === "rotate" && !confirm(`Rotate "${k.name}"? You get a new key now; the old one keeps working for 24 hours so you can switch over.`)) return;
    setBusy(k.id); setErr("");
    try { const r = await api<{ key?: string }>(`/api/keys/${k.id}`, "POST", { op }); if (r.key) setSecret({ name: k.name, key: r.key }); await load(); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const live = (keys ?? []).filter((k) => k.state !== "revoked");

  return (
    <div className="stack">
      <Card title="REST API" sub="Read sites, inspections, actions, risk scores, sampling plans and reported issues, and raise actions or report issues from another system.">
        <p style={{ marginTop: 0 }}>Send the key as <code>Authorization: Bearer pq_…</code>. Answers are JSON, paged with <code>?limit=</code> and <code>?after=</code>; each key may make 120 requests a minute. A key acts only within its scopes, is recorded in the change history as itself, and can never approve or verify anything.</p>
        <dl className="kv"><dt>Address</dt><dd>{demo ? "Hidden in the demo" : <code>{origin || "https://quality.pulsus.tech"}/api/v1</code>}</dd></dl>
        <div className="tablewrap mt" tabIndex={0} role="region" aria-label="Endpoints">
          <table className="t stack">
            <caption className="sr">Endpoints and the scope each needs</caption>
            <thead><tr><th scope="col">Endpoint</th><th scope="col">Scope</th></tr></thead>
            <tbody>{ENDPOINTS.map(([m, p, s]) => <tr key={m + p}><td data-label="Endpoint"><code>{m} {p}</code></td><td data-label="Scope">{s} <span className="sub">· {SCOPE_INFO[s]}</span></td></tr>)}</tbody>
          </table>
        </div>
      </Card>

      <Card flush title="Keys" sub={keys ? `${live.length} key${live.length === 1 ? "" : "s"} in use. Only a fingerprint of each is kept; a lost key is replaced, not recovered.` : "Loading…"}
        actions={<button type="button" className="btn primary sm" disabled={demo} onClick={() => setCreating(true)}><Icon name="plus" />New key</button>}>
        {demo && <div style={{ padding: "0 18px" }}><Msg kind="info">The demo shows sample keys. It doesn&apos;t issue, rotate or revoke them.</Msg></div>}
        {keys && keys.length === 0 && <Empty icon="key" title="No API keys yet">Create one for each system that connects, so each can be revoked on its own.</Empty>}
        {keys && keys.length > 0 && (
          <ul className="list keylist">{keys.map((k) => (
            <li key={k.id} style={{ alignItems: "flex-start" }}>
              <span className="badge sm" aria-hidden="true"><Icon name="key" /></span>
              <span className="grow" style={{ minWidth: 0 }}>
                <strong>{k.name}</strong> <span className="sub">{k.hint}</span>
                <span className="sub" style={{ display: "block", fontSize: 13 }}>{k.scopes.join(", ")}</span>
                <span className="sub" style={{ display: "block", fontSize: 12.5 }}>Created {fmtDate(k.createdAt)} by {k.createdBy} · {k.lastUsedAt ? `last used ${fmtDateTime(k.lastUsedAt)}` : "never used"}{k.expiresAt && k.state !== "revoked" ? ` · ${k.state === "expired" ? "expired" : "expires"} ${fmtDateTime(k.expiresAt)}` : ""}{k.replacedBy ? " · replaced by a rotated key" : ""}</span>
                {k.state !== "revoked" && k.state !== "expired" && !demo && (
                  <span className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                    <button type="button" className="btn sm" disabled={busy === k.id || !!k.replacedBy} onClick={() => change(k, "rotate")}>Rotate</button>
                    <button type="button" className="btn sm ghost" disabled={busy === k.id} onClick={() => change(k, "revoke")}>Revoke</button>
                  </span>
                )}
              </span>
              <BandPill band={STATE[k.state].band}>{STATE[k.state].label}</BandPill>
            </li>
          ))}</ul>
        )}
        <div style={{ padding: "0 18px 12px" }}><Msg>{err}</Msg></div>
      </Card>

      {creating && <CreateKey onClose={() => setCreating(false)} onMade={(name, key) => { setCreating(false); setSecret({ name, key }); load(); }} />}
      {secret && <SecretSheet name={secret.name} secret={secret.key} onClose={() => setSecret(null)} />}
    </div>
  );
}

function CreateKey({ onClose, onMade }: { onClose: () => void; onMade: (name: string, key: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["sites:read", "inspections:read", "actions:read"]);
  const [days, setDays] = useState("365");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try { const r = await api<{ key: string }>("/api/keys", "POST", { name, scopes, expiresInDays: Number(days) }); onMade(name, r.key); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Sheet title="New API key" sub="Name it after the system that will use it." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Creating…" : "Create the key"}</button></>}>
      <Field label="Name"><input className="input" value={name} maxLength={80} placeholder="e.g. Power BI, HR system" onChange={(e) => setName(e.target.value)} /></Field>
      <fieldset className="scopes">
        <legend>What it can do</legend>
        {SCOPES.map((s) => (
          <label key={s} className="row" style={{ alignItems: "flex-start", gap: 8, margin: "6px 0" }}>
            <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />
            <span><code>{s}</code><span className="sub" style={{ display: "block", fontSize: 13 }}>{SCOPE_INFO[s]}</span></span>
          </label>
        ))}
      </fieldset>
      <Field label="Expires">
        <select className="select" style={{ width: "100%" }} value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option><option value="0">Never</option>
        </select>
      </Field>
      <Msg>{err}</Msg>
    </Sheet>
  );
}

function SecretSheet({ name, secret, onClose }: { name: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title={`Your key for ${name}`} sub="Copy it now. It won't be shown again." onClose={onClose}
      footer={<button type="button" className="btn primary" onClick={onClose}>I&apos;ve stored it safely</button>}>
      <label className="field"><span>API key</span><input className="input mono" readOnly value={secret} onFocus={(e) => e.currentTarget.select()} /></label>
      <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { /* clipboard blocked */ } }}><Icon name="copy" />{copied ? "Copied" : "Copy the key"}</button>
      <Msg kind="info">Keep it in your other system&apos;s secret store, not in a spreadsheet or email. If it leaks, revoke it here.</Msg>
    </Sheet>
  );
}
