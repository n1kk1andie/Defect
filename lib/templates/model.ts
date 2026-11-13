// Templates: what an inspection asks, and how it is scored. Pure (the builder,
// the phone capture and the server all use it) and tested
// (tests/templates.test.mjs). The design is docs/quality-model.md §3.
//
//   Template → sections → questions. A section marked perItem repeats for each
//   sampled item (a file, chart, transaction or record), so a file review is a
//   template too. Published definitions are frozen as versions; an inspection
//   is always scored against the version it was started on.
//
// Scoring: for every visible, scorable, answered, not-N/A question,
//   possible += weight, earned += weight × s (s from 0 to 1 by type);
//   score = earned ÷ possible × 100. A failed critical question fails the
//   inspection whatever the score (and, with critical: "zero", zeroes it).

export const TEMPLATE_SCHEMA = "pulsus.quality.template/v1" as const;

export const QUESTION_TYPES = ["yesno", "passfail", "rating", "number", "choice", "multi", "text", "date", "photo", "signature", "reference"] as const;
export type QType = (typeof QUESTION_TYPES)[number];

export const TYPE_INFO: Record<QType, { label: string; hint: string; scorable: boolean }> = {
  yesno: { label: "Yes / No", hint: "Yes passes, No fails; N/A if allowed", scorable: true },
  passfail: { label: "Pass / Fail", hint: "A direct pass or fail", scorable: true },
  rating: { label: "Rating scale", hint: "1 to 5 by default; below the pass point fails", scorable: true },
  number: { label: "Number", hint: "Outside the expected range fails", scorable: true },
  choice: { label: "Multiple choice", hint: "One answer; each option has a score", scorable: true },
  multi: { label: "Checklist (several)", hint: "Tick all that apply; scored on the options chosen", scorable: true },
  text: { label: "Text", hint: "A written answer", scorable: false },
  date: { label: "Date", hint: "A date", scorable: false },
  photo: { label: "Photo / evidence", hint: "A photo or file is the answer", scorable: false },
  signature: { label: "Signature", hint: "Signed on screen", scorable: false },
  reference: { label: "File or sample reference", hint: "An account, chart, case or record number", scorable: false },
};

export const SECTORS = ["banking", "healthcare", "government", "higher_ed", "general"] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_INFO: Record<Sector, { label: string; unit: string; units: string; group: string; item: string; blurb: string }> = {
  banking: { label: "Banking and credit unions", unit: "Branch", units: "Branches", group: "Region", item: "File", blurb: "Branch operations, cash, KYC and loan files, ATMs, mystery shops, complaints." },
  healthcare: { label: "Hospitals and health systems", unit: "Ward", units: "Wards", group: "Hospital", item: "Chart", blurb: "Hand hygiene, infection control, medicines, walk-rounds, environment of care, chart review." },
  government: { label: "Government and public services", unit: "Office", units: "Offices", group: "Agency", item: "Case file", blurb: "Service standards, records, procurement files, facilities, citizen-service shops." },
  higher_ed: { label: "Universities and colleges", unit: "Campus", units: "Campuses", group: "Faculty", item: "File", blurb: "Campus and lab safety, residences, accessibility, student services, exam files." },
  general: { label: "Any multi-site organisation", unit: "Site", units: "Sites", group: "Region", item: "Record", blurb: "Health and safety, 5S, customer experience, supplier and site audits." },
};

export type Severity = "critical" | "major" | "minor";
export interface Option { id: string; label: string; /** 0–1 */ score: number; fail?: boolean }
export interface ShowIf { q: string; is: "pass" | "fail" | "na" | "answered" | string }
export interface Question {
  id: string;
  type: QType;
  label: string;
  guidance?: string;
  /** The policy or procedure it tests, e.g. "Cash Handling Procedure §4.2". */
  reference?: string;
  required: boolean;
  allowNA: boolean;
  /** 0–10; 0 = recorded but not scored. */
  weight: number;
  severity: Severity;
  /** Failing it fails the inspection. */
  critical: boolean;
  options?: Option[];
  scale?: { min: number; max: number; passAt: number; labels?: [string, string] };
  range?: { min?: number; max?: number; unit?: string };
  photoOnFail?: boolean;
  noteOnFail?: boolean;
  showIf?: ShowIf;
  action?: { auto: boolean; priority: "high" | "medium" | "low"; dueDays: number };
  /** A check code (Branch Defects) or a scorecard measure key ("@audit" = audit grade). */
  key?: string;
}
export interface Section { id: string; title: string; description?: string; perItem?: boolean; questions: Question[] }
export interface TemplateDef {
  schema: typeof TEMPLATE_SCHEMA;
  name: string;
  description: string;
  sector: Sector;
  category: string;
  sampling?: { itemLabel: string; min: number; max: number };
  scoring: { passMark: number; critical: "fail" | "zero" };
  binding?: { kind: "defects"; areaId: string } | { kind: "scorecard" };
  signatures: { inspector: boolean; site: boolean };
  checkin: boolean;
  sections: Section[];
}

