import { getActor } from "@/lib/session";
import { listProgrammes, visits } from "@/lib/schedule";
import { listTemplates } from "@/lib/templates/store";
import { Schedule } from "@/components/screens/Schedule";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const actor = (await getActor())!;
  const programmes = await listProgrammes(actor);
  const vs = await visits(actor);
  const templates = (await listTemplates(actor, { includeDrafts: false })).filter((t) => t.version > 0 && t.status !== "archived").map((t) => ({ id: t.id, name: t.name }));
  return <Schedule programmes={programmes} visits={vs} templates={templates} today={new Date().toISOString().slice(0, 10)} />;
}
