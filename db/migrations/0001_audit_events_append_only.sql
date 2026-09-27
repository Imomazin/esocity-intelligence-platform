-- Audit events are append-only: reject UPDATE and DELETE at the database level so that the
-- trail stays trustworthy even if application code is compromised or buggy.
-- To purge data for legal/retention reasons, a privileged operator must explicitly disable
-- this trigger inside a reviewed maintenance transaction (see docs/SECURITY.md).
CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% is not permitted)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
