-- ============================================================================
-- mark_trippy_change_undone(p_message uuid) — save "Undone" on a change card
-- ============================================================================
-- Undoing a Trippy edit only flipped the card in the undoer's own browser: a
-- co-traveller kept seeing an un-undone change, and the undoer lost the
-- "Undone" note on reload. The web client now calls this after an undo, and
-- the realtime UPDATE carries the flag to everyone else on the trip.
--
-- trip_messages has no UPDATE policy, and gets none: a member must not be able
-- to rewrite what anyone (Trippy included) said. This SECURITY DEFINER
-- function makes exactly one change — it merges
--   {undone: true, undoneBy: <caller>, undoneAt: now()}
-- into meta — and only on a Trippy reply that carried a change card
-- (role = 'assistant', meta has "changes") and is not already undone, for a
-- caller who can edit the trip (an 'edit' trip_members row; created_by
-- confers nothing, as everywhere since 20261009000001). content and every
-- other meta key are left alone.
--
-- Returns true when the row was marked, false otherwise (not found, not a
-- change card, already undone, or the caller can't edit that trip).
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_trippy_change_undone(p_message uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mark_trippy_change_undone: not signed in';
  END IF;

  UPDATE trip_messages m
     SET meta = coalesce(m.meta, '{}'::jsonb)
                || jsonb_build_object('undone', true,
                                      'undoneBy', v_uid,
                                      'undoneAt', now())
   WHERE m.id = p_message
     AND m.role = 'assistant'
     AND m.meta ? 'changes'
     AND NOT coalesce((m.meta->>'undone')::boolean, false)
     AND EXISTS (SELECT 1 FROM trip_members tm
                  WHERE tm.trip_id = m.trip_id
                    AND tm.user_id = v_uid
                    AND tm.role = 'edit');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_trippy_change_undone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_trippy_change_undone(uuid) TO authenticated;
