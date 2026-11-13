// The bulk import fields and shapes, shared by the browser (mapping) and the server. Pure.
export const BULK_KINDS = ["locations", "people", "actions"] as const;
export type BulkKind = (typeof BULK_KINDS)[number];

export interface BulkField { key: string; label: string; required?: boolean; synonyms: string[]; hint?: string }
export const BULK_FIELDS: Record<BulkKind, BulkField[]> = {
  locations: [
    { key: "name", label: "Name", required: true, synonyms: ["site", "location", "branch", "ward", "office", "campus", "store", "site name", "location name"] },
    { key: "code", label: "Code", synonyms: ["site code", "id", "number", "cost centre", "cost center"] },
    { key: "region", label: "Region", synonyms: ["area", "district", "zone", "division"] },
    { key: "entity", label: "Entity", synonyms: ["hospital", "agency", "subsidiary", "business unit", "company", "university"], hint: "Created if it doesn't exist" },
    { key: "active", label: "Active", synonyms: ["status", "open"], hint: "yes / no (blank = yes)" },
  ],
  people: [
    { key: "email", label: "Email", required: true, synonyms: ["e-mail", "work email", "email address", "login"] },
    { key: "name", label: "Name", synonyms: ["full name", "person", "staff name"] },
    { key: "roles", label: "Roles", synonyms: ["role", "access", "permission"], hint: "admin, supervisor, inspector, site manager, viewer" },
    { key: "sites", label: "Sites", synonyms: ["site", "branches", "locations", "units", "scope"], hint: "Names separated by commas; blank = every site" },
  ],
  actions: [
    { key: "title", label: "Issue", required: true, synonyms: ["title", "action", "finding", "description", "issue title"] },
    { key: "site", label: "Site", required: true, synonyms: ["location", "branch", "ward", "office", "unit", "campus"] },
    { key: "due", label: "Due date", required: true, synonyms: ["due", "target date", "deadline", "date due"] },
    { key: "owner", label: "Owner", synonyms: ["owner email", "assigned to", "responsible", "assignee"], hint: "An email, or a team name" },
    { key: "priority", label: "Priority", synonyms: ["risk", "severity", "rating"], hint: "high, medium or low" },
    { key: "kind", label: "Kind", synonyms: ["type", "action type"], hint: "containment, corrective or preventive" },
    { key: "details", label: "Details", synonyms: ["notes", "comments", "detail"] },
    { key: "rootCause", label: "Root cause", synonyms: ["cause", "root cause"] },
  ],
};

export interface BulkRow { n: number; values: Record<string, string>; status: "new" | "update" | "error" | "skip"; message: string }
export interface BulkPreview { kind: BulkKind; rows: BulkRow[]; counts: { new: number; update: number; error: number; skip: number } }

