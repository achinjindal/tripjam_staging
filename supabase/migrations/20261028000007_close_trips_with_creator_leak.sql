-- Close the trips_with_creator data leak (Supabase advisor: security_definer_view).
--
-- The view was created without `security_invoker`, so it ran as its owner
-- (postgres), bypassing RLS on trips — and Postgres grants new views to anon
-- and authenticated by default. MEASURED on prod 2026-10-28 before this fix:
-- `GET /rest/v1/trips_with_creator` with just the PUBLIC anon key returned
-- all 190 trips of 35 users, every trips column (share_token, hotels_data,
-- notes, ig_response, …). A leaked share_token also opens that trip's days
-- and activities through the share-link policies.
--
-- Nothing in the app, edge functions or scripts reads this view; it was an
-- admin/debug helper (20260528000002). Keep it for dashboard SQL, but make it
-- obey the caller's RLS and take it off the public API entirely.
ALTER VIEW public.trips_with_creator SET (security_invoker = true);
REVOKE ALL ON public.trips_with_creator FROM anon, authenticated;

-- Advisor: function_search_path_mutable. Pin search_path so a caller-set
-- search_path can't redirect unqualified names. Altered by name so it applies
-- to whatever signature each environment has (set_updated_at was never
-- created by a migration in this repo).
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('set_updated_at', 'set_trip_owner_default', 'has_itinerary')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f);
  END LOOP;
END $$;
