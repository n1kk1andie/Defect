// The template library: starter templates by sector. An organisation adds one
// (it is copied into the company as a draft), then edits it freely in the
// builder. Pure data. Every entry passes validateTemplate (tested).
//
// The institution's Operational Standard and Branch Defects reviews are not
// here: they are generated from the company's own programme and scorecard
// (lib/templates/convert.ts), so they always match what the company measures.
import { TEMPLATE_SCHEMA, type Question, type QType, type Section, type Sector, type TemplateDef } from "@/lib/templates/model";

type O = {
  id?: string; w?: number; crit?: boolean; sev?: Question["severity"]; g?: string; ref?: string; photo?: boolean; note?: boolean;
  act?: "high" | "medium" | "low"; due?: number; na?: boolean; req?: boolean; when?: [string, string];
  opts?: [string, number, boolean?][]; range?: { min?: number; max?: number; unit?: string }; scale?: [number, number, number, string?, string?];
};

function q(type: QType, label: string, o: O = {}): Question {
  const scorable = !["text", "date", "photo", "signature", "reference"].includes(type);
  const x: Question = {
    id: o.id || "", type, label, required: o.req ?? (scorable || type === "photo"), allowNA: o.na ?? (type === "yesno" || type === "passfail"),
    weight: scorable ? o.w ?? (o.crit ? 3 : 1) : 0, severity: o.sev ?? (o.crit ? "critical" : "major"), critical: !!o.crit,
  };
  if (o.g) x.guidance = o.g;
  if (o.ref) x.reference = o.ref;
  if (o.photo) x.photoOnFail = true;
  if (o.note) x.noteOnFail = true;
  if (o.act || o.crit) x.action = { auto: true, priority: o.act ?? "high", dueDays: o.due ?? (o.crit ? 7 : 30) };
  if (o.opts) x.options = o.opts.map(([label, score, fail], i) => ({ id: `o${i + 1}`, label, score, ...(fail ? { fail: true } : {}) }));
  if (o.range) x.range = o.range;
  if (type === "rating") { const [min, max, passAt, lo, hi] = o.scale ?? [1, 5, 3, "Poor", "Excellent"]; x.scale = { min, max, passAt, ...(lo && hi ? { labels: [lo, hi] as [string, string] } : {}) }; }
  if (o.when) x.showIf = { q: o.when[0], is: o.when[1] };
  return x;
}
const yn = (l: string, o?: O) => q("yesno", l, o);
const pf = (l: string, o?: O) => q("passfail", l, o);
const rate = (l: string, o?: O) => q("rating", l, o);
const numq = (l: string, o?: O) => q("number", l, o);
const pick = (l: string, opts: O["opts"], o: O = {}) => q("choice", l, { ...o, opts });
const many = (l: string, opts: O["opts"], o: O = {}) => q("multi", l, { ...o, opts });
const text = (l: string, o?: O) => q("text", l, { req: false, ...o });
const photo = (l: string, o?: O) => q("photo", l, o);
const refq = (l: string, o?: O) => q("reference", l, { req: true, ...o });
const date = (l: string, o?: O) => q("date", l, { req: false, ...o });
/** A follow-up shown only when the question with this id fails. */
const ifFail = (id: string): Pick<O, "when"> => ({ when: [id, "fail"] });

function sec(title: string, questions: Question[], o: { perItem?: boolean; desc?: string } = {}): Section {
  return { id: "", title, questions, ...(o.perItem ? { perItem: true } : {}), ...(o.desc ? { description: o.desc } : {}) };
}

export interface LibraryEntry { key: string; sector: Sector; icon: string; minutes: number; def: TemplateDef }

