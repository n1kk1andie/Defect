// The cross-company system path, for cron jobs only (the nightly backup): a
// transaction on the login role, with no role switch and no company set. It
// relies on the login role bypassing row-level security (Neon's owner role does;
// PGlite's superuser does) and refuses to run if it does not, rather than
// silently seeing nothing. Request handlers never use it: they go through
// withTenant() (tests/data-safety.test.mjs checks who imports this file).
import { sql } from "drizzle-orm";
import { connection, rowsOf, type Tx } from "./client";

export async function systemTx<T>(fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
  const c = await connection();
  return c.db.transaction(async (tx) => {
    if (opts.readOnly) await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    const [r] = rowsOf<{ bypass: boolean | null }>(await tx.execute(sql`select rolbypassrls or rolsuper as bypass from pg_roles where rolname = current_user`));
    if (!r?.bypass) throw new Error("systemTx: the database login role does not bypass row-level security, so it cannot work across companies");
    return fn(tx);
  });
}
