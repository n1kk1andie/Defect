import { getActor } from "@/lib/session";
import { listActions } from "@/lib/actions";
import { Report } from "@/components/screens/Report";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const actor = (await getActor())!;
  return <Report actions={await listActions(actor)} />;
}
