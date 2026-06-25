-- Soft-delete for sessions. A broker can remove a client session from their list,
-- but the immutable audit trail (audit_records → sessions, no-cascade FK) and the
-- access-event log must be RETAINED for compliance — so we mark the session deleted
-- rather than hard-deleting it. The app filters `deleted_at is null` in the broker's
-- session list; the owner's existing UPDATE policy (0001/0002) covers setting it.
alter table public.sessions add column if not exists deleted_at timestamptz;
