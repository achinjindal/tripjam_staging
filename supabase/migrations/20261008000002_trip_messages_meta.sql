-- ============================================================================
-- trip_messages.meta — what a Trippy reply carried besides its text
-- ============================================================================
-- Suggestion cards, the "what changed" card for an edit and the
-- "View updated" flag were in-memory only, so they vanished on reload and
-- co-travellers never saw them. The web client now saves them here:
--   {suggestions?, changes?, hasChanges?, changedRouteIds?, followUp?,
--    followUpLabel?}
-- plus, set later by mark_trippy_change_undone (20261028000004) when a change
-- card is undone: {undone, undoneBy, undoneAt}.
-- Older clients don't select or write the column, so they are unaffected.
-- APPLY BEFORE shipping the frontend that selects it: the history query
-- names `meta`, and PostgREST rejects an unknown column.
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

ALTER TABLE trip_messages ADD COLUMN IF NOT EXISTS meta jsonb;
