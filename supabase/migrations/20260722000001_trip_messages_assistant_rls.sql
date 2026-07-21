-- Phase 2 · Shared Trippy chat — assistant-row INSERT policy.
--
-- Trippy replies are persisted with user_id = NULL (they're the AI, not the
-- sender who prompted them). The existing INSERT policy
-- ("Members insert messages for their trips") requires user_id = auth.uid(),
-- which would REJECT a null-user assistant row. Add a second, narrow INSERT
-- policy that lets any trip member write an assistant/null-user row for their
-- own trip. RLS is permissive: a row passing EITHER policy is allowed, so the
-- original human-message policy is untouched.
--
-- audience is orthogonal to role (see 20260721000001_add_missing_columns.sql);
-- assistant replies are always audience = 'trippy'.

DROP POLICY IF EXISTS "Members insert Trippy messages" ON trip_messages;
CREATE POLICY "Members insert Trippy messages" ON trip_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    role = 'assistant'
    AND user_id IS NULL
    AND is_trip_member(trip_id, auth.uid())
  );
