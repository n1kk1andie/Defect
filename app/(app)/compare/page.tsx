import { getActor } from "@/lib/session";
import { compare, getStructure } from "@/lib/structure";
import { Compare } from "@/components/screens/Compare";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ level?: string; days?: string }> }) {
  const actor = (await getActor())!;
  const sp = await searchParams;
  const structure = await getStructure(actor);
  const level = sp.level || (structure.entities.length ? "entity" : "region");
  const comparison = await compare(actor, { level, days: Number(sp.days) || 90 });
  return <Compare comparison={comparison} structure={structure} />;
}
