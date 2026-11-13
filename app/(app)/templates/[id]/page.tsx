import { notFound } from "next/navigation";
import { getActor } from "@/lib/session";
import { getTemplate } from "@/lib/templates/store";
import { Builder } from "@/components/builder/Builder";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = (await getActor())!;
  const t = await getTemplate(actor, (await params).id);
  if (!t) notFound();
  return <Builder template={t} />;
}
