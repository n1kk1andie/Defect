# Pulsus Quality → Pulsus Risk: the proposed-issue contract

**Schema:** `pulsus.quality.proposed-issue/v1` · **Owner:** Pulsus Quality · **Status:** sending side built and stubbed; Risk's intake is being rebuilt in parallel.

A supervisor in Quality can send a **serious or recurring defect** to Pulsus Risk. It arrives as a **proposed** issue (or risk event) in Risk's review queue, labelled "Linked: Pulsus Quality". A Risk Officer accepts or rejects it: nothing enters Risk unreviewed.

## Transport

```
POST {RISK_INTAKE_URL}                      e.g. https://risk.pulsus.tech/api/intake/quality
Authorization: Bearer {RISK_INTAKE_KEY}     interim shared key; to be replaced by the suite's
                                            service grant (iss pulsus-service-grant, scope "risk.intake")
Idempotency-Key: {payload.id}
Content-Type: application/json
```

| Risk answers | Meaning | Quality records |
|---|---|---|
| `202 {"accepted": true, "risk_ref": "RSK-ISS-0123", "status": "proposed"}` | queued for a Risk Officer | `sent` |
| `200` with the same body | already received (idempotent replay) | `sent` |
| `409 {"risk_ref": "…"}` | duplicate of an existing proposal | `sent` |
| `4xx/5xx` or no answer within 8 s | not received | `failed` (resend later) |

Until `RISK_INTAKE_URL` is set, Quality stores each proposal in its outbox as `stubbed` (Settings → Integrations) and sends nothing.

## Payload

```json
{
  "schema": "pulsus.quality.proposed-issue/v1",
  "id": "9f2c…64 hex",
  "sent_at": "2026-11-13T09:30:00.000Z",
  "source": {
    "app": "quality",
    "company_id": "harbour-cu",
    "record_type": "recurring_issue",
    "record_ref": "<unit id>|<area id>|Missing customer verification",
    "url": "https://quality.pulsus.tech/insights"
  },
  "proposed": {
    "kind": "risk_event",
    "title": "Recurring: Missing customer verification at Summit",
    "description": "Missing customer verification has recurred at Summit (Card Applications) for 3 consecutive months, 31 defects in published reviews.",
    "severity": "high",
    "category": "Operational",
    "unit": { "name": "Summit", "type": "Branch" },
    "process_area": "Card Applications",
    "detected_at": "2026-10-01T00:00:00Z",
    "recurrence": { "months": 3, "first_period": "2026-08", "last_period": "2026-10", "defects": 31 },
    "linked_action": { "ref": "ACT-0035", "status": "awaiting_verification", "owner": "Sam Foster", "due_date": "2026-11-10" }
  },
  "raised_by": { "email": "taylor.reid@demo.pulsus.tech", "name": "Taylor Reid" }
}
```

| Field | Rule |
|---|---|
| `id` | SHA-256 of `company_id|record_type|record_ref`. The same source always gives the same id, so Risk can de-duplicate. |
| `source.record_type` | `defect` (one published defect), `recurring_issue` (same nature, same unit, N consecutive months) or `action` (a corrective action escalated). |
| `proposed.kind` | `risk_event` when there is a recurrence, else `issue`. |
| `proposed.severity` | `critical`, `high`, `medium` or `low`, chosen by the supervisor (default `high` from 5 months running). |
| `proposed.recurrence` | present for recurring issues, else `null`. |
| `proposed.linked_action` | the Quality action already working on it, else `null`. |

Validation lives in `lib/riskLink.ts` (`validateProposal`), tested in `tests/integrations.test.mjs`.

## Status back (for Risk to build)

Risk should call back `POST https://quality.pulsus.tech/api/risk/status` (to be added in Milestone 2) with `{ id, risk_ref, status: "accepted" | "rejected", reason, decided_by, decided_at }`, so the supervisor sees the outcome beside the defect. Until then the outbox shows `sent`.
