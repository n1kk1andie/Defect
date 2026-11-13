# What Pulsus Platform reads from Pulsus Quality

## `GET /api/data` (unchanged shape)

Read with the member's company session (the company brief) or, for the institution's synthesis feed, the Command Center's Bearer staff token or `x-pulse-feed` token.

```json
{
  "defects": { "periods": ["2024-01-01", …], "branches": ["Harbour", …], "areas": ["Payments", …],
               "rows": [[periodIdx, branchIdx, areaIdx, reviewed, instances, defects, resolvable, resolved, recurring], …] },
  "opstd":   { "metrics": [{ "key": "overall", "label": "Op Standard Score" }, …9],
               "periods": [...], "branches": [...],
               "rows": [[periodIdx, branchIdx, OpStandardScore, AvgCustomerSla, QueueSla, OnboardingSla, Procurement, MajorProcedure, AvgProcedureCompliance, Complaints, AuditResolution], …],
               "auditRaw": [4, 80, null, …] },
  "uploaded": { "defects": true, "opstd": true }
}
```

`opstd` is `null` for a company without a scorecard. Columns are positional, as `companyBrief.ts` and `synthesis/apps.ts` expect.

## `GET /api/pulse` (new): service grant `quality.pulse`

`Authorization: Bearer <service grant>` (iss `pulsus-service-grant`, aud `pulsus-module-read`, `scope: "quality.pulse"`, at most 5 minutes, one `company_id`).

```json
{
  "ok": true, "app": "quality", "schema": "pulsus.quality.pulse/v1", "generatedAt": "…", "period": "2026-10",
  "defectRate":     { "value": 0.043, "band": "watch", "defects": 1966, "instances": 45779, "itemsReviewed": 9241 },
  "resolutionRate": { "value": 0.702, "band": "attention" },
  "recurringRate":  { "value": 0.166, "band": "healthy" },
  "operationalStandard": { "value": 91.3, "band": "healthy", "period": "2026-10", "name": "Operational Standard" },
  "unitsBelowStandard": [{ "name": "Summit", "defectRate": 0.091, "band": "attention" }],
  "actions": { "open": 11, "overdue": 4, "awaitingVerification": 3 },
  "recurringIssues": 8
}
```

Values are fractions (rates) or 0–100 (scores); `band` is one of the six suite bands on the company's own Quality cut-offs.

### Added in Milestone 3: `inspections` (additive)

`GET /api/pulse` now also returns an `inspections` block. The fields above are unchanged. Pulsus Risk can read it as key risk indicators: average inspection score, critical failures, controls that sampling found not effective, overdue visits, and each site's risk score and band.

```json
"inspections": {
  "schema": "pulsus.quality.inspections/v1",
  "unitLabel": "Branch",
  "last90Days": { "approved": 58, "averageScore": 94.1, "failed": 9, "criticalFailures": 11 },
  "sampling":   { "evaluated": 2, "notEffective": 1 },
  "risk": {
    "bands": { "escalate": 1, "watch": 1, "healthy": 2, "strong": 2 },
    "sites": [{ "name": "Summit", "score": 71.4, "band": "escalate",
                "topDriver": { "label": "Inspection scores", "detail": "86.8% average over 21 inspections", "contribution": 19.6 } }]
  },
  "visits": { "overdue": 3, "dueNow": 5, "done": 41 }
}
```

- Each site's `score` runs from 0 (low risk) to 100. `band` is the site's band on the company's own risk cut-offs (Settings → Risk model).
- `sites` is sorted with the highest risk first.
- The method is in docs/quality-model.md §6.
