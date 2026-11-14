-- Change-triggered backups: one row per company saying whether it has changes
-- not yet in a backup (lib/backup.ts, lib/backup-after.ts).
--
-- Every row written for a company (insert, update or delete on any table with
-- company_id) marks that company's row here, through the trigger below, inside
-- the same transaction: so a change and its mark commit or roll back together.
-- The trigger only marks when lib/db/client.ts withTenant() has set
-- app.backup_mark = '1' for the transaction, which it never does on a demo
-- deployment (DEMO_MODE=1) or for a demo company (_demo, demo-*). Migrations,
-- the system path and seeding outside withTenant() mark nothing.
--
-- change_seq counts marking transactions; a backup records the change_seq it
-- saw in its snapshot (backed_up_seq) and clears pending only when nothing
-- newer has been marked since, so a change committed while a backup runs is
-- never lost. Row-level security as on every other company table; quality_app may
-- read, insert and update its own company's row (never delete it).
CREATE TABLE IF NOT EXISTS backup_state (
  company_id text PRIMARY KEY,
  last_change_at timestamptz,
  last_backup_at timestamptz,
  pending boolean NOT NULL DEFAULT false,
  change_seq bigint NOT NULL DEFAULT 0,
  backed_up_seq bigint NOT NULL DEFAULT 0,
  backup_started_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS backup_state_pending ON backup_state (company_id) WHERE pending;
--> statement-breakpoint
ALTER TABLE backup_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE backup_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON backup_state;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON backup_state USING (company_id = current_setting('app.company_id', true)) WITH CHECK (company_id = current_setting('app.company_id', true));
--> statement-breakpoint
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON backup_state TO quality_app;
EXCEPTION WHEN others THEN NULL;
END $$;
--> statement-breakpoint
-- Row-level, but only the first row of a transaction does any work: it marks
-- the company and notes that in a transaction-local setting, so the rest of the
-- transaction (an import of a thousand rows) costs one setting lookup per row.
CREATE OR REPLACE FUNCTION backup_mark_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c text;
BEGIN
  IF current_setting('app.backup_mark', true) IS DISTINCT FROM '1' THEN RETURN NULL; END IF;
  c := current_setting('app.company_id', true);
  IF c IS NULL OR c = '' THEN RETURN NULL; END IF;
  INSERT INTO backup_state AS b (company_id, last_change_at, pending, change_seq) VALUES (c, clock_timestamp(), true, 1)
    ON CONFLICT (company_id) DO UPDATE SET last_change_at = greatest(b.last_change_at, excluded.last_change_at), pending = true, change_seq = b.change_seq + 1;
  PERFORM set_config('app.backup_mark', 'done', true);
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables k ON k.table_schema = c.table_schema AND k.table_name = c.table_name
    WHERE c.table_schema = 'public' AND k.table_type = 'BASE TABLE' AND c.column_name = 'company_id' AND c.table_name <> 'backup_state'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS backup_mark ON %I', t);
    EXECUTE format('CREATE TRIGGER backup_mark AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION backup_mark_change()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Companies that already hold data start pending, so the first daily sweep
-- backs each of them up once (demo companies excepted).
INSERT INTO backup_state (company_id, pending) SELECT company_id, true FROM companies
  WHERE company_id <> '_demo' AND company_id NOT LIKE 'demo-%' AND kind <> 'demo'
  ON CONFLICT (company_id) DO NOTHING;
