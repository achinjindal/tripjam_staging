-- ============================================================================
-- Story mode · 01 — content columns + missing days UPDATE policy
-- days.story_title / days.narrative: per-day magazine content (IG + backfill fn)
-- activities.gloss: one-line evocative gloss (Story timeline; `note` stays Plan-only)
--
-- Also fixes a PRE-EXISTING RLS gap: `days` has INSERT/SELECT policies but no
-- UPDATE policy (see schema.sql — "Edit members can insert days" / "Members can
-- view days"), so client-side days updates (e.g. days.wishlist, App.jsx) were
-- silently no-oping (RLS filters to 0 rows, no error). Mirrors
-- "Edit members can update activities" + the legacy-solo-trip owner fallback
-- used by "author writes activity" (20260721000003).
-- ============================================================================

ALTER TABLE days
  ADD COLUMN IF NOT EXISTS story_title text,
  ADD COLUMN IF NOT EXISTS narrative text;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS gloss text;

DROP POLICY IF EXISTS "Edit members can update days" ON days;
CREATE POLICY "Edit members can update days" ON days
  FOR UPDATE TO authenticated
  USING (
    auth.uid() IN (
      SELECT trip_members.user_id FROM trip_members
      WHERE trip_members.trip_id = days.trip_id
        AND trip_members.role = 'edit'::text
    )
    OR EXISTS (
      SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.created_by = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT trip_members.user_id FROM trip_members
      WHERE trip_members.trip_id = days.trip_id
        AND trip_members.role = 'edit'::text
    )
    OR EXISTS (
      SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.created_by = auth.uid()
    )
  );
