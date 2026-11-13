import { notFound } from "next/navigation";
import { getActor } from "@/lib/session";
import { getInspection } from "@/lib/inspections";
import { Capture } from "@/components/inspect/Capture";
import { InspectionView } from "@/components/inspect/View";

export const dynamic = "force-dynamic";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = (await getActor())!;
  const r = await getInspection(actor, (await params).id);
  if (!r) notFound();
  const mine = r.inspection.inspectorEmail === actor.email || actor.roles.includes("admin");
  if (mine && (r.inspection.status === "draft" || r.inspection.status === "returned")) return <Capture def={r.def} templateId={r.inspection.templateId} version={r.inspection.templateVersion} inspection={r.inspection} />;
  return <InspectionView inspection={r.inspection} def={r.def} />;
}
