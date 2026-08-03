-- ============================================================================
-- Co-traveller co-editing.
--
-- Board (trip_todos/bookmarks/expenses) and chat (trip_messages) already allow
-- trip members to write. This migration closes the two remaining gaps so a
-- member (not just the owner/creator) can edit:
--   1. Routes   — brainstorm_items (was owner-only, FOR ALL via trips.created_by)
--   2. Itinerary — trips.ig_response (was owner-only UPDATE)
-- ...and adds both tables to the realtime publication for live sync.
--
-- Conventions: is_trip_member(p_trip, p_uid) from 20260721000003. Owner access
-- is preserved via trips.created_by (covers trips created before the owner had
-- a trip_members row). Owner-only columns on `trips` (ownership / pooled credits
-- / share link) stay protected against non-owner editors via a trigger.
--
-- NOTE (caveat): trips.ig_response is a whole-blob write, so concurrent
-- itinerary edits are last-write-wins. Realtime surfaces the other person's
-- change but does not merge simultaneous edits to the same blob.
-- ============================================================================

-- ── 1. brainstorm_items: members can write routes ──────────────────────────
-- SELECT ("Trip members read brainstorm items") already includes members.
-- Replace the owner-only write ("Trip owner manages brainstorm items", FOR ALL)
-- with explicit owner-or-member INSERT/UPDATE/DELETE policies.
DROP POLICY IF EXISTS "Trip owner manages brainstorm items" ON brainstorm_items;

DROP POLICY IF EXISTS "members insert brainstorm items" ON brainstorm_items;
CREATE POLICY "members insert brainstorm items" ON brainstorm_items
  FOR INSERT TO authenticated
  WITH CHECK (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR is_trip_member(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "members update brainstorm items" ON brainstorm_items;
CREATE POLICY "members update brainstorm items" ON brainstorm_items
  FOR UPDATE TO authenticated
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR is_trip_member(trip_id, auth.uid())
  )
  WITH CHECK (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR is_trip_member(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "members delete brainstorm items" ON brainstorm_items;
CREATE POLICY "members delete brainstorm items" ON brainstorm_items
  FOR DELETE TO authenticated
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR is_trip_member(trip_id, auth.uid())
  );

-- ── 2. trips: members can update plan content (not ownership/credits) ───────
-- Keeps the existing owner UPDATE policy; adds a member UPDATE policy.
DROP POLICY IF EXISTS "members update trip" ON trips;
CREATE POLICY "members update trip" ON trips
  FOR UPDATE TO authenticated
  USING (is_trip_member(id, auth.uid()))
  WITH CHECK (is_trip_member(id, auth.uid()));

-- Protect owner-only columns from non-owner editors. Service-role writes
-- (edge functions: payments, pooled-credit deductions) have auth.uid() = NULL
-- and are exempt; the owner (created_by = auth.uid()) is exempt.
CREATE OR REPLACE FUNCTION public.trips_protect_owner_columns()
  RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND OLD.created_by IS DISTINCT FROM auth.uid() THEN
    IF NEW.owner_id       IS DISTINCT FROM OLD.owner_id
    OR NEW.created_by     IS DISTINCT FROM OLD.created_by
    OR NEW.credit_balance IS DISTINCT FROM OLD.credit_balance
    OR NEW.share_token    IS DISTINCT FROM OLD.share_token THEN
      RAISE EXCEPTION
        'co-travellers cannot change ownership, pooled credits, or the share link'
        USING errcode = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trips_protect_owner_columns_trg ON trips;
CREATE TRIGGER trips_protect_owner_columns_trg
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_protect_owner_columns();

-- ── 3. realtime: live sync for itinerary + routes ──────────────────────────
-- days / activities / trip_messages / polls are already published (…0004).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trips;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'brainstorm_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE brainstorm_items;
  END IF;
END $$;