function tpl(key: string, sector: Sector, category: string, name: string, description: string, sections: Section[], o: { item?: string; pass?: number; zero?: boolean; site?: boolean; minutes?: number; icon?: string; checkin?: boolean } = {}): LibraryEntry {
  // Stable ids, so an export of a library template diffs cleanly against a later one.
  sections.forEach((s, si) => {
    s.id = `s${si + 1}`;
    const rename = new Map<string, string>();
    s.questions.forEach((x, qi) => { const id = `s${si + 1}q${qi + 1}`; if (x.id) rename.set(x.id, id); x.id = id; });
    s.questions.forEach((x) => { if (x.showIf) x.showIf = { ...x.showIf, q: rename.get(x.showIf.q) ?? x.showIf.q }; });
  });
  const def: TemplateDef = {
    schema: TEMPLATE_SCHEMA, name, description, sector, category,
    scoring: { passMark: o.pass ?? 85, critical: o.zero ? "zero" : "fail" },
    signatures: { inspector: true, site: o.site ?? true }, checkin: o.checkin ?? true, sections,
  };
  if (sections.some((s) => s.perItem)) def.sampling = { itemLabel: o.item ?? "Item", min: 1, max: 200 };
  const minutes = o.minutes ?? Math.max(10, Math.round(sections.reduce((t, s) => t + s.questions.length, 0) * 1.2));
  return { key, sector, icon: o.icon ?? "review", minutes, def };
}

const GRADE: O["opts"] = [["Fully met", 1], ["Partly met", 0.5], ["Not met", 0, true]];

