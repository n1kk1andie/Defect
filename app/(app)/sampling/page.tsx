import { getActor } from "@/lib/session";
import { listPlans } from "@/lib/samplingPlans";
import { listTemplates } from "@/lib/templates/store";
import { Sampling } from "@/components/screens/Sampling";

export const dynamic = "force-dynamic";

export default async function SamplingPage() {
  const actor = (await getActor())!;
  const plans = await listPlans(actor);
  const templates = (await listTemplates(actor, { includeDrafts: false })).filter((t) => t.sampled && t.version > 0 && t.status !== "archived").map((t) => ({ id: t.id, name: t.name }));
  return <Sampling plans={plans} templates={templates} />;
}
