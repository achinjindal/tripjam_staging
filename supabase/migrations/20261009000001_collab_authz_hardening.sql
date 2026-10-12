-- ============================================================================
-- Collaboration authorization hardening (security audit, 2026-10-09)
-- ============================================================================
-- Every hole below needs only a trip id, which a removed co-traveller, or
-- anyone handed a /trip/... link, already has.
--
-- 1. leave_trip deleted other people's trips. It is SECURITY DEFINER and
--    never checked that the caller belonged to the trip: for a non-member on
--    a solo trip the "last member leaving" branch ran and deleted the trip.
--    An E2E cleanup step did exactly this to the QA trip. Now a non-owner can
--    only ever remove their own membership; only the owner deletes, and only
--    when nobody else is on the trip. FOR UPDATE stops two members leaving at
--    once from racing past the count.
-- 2. Anyone could add themselves to any trip, with any role: the
--    trip_members INSERT policy only checked user_id = auth.uid(). Now a
--    client can only insert the trip OWNER's own row (trip creation). Every
--    other join goes through accept_invite / respond_invite.
-- 3. Pool credits could be created from nothing: the owner-columns trigger
--    exempted the creator, so a creator could set trips.credit_balance, and
--    INSERT wasn't guarded at all. Now no signed-in caller can write
--    credit_balance; only purchases and AI charges (service role) change it.
-- 4. A non-member could spend another trip's pool: resolve_credit_source
--    and deduct_credits never checked membership. resolve_credit_source now
--    returns source 'denied' for a caller who is neither a member nor the
--    owner of an existing trip (edge functions answer 403; one deployed
--    before this reads 'denied' as a personal wallet with balance 0 and
--    answers 402, which is also safe), and deduct_credits only debits a
--    pool for a member.
-- 5. Owner rights keyed on trips.created_by, which transfer_ownership never
--    changes: an ex-creator kept update/delete rights (even after being
--    removed) and the new owner had fewer. They now key on owner_id.
-- 6. Anyone could delete their own trip_members row directly, skipping
--    leave_trip (poll cleanup, the owner check). This is how 40 staging
--    trips ended up with an owner who has no member row. Leaving now goes
--    through leave_trip; the owner may still delete OTHER members' rows.
-- 7. close_poll and cancel_invite compared auth.uid() <> x, which is NULL
--    with no login, so the anon key could close any poll or cancel any
--    invite. _cleanup_member_polls and incr_rate_limit were callable by
--    anyone (default PUBLIC execute): delete anyone's poll votes, or push
--    another user's rate-limit counter until they're locked out.
-- 8. delete_trip: the owner deletes a trip in one call (dependent rows
--    cascade). Home used four client deletes that, run by a co-member,
--    wiped the shared itinerary. Per product decision, a trip's remaining
--    pool balance is lost with the trip.
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

-- 1. leave_trip ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_trip(p_trip uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = 'P0001';
  END IF;
  SELECT owner_id INTO v_owner FROM trips WHERE id = p_trip FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_trip' USING errcode = 'P0001'; END IF;

  IF v_owner = auth.uid() THEN
    IF EXISTS (SELECT 1 FROM trip_members
                WHERE trip_id = p_trip AND user_id <> auth.uid()) THEN
      -- must hand off first; UI opens the "choose new owner" picker
      RAISE EXCEPTION 'transfer_ownership_first' USING errcode = 'P0001';
    END IF;
    -- owner leaving an otherwise empty trip → delete it (rows cascade)
    DELETE FROM trips WHERE id = p_trip;
    RETURN 'trip_deleted';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM trip_members
                  WHERE trip_id = p_trip AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING errcode = 'P0001';
  END IF;

  -- a non-owner never deletes the trip, even if they're the last row
  PERFORM _cleanup_member_polls(p_trip, auth.uid());
  DELETE FROM trip_members WHERE trip_id = p_trip AND user_id = auth.uid();
  RETURN 'left';
END $function$;

REVOKE EXECUTE ON FUNCTION public.leave_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_trip(uuid) TO authenticated;

-- 8. delete_trip ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_trip(p_trip uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = 'P0001';
  END IF;
  SELECT owner_id INTO v_owner FROM trips WHERE id = p_trip FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_trip' USING errcode = 'P0001'; END IF;
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  DELETE FROM trips WHERE id = p_trip;
  RETURN 'trip_deleted';
END $function$;

REVOKE EXECUTE ON FUNCTION public.delete_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_trip(uuid) TO authenticated;

-- 2. trip_members INSERT: only the owner adding themselves -----------------------
DROP POLICY IF EXISTS "users can insert trip members" ON public.trip_members;
DROP POLICY IF EXISTS "owner can add themselves" ON public.trip_members;
CREATE POLICY "owner can add themselves" ON public.trip_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'edit'
    AND EXISTS (SELECT 1 FROM trips t
                 WHERE t.id = trip_id AND t.owner_id = auth.uid())
  );

-- 6. trip_members DELETE: the owner removes others; leaving is leave_trip -----
DROP POLICY IF EXISTS "Creators and members can delete memberships" ON public.trip_members;
DROP POLICY IF EXISTS "owner can remove other members" ON public.trip_members;
CREATE POLICY "owner can remove other members" ON public.trip_members
  FOR DELETE TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (SELECT 1 FROM trips t
                 WHERE t.id = trip_id AND t.owner_id = auth.uid())
  );

