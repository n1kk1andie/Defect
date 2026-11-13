import { notFound } from "next/navigation";
import { getActor } from "@/lib/session";
import { withTenant } from "@/lib/db/client";
import { getTemplate, loadVersion } from "@/lib/templates/store";
import { Capture } from "@/components/inspect/Capture";

export const dynamic = "force-dynamic";

export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = (await getActor())!;
  const q = await searchParams;
  const t = q.template ? await getTemplate(actor, q.template) : null;
  if (!t || !t.version || t.status === "archived") notFound();
  const def = await withTenant(actor.tenant, (tx) => loadVersion(tx, actor.tenant, t.id, t.version));
  if (!def) notFound();
  return <Capture def={def} templateId={t.id} version={t.version} start={{ unitId: q.unit || "", period: q.period || "", clientId: q.client || "" }} />;
}
