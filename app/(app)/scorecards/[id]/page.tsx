import { notFound } from "next/navigation";
import { getActor } from "@/lib/session";
import { getScorecard } from "@/lib/scorecards/store";
import { listTemplates } from "@/lib/templates/store";
import { ScorecardDesigner } from "@/components/builder/ScorecardDesigner";

export const dynamic = "force-dynamic";

export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = (await getActor())!;
  const [s, templates] = await Promise.all([getScorecard(actor, (await params).id), listTemplates(actor, { includeDrafts: false })]);
  if (!s) notFound();
  return <ScorecardDesigner scorecard={s} templates={templates.filter((t) => t.version > 0).map((t) => ({ id: t.id, name: t.name }))} />;
}
