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
