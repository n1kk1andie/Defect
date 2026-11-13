# Pulsus Quality REST API

Other systems (a BI tool, an HR or complaints system, a facilities desk) read Quality's records and raise actions or report issues through a small REST API. It is for a company's own integrations; Pulsus Platform keeps its own feeds (`/api/data`, `/api/pulse`, see [platform feed](platform-feed.md)).

## Keys

- A Quality admin creates keys in **Settings → Connections → API keys**, one per system, with only the scopes it needs and an expiry (30 days, 90 days, a year, or never).
- A key reads `pq_<company>.<secret>`. The secret is shown once; only its SHA-256 is stored. A lost key is replaced, not recovered.
- **Rotate** issues a new key with the same name and scopes; the old key keeps working for 24 hours so the other system can switch over. **Revoke** stops a key at once.
- Every create, rotate and revoke is in the hash-chained change history. Actions a key raises show it as `api-key:<name>`; a key never approves, verifies or closes anything.
- The demo shows sample keys and issues none.
- Keys follow the company's plan. The plan comes from the Pulsus Platform session; the API has no session, so it reads the copy cached on the company row each time a member's session is seen (the licence page included). While the plan is suspended or ended, or a trial has passed its end, every call answers 402 `licence_required` and no new key can be issued; once the plan is active again, the same keys work (`lib/planStatus.ts`, `lib/planCache.ts`).

Send the key on every request:

```
Authorization: Bearer pq_…
```

## Scopes

| Scope | Allows |
| --- | --- |
| `sites:read` | Sites, entities and groups |
| `inspections:read` | Inspections and their scores |
| `actions:read` | Corrective and preventive actions |
| `actions:write` | Raise actions |
| `risk:read` | Risk scores, bands and drivers |
| `sampling:read` | Sampling plans and their conclusions |
| `issues:read` | Reported issues |
| `issues:write` | Report issues from another system |

## Endpoints

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1` | any | What this key can reach |
| `GET /api/v1/sites` | `sites:read` | `{ sites, entities, groups }` |
| `GET /api/v1/inspections` | `inspections:read` | `?status=draft\|submitted\|returned\|approved`, `?since=<date>`, paged |
| `GET /api/v1/inspections/{id}` | `inspections:read` | With its findings |
| `GET /api/v1/actions` | `actions:read` | `?status=open\|in_progress\|awaiting_verification\|closed`, `?since=`, paged |
| `GET /api/v1/actions/{id}` | `actions:read` | |
| `POST /api/v1/actions` | `actions:write` | `{ site_id, title, due_date, priority?, kind?, details?, root_cause?, owner_email?, owner_name?, external_id? }` → 201 with the action |
| `GET /api/v1/risk` | `risk:read` | Each site's score, band, visit frequency and drivers |
| `GET /api/v1/sampling` | `sampling:read` | Plans with method, seed and population hash, so a selection can be re-checked |
| `GET /api/v1/issues` | `issues:read` | Reported issues and how each was triaged |
| `POST /api/v1/issues` | `issues:write` | `{ site_id, category, description, location?, reporter_name?, reporter_contact? }` → 201 `{ ref }`; `category` is `observation`, `hazard`, `near_miss`, `complaint` or `other` |

### Paging

Lists take `?limit=` (1–200, default 50) and `?after=<cursor>`, and answer `{ data, next }`. Pass `next` as `after` for the following page; `next` is `null` on the last page.

### Errors

```
{ "error": { "code": "insufficient_scope", "message": "This key doesn't have the risk:read scope." } }
```

| Status | Code |
| --- | --- |
| 400 | `invalid_json`, `invalid_request` |
| 401 | `unauthorized` (no key, a wrong key, or a revoked or expired one) |
| 402 | `licence_required`: the company's plan isn't active (suspended, ended, or a trial past its end). The same rule as the app's licence wall; keys work again, unchanged, once the plan is active |
| 403 | `insufficient_scope` |
| 404 | `not_found` |
| 429 | `rate_limited`: 120 requests a minute per key; `Retry-After: 60` |
| 500 | `server_error` |

Every answer carries `X-Pulsus-Api-Version: 2026-11-01` and `Cache-Control: no-store`.

## Example

```
curl -H "Authorization: Bearer $PQ_KEY" "https://quality.pulsus.tech/api/v1/actions?status=open&limit=100"

curl -X POST -H "Authorization: Bearer $PQ_KEY" -H "Content-Type: application/json" \
  -d '{"site_id":"<site id>","title":"Replace the faulty card reader","due_date":"2026-12-15","priority":"high"}' \
  https://quality.pulsus.tech/api/v1/actions
```

## Isolation

A key belongs to one company. Its company part only says which tenant to look in; the secret must match a stored hash there, and every query then runs under that company's row-level security, so a key can never read or write another company's records (tests/m4.test.mjs).
