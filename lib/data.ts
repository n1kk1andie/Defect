// Dataset persistence: uploaded data lives in Blob as JSON (defects.json / opstd.json)
// plus the original workbook (defects.xlsx / opstd.xlsx) for re-download. Falls back to
// the bundled seed when nothing has been uploaded.
import { getStorage } from "@/lib/storage";
import { buildWorkbook, type Dataset } from "@/lib/xlsx";
import seedDefects from "@/lib/seed-defects.json";
import seedOpstd from "@/lib/seed-opstd.json";

const JSON_KEY: Record<Dataset, string> = { defects: "defects.json", opstd: "opstd.json" };
const XLSX_KEY: Record<Dataset, string> = { defects: "defects.xlsx", opstd: "opstd.xlsx" };
const SEED: Record<Dataset, any> = { defects: seedDefects, opstd: seedOpstd };

async function readJson(key: string): Promise<any | null> {
  const buf = await getStorage().read(key);
  if (!buf) return null;
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
}

export interface DatasetsResponse {
  defects: any; opstd: any;
  uploaded: { defects: boolean; opstd: boolean };
}

// Metric labels are presentation, not data. A stored upload freezes whatever labels
// were current when it was persisted, so a later rename in the seed (e.g. "Average SLA"
// -> "Average Customer SLA") would never reach production. Overlay the seed's labels
// onto a stored payload — matched by the stable `key` — so display text always tracks
// the code while the stored numbers are left untouched.
function overlaySeedLabels(type: Dataset, payload: any): any {
  if (!payload || !Array.isArray(payload.metrics)) return payload;
  const seedMetrics: any[] = SEED[type]?.metrics || [];
  const labelByKey: Record<string, string> = {};
  for (const m of seedMetrics) if (m && m.key != null && m.label != null) labelByKey[m.key] = m.label;
  payload.metrics = payload.metrics.map((m: any) =>
    m && labelByKey[m.key] != null ? { ...m, label: labelByKey[m.key] } : m);
  return payload;
}

export async function loadDatasets(): Promise<DatasetsResponse> {
  const [d, o] = await Promise.all([readJson(JSON_KEY.defects), readJson(JSON_KEY.opstd)]);
  return {
    defects: d ? overlaySeedLabels("defects", d) : SEED.defects,
    opstd: o ? overlaySeedLabels("opstd", o) : SEED.opstd,
    uploaded: { defects: !!d, opstd: !!o },
  };
}

/** Persist an uploaded dataset (JSON for the app + xlsx for re-download). */
export async function saveDataset(type: Dataset, payload: any, workbook: Buffer): Promise<void> {
  const store = getStorage();
  await Promise.all([
    store.write(JSON_KEY[type], Buffer.from(JSON.stringify(payload), "utf8"), "application/json"),
    store.write(XLSX_KEY[type], workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  ]);
}

/** Reset a dataset back to the bundled seed. */
export async function resetDataset(type: Dataset): Promise<void> {
  const store = getStorage();
  await Promise.all([store.remove(JSON_KEY[type]), store.remove(XLSX_KEY[type])]);
}

/** The workbook for download: the stored upload if present, else generated from the seed. */
export async function datasetWorkbook(type: Dataset): Promise<Buffer> {
  const stored = await getStorage().read(XLSX_KEY[type]);
  if (stored) return stored;
  return buildWorkbook(type, SEED[type]);
}

export function statsFor(type: Dataset, payload: any): { periods: number; branches: number } {
  return { periods: payload.periods.length, branches: payload.branches.length };
}

/** The live payload for a dataset — the stored upload if present, else a fresh clone of
 *  the bundled seed (cloned so callers can safely mutate it when merging in new rows). */
export async function loadDatasetPayload(type: Dataset): Promise<any> {
  const stored = await readJson(JSON_KEY[type]);
  return stored ? overlaySeedLabels(type, stored) : structuredClone(SEED[type]);
}

/** Persist a merged payload as the live dataset (JSON for the app + a regenerated
 *  workbook for re-download). Used when publishing an approved submission. */
export async function persistMergedDataset(type: Dataset, payload: any): Promise<void> {
  await saveDataset(type, payload, buildWorkbook(type, payload));
}
