// The demo's people: the shared Pulsus demo world (Meridian Financial Group; DEMO-WORLD.md
// in the Command Center repo). A visitor opens the demo as the guest viewer and
// can switch persona from the avatar menu to try each role's work. Pure.
import type { Role } from "@/lib/roles";

export const DEMO_COMPANY = "Meridian Financial Group";
export const DEMO_DOMAIN = "demo.pulsus.tech";
export const PERSONA_COOKIE = "pq_persona";

export interface Persona { email: string; name: string; roles: Role[]; title: string; units?: string[] }

export const PERSONAS: Persona[] = [
  { email: `guest@${DEMO_DOMAIN}`, name: "Guest", roles: ["viewer"], title: "Viewer · read-only" },
  { email: `admin@${DEMO_DOMAIN}`, name: "Alex Morgan", roles: ["admin"], title: "Quality admin" },
  { email: `taylor.reid@${DEMO_DOMAIN}`, name: "Taylor Reid", roles: ["supervisor"], title: "Supervisor" },
  { email: `robin.ellis@${DEMO_DOMAIN}`, name: "Robin Ellis", roles: ["supervisor"], title: "Supervisor" },
  { email: `jordan.blake@${DEMO_DOMAIN}`, name: "Jordan Blake", roles: ["inspector"], title: "Inspector" },
  { email: `sam.foster@${DEMO_DOMAIN}`, name: "Sam Foster", roles: ["branch_manager"], title: "Branch manager · Summit", units: ["Summit"] },
];

export const DEFAULT_PERSONA = PERSONAS[0].email;
export const personaFor = (email: string | null | undefined) => PERSONAS.find((p) => p.email === String(email || "").toLowerCase()) || null;