-- 5. owner rights key on owner_id, not created_by ----------------------------
DROP POLICY IF EXISTS "Creator can delete trip" ON public.trips;
DROP POLICY IF EXISTS "Owner can delete trip" ON public.trips;
CREATE POLICY "Owner can delete trip" ON public.trips
  FOR DELETE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Creator can update trip" ON public.trips;
DROP POLICY IF EXISTS "Owner can update trip" ON public.trips;
CREATE POLICY "Owner can update trip" ON public.trips
  FOR UPDATE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "creators can view their own trips" ON public.trips;
DROP POLICY IF EXISTS "owners can view their own trips" ON public.trips;
CREATE POLICY "owners can view their own trips" ON public.trips
  FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Edit members can update days" ON public.days;
CREATE POLICY "Edit members can update days" ON public.days
  FOR UPDATE
  USING (
    auth.uid() IN (SELECT tm.user_id FROM trip_members tm
                    WHERE tm.trip_id = days.trip_id AND tm.role = 'edit')
    OR EXISTS (SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.owner_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() IN (SELECT tm.user_id FROM trip_members tm
                    WHERE tm.trip_id = days.trip_id AND tm.role = 'edit')
    OR EXISTS (SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.owner_id = auth.uid())
  );

-- 3 + 5. owner-only columns ----------------------------------------------------
-- created_by is pinned silently rather than rejected: the regenerate path
-- writes created_by = the current user in its update payload (and the
-- Android APK can't be patched), which would otherwise fail for co-members.
CREATE OR REPLACE FUNCTION public.trips_protect_owner_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := OLD.created_by;
    IF NEW.credit_balance IS DISTINCT FROM OLD.credit_balance THEN
      RAISE EXCEPTION 'pooled credits change only through a purchase or an AI charge'
        USING errcode = 'P0001';
    END IF;
    -- Ownership moves only through transfer_ownership (SECURITY DEFINER, so
    -- current_user is its owner there, not a client role): a direct UPDATE,
    -- even by the owner, could hand the trip to a non-member.
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
       AND current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'ownership changes only through transfer_ownership'
        USING errcode = 'P0001';
    END IF;
    IF OLD.owner_id IS DISTINCT FROM auth.uid()
       AND NEW.share_token IS DISTINCT FROM OLD.share_token THEN
      RAISE EXCEPTION 'co-travellers cannot change the share link'
        USING errcode = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- On insert, a signed-in caller always owns the trip they create and starts
-- with an empty pool.
CREATE OR REPLACE FUNCTION public.set_trip_owner_default()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.owner_id := NEW.created_by;
    NEW.credit_balance := 0;
  ELSE
    NEW.owner_id := COALESCE(NEW.owner_id, NEW.created_by);
  END IF;
  RETURN NEW;
END $function$;

-- 4. pool spend requires membership ------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_credit_source(p_user uuid, p_trip uuid DEFAULT NULL::uuid, p_prefer_personal boolean DEFAULT false)
 RETURNS TABLE(source text, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_members int;
  v_personal numeric;
  v_pool numeric;
  v_owner uuid;
BEGIN
  SELECT credits INTO v_personal FROM profiles WHERE id = p_user;
  v_personal := COALESCE(v_personal, 0);

  IF p_trip IS NULL THEN
    RETURN QUERY SELECT 'personal'::text, v_personal;
    RETURN;
  END IF;

  SELECT owner_id, credit_balance INTO v_owner, v_pool FROM trips WHERE id = p_trip;
  IF NOT FOUND THEN
    -- not saved yet (e.g. route generation before the trip row exists)
    RETURN QUERY SELECT 'personal'::text, v_personal;
    RETURN;
  END IF;

  IF v_owner IS DISTINCT FROM p_user AND NOT EXISTS (
       SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = p_user) THEN
    RETURN QUERY SELECT 'denied'::text, 0::numeric;
    RETURN;
  END IF;

  IF p_prefer_personal THEN
    RETURN QUERY SELECT 'personal'::text, v_personal;
    RETURN;
  END IF;

  SELECT count(*) INTO v_members FROM trip_members WHERE trip_id = p_trip;
  IF v_members <= 1 THEN
    -- Solo trip: personal wallet, exactly as today (the pool is ignored).
    RETURN QUERY SELECT 'personal'::text, v_personal;
    RETURN;
  END IF;

  -- Shared trip → the trip pool pays (gate compares balance >= min; if short,
  -- it forks with code 'empty_trip_pool'). Pool may be 0 (unfunded).
  RETURN QUERY SELECT 'pool'::text, COALESCE(v_pool, 0);
END $function$;

CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid, p_amount numeric, p_reason text, p_function_name text DEFAULT NULL::text, p_trip_id uuid DEFAULT NULL::uuid, p_llm_cost_usd numeric DEFAULT NULL::numeric, p_metadata jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'auto'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_balance NUMERIC(10,2);
  v_source TEXT := p_source;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  IF v_source = 'auto' THEN
    SELECT source INTO v_source
      FROM resolve_credit_source(p_user_id, p_trip_id, false);
  END IF;

  -- Only a member (or the owner) ever draws on a trip's pool.
  IF v_source = 'pool' AND p_trip_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM trip_members WHERE trip_id = p_trip_id AND user_id = p_user_id
       UNION ALL
       SELECT 1 FROM trips WHERE id = p_trip_id AND owner_id = p_user_id) THEN
    v_source := 'personal';
  END IF;

  IF v_source = 'pool' AND p_trip_id IS NOT NULL THEN
    UPDATE trips SET credit_balance = credit_balance - p_amount
      WHERE id = p_trip_id
      RETURNING credit_balance INTO v_new_balance;
    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'Trip not found: %', p_trip_id;
    END IF;
  ELSE
    v_source := 'personal';
    UPDATE profiles SET credits = credits - p_amount
      WHERE id = p_user_id
      RETURNING credits INTO v_new_balance;
    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'User not found: %', p_user_id;
    END IF;
  END IF;

  INSERT INTO credit_transactions (
    user_id, amount, balance_after, reason, function_name,
    trip_id, llm_cost_usd, metadata
  )
  VALUES (
    p_user_id, -p_amount, v_new_balance, p_reason, p_function_name,
    p_trip_id, p_llm_cost_usd,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', v_source)
  );
  RETURN v_new_balance;
END $function$;

-- 7. NULL-safe permission checks + revoke internal helpers -------------------
CREATE OR REPLACE FUNCTION public.cancel_invite(p_invite uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_trip uuid; v_inviter uuid;
BEGIN
  SELECT trip_id, inviter_id INTO v_trip, v_inviter
    FROM trip_invites
   WHERE id = p_invite AND status = 'pending';
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'invalid_invite' USING errcode = 'P0001';
  END IF;

  IF auth.uid() IS NULL OR (
       v_inviter IS DISTINCT FROM auth.uid()
       AND NOT EXISTS (SELECT 1 FROM trips WHERE id = v_trip AND owner_id = auth.uid())) THEN
    RAISE EXCEPTION 'not_allowed' USING errcode = 'P0001';
  END IF;

  UPDATE trip_invites SET status = 'cancelled', responded_at = now() WHERE id = p_invite;
END $function$;

CREATE OR REPLACE FUNCTION public.close_poll(p_poll uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trip    uuid;
  v_creator uuid;
  v_owner   uuid;
  v_status  text;
  v_winner  text;
  v_rows    int;
BEGIN
  SELECT p.trip_id, p.created_by, p.status, t.owner_id
    INTO v_trip, v_creator, v_status, v_owner
    FROM polls p JOIN trips t ON t.id = p.trip_id
   WHERE p.id = p_poll;

  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'poll not found' USING errcode = 'P0002';
  END IF;

  IF auth.uid() IS NULL OR (
       auth.uid() IS DISTINCT FROM v_creator AND auth.uid() IS DISTINCT FROM v_owner) THEN
    RAISE EXCEPTION 'only the poll creator or trip owner can close this poll'
      USING errcode = 'P0001';
  END IF;

  IF v_status <> 'open' THEN
    RETURN jsonb_build_object(
      'closed_now', false, 'status', v_status,
      'winner', (SELECT resolved_option_id FROM polls WHERE id = p_poll));
  END IF;

  WITH counts AS (
    SELECT option_id, count(*)::int AS c
      FROM poll_votes WHERE poll_id = p_poll GROUP BY option_id
  ), ranked AS (
    SELECT option_id, c,
           rank() OVER (ORDER BY c DESC) AS rk,
           count(*) OVER (PARTITION BY c) AS tie_at_c
      FROM counts
  )
  SELECT option_id INTO v_winner
    FROM ranked
   WHERE rk = 1 AND c > 0 AND tie_at_c = 1
   LIMIT 1;

  UPDATE polls
     SET status = 'resolved',
         resolved_option_id = v_winner,
         closes_at = COALESCE(closes_at, now()),
         updated_at = now()
   WHERE id = p_poll AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN  -- lost the race; someone else already resolved it
    RETURN jsonb_build_object(
      'closed_now', false, 'status', (SELECT status FROM polls WHERE id = p_poll),
      'winner', (SELECT resolved_option_id FROM polls WHERE id = p_poll));
  END IF;

  RETURN jsonb_build_object(
    'closed_now', true, 'status', 'resolved',
    'winner', v_winner, 'entity_type', (SELECT entity_type FROM polls WHERE id = p_poll),
    'entity_id', (SELECT entity_id FROM polls WHERE id = p_poll));
END $function$;

-- Only called from leave_trip / remove_member, which run as the function
-- owner; edge functions call incr_rate_limit with the service role.
REVOKE EXECUTE ON FUNCTION public._cleanup_member_polls(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.incr_rate_limit(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.incr_rate_limit(uuid, text) TO service_role;
