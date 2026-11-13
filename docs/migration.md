# Moving the previous version's data into Postgres

**Who:** a Quality admin of the company (for the institution: one of its named administrators). **Where:** Settings → Data and uploads → "Move in the previous version's data".

1. **Preview (dry run).** Reads, never writes, the previous version's Blob store:
   - the institution: `defects.json` and `opstd.json` (else the bundled consolidated workbooks in `institution/`), `submissions.json`, `actions.json` and `attachment-<id>` files;
   - a company: `companies/<id>/program.json`, `submissions.json`, `actions.json` and attachments.
   It shows the counts, every warning, and the headline figures **as the previous version computed them next to the new ones**.
2. **Confirm.** The admin ticks "I've checked the preview" and imports. Everything is written in **one transaction** (all or nothing), recorded in the change history, then the evidence files are copied into the new evidence store and hashed. A preview older than a day must be re-run; a company that already has data can't be imported over.

## The institution's dry run (bundled history)

| Figure | Previous version | This version |
|---|---|---|
| Items reviewed | 11,074 | 11,074 |
| Possible instances | 143,429 | 143,429 |
| Defects found | 4,134 | 4,134 |
| Defect rate | 2.9% | 2.9% |
| Resolution rate | 82.8% | 79.9% |
| Recurring rate | 40.2% | 39.9% |
| Operational Standard (all months) | 92.3 | 92.3 |

Resolution and recurring differ only because **3 history rows recorded more defects resolved than were resolvable** (e.g. 88 resolved of 8), the cause of the resolution rate once reading above 100%, and 7 rows recorded more recurring than defects found. Those rows are capped and listed in the preview.

## What is carried over, and what isn't

- Units (with the institution's branch-name aliases), process areas, the institution's five control checks per area, company checklists, severities and natures; company people and their roles.
- The Branch Defects history at month × branch × area, the Operational Standard entries with their raw audit scores (mixed 1–5 and points scales kept).
- Every review with its items, history and attachments; every action with its reference (ACT-0007 stays ACT-0007), history and evidence.
- **Not carried:** shared role passwords and password accounts. People sign in as themselves; an admin grants roles in People and roles. Previous sign-in names appear in history as "… (previous sign-in)".

## The way back

Nothing in Blob is changed or deleted. Until the switch-over is confirmed, the previous deployment can be redeployed against the same store unchanged.
