-- ============================================================================
-- Phase 0b · 05 — Realtime publication
-- Add app tables to supabase_realtime so clients get live postgres_changes.
-- RLS is still enforced on realtime rows, so the is_trip_member() policies (04)
-- gate what each subscriber receives.
-- `ADD TABLE` errors if a table is already a member, so guard each one.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trip_messages','activity_log','days','activities','polls','poll_votes','comments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
