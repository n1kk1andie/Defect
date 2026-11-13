import { getActor } from "@/lib/session";
import { listInspections } from "@/lib/inspections";
import { ensureProgramTemplatesFor, listTemplates } from "@/lib/templates/store";
import { Inspections } from "@/components/screens/Inspections";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function InspectPage() {
  const actor = (await getActor())!;
  if (can.buildTemplates(actor)) await ensureProgramTemplatesFor(actor.tenant);
  const [inspections, templates] = await Promise.all([listInspections(actor, { limit: 400 }), listTemplates(actor, { includeDrafts: false })]);
  return <Inspections inspections={inspections} templates={templates.filter((t) => t.status !== "archived" && t.version > 0)} />;
}
