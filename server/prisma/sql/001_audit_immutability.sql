-- Makes audit_events genuinely append-only.
--
-- "Append-only" as a naming convention is worth nothing if the application's
-- database role can still issue UPDATE or DELETE. Two independent mechanisms:
--
--   1. Privilege:  REVOKE UPDATE, DELETE from the application role.
--   2. Trigger:    a BEFORE UPDATE OR DELETE trigger that raises, which also
--                  covers superuser/owner connections that privileges miss.
--
-- The hash chain in the application layer is the third: it makes tampering
-- that bypasses both of the above *detectable* after the fact.
--
-- Applied by `npm run db:harden` after `prisma migrate deploy`.
-- :app_role is substituted by the harden script.

CREATE OR REPLACE FUNCTION audit_events_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_events is append-only: % on this table is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

-- TRUNCATE bypasses row-level triggers entirely, so block it separately.
DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();
