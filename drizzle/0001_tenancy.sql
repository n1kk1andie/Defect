-- Tenant isolation, enforced by Postgres itself.
--
-- Every table carries company_id. Row-level security is ENABLED and FORCED (so
-- it binds the table owner too), and one policy per table admits only the rows
-- of the company named by the transaction-local setting app.company_id, which
-- lib/db/client.ts withTenant() sets at the start of every transaction. With
-- no setting, nothing is visible and nothing can be written: it fails closed.
--
-- Queries also run as the NOLOGIN role quality_app when the connecting role may
-- assume it (always on PGlite, whose default user is a superuser and would
-- otherwise bypass RLS). quality_app holds no BYPASSRLS and may not UPDATE or
-- DELETE the change history.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quality_app') THEN
    CREATE ROLE quality_app NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT quality_app TO %I', current_user);
EXCEPTION WHEN others THEN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','company_settings','members','units','areas','checks','natures','monthly_stats','reviews','review_items','review_events','scorecards','scorecard_entries','actions','action_events','evidence','audit_log','imports','risk_outbox','counters']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.company_id'', true)) WITH CHECK (company_id = current_setting(''app.company_id'', true))', t);
    BEGIN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO quality_app', t);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
  BEGIN
    EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO quality_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_log FROM quality_app';
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;
--> statement-breakpoint
-- The change history is append-only for everyone, the owner included.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The change history is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
