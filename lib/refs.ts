// Human references per company: REV-0001, ACT-0001… Allocated from the
// counters table inside the caller's transaction, so two saves at once can't
// take the same number.
import { sql } from "drizzle-orm";
import { rowsOf, type Tx } from "@/lib/db/client";

export async function nextRef(tx: Tx, companyId: string, name: string, prefix: string, floor = 0): Promise<string> {
  const r = rowsOf<{ value: number }>(await tx.execute(sql`
    insert into counters (company_id, name, value) values (${companyId}, ${name}, ${floor + 1})
    on conflict (company_id, name) do update set value = greatest(counters.value, ${floor}) + 1
    returning value`));
  return `${prefix}-${String(r[0].value).padStart(4, "0")}`;
}