// ── Banking and credit unions ────────────────────────────────────────────────
const BANKING: LibraryEntry[] = [
  tpl("bank-branch-ops", "banking", "Branch operations", "Branch operations review", "The monthly operational control review of a branch: opening and closing, dual control, cash and security, records, staff and service.", [
    sec("Opening and closing", [
      yn("Branch opened and closed under dual control", { crit: true, ref: "Branch Operations Manual §2.1", g: "Two authorised staff present for alarm, vault and safe. Check the opening and closing log for both signatures." }),
      yn("Opening and closing log complete for the last 20 business days", { w: 2, note: true }),
      yn("Alarm codes changed within the required period", { w: 2, ref: "Security Standard §5" }),
    ]),
    sec("Vault, cash and keys", [
      yn("Vault and safe combinations held under dual custody", { crit: true }),
      yn("Key register reconciled to the keys physically held", { w: 2, id: "keys", photo: true }),
      text("Which keys were missing or unaccounted for?", ifFail("keys")),
      yn("Cash holdings within the branch insurance limit", { w: 2, act: "high" }),
      yn("Surprise cash count performed this month and recorded", { w: 2 }),
    ]),
    sec("Records and controls", [
      yn("Daily balancing completed and signed off by a supervisor", { w: 2 }),
      yn("Suspense and differences cleared within 2 business days", { w: 2, act: "medium" }),
      yn("Dormant-account reactivations authorised by a second officer", { crit: true, ref: "Dormancy Policy §3" }),
      yn("Override and exception report reviewed daily", { w: 2 }),
      yn("Confidential waste locked and shredded under contract", { w: 1 }),
    ]),
    sec("People and service", [
      yn("Mandatory training (AML, fraud, privacy) current for all staff", { w: 2, act: "medium" }),
      yn("Segregation of duties maintained (no staff member both keys and records the same transaction)", { crit: true }),
      rate("Customer area: clean, signage current, rates and fees displayed", { w: 1, photo: true }),
      text("Observations for the branch manager"),
    ]),
  ], { icon: "building" }),

  tpl("bank-teller-cash", "banking", "Cash", "Teller and cash handling", "Surprise teller cash count and cash-handling controls at the counter.", [
    sec("Cash count", [
      refq("Teller ID or till number"),
      numq("Counted cash difference (positive or negative)", { crit: true, range: { min: -5, max: 5, unit: "currency" }, g: "Count the till in the teller's presence. Any difference outside the tolerance fails the count.", note: true }),
      yn("Teller cash within the till limit", { w: 2, act: "medium" }),
      yn("Bait money and dye packs in place and recorded", { w: 1, na: true }),
    ]),
    sec("Counter controls", [
      yn("Till locked whenever the teller steps away", { w: 2, photo: true }),
      yn("Large cash transactions approved by a supervisor", { crit: true, ref: "Cash Handling Procedure §4.2" }),
      yn("Currency transaction reports raised for reportable amounts", { crit: true, ref: "AML Policy §7" }),
      yn("Counterfeit notes withdrawn and logged", { w: 1, na: true }),
      yn("Cash shipments verified under dual control", { w: 2 }),
    ]),
  ], { site: true, icon: "card" }),

  tpl("bank-kyc-file", "banking", "File review", "KYC and account-opening file review", "Test a sample of account-opening files against the customer due diligence standard. Each file is a sampled item.", [
    sec("Sample", [text("How was the sample selected?", { g: "For example: random from the month's account openings, seed recorded on the sampling plan." })]),
    sec("Each file", [
      refq("Account or customer number"),
      yn("Identity verified with acceptable documents, copies on file", { crit: true, ref: "CDD Standard §3.1" }),
      yn("Proof of address on file and dated within 3 months", { w: 2 }),
      yn("Sanctions and PEP screening completed before opening", { crit: true, ref: "Sanctions Policy §2" }),
      yn("Customer risk rating assigned and justified", { w: 2 }),
      yn("Source of funds recorded where required", { w: 2, na: true }),
      yn("Enhanced due diligence approved for high-risk customers", { crit: true, na: true }),
      yn("System record matches the documents (name, date of birth, address)", { w: 1 }),
    ], { perItem: true }),
  ], { item: "File", site: false, icon: "file", checkin: false }),

  tpl("bank-loan-file", "banking", "File review", "Loan file review", "Credit file quality: application, underwriting, approval within authority, security and disbursement. Each loan file is a sampled item.", [
    sec("Each loan file", [
      refq("Loan number"),
      yn("Application complete and signed", { w: 1 }),
      yn("Income and affordability verified", { crit: true, ref: "Lending Policy §4" }),
      yn("Credit decision within the approver's delegated authority", { crit: true }),
      yn("Exceptions to policy documented and approved", { w: 2, na: true }),
      yn("Security perfected before disbursement (charge registered, insurance in place)", { w: 2, na: true }),
      yn("Disclosures and key facts given to the borrower", { w: 2, ref: "Consumer Credit Disclosure §1" }),
      yn("Disbursement matches the approved amount and purpose", { w: 2 }),
    ], { perItem: true }),
  ], { item: "Loan file", site: false, icon: "file", checkin: false }),

  tpl("bank-atm", "banking", "Site check", "ATM site check", "Physical and security check of an ATM or self-service lobby.", [
    sec("Security", [
      yn("No skimming devices, cameras or overlays on the fascia", { crit: true, photo: true, g: "Pull gently on the card reader and PIN pad surround. Look for pinhole cameras above the keypad." }),
      yn("Anti-skimming device fitted and working", { w: 2 }),
      yn("CCTV covers the ATM and lobby, recording verified", { w: 2 }),
      yn("Lighting adequate around the ATM after dark", { w: 1, photo: true }),
    ]),
    sec("Condition and service", [
      pick("Machine status", [["In service", 1], ["Partly in service (no deposits or no cash)", 0.5], ["Out of service", 0, true]], { w: 2 }),
      yn("Screen, keypad and receipt printer working", { w: 1 }),
      yn("Signage, fees notice and helpline number displayed", { w: 1 }),
      rate("Cleanliness of the site", { w: 1 }),
      photo("Photo of the ATM fascia"),
    ]),
  ], { site: false, icon: "card", minutes: 10 }),

  tpl("bank-premises-hs", "banking", "Health and safety", "Branch premises: health and safety", "Workplace health and safety walk-through for a branch.", [
    sec("Fire and emergency", [
      yn("Fire exits unobstructed and signed", { crit: true, photo: true }),
      yn("Extinguishers in date and inspected", { w: 2 }),
      yn("Fire drill held within the last 6 months", { w: 2 }),
      yn("First aid kit stocked; first aider named on the notice", { w: 1 }),
    ]),
    sec("Workplace", [
      yn("Floors and walkways free of trip hazards", { w: 2, photo: true }),
      yn("Electrical equipment tested and in date", { w: 1 }),
      yn("Hold-up and panic alarms tested this month", { crit: true }),
      yn("Accessible entrance and counter available for customers with disabilities", { w: 2 }),
      text("Hazards found and immediate action taken"),
    ]),
  ], { icon: "alert" }),

  tpl("bank-mystery-shop", "banking", "Customer experience", "Customer-experience mystery shop", "A shopper's visit to a branch: welcome, needs discovery, product knowledge, compliance and close.", [
    sec("Visit", [date("Date of visit", { req: true }), text("Time of visit and staff member (description or name badge)")]),
    sec("Welcome and wait", [
      yn("Greeted within 30 seconds of entering", { w: 1 }),
      numq("Minutes waited before being served", { w: 2, range: { min: 0, max: 5, unit: "min" } }),
      rate("Branch appearance", { w: 1 }),
    ]),
    sec("Service", [
      yn("Asked open questions to understand the need", { w: 2 }),
      rate("Product knowledge", { w: 2 }),
      yn("Explained fees, rates and key terms clearly", { crit: true, ref: "Fair Treatment of Customers" }),
      yn("Did not pressure the shopper to buy", { crit: true }),
      yn("Offered a next step (appointment, brochure, follow-up)", { w: 1 }),
      rate("Overall impression", { w: 2, scale: [1, 5, 4, "Poor", "Excellent"] }),
      text("Shopper's narrative"),
    ]),
  ], { site: false, icon: "eye", checkin: false }),

  tpl("bank-complaints", "banking", "File review", "Complaints handling review", "Sampled complaint files tested against the complaints-handling standard.", [
    sec("Each complaint", [
      refq("Complaint reference"),
      yn("Acknowledged within 2 business days", { w: 2 }),
      yn("Resolved within the regulatory deadline", { crit: true, ref: "Complaints Handling Standard §5" }),
      yn("Root cause recorded", { w: 2 }),
      yn("Final response explains the outcome and the right to escalate", { crit: true }),
      yn("Redress calculated correctly and paid", { w: 2, na: true }),
      pick("Fairness of the outcome", GRADE, { w: 2 }),
    ], { perItem: true }),
  ], { item: "Complaint", site: false, icon: "help", checkin: false }),
];

