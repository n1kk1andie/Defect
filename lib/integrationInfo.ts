// API scopes, webhook events and the shapes the settings screens show. Pure: shared by the browser and the server.
export const SCOPES = ["sites:read", "inspections:read", "actions:read", "actions:write", "risk:read", "sampling:read", "issues:read", "issues:write"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_INFO: Record<Scope, string> = {
  "sites:read": "Sites, entities and groups",
  "inspections:read": "Inspections and their scores",
  "actions:read": "Corrective and preventive actions",
  "actions:write": "Raise actions (as the key, never verify them)",
  "risk:read": "Risk scores, bands and drivers",
  "sampling:read": "Sampling plans and conclusions",
  "issues:read": "Reported issues",
  "issues:write": "Report issues from another system",
};

export const EVENTS = ["inspection.approved", "action.overdue", "site.band_changed", "issue.reported", "risk.proposed"] as const;
export type WebhookEvent = (typeof EVENTS)[number];
export const EVENT_INFO: Record<WebhookEvent, string> = {
  "inspection.approved": "An inspection is approved",
  "action.overdue": "An action passes its due date",
  "site.band_changed": "A site moves to another risk band",
  "issue.reported": "Someone reports an issue from a site's link",
  "risk.proposed": "A finding or KRI breach is proposed to Pulsus Risk",
};
export type WebhookKind = "generic" | "slack" | "teams";

export interface KeyView { id: string; name: string; hint: string; scopes: Scope[]; createdBy: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; replacedBy: string | null; state: "active" | "expiring" | "expired" | "revoked" }

export interface WebhookView { id: string; name: string; kind: WebhookKind; url: string; events: WebhookEvent[]; active: boolean; createdBy: string; createdAt: string; lastStatus: string | null; lastAt: string | null; deliveries: { event: string; status: string; code: number | null; attempts: number; at: string }[] }
