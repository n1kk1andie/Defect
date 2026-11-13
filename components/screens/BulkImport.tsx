"use client";
// Bulk import (Settings → Data → Bulk import): locations, people or actions
// from a spreadsheet. Choose what to import, upload a CSV or Excel file, map
// its columns to the fields (the last mapping is remembered), preview every row
// (new, update, duplicate or error, with the reason), then import the good rows.
import { useMemo, useState } from "react";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Field, Msg, Seg } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BULK_FIELDS, type BulkKind, type BulkPreview, type BulkRow } from "@/lib/bulkInfo";
import { guessMapping } from "@/lib/table";

interface Table { headers: string[]; rows: string[][]; name: string; sheet?: string; truncated: boolean }
type Done = { added: number; updated: number; skipped: number; errors: { n: number; message: string }[] };
type Show = "all" | "new" | "update" | "skip" | "error";

const KIND_LABEL: Record<BulkKind, string> = { locations: "Locations", people: "People", actions: "Actions" };
const STATUS: Record<BulkRow["status"], { label: string; band: "strong" | "healthy" | "watch" | "escalate" }> = {
  new: { label: "New", band: "strong" }, update: { label: "Update", band: "healthy" }, skip: { label: "Duplicate", band: "watch" }, error: { label: "Error", band: "escalate" },
};
const EXAMPLES: Record<BulkKind, string[]> = {
  locations: ["Harbour Street", "HS01", "North", "Retail banking", "yes"],
  people: ["jo.smith@example.com", "Jo Smith", "inspector", "Harbour Street, Mill Lane"],
  actions: ["Fire exit blocked by boxes", "Harbour Street", "2026-12-15", "jo.smith@example.com", "high", "corrective", "Seen on the walk-round", ""],
};

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A CSV template with the field headings and one example row. */
export function templateCsv(kind: BulkKind): string {
  return [BULK_FIELDS[kind].map((f) => f.label), EXAMPLES[kind]].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function BulkImport() {
  const app = useApp();
  const [kind, setKind] = useState<BulkKind>("locations");
  const [table, setTable] = useState<Table | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fields = BULK_FIELDS[kind];
  const U = app.settings.unitLabel;
  const label = (f: { key: string; label: string }) => (f.key === "site" ? U : f.key === "sites" ? app.settings.unitPlural : f.key === "entity" ? app.settings.entityLabel : f.label);

  const reset = (k: BulkKind) => { setKind(k); setTable(null); setPreview(null); setDone(null); setErr(""); setMap({}); };
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(""); try { await f(); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  /** Saved mapping first (by column heading), then the best guess by name. */
  const autoMap = (t: Table, k: BulkKind) => {
    const guess = guessMapping(t.headers, BULK_FIELDS[k].map((f) => ({ key: f.key, synonyms: [f.label, ...f.synonyms] })));
    const saved = app.settings.bulkMappings?.[k] ?? {};
    const out: Record<string, number> = {};
    for (const f of BULK_FIELDS[k]) {
      const i = saved[f.key] ? t.headers.findIndex((h) => h.trim().toLowerCase() === saved[f.key].toLowerCase()) : -1;
      out[f.key] = i >= 0 ? i : guess[f.key];
    }
    return { out, fromSaved: Object.keys(saved).some((key) => out[key] >= 0 && t.headers[out[key]]?.toLowerCase() === saved[key].toLowerCase()) };
  };
  const [fromSaved, setFromSaved] = useState(false);

  const upload = (file: File) => run(async () => {
    const fd = new FormData(); fd.append("file", file);
    const r = await api<{ table: Table }>("/api/table", "POST", fd);
    const m = autoMap(r.table, kind);
    setTable(r.table); setMap(m.out); setFromSaved(m.fromSaved); setPreview(null); setDone(null);
  });

  const rows = useMemo(() => (table ? table.rows.map((r) => Object.fromEntries(fields.filter((f) => map[f.key] >= 0).map((f) => [f.key, r[map[f.key]] ?? ""]))) : []), [table, map, fields]);
  const missing = fields.filter((f) => f.required && !(map[f.key] >= 0));
  const mapping = () => Object.fromEntries(fields.filter((f) => map[f.key] >= 0).map((f) => [f.key, table!.headers[map[f.key]]]));

  const check = () => run(async () => { const r = await api<{ preview: BulkPreview }>("/api/bulk", "POST", { kind, rows }); setPreview(r.preview); setShow(r.preview.counts.error ? "error" : "all"); });
  const commit = () => run(async () => { const r = await api<{ done: Done }>("/api/bulk", "POST", { kind, rows, commit: true, mapping: mapping() }); setDone(r.done); setPreview(null); setTable(null); app.refresh(); });

  const download = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(kind)], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `pulsus-quality-${kind}-template.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const listed = preview ? preview.rows.filter((r) => show === "all" || r.status === show) : [];
  const good = preview ? preview.counts.new + preview.counts.update : 0;

  return (
    <div className="stack">
      <Card title="1. What are you importing?" sub="Add or update many records at once from a spreadsheet. Nothing is written until you've checked the preview.">
        <Seg label="What to import" value={kind} onChange={reset} options={(["locations", "people", "actions"] as BulkKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <p className="sub" style={{ marginBottom: 0 }}>
          {kind === "locations" ? `Each row is a ${U.toLowerCase()}: a name, and optionally a code, region, ${app.settings.entityLabel.toLowerCase()} and whether it's active. Existing ${app.settings.unitPlural.toLowerCase()} are matched by name and updated.`
            : kind === "people" ? "Each row is a person: their email, name, Quality roles and (optionally) the sites they cover. Existing people are matched by email and their roles replaced."
              : `Each row raises a corrective action: the issue, the ${U.toLowerCase()}, a due date and optionally an owner, priority and kind. An open action with the same issue at the same ${U.toLowerCase()} is flagged as a duplicate and skipped.`}
        </p>
        <div className="row wrap mt">
          <button type="button" className="btn ghost" onClick={download}><Icon name="download" />Download the {KIND_LABEL[kind].toLowerCase()} template (CSV)</button>
        </div>
      </Card>

      <Card title="2. Upload the file" sub="A .csv or .xlsx file with a heading row, up to 5,000 rows.">
        <label className="btn primary" aria-disabled={busy}>
          <Icon name="upload" />{table ? "Choose another file" : "Choose a file"}
          <input type="file" accept=".csv,.tsv,.txt,.xlsx" className="sr" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </label>
        {table && <p className="mt" style={{ marginBottom: 0 }}><strong>{table.name}</strong>{table.sheet ? ` (sheet ${table.sheet})` : ""}: {table.rows.length.toLocaleString("en-US")} row{table.rows.length === 1 ? "" : "s"}, {table.headers.length} columns{table.rows.length > 5000 ? ". Only the first 5,000 rows are imported." : "."}</p>}
        <Msg>{!preview && !done ? err : ""}</Msg>
      </Card>

      {table && (
        <Card title="3. Match the columns" sub={fromSaved ? "Matched from the mapping you used last time. Check each one." : "Matched by heading where possible. Check each one."}>
          <div className="grid g2 mapgrid">
            {fields.map((f) => (
              <Field key={f.key} label={`${label(f)}${f.required ? " (required)" : ""}`} hint={f.hint}>
                <select className="select" style={{ width: "100%" }} value={map[f.key] ?? -1} onChange={(e) => { setMap((m) => ({ ...m, [f.key]: Number(e.target.value) })); setPreview(null); }}>
                  <option value={-1}>{f.required ? "Choose a column" : "Not in this file"}</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h}{table.rows[0]?.[i] ? ` (e.g. ${table.rows[0][i].slice(0, 30)})` : ""}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {missing.length > 0 && <Msg kind="info">Choose a column for {missing.map(label).join(" and ")}.</Msg>}
          <button type="button" className="btn primary mt" disabled={busy || missing.length > 0} onClick={check}><Icon name="eye" />{busy && !preview ? "Checking…" : "Preview the import"}</button>
        </Card>
      )}

      {preview && (
        <Card flush title="4. Check the preview" sub={`${preview.counts.new} new · ${preview.counts.update} update${preview.counts.update === 1 ? "" : "s"} · ${preview.counts.skip} duplicate${preview.counts.skip === 1 ? "" : "s"} · ${preview.counts.error} error${preview.counts.error === 1 ? "" : "s"}. Duplicates and rows with errors are skipped; fix them in the file and import it again if you need them.`}
          actions={<Seg label="Show rows" value={show} onChange={setShow} options={[{ value: "all", label: `All (${preview.rows.length})` }, { value: "error", label: `Errors (${preview.counts.error})` }, { value: "skip", label: `Duplicates (${preview.counts.skip})` }, { value: "new", label: `New (${preview.counts.new})` }, { value: "update", label: `Updates (${preview.counts.update})` }]} />}>
          <div className="tablewrap" tabIndex={0} role="region" aria-label="Import preview">
            <table className="t stack">
              <caption className="sr">Every row of the file and what will happen to it</caption>
              <thead><tr><th scope="col" className="num">Row</th><th scope="col">Result</th>{fields.filter((f) => map[f.key] >= 0).slice(0, 4).map((f) => <th key={f.key} scope="col">{label(f)}</th>)}<th scope="col">What happens</th></tr></thead>
              <tbody>{listed.slice(0, 300).map((r) => (
                <tr key={r.n}>
                  <td data-label="Row" className="num">{r.n}</td>
                  <td data-label="Result"><BandPill band={STATUS[r.status].band}>{STATUS[r.status].label}</BandPill></td>
                  {fields.filter((f) => map[f.key] >= 0).slice(0, 4).map((f) => <td key={f.key} data-label={label(f)}>{r.values[f.key] || "—"}</td>)}
                  <td data-label="What happens">{r.message}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {listed.length > 300 && <p className="sub" style={{ padding: "0 18px" }}>Showing the first 300 of {listed.length} rows.</p>}
          {!listed.length && <p className="sub" style={{ padding: "0 18px" }}>No rows of this kind.</p>}
          <div className="row wrap" style={{ padding: "12px 18px 18px" }}>
            <button type="button" className="btn navy" disabled={busy || !good} onClick={commit}><Icon name="check" />{busy ? "Importing…" : good ? `Import ${good} row${good === 1 ? "" : "s"}` : "Nothing to import"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setPreview(null)}>Change the mapping</button>
          </div>
          <div style={{ padding: "0 18px" }}><Msg>{err}</Msg></div>
        </Card>
      )}

      {done && (
        <Card title="Imported" sub="Recorded in the change history.">
          <Msg kind="ok">{done.added} added, {done.updated} updated, {done.skipped} skipped. The column mapping is saved for next time.</Msg>
          {done.errors.length > 0 && <>
            <div className="eyebrow mt">Rows not imported</div>
            <ul className="list">{done.errors.map((e) => <li key={e.n}><span className="grow"><strong>Row {e.n}</strong>: {e.message}</span></li>)}</ul>
          </>}
        </Card>
      )}
    </div>
  );
}