// ── Hospitals and health systems ─────────────────────────────────────────────
const HEALTHCARE: LibraryEntry[] = [
  tpl("hc-hand-hygiene", "healthcare", "Infection prevention", "Hand hygiene audit (WHO 5 moments)", "Direct observation of hand-hygiene opportunities by the WHO 5 moments. Each observed opportunity is a sampled item; compliance is the pass rate.", [
    sec("Session", [text("Observer, session start and end time"), many("Staff groups observed", [["Nursing", 1], ["Medical", 1], ["Allied health", 1], ["Support staff", 1]], { w: 0, req: false })]),
    sec("Each opportunity", [
      pick("Moment", [["1 · Before touching a patient", 1], ["2 · Before a clean/aseptic procedure", 1], ["3 · After body-fluid exposure risk", 1], ["4 · After touching a patient", 1], ["5 · After touching patient surroundings", 1]], { w: 0, g: "WHO My 5 Moments for Hand Hygiene." }),
      pick("Staff group", [["Nursing", 1], ["Medical", 1], ["Allied health", 1], ["Support staff", 1]], { w: 0 }),
      pick("Action", [["Hand rub", 1], ["Hand wash", 1], ["Missed", 0, true]], { w: 1, crit: false }),
      yn("Gloves used appropriately (not instead of hand hygiene)", { w: 1, na: true }),
    ], { perItem: true }),
  ], { item: "Opportunity", pass: 90, site: false, icon: "check", minutes: 20 }),

  tpl("hc-infection-control", "healthcare", "Infection prevention", "Infection control audit", "Ward-level infection prevention and control standards.", [
    sec("Environment", [
      yn("Alcohol hand rub available at the point of care", { w: 2, photo: true }),
      yn("Clinical and general waste segregated correctly", { w: 2 }),
      yn("Sharps bins below the fill line, labelled and dated", { crit: true, photo: true }),
      yn("Linen stored covered and off the floor", { w: 1 }),
    ]),
    sec("Isolation and equipment", [
      yn("Isolation signage displayed and PPE available at the door", { crit: true, na: true }),
      yn("Equipment cleaned and tagged as clean", { w: 2 }),
      yn("Commodes and bedpans clean underneath", { w: 2, photo: true }),
      yn("Staff bare below the elbows", { w: 1 }),
      rate("Overall cleanliness", { w: 2 }),
    ]),
  ], { icon: "check" }),

  tpl("hc-medication", "healthcare", "Medicines", "Medication storage and safety", "Storage, security and records of medicines on a ward or clinic.", [
    sec("Storage", [
      yn("Medicines cupboards and trolleys locked", { crit: true }),
      numq("Medicine fridge temperature (°C)", { crit: true, range: { min: 2, max: 8, unit: "°C" }, photo: true, g: "Record the current reading. Outside 2–8 °C fails; check the min/max log for the last 7 days." }),
      yn("Fridge min/max temperature log complete for the last 7 days", { w: 2 }),
      yn("No expired medicines in stock", { w: 2, photo: true }),
    ]),
    sec("Controlled drugs", [
      yn("Controlled drug register balances to the stock checked", { crit: true, ref: "Controlled Drugs Policy" }),
      yn("Two signatures on every controlled-drug entry", { crit: true }),
      yn("Controlled-drug keys held by the nurse in charge", { w: 2 }),
    ]),
    sec("Administration", [
      yn("Allergy status recorded on the sampled charts", { w: 2 }),
      yn("No omitted critical medicines without a reason", { crit: true }),
    ]),
  ], { icon: "lock" }),

  tpl("hc-walkround", "healthcare", "Patient safety", "Patient-safety leadership walk-round", "A leadership walk-round: talking to staff and patients about safety, and following up.", [
    sec("Conversation with staff", [
      rate("Staff feel able to raise safety concerns", { w: 2 }),
      yn("Staffing matched to the planned levels this shift", { w: 2 }),
      text("What could cause the next patient harm here?"),
    ]),
    sec("Observations", [
      yn("Patient identification bands present and correct", { crit: true }),
      yn("Falls risk assessed and mitigations in place", { w: 2 }),
      yn("Pressure-injury prevention plans current", { w: 2 }),
      yn("Escalation of the deteriorating patient visible (early-warning scores)", { w: 2 }),
      pick("Patient experience", [["Positive", 1], ["Mixed", 0.5], ["Concerns raised", 0, true]], { w: 1, note: true }),
    ]),
  ], { site: true, icon: "users" }),

  tpl("hc-environment-of-care", "healthcare", "Facilities", "Environment of care round", "Environment-of-care rounding: safety, security, fire, utilities and hazardous materials.", [
    sec("Safety and fire", [
      yn("Corridors clear; fire doors close fully", { crit: true, photo: true }),
      yn("Medical gas shut-off valves accessible and labelled", { w: 2 }),
      yn("Hazardous materials stored and labelled; safety data sheets available", { w: 2 }),
    ]),
    sec("Equipment and utilities", [
      yn("Medical equipment has a current inspection sticker", { w: 2 }),
      yn("Emergency power outlets identified (red)", { w: 1 }),
      yn("Ceiling tiles intact, no water damage", { w: 1, photo: true }),
      rate("General environment", { w: 1 }),
    ]),
  ], { icon: "building" }),

  tpl("hc-chart-review", "healthcare", "Clinical audit", "Clinical record (chart) review", "Documentation standards tested on a sample of patient charts.", [
    sec("Each chart", [
      refq("Chart or patient record number", { g: "Record the identifier only, no patient-identifiable detail beyond it." }),
      yn("Admission assessment completed within 24 hours", { w: 2 }),
      yn("Allergies documented", { crit: true }),
      yn("Care plan current and signed", { w: 2 }),
      yn("Entries dated, timed and signed legibly", { w: 1 }),
      yn("Consent documented for procedures", { crit: true, na: true }),
      yn("Discharge summary completed (discharged patients)", { w: 2, na: true }),
    ], { perItem: true }),
  ], { item: "Chart", site: false, icon: "file", checkin: false }),
];

