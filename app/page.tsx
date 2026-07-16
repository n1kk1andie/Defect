import { loadDatasets } from "@/lib/data";
import { getSession } from "@/lib/auth";
import TrackerApp from "@/components/TrackerApp";

export const dynamic = "force-dynamic";

export default async function Page() {
  const datasets = await loadDatasets();
  const s = getSession(Date.now());
  const initialSession = s ? { role: s.role, username: s.username, branch: s.branch } : null;
  return <TrackerApp datasets={datasets} initialSession={initialSession} />;
}
