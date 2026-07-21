-- Phase 2.5 pooled-credits RPC regression. Run in a Supabase SQL Editor
-- (executes as a privileged role). Self-contained: rolls back all test data via
-- a final exception. SUCCESS = it "fails" with 'ALL 7 TESTS PASSED'.
-- Proves: pool spend never touches profiles.credits; solo 'auto' = byte-identical.
DO $$
DECLARE
  v_owner uuid; v_member uuid;
  v_trip uuid := gen_random_uuid();
  v_p0 numeric; v_p numeric; v_pool numeric; v_src text;
BEGIN
  SELECT id INTO v_owner FROM profiles WHERE username = 'qa-tester' LIMIT 1;
  SELECT id INTO v_member FROM profiles WHERE id <> v_owner LIMIT 1;
  IF v_owner IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'need two users'; END IF;

  INSERT INTO trips (id, name, destination, start_date, end_date, created_by, owner_id, credit_balance)
    VALUES (v_trip, 'POOLTEST', 'Testland', '2026-08-01', '2026-08-05', v_owner, v_owner, 0);
  INSERT INTO trip_members (trip_id, user_id, role)
    VALUES (v_trip, v_owner, 'edit'), (v_trip, v_member, 'edit');

  SELECT credits INTO v_p0 FROM profiles WHERE id = v_owner;

  SELECT source INTO v_src FROM resolve_credit_source(v_owner, v_trip, false);
  IF v_src <> 'pool' THEN RAISE EXCEPTION 'T1 FAIL: got %', v_src; END IF;
  SELECT source INTO v_src FROM resolve_credit_source(v_owner, v_trip, true);
  IF v_src <> 'personal' THEN RAISE EXCEPTION 'T2 FAIL prefer_personal: got %', v_src; END IF;
  SELECT source INTO v_src FROM resolve_credit_source(v_owner, NULL, false);
  IF v_src <> 'personal' THEN RAISE EXCEPTION 'T3 FAIL null-trip: got %', v_src; END IF;

  PERFORM grant_credits(v_owner, 100, 'pooltest', NULL, NULL, v_trip);
  SELECT credit_balance INTO v_pool FROM trips WHERE id = v_trip;
  SELECT credits INTO v_p FROM profiles WHERE id = v_owner;
  IF v_pool <> 100 OR v_p <> v_p0 THEN RAISE EXCEPTION 'T4 FAIL grant-to-pool pool=% personal=%', v_pool, v_p; END IF;

  PERFORM deduct_credits(v_owner, 30, 'pooltest', 'test', v_trip, NULL, NULL, 'pool');
  SELECT credit_balance INTO v_pool FROM trips WHERE id = v_trip;
  SELECT credits INTO v_p FROM profiles WHERE id = v_owner;
  IF v_pool <> 70 THEN RAISE EXCEPTION 'T5 FAIL pool-deduct pool=%', v_pool; END IF;
  IF v_p <> v_p0 THEN RAISE EXCEPTION 'T5 FAIL: POOL SPEND TOUCHED PERSONAL %→%', v_p0, v_p; END IF;

  DELETE FROM trip_members WHERE trip_id = v_trip AND user_id = v_member;
  SELECT source INTO v_src FROM resolve_credit_source(v_owner, v_trip, false);
  IF v_src <> 'personal' THEN RAISE EXCEPTION 'T6 FAIL solo-resolve: got %', v_src; END IF;
  PERFORM deduct_credits(v_owner, 5, 'pooltest', 'test', v_trip, NULL, NULL, 'auto');
  SELECT credits INTO v_p FROM profiles WHERE id = v_owner;
  IF v_p <> v_p0 - 5 THEN RAISE EXCEPTION 'T7 FAIL solo-auto personal %→% (expect -5)', v_p0, v_p; END IF;

  RAISE EXCEPTION 'ALL 7 TESTS PASSED — rolling back test data';
END $$;
