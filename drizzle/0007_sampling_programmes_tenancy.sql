-- Tenant isolation for sampling plans, programmes and site risk factors (as 0001_tenancy).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sampling_plans','programmes','unit_factors']
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
