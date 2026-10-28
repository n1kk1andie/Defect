import { loadDatasets } from "@/lib/data";
import { canElevate, requestSession } from "@/lib/auth";
import { ssoEnabled } from "@/lib/msauth";
import { currentCompany, companyManager } from "@/lib/company";
import { loadProgram } from "@/lib/program";
import TrackerApp from "@/components/TrackerApp";

export const dynamic = "force-dynamic";

export default async function Page() {
  const datasets = await loadDatasets();
  const now = Date.now();
  const s = await requestSession(now);
  const initialSession = s ? { role: s.role, username: s.username, branch: s.branch } : null;
  // A Pulsus company member: signed in through the Command Center, working the
  // company's own program. Their role comes from there — no sign-in here.
  const c = currentCompany();
  if (c) {
    return (
      <TrackerApp
        datasets={datasets}
        initialSession={initialSession}
        company={{ name: c.name, email: c.email, role: c.role, manager: companyManager(c) }}
        program={await loadProgram()}
      />
    );
  }
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
      signedInAs={elevate.email}
    />
  );
}
