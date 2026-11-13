-- Tenant isolation for the inspection tables (as 0001_tenancy), and published
-- template versions made immutable: a version, once published, never changes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['templates','template_versions','inspections','inspection_events']
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
    EXECUTE 'REVOKE UPDATE ON template_versions FROM quality_app';
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION template_versions_frozen() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A published template version cannot be changed';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS template_versions_no_update ON template_versions;
--> statement-breakpoint
CREATE TRIGGER template_versions_no_update BEFORE UPDATE ON template_versions FOR EACH ROW EXECUTE FUNCTION template_versions_frozen();