// ── Government and public services ───────────────────────────────────────────
const GOVERNMENT: LibraryEntry[] = [
  tpl("gov-front-office", "government", "Service standards", "Front-office service standards", "The public-facing office against its published service standards.", [
    sec("Access", [
      yn("Opening hours displayed and kept", { w: 2 }),
      numq("Average wait time today (minutes)", { w: 2, range: { min: 0, max: 20, unit: "min" } }),
      yn("Accessible entrance, counter and seating", { w: 2 }),
      yn("Information available in the required languages and formats", { w: 2 }),
    ]),
    sec("Service", [
      yn("Queue management system working", { w: 1 }),
      yn("Staff wear identification", { w: 1 }),
      yn("Privacy maintained at the counter (no overheard personal details)", { crit: true }),
      yn("Complaints and feedback process visible", { w: 1 }),
      rate("Overall service environment", { w: 2 }),
    ]),
  ], { icon: "building" }),

  tpl("gov-records", "government", "Records", "Records management inspection", "Records management against the retention schedule and information-security policy.", [
    sec("Storage and security", [
      yn("Paper records stored in locked cabinets or rooms", { crit: true }),
      yn("Clear-desk policy observed", { w: 2, photo: true }),
      yn("Records classified and labelled", { w: 2 }),
    ]),
    sec("Retention and disposal", [
      yn("Retention schedule applied; no records held beyond retention", { w: 2, ref: "Records Retention Schedule" }),
      yn("Disposal certificates on file for destroyed records", { w: 2 }),
      yn("Information requests logged and answered on time", { crit: true }),
      text("Notes"),
    ]),
  ], { icon: "database" }),

  tpl("gov-procurement-file", "government", "File review", "Procurement file review", "A sample of procurement files tested against the procurement rules.", [
    sec("Each procurement file", [
      refq("Contract or purchase order number"),
      pick("Procurement route", [["Open tender", 1], ["Restricted / framework", 1], ["Quotations", 1], ["Direct award", 1]], { w: 0 }),
      yn("Route matches the value threshold", { crit: true, ref: "Procurement Rules §3" }),
      yn("Conflict-of-interest declarations signed by the panel", { crit: true }),
      yn("Evaluation scored against published criteria", { w: 2 }),
      yn("Approval by the authorised delegate", { crit: true }),
      yn("Contract signed before work started", { w: 2 }),
      yn("Direct award justified in writing", { w: 2, na: true }),
    ], { perItem: true }),
  ], { item: "Procurement file", site: false, icon: "file", checkin: false }),

  tpl("gov-facilities-hs", "government", "Health and safety", "Facilities and health and safety", "Workplace inspection of a public building.", [
    sec("Fire and emergency", [yn("Fire exits clear and signed", { crit: true, photo: true }), yn("Evacuation plan displayed", { w: 1 }), yn("Fire wardens named and trained", { w: 2 })]),
    sec("Workplace", [yn("Workstations assessed (ergonomics)", { w: 1 }), yn("No trip, slip or fall hazards", { w: 2, photo: true }), yn("Incident reports filed and followed up", { w: 2 }), yn("Lone-worker and personal safety arrangements in place", { w: 2 })]),
  ], { icon: "alert" }),

  tpl("gov-citizen-shop", "government", "Customer experience", "Citizen-service mystery shop", "A mystery visit or call to a public service.", [
    sec("Contact", [pick("Channel", [["In person", 1], ["Telephone", 1], ["Online chat", 1]], { w: 0 }), numq("Minutes to first contact", { w: 2, range: { min: 0, max: 10, unit: "min" } })]),
    sec("Service", [yn("Staff introduced themselves", { w: 1 }), yn("Gave correct information", { crit: true }), yn("Explained the next steps and timescales", { w: 2 }), yn("Treated the citizen with courtesy and respect", { w: 2 }), rate("Overall experience", { w: 2 }), text("Narrative")]),
  ], { site: false, icon: "eye", checkin: false }),
];