export interface Answer { v?: string | number | string[] | null; na?: boolean; note?: string; photos?: string[] }
export type Answers = Record<string, Answer>;
export interface SampledItem { ref: string; answers: Answers }

// ── construction ─────────────────────────────────────────────────────────────

export const uid = (p = "q") => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export function newQuestion(type: QType = "yesno", label = ""): Question {
  const q: Question = { id: uid(), type, label, required: TYPE_INFO[type].scorable || type === "signature", allowNA: type === "yesno" || type === "passfail", weight: TYPE_INFO[type].scorable ? 1 : 0, severity: "major", critical: false };
  if (type === "choice" || type === "multi") q.options = [{ id: uid("o"), label: "Good", score: 1 }, { id: uid("o"), label: "Needs work", score: 0.5 }, { id: uid("o"), label: "Poor", score: 0, fail: true }];
  if (type === "rating") q.scale = { min: 1, max: 5, passAt: 3, labels: ["Poor", "Excellent"] };
  if (type === "number") q.range = { min: 0, max: 100 };
  return q;
}
export const newSection = (title = "New section"): Section => ({ id: uid("s"), title, questions: [newQuestion("yesno")] });

export function blankTemplate(name = "Untitled template", sector: Sector = "general"): TemplateDef {
  return { schema: TEMPLATE_SCHEMA, name, description: "", sector, category: "Inspection", scoring: { passMark: 85, critical: "fail" }, signatures: { inspector: true, site: false }, checkin: true, sections: [{ id: uid("s"), title: "Section 1", questions: [newQuestion("yesno", "")] }] };
}

/** Every question with its section, in order. */
export function allQuestions(def: TemplateDef): { q: Question; s: Section }[] {
  return def.sections.flatMap((s) => s.questions.map((q) => ({ q, s })));
}

// ── validation ───────────────────────────────────────────────────────────────

type V<T> = { ok: true; def: T } | { ok: false; error: string };
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const LIMITS = { sections: 40, questions: 300, perSection: 80, options: 20 };

