-- Tenant isolation for the Milestone 4 tables (as 0001_tenancy).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entities','site_groups','report_links','issue_reports','saved_reports','report_runs','api_keys','webhooks','webhook_deliveries','site_bands']
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
END $$;
--> statement-breakpoint
-- The scheduled sweep (lib/automation.ts) needs the list of tenant ids, and
-- nothing else, across companies: a read-only policy on the companies table
-- for the reserved setting "__registry__", which withTenant() can never set.
DROP POLICY IF EXISTS tenant_registry ON companies;
--> statement-breakpoint
CREATE POLICY tenant_registry ON companies FOR SELECT USING (current_setting('app.company_id', true) = '__registry__');
