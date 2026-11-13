-- Tenant isolation for published scorecard versions (as 0001_tenancy), and the
-- versions made immutable. Existing scorecards get their first version row the
-- first time the designer saves them (lib/scorecards.ts), inside their tenant.
ALTER TABLE scorecard_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE scorecard_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON scorecard_versions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON scorecard_versions USING (company_id = current_setting('app.company_id', true)) WITH CHECK (company_id = current_setting('app.company_id', true));
--> statement-breakpoint
DO $$ BEGIN
  GRANT SELECT, INSERT, DELETE ON scorecard_versions TO quality_app;
EXCEPTION WHEN others THEN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scorecard_versions_frozen() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A published scorecard version cannot be changed';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS scorecard_versions_no_update ON scorecard_versions;
--> statement-breakpoint
CREATE TRIGGER scorecard_versions_no_update BEFORE UPDATE ON scorecard_versions FOR EACH ROW EXECUTE FUNCTION scorecard_versions_frozen();
