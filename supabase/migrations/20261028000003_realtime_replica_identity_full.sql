-- ============================================================================
-- REPLICA IDENTITY FULL on days, trip_members and brainstorm_items
-- ============================================================================
-- realtime.js subscribes per trip with filter trip_id=eq.<id>. Under the
-- default replica identity a DELETE's old row carries only the primary key
-- (id), so the trip_id filter can't match it and the event is silently
-- dropped. 20260807000001_tier2_board_realtime.sql fixed the board tables the
-- same way; these three were missed:
--   - days: clearing an itinerary (replace_trip_days(p, []) when the owner
--     changes destinations or trip length) only emits DELETEs, so co-travellers
--     kept seeing the old days until they reloaded.
--   - trip_members: a member leaving or being removed never reached the others'
--     member lists.
--   - brainstorm_items: deleted / dismissed routes stayed on co-travellers'
--     screens.
-- RLS and the publication are unchanged — all three are already published and
-- member-scoped.
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

ALTER TABLE public.days REPLICA IDENTITY FULL;
ALTER TABLE public.trip_members REPLICA IDENTITY FULL;
ALTER TABLE public.brainstorm_items REPLICA IDENTITY FULL;
