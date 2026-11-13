# Pulsus Quality: the quality model

**Status:** design of record for Milestones 2 and 3 · **Owner:** Pulsus Quality · Last revised November 2026

Pulsus Quality started as one institution's branch-defect register. This document turns it into a general quality management and inspection platform for any multi-site organisation. It covers banks and credit unions, hospitals and health systems, government agencies, universities, and businesses with many sites. It benchmarks the market leaders, then designs the five pillars:

1. templates and the checklist builder;
2. inspections and field visits;
3. sampling;
4. the risk score;
5. actions, analytics and reporting.

The institution's Branch Defects and Operational Standard stay working throughout. They become templates in the library, and their records become history, rather than a special case built into the code.

---

## 1. Benchmark

### 1.1 Who we measured against

| Group | Products | What they are best at | Sector fit |
|---|---|---|---|
| Inspection and checklist platforms | **SafetyCulture** (iAuditor), **Lumiform**, **GoAudits**, **Crunchtime Ops Execution** (formerly Zenput) | Fast template building, phone capture, photos, logic, schedules | All of them are horizontal. SafetyCulture and Lumiform market to healthcare, government, education, retail and manufacturing. Crunchtime is restaurant and retail-led. |
| Enterprise QMS / EHS | **Octave Reliance** (formerly ETQ Reliance), **Intelex** | Configurable CAPA, audit programmes with risk-based frequency, document control, enterprise workflow | Manufacturing, life sciences and EHS. They are heavy to configure and priced for large programmes. |
| Clinical audit (healthcare) | **MEG** (MEG Audit), **Tendable** (formerly Perfect Ward), hand-hygiene observation tools (the Joint Commission's Hand Hygiene app, Ecolab, GOJO SMARTLINK, B. Braun HAT) | Ward-level audits, hand hygiene observation by the WHO "5 moments", offline capture, benchmarking across wards | Hospitals, health systems, care homes |
| Banking branch QA and mystery shopping | Market Force, BestMark, Harland Clarke and other CX vendors; regulator mystery-shop programmes (FCA, FCAC) | Customer-experience scripts, quarterly shop cadence, branch scorecards and action plans | Retail banks and credit unions. Government also uses it for citizen-service shops. |
| Audit sampling practice | AICPA Audit Guide *Audit Sampling*; IIA Practice Advisory 2320-3; ISA 530 | Attribute sampling for tests of controls, sample size by confidence and tolerable/expected deviation rates, stratification, random selection, projection | Universal for file, chart, transaction and record reviews |

### 1.2 What the leaders do (evidence)

- **SafetyCulture.** The template editor offers many response types, including multiple choice, checkbox, slider, number, text, signature and media. Logic fields on those responses can trigger follow-up questions, require actions or evidence, or send notifications. Scoring works on multiple-choice, checkbox and slider responses, with weights set per question. Flagged responses mark answers that need attention. Changes to a published template apply only to new inspections. ([logic](https://help.safetyculture.com/en-US/000031), [scoring](https://help.safetyculture.com/en-US/000064), [flagged responses](https://help.safetyculture.com/000029), [templates](https://help.safetyculture.com/en-US/using-safetyculture/templates))
- **Lumiform.** It has a form builder with templates and import. Questions carry point values. "K.O." answers flag a critical failure, and a critical failure can automatically create prioritised tasks with follow-up verification. ([form builder](https://lumiformapp.com/product/form-builder), [vs GoAudits](https://lumiformapp.com/comparisons/lumiform-vs-goaudits))
- **GoAudits.** It has drag-and-drop sections, conditional branching, weighted questions and pass/fail thresholds. Schedules can be daily, weekly, monthly or custom, set per location, and can be assigned to a role. Capture works offline. ([scheduling](https://goaudits.com/blog/audit-scheduling-feature/), [vs Lumiform](https://goaudits.com/blog/lumiform-alternatives/))
- **Crunchtime Ops Execution (Zenput).** It enforces brand standards across thousands of locations, with audits and corrective actions assigned and tracked automatically. ([audits and corrective action](https://www.zenput.com/platform/audits-corrective-action), [product brief](https://www.crunchtime.com/hubfs/2023%20Resource%20Page%20Assets/CrunchTime%20Ops%20Execution%20(Zenput)%20-%20Product%20Brief.pdf?hsLang=en))
- **Intelex.** Its audit scheduler sets frequency and risk level per audit, for one-off or recurring internal audits. ([audits management](https://intelex.com/products/applications/audits-management))
- **Reliance (ETQ).** CAPA is a core application. Audit calendars are generated from predefined criteria and resource availability. ([audit scheduling](https://www.etq.com/blog/improving-audit-scheduling-with-automation-etq-reliance), [Reliance](https://www.octave.com/reliance))
- **Clinical audit.** MEG covers hand hygiene, environment and care-bundle audits offline, with photos and signatures and with ward benchmarking. Perfect Ward/Tendable runs ward quality inspections on a smartphone for tens of thousands of nurses. Hand-hygiene tools observe the WHO 5 moments. ([MEG](https://megsupporttools.com/news-page/simplifying-document-management-for-healthcare-with-meg-docs), [Perfect Ward](https://htn.co.uk/2021/01/14/perfect-ward-hits-500000-quality-inspections/), [Tendable](https://uhliverpool.nhs.uk/luhft-staff/tendable), [Joint Commission app](https://jointcommission.org/resources/news-and-multimedia/blogs/improvement-insights/2023/02/mobile-application-improves-efficiency-of-hand-hygiene-audits), [Queensland Health auditing](https://www.health.qld.gov.au/clinical-practice/guidelines-procedures/diseases-infection/infection-prevention/standard-precautions/hand-hygiene/hand-hygiene-auditing-and-reporting))
- **Banking mystery shopping.** Typical programmes shop each branch quarterly, use branch-level scorecards with action plans, and average two shops as the baseline. Regulators use mystery shopping too: the FCA found suitability concerns in 15% of shops in its investment-advice review. ([Market Force case](https://www.marketforce.com/hubfs/Resources/Case-Studies/Market-Force-Case-Study-Banking-Branch-Services.pdf?hsLang=en), [Harland Clarke case](https://insight.harlandclarke.com/wp-content/uploads/2016/08/HC-Mystery-Shop-Improve-Customer-Service-Program-case-study-2016-08.pdf), [FCA thematic review](https://www.fca.org.uk/publication/thematic-reviews/thematic-assessing-retail-banking.pdf), [FCAC](https://www.canada.ca/en/financial-consumer-agency/programs/research/mystery-shopping-domestic-retail-banks.html))
- **Sampling standards.**
  - Sample size rises with the confidence wanted and the expected deviation rate, and falls as the tolerable deviation rate rises.
  - The auditor reads the size from a table, choosing the confidence (the risk of over-reliance), the expected rate (row) and the tolerable rate (column).
  - Stratification reduces variability within each stratum, and so the sample size.
  - Random selection is what lets results be projected with a known confidence. Judgmental selection is allowed, but it cannot be projected statistically.
  - Sources: [IIA PA 2320-3](https://www.iia.nl/actualiteit/nieuws/new-ippf-practice-advisory-released--23203-audit-sampling), [ISA 530 handbook](https://www.scribd.com/document/716359756/Handbook-ISA-530), [attribute sampling](https://www.dummies.com/article/business-careers-money/business/accounting/audits/how-does-attribute-sampling-work-189818/), [HUD OIG sampling appendix](https://hudoig.gov/sites/default/files/2024-02/appendix.pdf), [AICPA guide](https://www.pubmatch.com/book/312414.html).

### 1.3 Feature matrix

● full · ◐ partial · ○ none. "Pulsus today" is the state after Milestone 1. "Target" is the end of M3; **M2** and **M3** mark the milestone that ships it.

| Capability | SafetyCulture | Lumiform | GoAudits | Crunchtime | Reliance / Intelex | Clinical audit (MEG, Tendable) | Pulsus today | Target |
|---|---|---|---|---|---|---|---|---|
| Template builder: sections, drag and drop, phone-usable | ● | ● | ● | ● | ◐ forms designer | ● | ○ fixed areas and checks | ● **M2** |
| Question types: yes/no/N/A, pass/fail, rating, number with range, choice, text, date, photo, signature, reference | ● | ● | ● | ◐ | ◐ | ● | ○ pass/fail/N/A only | ● **M2** |
| Weights, severities, critical ("K.O.") questions | ● weights, flags | ● K.O. | ● | ◐ | ● | ◐ | ◐ severity weights | ● **M2** |
| Conditional logic (follow-up, require photo) | ● | ● | ● | ◐ | ◐ | ◐ | ○ | ● **M2** |
| Guidance and policy reference per question | ● | ● | ◐ | ◐ | ● document control | ● | ○ | ● **M2** |
| Versioning: published versions locked; old inspections keep theirs | ● | ◐ | ◐ | ◐ | ● | ◐ | ○ | ● **M2** |
| Import and export (JSON, Excel), duplicate | ◐ | ● import | ● | ◐ | ● | ◐ | ○ | ● **M2** |
| Template library by sector | ● public library | ● | ● | ◐ | ◐ | ● clinical | ○ | ● **M2**: banking, healthcare, government, higher education, general |
| Phone capture, offline drafts, photos, signatures | ● | ● | ● | ● | ◐ | ● | ◐ phone and on-device draft; no photos per question or signatures | ● **M2** |
| Supervisor review and approval, no self-approval | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ● | ● |
| Failed item → corrective action automatically | ● | ● | ◐ | ● | ● CAPA | ◐ | ◐ manual from defect | ● **M2** |
| Independent verification of action closure (verifier ≠ raiser, owner or submitter) | ◐ | ◐ | ○ | ○ | ● | ○ | ● | ● |
| Schedules, programmes, due windows, missed-visit alerts | ● | ● | ● | ● | ● | ● | ○ | ● **M3** |
| Site check-in (geolocation, time on site) | ● | ◐ | ● | ● | ○ | ○ | ○ | ● **M2** capture, **M3** reporting |
| Statistical sampling (attribute), seeded random selection, projection with upper limit | ○ | ○ | ○ | ○ | ○ | ○ | ◐ sample keyed, no plan | ● **M3**: our differentiator |
| Risk-based inspection frequency | ○ | ○ | ○ | ○ | ● risk level per audit | ○ | ○ | ● **M3** |
| Transparent site risk score with drivers | ○ | ○ | ○ | ◐ | ◐ | ◐ | ◐ watchlist | ● **M3** |
| Recurring-issue detection | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ● | ● |
| League tables, heat maps, most-failed questions | ● | ● | ● | ● | ● | ● | ◐ by area, not by question | ● **M2** (most-failed questions) / **M3** |
| Hash-chained audit trail, row-level tenancy, named roles | ○ | ○ | ○ | ○ | ◐ (21 CFR Part 11 e-signatures) | ○ | ● | ● |
| Feed to an enterprise risk register | ○ | ○ | ○ | ○ | ◐ within the suite | ○ | ● contract (stubbed) | ● |

**Where Pulsus wins.**
- **Assurance-grade sampling built into the inspection.** No inspection platform has it. Banks, hospitals (chart reviews), government (procurement and records files) and universities (exam-process files) all sample files.
- **Separation of duties and a tamper-evident history.** The quality data stands up to audit and regulator scrutiny.
- **A risk score that explains itself and sets the inspection cadence,** feeding Pulsus Risk.
- **One suite** with Risk, the platform and the executive brief.

---

## 2. Sector neutrality

Quality is sold to banks and credit unions, hospitals and health systems, government agencies, universities and other multi-site organisations. Everything a buyer sees is configurable, and each sector has defaults:

| | Banking | Healthcare | Government | Higher education | General |
|---|---|---|---|---|---|
| Site (unit) label | Branch | Ward / Clinic | Office | Campus / Building | Site |
| Grouping (region) | Region | Hospital / Directorate | Agency / Division | Faculty / Campus | Region |
| Sampled item | File / Transaction | Chart / Patient record | Case file / Record | File / Record | Record |
| Starter templates | Branch operations, teller/cash, KYC file, loan file, ATM site, H&S premises, mystery shop, complaints, Operational Standard, Branch Defects | Hand hygiene (WHO 5 moments), infection control, medication storage, patient-safety walk-round, environment of care, chart review (sampled) | Front-office service standards, records management, procurement file review (sampled), facilities and H&S, citizen-service mystery shop | Campus safety, lab safety, residence halls, accessibility, student services, exam/assessment process file review (sampled) | Health and safety, 5S/facilities, customer experience, supplier/site audit |
| Inherent-risk factors (M3 defaults) | Transaction volume, staff turnover, branch size, prior incidents, cash holdings | Bed count/acuity, staff vacancy, infection incidents, prior incidents | Caseload volume, staff turnover, public-facing hours, prior complaints | Student population, lab count, prior incidents, residence capacity | Volume, headcount, turnover, prior incidents |

- Sector packs are **starting points**: an organisation picks its sector at onboarding (Settings → Company set-up), and every label, template and factor stays editable.
- The demo is Meridian Society, a financial co-operative. Every sector pack can be browsed in its library, so a hospital or university buyer sees their own templates.

### 2.1 From sign-up to the first inspection (a hospital or a university)

1. **Sign up** on Pulsus Platform and open Pulsus Quality. The owner or admin is a Quality admin, and a banner offers **Set up**.
2. **Sector.** Choose *Hospitals and health systems* (or *Universities and colleges*). The labels, starter checklists and scorecard follow from it.
3. **Names.** Ward / Wards, grouped by Hospital, with Chart as the sampled record. A university gets Campus / Campuses, grouped by Faculty, with File as the sampled record. Every name can be edited.
4. **Locations.** Type the wards one at a time, or paste them from Excel as "Ward 4A, St Mary's".
5. **Checklists.** Hand hygiene (WHO 5 moments), infection control, medication storage, walk-rounds, environment of care and chart review are pre-ticked. A university gets campus safety, lab safety, residences, accessibility, student services and exam files. Each ticked checklist is published straight away.
6. **Scorecard.** *Ward quality score* or *Campus safety score*. Its measures read the checklists just added.
7. **Finish.** Inspectors open Inspect, then **Start an inspection**, on a phone. The whole journey takes minutes, and every step is recorded in the change history for that organisation only.

---

## 3. Pillar 1: templates and the builder (M2)

### 3.1 The template definition (`pulsus.quality.template/v1`)

A template is a JSON definition, stored as a **draft** on the template and frozen into a **version** on publish (`lib/templates/model.ts`):

```
Template
  name, description, sector, category
  sampling?    { itemLabel: "File", min, max }        // sections marked perItem repeat for each sampled item
  scoring      { passMark: 85, critical: "fail" | "zero" }
  binding?     { kind: "defects", areaId } | { kind: "scorecard" }   // feeds Branch Defects / the scorecard
  sections[]   { id, title, description?, perItem? }
    questions[] { id, type, label, guidance?, reference?, required, allowNA,
                  weight 0–10, severity critical|major|minor, critical (K.O.),
                  options[] {id,label,score 0–1,fail}  (choice / multi),
                  scale {min,max}                      (rating),
                  range {min?,max?,unit?}              (number: outside = fail),
                  photoOnFail, noteOnFail,
                  showIf { questionId, is: "fail"|"pass"|"na"|<optionId> },
                  action { auto, priority, dueDays },
                  key?                                  (check code or scorecard measure) }
```

**Question types:**
- yes/no (+N/A);
- pass/fail (+N/A);
- rating (1–5 by default);
- number, with an expected range;
- single choice and multiple choice, each option with a score and a fail flag;
- text;
- date;
- photo (required evidence);
- signature;
- reference (a file or sample reference, such as a loan number or chart ID).

### 3.2 Scoring

For every *visible, scorable, answered, not N/A* question:

```
possible += weight
earned   += weight × s      s: yes/pass 1, no/fail 0; rating (v−min)/(max−min);
                               number in range 1 else 0; choice: option score;
                               multi: mean of chosen option scores
score     = earned ÷ possible × 100          (N/A and hidden questions are excluded)
result    = fail if any critical question failed (the "critical override")
            else pass if score ≥ passMark, else fail
```

- With `critical: "zero"` a critical failure also sets the score to 0. This is the stricter rule some regulators and clinical audits use.
- Per-item (sampled) sections score across all items. The inspection also reports:
  - the **deviation count**: items with at least one failed question;
  - the **deviation rate**: deviations ÷ items;
  - **defects**: failed checks;
  - **opportunities**: pass/fail answers.
- These are the same measures as the Branch Defects register, so a sampled template feeds the defect rate.

### 3.3 Versioning

- Editing changes the draft. Publishing freezes it as version *n + 1* in `template_versions` (append-only; the app never updates a version, and the tests prove it).
- An inspection records `template_id` and `template_version`, and is always rendered and scored against that version, even after later publishes.
- Archive hides a template from new inspections. Duplicate copies the draft into a new template. Export downloads the definition as JSON or as an Excel sheet with one row per question. Import accepts either, validates it and creates a draft.

### 3.4 The builder

- **Desktop:** an outline of the sections, the question cards (drag to reorder within and across sections), the editor for the selected question, and a **live phone preview** of the inspection.
- **Phone:** the same cards stacked, with move up and move down controls (drag is not usable on touch screens), and a full-screen editor per question.
- **Every control works by keyboard,** and the a11y suite covers the builder.

### 3.5 Library

- `lib/templates/library.ts` holds the sector packs listed in §2. Adding one copies it into the company as a draft, ready to publish or edit.
- The institution's **Operational Standard** becomes a template bound to the scorecard: number questions 0–100 keyed to its measures, plus the audit grade as a choice question. Approving one writes the scorecard entry exactly as the old entry form did.
- The institution's **Branch Defects** becomes one sampled template per process area, generated from the company's programme. Its checks are pass/fail questions keyed to the existing check codes, with severities kept. Approving one feeds the Branch Defects figures at month × site × area, exactly as reviews do.
- Existing reviews and imported history stay as history.

## 4. Pillar 2: inspections and field visits (M2 capture, M3 programmes)

- **Lifecycle:**
  - An inspection moves draft → submitted → approved, or returned → resubmitted.
  - Nobody approves their own inspection.
  - Approval publishes the score, feeds any binding (defects or scorecard) and raises the corrective actions (§7).
- **Capture is phone-first:**
  - one question at a time, or a whole section;
  - big pass/fail targets;
  - a progress bar;
  - a per-question note and photos;
  - inspector and site-manager signatures drawn on screen.
- **Check-in (optional):** an optional geolocation reading and an arrival time. The time on site runs from check-in to submission.
- **Offline:**
  - The draft lives on the device (`localStorage`) and photos wait in IndexedDB.
  - A draft carries a client-generated id, so a retry after a dropped connection never creates a duplicate.
  - The sync runs automatically when the device comes back online.
- **Programmes (M3):**
  - A programme says which template is inspected, at which sites, how often, who does it, and the due window (for example, "within the first 15 days of the month").
  - Its calendar creates the due inspections.
  - Missed and overdue visits raise alerts and appear on Pulse.
  - The frequency can follow the risk band (§6.4).

## 5. Pillar 3: sampling (M3)

Every file, chart, transaction or record review can carry a **sampling plan** (`lib/sampling.ts`, pure and tested):

1. **Population.** Enter its size, or upload the list (CSV/Excel) with an id column and optional stratum and value columns.
2. **Method.**
   - **Statistical attribute sampling.** Choose the confidence (90 / 95 / 99%), the tolerable deviation rate (TDR) and the expected deviation rate (EDR).
     - The sample size *n* is the smallest number for which, if *k* = ⌈n × EDR⌉ deviations were found, the one-sided upper confidence bound on the deviation rate would not exceed the TDR. This is the binomial basis of the AICPA tables.
     - It reproduces the standard figures, for example **59** at 95% / 5% / 0%, **45** at 90% / 5% / 0%, **29** at 95% / 10% / 0%, **22** at 90% / 10% / 0%, and **93** at 95% / 5% / 1%.
     - For a small population the finite-population (hypergeometric) size applies.
   - **Judgmental or fixed.** The reviewer states the size and the reason. Results are reported but not projected statistically.
3. **Stratification (optional).** Split the population by site, product or value band, and allocate the sample in proportion, or set it per stratum. A 100% stratum, such as high-value items, is supported.
4. **Selection.** A seeded random selection: the seed is recorded with the plan and the population hash, so anyone can reproduce the same items. Export the selection as CSV or Excel.
5. **Evaluation.**
   - Each sampled item's inspection result counts as a deviation or not.
   - The **sample deviation rate** is projected to the population, with the **upper deviation limit** (Clopper–Pearson) at the plan's confidence.
   - The conclusion is "the control is operating effectively" when the upper limit is at or below the TDR.
   - The method, seed, inputs and evidence are shown beside the result.

## 6. Pillar 4: the risk score (M3)

Each site (or unit or process) has a **quality risk score** from 0 (low) to 100 (high), with three transparent parts and weights the company can edit:

```
risk = wI × Inherent + wC × ControlWeakness + wR × RecurrenceAndBacklog        (wI + wC + wR = 1; defaults 0.30 / 0.50 / 0.20)

Inherent         Σ factor weight × normalised factor (0–100). Factors are configurable per organisation, with sector defaults
                 (volume, staff turnover, size or complexity, prior incidents; for example bed acuity in healthcare).
ControlWeakness  100 − decayed mean inspection score, plus deviation-rate and critical-failure terms. Each observation
                 is weighted by e^(−age/τ), with half-life τ·ln2 = 6 months by default.
Recurrence…      recurring issues, overdue actions (count and days overdue) and returned inspections.
```

- **Bands.**
  - The score maps to the six Pulsus bands: World class < 15 ≤ Strong < 25 ≤ Healthy < 40 ≤ Watch < 55 ≤ Attention < 70 ≤ Escalate.
  - Lower is better.
  - The cut-offs are editable under Colour bands, with their history.
- **Drivers.** Each score is shown with the contribution of each factor ("why this branch is Escalate"), sorted by impact, for example:
  - critical failures in Payments, 2 this quarter (+14);
  - 4 overdue actions (+9);
  - staff turnover in the top quartile (+7).
- **Risk-based frequency.** A programme can set its cadence by band, for example monthly for Escalate or Attention, every two months for Watch, quarterly for Healthy, and half-yearly for Strong or World class.
- **League table and watchlist.** Sites are ranked by risk score, with the trend (Δ against last quarter) and the top driver.
- **To Pulsus Risk.** A site entering Escalate, a critical failure, or a recurring issue can be proposed to Risk under `docs/risk-contract.md`, with `record_type` `inspection` or `site_risk` (added to the contract in M3).

## 7. Pillar 5: actions, analytics and reporting

- **Failed questions become actions.**
  - When an inspection is approved, every failed question with *auto-create action* (and every critical failure, always) raises a corrective action.
  - The action records the site, the template, the question, the guidance as context, a due date from the question's `dueDays`, and the inspection reference.
  - The approving supervisor is the raiser.
  - The existing rule holds: the verifier is never the raiser, the owner or the submitter.
- **Analytics.** The existing measures are:
  - Pulse, Register, History heat-maps, Insights, recurring detection and the executive report.

  M2 adds:
  - inspection scores by site and template;
  - the **most-failed questions**.

  M3 adds:
  - league tables by risk;
  - heat-maps by site × template;
  - repeat-finding detection per question.
- **Reports.** The executive and committee report (print to PDF), plus the Excel exports, now including inspections.

## 7a. The scorecard designer (M2)

The Operational Standard was the institution's own measure tree in code. It is now one ready-made scorecard among several (`lib/scorecards/library.ts`). An organisation copies one, or starts blank, and designs its own at **Scorecards**:

- **Measures:**
  - **entered** monthly (0–100);
  - **computed** as a weighted average of earlier measures (optionally including the audit grade), optionally rounded;
  - **from a checklist:** the average score, the pass rate, or the compliance (100 − deviation rate) of that site's approved inspections that month. These are fed when each inspection is approved (`feedScorecardFromInspections`).
- **Settings:** the headline measure, the target, the dashboard columns, and whether an audit grade is recorded.
- **Preview** against generated sample data, coloured against the target.
- **Versions.** Publishing freezes a version in `scorecard_versions` (immutable, enforced by a trigger). One scorecard at a time is shown on the dashboards. Monthly entries keep the values they were scored with.
- **Ready-made scorecards:** Operational Standard and Branch Standards (banking), Ward quality score (healthcare), Public service standard (government), Campus safety score (higher education), Site quality score (general).

## 8. Data model added in M2

| Table | Purpose |
|---|---|
| `templates` | A company's template: name, sector, category, status (draft, published, archived), the editable draft, the latest published version and its origin (library key, import, migration) |
| `template_versions` | Immutable published definitions (template, version, definition, SHA-256, published by and at) |
| `inspections` | An inspection: reference `INS-0001`, template and version, site, period, status, inspector, approver, answers, sampled items, signatures, check-in, computed score, client id (offline idempotency) |
| `inspection_events` | The inspection's own status history (the hash-chained audit log also records every change) |

| `scorecard_versions` | Immutable published scorecard versions. `scorecards` gains a draft, a dirty flag and an origin |

All of these tables are tenant-scoped with row-level security, like every other table. Company settings gain a sector, a grouping label (Region, Hospital, Agency, Faculty) and whether set-up is done.

## 9. Delivery

- **M2 (this milestone):**
  - pillar 1, complete;
  - pillar 2: capture, offline drafts, check-in, signatures and approval;
  - pillar 5: failed items become actions, the most-failed questions, scores by site and template, and the inspections export;
  - the scorecard designer;
  - the set-up wizard;
  - the demo.
- **M3:**
  - pillar 3, sampling (§5);
  - pillar 2's programmes, schedules, calendar and missed-visit alerts;
  - pillar 4, the risk score, with risk-based frequency and the league table;
  - inspection results sent to Pulsus Risk (`record_type: inspection | site_risk`);
  - the committee report in PDF and Excel with inspection sections.