// ── Universities and colleges ────────────────────────────────────────────────
const HIGHER_ED: LibraryEntry[] = [
  tpl("he-campus-safety", "higher_ed", "Safety", "Campus safety walk", "Campus grounds and building safety and security.", [
    sec("Security", [yn("Emergency phones working", { crit: true }), yn("Exterior lighting working along main routes", { w: 2, photo: true }), yn("Access-controlled doors closing and locking", { w: 2 }), yn("CCTV coverage of entrances", { w: 1 })]),
    sec("Grounds", [yn("Paths free of hazards", { w: 2, photo: true }), yn("Signage and wayfinding current", { w: 1 }), yn("Emergency notices and assembly points displayed", { w: 2 })]),
  ], { icon: "globe" }),

  tpl("he-lab-safety", "higher_ed", "Safety", "Laboratory safety inspection", "Teaching and research laboratory safety.", [
    sec("Chemicals", [yn("Chemical inventory current", { w: 2 }), yn("Incompatible chemicals segregated", { crit: true, photo: true }), yn("Fume cupboards tested within 12 months", { crit: true }), yn("Waste containers labelled and closed", { w: 2 })]),
    sec("People and equipment", [yn("Risk assessments in date for current work", { w: 2 }), yn("Eyewash and safety shower tested this month", { crit: true }), yn("PPE worn by everyone in the lab", { w: 2 }), yn("Training records current for lab users", { w: 2 })]),
  ], { icon: "alert" }),

  tpl("he-residence", "higher_ed", "Residence life", "Residence hall inspection", "Student residence safety, condition and welfare.", [
    sec("Safety", [yn("Smoke alarms tested and working", { crit: true }), yn("Fire doors not propped open", { crit: true, photo: true }), yn("No prohibited appliances in rooms sampled", { w: 2 })]),
    sec("Condition and welfare", [rate("Condition of shared kitchens and bathrooms", { w: 2 }), yn("Maintenance requests answered within the standard", { w: 2 }), yn("Welfare and out-of-hours contacts displayed", { w: 1 })]),
  ], { icon: "building" }),

  tpl("he-accessibility", "higher_ed", "Accessibility", "Accessibility audit", "Physical and information accessibility of a building or service.", [
    sec("Physical access", [yn("Step-free route to the entrance", { crit: true }), yn("Accessible toilet available and unobstructed", { w: 2 }), yn("Lifts working", { w: 2 }), yn("Hearing loop at reception", { w: 1, na: true })]),
    sec("Information", [yn("Signage high-contrast and readable", { w: 1 }), yn("Course and service information available in accessible formats", { w: 2 }), yn("Website pages checked meet WCAG 2.2 AA", { w: 2, na: true })]),
  ], { icon: "users" }),

  tpl("he-student-services", "higher_ed", "Service quality", "Student services quality review", "Student-facing services against the service charter.", [
    sec("Service", [numq("Average response time to enquiries (working days)", { w: 2, range: { min: 0, max: 3, unit: "days" } }), yn("Enquiries logged and tracked", { w: 2 }), yn("Referral routes to wellbeing and disability services known by staff", { crit: true }), yn("Privacy of student information maintained", { crit: true }), rate("Student feedback this term", { w: 2 })]),
  ], { site: false, icon: "help", checkin: false }),

  tpl("he-exam-file", "higher_ed", "File review", "Exam and assessment process file review", "A sample of assessment files tested against the assessment regulations.", [
    sec("Each assessment file", [refq("Module and assessment code"), yn("Paper set and approved by the external examiner", { crit: true }), yn("Marking scheme on file", { w: 2 }), yn("Second marking or moderation evidenced", { crit: true }), yn("Extenuating circumstances applied consistently", { w: 2, na: true }), yn("Marks entered correctly in the student record", { w: 2 })], { perItem: true }),
  ], { item: "Assessment file", site: false, icon: "file", checkin: false }),
];

