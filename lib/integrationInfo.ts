// API scopes and the key shape the settings screen shows. Pure: shared by the browser and the server.
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

export interface KeyView { id: string; name: string; hint: string; scopes: Scope[]; createdBy: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; replacedBy: string | null; state: "active" | "expiring" | "expired" | "revoked" }