/** Clean and check a definition from the builder, an import or the library. */
export function validateTemplate(raw: unknown): V<TemplateDef> {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const name = txt(d.name, 120);
  if (!name) return { ok: false, error: "Give the template a name." };
  const sector = (SECTORS as readonly string[]).includes(d.sector) ? (d.sector as Sector) : "general";
  if (!Array.isArray(d.sections) || !d.sections.length) return { ok: false, error: "Add at least one section." };
  if (d.sections.length > LIMITS.sections) return { ok: false, error: `Up to ${LIMITS.sections} sections.` };
  const ids = new Set<string>();
  const sections: Section[] = [];
  let total = 0;
  for (const [si, rs] of (d.sections as any[]).entries()) {
    const title = txt(rs?.title, 120) || `Section ${si + 1}`;
    let sid = txt(rs?.id, 40);
    if (!ID.test(sid) || ids.has(sid)) sid = uid("s");
    ids.add(sid);
    const qs = Array.isArray(rs?.questions) ? rs.questions : [];
    if (qs.length > LIMITS.perSection) return { ok: false, error: `“${title}” has more than ${LIMITS.perSection} questions.` };
    const seenHere: Question[] = [];
    for (const [qi, rq] of (qs as any[]).entries()) {
      const type = (QUESTION_TYPES as readonly string[]).includes(rq?.type) ? (rq.type as QType) : "yesno";
      const label = txt(rq?.label, 300);
      if (!label) return { ok: false, error: `Question ${qi + 1} in “${title}” has no wording.` };
      let id = txt(rq?.id, 40);
      if (!ID.test(id) || ids.has(id)) id = uid();
      ids.add(id);
      const scorable = TYPE_INFO[type].scorable;
      const q: Question = {
        id, type, label,
        required: rq?.required === undefined ? scorable : !!rq.required,
        allowNA: !!rq?.allowNA,
        weight: scorable ? num(rq?.weight, 1, 0, 10) : 0,
        severity: (["critical", "major", "minor"].includes(rq?.severity) ? rq.severity : "major") as Severity,
        critical: scorable && !!rq?.critical,
      };
      const g = txt(rq?.guidance, 1200); if (g) q.guidance = g;
      const r = txt(rq?.reference, 160); if (r) q.reference = r;
      const k = txt(rq?.key, 60); if (k) q.key = k;
      if (type === "choice" || type === "multi") {
        const opts = (Array.isArray(rq?.options) ? rq.options : []).slice(0, LIMITS.options).map((o: any) => ({ id: ID.test(txt(o?.id, 40)) ? txt(o.id, 40) : uid("o"), label: txt(o?.label, 120), score: num(o?.score, 0, 0, 1), ...(o?.fail ? { fail: true } : {}) })).filter((o: Option) => o.label);
        if (opts.length < 2) return { ok: false, error: `“${label.slice(0, 60)}” needs at least two options.` };
        const oid = new Set<string>(); for (const o of opts) { if (oid.has(o.id)) o.id = uid("o"); oid.add(o.id); }
        q.options = opts;
      }
      if (type === "rating") {
        const min = Math.round(num(rq?.scale?.min, 1, 0, 9)), max = Math.round(num(rq?.scale?.max, 5, min + 1, 10));
        q.scale = { min, max, passAt: Math.round(num(rq?.scale?.passAt, Math.ceil((min + max) / 2), min, max)) };
        const ls = rq?.scale?.labels; if (Array.isArray(ls) && ls.length === 2) q.scale.labels = [txt(ls[0], 30), txt(ls[1], 30)];
      }
      if (type === "number") {
        const lo = rq?.range?.min, hi = rq?.range?.max;
        q.range = {};
        if (lo !== undefined && lo !== null && lo !== "" && Number.isFinite(Number(lo))) q.range.min = Number(lo);
        if (hi !== undefined && hi !== null && hi !== "" && Number.isFinite(Number(hi))) q.range.max = Number(hi);
        if (q.range.min !== undefined && q.range.max !== undefined && q.range.min > q.range.max) return { ok: false, error: `“${label.slice(0, 60)}”: the lowest expected value is above the highest.` };
        const u = txt(rq?.range?.unit, 20); if (u) q.range.unit = u;
      }
      if (scorable) {
        if (rq?.photoOnFail) q.photoOnFail = true;
        if (rq?.noteOnFail) q.noteOnFail = true;
        if (rq?.action?.auto || q.critical) q.action = { auto: !!rq?.action?.auto || q.critical, priority: (["high", "medium", "low"].includes(rq?.action?.priority) ? rq.action.priority : q.critical ? "high" : "medium"), dueDays: Math.round(num(rq?.action?.dueDays, q.critical ? 7 : 30, 1, 365)) };
      }
      if (rq?.showIf?.q) {
        const target = seenHere.find((x) => x.id === rq.showIf.q);
        if (!target) return { ok: false, error: `“${label.slice(0, 60)}” depends on a question that isn't before it in the same section.` };
        const is = txt(rq.showIf.is, 40);
        if (!["pass", "fail", "na", "answered"].includes(is) && !target.options?.some((o) => o.id === is)) return { ok: false, error: `“${label.slice(0, 60)}” has a condition that can't happen.` };
        q.showIf = { q: target.id, is };
      }
      seenHere.push(q);
    }
    if (!seenHere.length) return { ok: false, error: `Add a question to “${title}”.` };
    total += seenHere.length;
    const sec: Section = { id: sid, title, questions: seenHere };
    const desc = txt(rs?.description, 600); if (desc) sec.description = desc;
    if (rs?.perItem) sec.perItem = true;
    sections.push(sec);
  }
  if (total > LIMITS.questions) return { ok: false, error: `Up to ${LIMITS.questions} questions in a template.` };
  const perItem = sections.some((s) => s.perItem);
  const def: TemplateDef = {
    schema: TEMPLATE_SCHEMA, name, description: txt(d.description, 1000), sector, category: txt(d.category, 60) || "Inspection",
    scoring: { passMark: Math.round(num(d.scoring?.passMark, 85, 0, 100)), critical: d.scoring?.critical === "zero" ? "zero" : "fail" },
    signatures: { inspector: d.signatures?.inspector !== false, site: !!d.signatures?.site },
    checkin: d.checkin !== false,
    sections,
  };
  if (perItem) def.sampling = { itemLabel: txt(d.sampling?.itemLabel, 30) || "Item", min: Math.round(num(d.sampling?.min, 1, 1, 500)), max: Math.round(num(d.sampling?.max, 200, 1, 500)) };
  if (d.binding?.kind === "defects" && txt(d.binding.areaId, 80)) def.binding = { kind: "defects", areaId: txt(d.binding.areaId, 80) };
  else if (d.binding?.kind === "scorecard") def.binding = { kind: "scorecard" };
  return { ok: true, def };
}

