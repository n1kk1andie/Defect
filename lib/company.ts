// Pulsus platform companies. A member of a platform company reaches Pulsus Quality
// with a company session: the gate (middleware.ts) verifies it and passes the
// company, role and email on in trusted request headers (stripped from every
// incoming request first, so they can't be forged). Read back here, they decide
// whose data a request touches and what the member may do.
import { headers } from "next/headers";

export interface CompanyContext {
  id: string;
  name: string;
  role: string;   // the member's Command Center role: owner | admin | editor | viewer
  email: string;
}

/** The request's platform company, or null for this deployment's own people (or outside a request). */
export function currentCompany(): CompanyContext | null {
  try {
    const h = headers();
    const id = h.get("x-pulsus-company");
    if (!id || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return null;
    let name = id;
    try { name = decodeURIComponent(h.get("x-pulsus-company-name") || id).slice(0, 80); } catch { /* keep the id */ }
    return { id, name, role: h.get("x-pulsus-role") || "viewer", email: (h.get("x-pulsus-email") || "").toLowerCase() };
  } catch {
    return null;
  }
}

/** Storage folder of the request's data: a company's own, or "" for this deployment. */
export function currentScope(): string {
  const c = currentCompany();
  return c ? `companies/${c.id}/` : "";
}

/** Owners and admins manage the company's Quality program and approve its reviews. */
export const companyManager = (c: CompanyContext) => c.role === "owner" || c.role === "admin";
