import { Suspense } from "react";
import { getActor } from "@/lib/session";
import { listLinks, listReports, turnstileSiteKey } from "@/lib/issues";
import { listTemplates } from "@/lib/templates/store";
import { isSupervisor } from "@/lib/roles";
import { Issues } from "@/components/screens/Issues";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const actor = (await getActor())!;
  const issues = await listReports(actor);
  const links = isSupervisor(actor) ? await listLinks(actor) : [];
  const templates = (await listTemplates(actor, { includeDrafts: false })).filter((t) => t.status === "published").map((t) => ({ id: t.id, name: t.name }));
  return <Suspense><Issues issues={issues} links={links} templates={templates} turnstile={!!turnstileSiteKey()} /></Suspense>;
}