// ── answering and scoring ────────────────────────────────────────────────────

export type Outcome = "pass" | "fail" | "na" | "unanswered" | "info";

const present = (a?: Answer) => !!a && !a.na && a.v !== undefined && a.v !== null && a.v !== "" && !(Array.isArray(a.v) && !a.v.length);

/** How an answer scores: s from 0 to 1, or null when it doesn't score. */
export function answerScore(q: Question, a?: Answer): { outcome: Outcome; s: number | null } {
  if (a?.na && q.allowNA) return { outcome: "na", s: null };
  if (!present(a)) return { outcome: "unanswered", s: null };
  const v = a!.v;
  switch (q.type) {
    case "yesno": return v === "yes" ? { outcome: "pass", s: 1 } : v === "no" ? { outcome: "fail", s: 0 } : { outcome: "unanswered", s: null };
    case "passfail": return v === "pass" ? { outcome: "pass", s: 1 } : v === "fail" ? { outcome: "fail", s: 0 } : { outcome: "unanswered", s: null };
    case "rating": {
      const n = Number(v), sc = q.scale || { min: 1, max: 5, passAt: 3 };
      if (!Number.isFinite(n)) return { outcome: "unanswered", s: null };
      return { outcome: n < sc.passAt ? "fail" : "pass", s: Math.max(0, Math.min(1, (n - sc.min) / (sc.max - sc.min))) };
    }
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return { outcome: "unanswered", s: null };
      const ok = (q.range?.min === undefined || n >= q.range.min) && (q.range?.max === undefined || n <= q.range.max);
      return { outcome: ok ? "pass" : "fail", s: ok ? 1 : 0 };
    }
    case "choice": {
      const o = q.options?.find((x) => x.id === v);
      if (!o) return { outcome: "unanswered", s: null };
      return { outcome: o.fail ? "fail" : "pass", s: o.score };
    }
    case "multi": {
      const chosen = (Array.isArray(v) ? v : [v]).map((id) => q.options?.find((x) => x.id === id)).filter(Boolean) as Option[];
      if (!chosen.length) return { outcome: "unanswered", s: null };
      return { outcome: chosen.some((o) => o.fail) ? "fail" : "pass", s: chosen.reduce((t, o) => t + o.score, 0) / chosen.length };
    }
    default: return { outcome: "info", s: null };
  }
}

/** Whether a question shows, given the answers in its scope. */
export function isVisible(q: Question, section: Section, answers: Answers): boolean {
  if (!q.showIf) return true;
  const target = section.questions.find((x) => x.id === q.showIf!.q);
  if (!target || !isVisible(target, section, answers)) return false;
  const a = answers[target.id];
  const { outcome } = answerScore(target, a);
  const is = q.showIf.is;
  if (is === "pass" || is === "fail" || is === "na") return outcome === is;
  if (is === "answered") return outcome !== "unanswered";
  const v = a?.v;
  return Array.isArray(v) ? v.includes(is) : v === is;
}