// ── Any multi-site organisation ──────────────────────────────────────────────
const GENERAL: LibraryEntry[] = [
  tpl("gen-health-safety", "general", "Health and safety", "Workplace health and safety inspection", "A general workplace inspection for any site.", [
    sec("Fire and emergency", [yn("Fire exits clear", { crit: true, photo: true }), yn("Extinguishers in date", { w: 2 }), yn("First aid kit stocked", { w: 1 })]),
    sec("Workplace", [yn("Housekeeping: no slip or trip hazards", { w: 2, photo: true }), yn("Electrical safety: no damaged cables", { w: 2 }), yn("Hazardous substances stored correctly", { w: 2 }), yn("PPE available and used", { w: 2 }), text("Hazards found")]),
  ], { icon: "alert" }),

  tpl("gen-5s", "general", "Facilities", "5S / workplace organisation", "Sort, set in order, shine, standardise, sustain.", [
    sec("5S", [rate("Sort: only what is needed is present", { w: 2 }), rate("Set in order: a place for everything, labelled", { w: 2 }), rate("Shine: clean and inspected", { w: 2 }), rate("Standardise: standards visible and followed", { w: 2 }), rate("Sustain: last audit's actions closed", { w: 2 }), photo("Photo of the area")]),
  ], { pass: 70, icon: "check" }),

  tpl("gen-cx", "general", "Customer experience", "Customer experience review", "Customer-facing standards at a site.", [
    sec("Experience", [yn("Greeted promptly", { w: 1 }), rate("Staff knowledge", { w: 2 }), yn("Promises kept (call-backs, deliveries)", { w: 2 }), rate("Cleanliness and presentation", { w: 1 }), rate("Overall experience", { w: 2 }), text("Comments")]),
  ], { icon: "eye" }),

  tpl("gen-supplier", "general", "Supplier", "Supplier / site audit", "A supplier or contractor site audit.", [
    sec("Management", [yn("Quality policy and certificates current", { w: 2 }), yn("Contract requirements understood and documented", { w: 2 }), yn("Subcontractors approved", { w: 1, na: true })]),
    sec("Operations", [yn("Non-conformances recorded and closed", { w: 2 }), yn("Traceability of goods or services maintained", { crit: true }), yn("Business continuity plan tested", { w: 2 }), yn("Information security controls in place", { crit: true }), pick("Overall rating", [["Approved", 1], ["Approved with conditions", 0.5], ["Not approved", 0, true]], { w: 3 })]),
  ], { icon: "link" }),
];

export const LIBRARY: LibraryEntry[] = [...BANKING, ...HEALTHCARE, ...GOVERNMENT, ...HIGHER_ED, ...GENERAL];
export const libraryEntry = (key: string) => LIBRARY.find((e) => e.key === key) || null;
