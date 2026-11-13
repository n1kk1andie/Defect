import { getActor } from "@/lib/session";
import { listActions } from "@/lib/actions";
import { emailConfigured, listSavedReports } from "@/lib/reportBuilder";
import { getStructure } from "@/lib/structure";
import { Report } from "@/components/screens/Report";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const actor = (await getActor())!;
  const actions = await listActions(actor);
  const reports = await listSavedReports(actor);
  const structure = await getStructure(actor);
  return <Report actions={actions} saved={{ reports, email: emailConfigured(), structure }} />;
}