export interface Finding { sectionId: string; questionId: string; label: string; item: number | null; itemRef: string; severity: Severity; critical: boolean; weight: number; note: string; photos: number }
export interface Missing { sectionId: string; questionId: string; label: string; item: number | null; why: "required" | "photo" | "note" }
export interface Score {
  /** 0–100, or null when nothing scorable was answered. */
  pct: number | null;
  earned: number;
  possible: number;
  result: "pass" | "fail" | "incomplete";
  passMark: number;
  findings: Finding[];
  criticalFails: number;
  missing: Missing[];
  answered: number;
  questions: number;
  /** Sampled items, those with at least one failed question (deviations), failed checks (defects) and pass/fail answers (opportunities). */
  items: number;
  deviations: number;
  defects: number;
  opportunities: number;
  bySection: { id: string; title: string; pct: number | null; fails: number }[];
}

/** Score an inspection's answers against a template version. */
export function scoreInspection(def: TemplateDef, answers: Answers, items: SampledItem[] = []): Score {
  let earned = 0, possible = 0, answered = 0, questions = 0, defects = 0, opportunities = 0;
  const findings: Finding[] = [], missing: Missing[] = [];
  const bySection: Score["bySection"] = [];
  const itemFailed = new Set<number>();
  const sampled = def.sections.some((s) => s.perItem);
  for (const s of def.sections) {
    let se = 0, sp = 0, sf = 0;
    const scopes: { ans: Answers; item: number | null; ref: string }[] = s.perItem ? items.map((it, i) => ({ ans: it.answers || {}, item: i, ref: it.ref })) : [{ ans: answers, item: null, ref: "" }];
    for (const sc of scopes) {
      for (const q of s.questions) {
        if (!isVisible(q, s, sc.ans)) continue;
        questions++;
        const a = sc.ans[q.id];
        const { outcome, s: v } = answerScore(q, a);
        if (outcome !== "unanswered") answered++;
        else if (q.required) missing.push({ sectionId: s.id, questionId: q.id, label: q.label, item: sc.item, why: "required" });
        const counts = q.weight > 0 && (outcome === "pass" || outcome === "fail");
        if (counts) opportunities++;
        if (v !== null && q.weight > 0) { earned += q.weight * v; possible += q.weight; se += q.weight * v; sp += q.weight; }
        if (outcome === "fail") {
          if (counts) defects++;
          sf++;
          if (sc.item !== null) itemFailed.add(sc.item);
          findings.push({ sectionId: s.id, questionId: q.id, label: q.label, item: sc.item, itemRef: sc.ref, severity: q.severity, critical: q.critical, weight: q.weight, note: a?.note || "", photos: a?.photos?.length || 0 });
          if (q.photoOnFail && !a?.photos?.length) missing.push({ sectionId: s.id, questionId: q.id, label: q.label, item: sc.item, why: "photo" });
          if (q.noteOnFail && !a?.note?.trim()) missing.push({ sectionId: s.id, questionId: q.id, label: q.label, item: sc.item, why: "note" });
        }
      }
    }
    bySection.push({ id: s.id, title: s.title, pct: sp ? Math.round((se / sp) * 1000) / 10 : null, fails: sf });
  }
  const criticalFails = findings.filter((f) => f.critical).length;
  let pct = possible ? Math.round((earned / possible) * 1000) / 10 : null;
  if (criticalFails && def.scoring.critical === "zero" && pct !== null) pct = 0;
  const incomplete = missing.length > 0 || (sampled && items.length === 0);
  const result: Score["result"] = criticalFails ? "fail" : incomplete ? "incomplete" : pct === null || pct >= def.scoring.passMark ? "pass" : "fail";
  return { pct, earned: Math.round(earned * 100) / 100, possible, result, passMark: def.scoring.passMark, findings, criticalFails, missing, answered, questions, items: items.length, deviations: itemFailed.size, defects, opportunities, bySection };
}

/** A plain description of a condition, for the builder and the capture screen. */
export function describeShowIf(def: TemplateDef, q: Question): string {
  if (!q.showIf) return "";
  const t = allQuestions(def).find((x) => x.q.id === q.showIf!.q)?.q;
  if (!t) return "";
  const is = q.showIf.is;
  const what = is === "fail" ? (t.type === "yesno" ? "No" : "a fail") : is === "pass" ? (t.type === "yesno" ? "Yes" : "a pass") : is === "na" ? "N/A" : is === "answered" ? "answered" : `“${t.options?.find((o) => o.id === is)?.label || is}”`;
  return `Shown when “${t.label.slice(0, 50)}${t.label.length > 50 ? "…" : ""}” is ${what}`;
}
