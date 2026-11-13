import { Suspense } from "react";
import { getActor } from "@/lib/session";
import { listActions } from "@/lib/actions";
import { Actions } from "@/components/screens/Actions";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const actor = (await getActor())!;
  return <Suspense><Actions actions={await listActions(actor)} /></Suspense>;
}
