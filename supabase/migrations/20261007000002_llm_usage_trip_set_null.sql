-- ============================================================================
-- llm_usage.trip_id: ON DELETE SET NULL
-- ============================================================================
-- The FK had no delete action, so deleting any trip that ever used AI failed.
-- Home's deleteTrip removes activities, days and memberships first, then the
-- trips delete is refused — the trip vanishes from the list but its row stays
-- behind, orphaned. Usage rows are billing history and must outlive the trip:
-- keep them, clear the link (what the 2026-10-06 prod cleanup did by hand).
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

ALTER TABLE llm_usage DROP CONSTRAINT IF EXISTS llm_usage_trip_id_fkey;
ALTER TABLE llm_usage
  ADD CONSTRAINT llm_usage_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL;
