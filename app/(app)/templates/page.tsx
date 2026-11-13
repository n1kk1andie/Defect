import { getActor } from "@/lib/session";
import { ensureProgramTemplatesFor, listTemplates } from "@/lib/templates/store";
import { Templates } from "@/components/screens/Templates";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const actor = (await getActor())!;
  if (can.buildTemplates(actor)) await ensureProgramTemplatesFor(actor.tenant);
  return <Templates templates={await listTemplates(actor)} />;
}
