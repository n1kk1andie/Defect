import { notFound } from "next/navigation";
import { getActor } from "@/lib/session";
import { getPlan } from "@/lib/samplingPlans";
import { PlanDetail } from "@/components/screens/Sampling";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = (await getActor())!;
  const got = await getPlan(actor, (await params).id);
  if (!got) notFound();
  return <PlanDetail plan={got.plan} population={got.population} />;
}
