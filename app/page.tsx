import { loadDatasets } from "@/lib/data";
import { isAdmin } from "@/lib/auth";
import TrackerApp from "@/components/TrackerApp";

export const dynamic = "force-dynamic";

export default async function Page() {
  const datasets = await loadDatasets();
  const admin = isAdmin(Date.now());
  return <TrackerApp datasets={datasets} initialAdmin={admin} />;
}
