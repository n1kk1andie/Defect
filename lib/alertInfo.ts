// The kinds of alert the bell and the daily email show, in the order they appear. Pure: shared by the browser and the server.
export type AlertKind = "approve" | "verify" | "overdue" | "due_soon" | "effectiveness" | "issue";
export const ALERT_KINDS: { key: AlertKind; label: string; icon: "stamp" | "check" | "clock" | "calendar" | "target" | "flag" }[] = [
  { key: "overdue", label: "Your overdue actions", icon: "clock" },
  { key: "approve", label: "Waiting for your approval", icon: "stamp" },
  { key: "verify", label: "Actions to verify", icon: "check" },
  { key: "issue", label: "Reported issues to triage", icon: "flag" },
  { key: "effectiveness", label: "Effectiveness checks due", icon: "target" },
  { key: "due_soon", label: "Your actions due in the next three days", icon: "calendar" },
];
export interface AlertItem { kind: AlertKind; id: string; title: string; detail: string; href: string; at: string }
