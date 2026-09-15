-- Privilege half of the append-only guarantee. Run as a role that owns the
-- table, granting the *application* role insert/select only.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM "__APP_ROLE__";
GRANT INSERT, SELECT ON audit_events TO "__APP_ROLE__";
