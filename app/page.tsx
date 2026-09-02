import { loadDatasets } from "@/lib/data";
import { canElevate, getSession } from "@/lib/auth";
import { ssoEnabled } from "@/lib/msauth";
import TrackerApp from "@/components/TrackerApp";

export const dynamic = "force-dynamic";

export default async function Page() {
  const datasets = await loadDatasets();
  const now = Date.now();
  const s = getSession(now);
  const initialSession = s ? { role: s.role, username: s.username, branch: s.branch } : null;
  // Whether the person opening the app is a named administrator who may unlock
  // admin as themselves. Resolved here, on the server, from the cookies they
  // already carry — the sign-in modal only has to offer the button.
  const elevate = await canElevate(now);
  return (
    <TrackerApp
      datasets={datasets}
      initialSession={initialSession}
      ssoEnabled={ssoEnabled()}
      elevateAs={elevate.ok ? elevate.name || elevate.email : null}
    />
  );
}
