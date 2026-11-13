import { getActor } from "@/lib/session";
import { listReviews } from "@/lib/reviews";
import { getProgram } from "@/lib/company";
import { Register, type DefectRow } from "@/components/screens/Register";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const actor = (await getActor())!;
  const [reviews, program] = await Promise.all([listReviews(actor, { limit: 2000 }), getProgram(actor.tenant)]);
  const labels = new Map(program.areas.flatMap((a) => a.checks.map((c) => [`${a.id}|${c.code}`, c.label] as const)));
  const defects: DefectRow[] = reviews.filter((r) => r.status === "published" && r.kind === "checklist").flatMap((r) => r.items.filter((i) => i.defects > 0).map((i) => ({
    reviewId: r.id, ref: r.ref, idx: i.idx, unitId: r.unitId, areaId: i.areaId, period: r.period, reference: i.reference, itemType: i.itemType,
    nature: i.nature, defects: i.defects, recurring: i.recurring, status: i.status,
    failed: Object.entries(i.checks).filter(([, v]) => v === "no").map(([k]) => labels.get(`${i.areaId}|${k}`) || k),
  }))).sort((a, b) => b.period.localeCompare(a.period));
  return <Register defects={defects} />;
}
