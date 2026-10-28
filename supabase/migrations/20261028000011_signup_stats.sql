-- Signup counts for health-monitor check 8 (free-credit farming signal).
--
-- Replaces an arbitrary-SQL Management API call: that token can run DDL on
-- prod, so any compromised workflow step could have dropped the database.
-- This exposes two numbers to exactly one account, the health-probe user the
-- monitor already signs in as. Everyone else gets an error, and nothing here
-- returns rows from auth.users.
--
-- peak_hour = busiest rolling 60 minutes; last_window = total. The window is
-- 6h30m, not 6h: GitHub cron often starts 10-60 min late, and a 6h window
-- would then skip the signups between runs. A burst near a boundary may be
-- counted by two runs, which is the safe direction.
CREATE OR REPLACE FUNCTION public.signup_stats()
RETURNS TABLE (peak_hour bigint, last_window bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND email = 'health-probe@tripjam.app'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    coalesce(max(w.n), 0)::bigint,
    (SELECT count(*) FROM auth.users
      WHERE created_at > now() - interval '6 hours 30 minutes')::bigint
  FROM (
    SELECT u.created_at,
      count(*) OVER (ORDER BY u.created_at
        RANGE BETWEEN interval '1 hour' PRECEDING AND CURRENT ROW) AS n
    FROM auth.users u
    WHERE u.created_at > now() - interval '7 hours 30 minutes'
  ) w
  WHERE w.created_at > now() - interval '6 hours 30 minutes';
END $$;

REVOKE ALL ON FUNCTION public.signup_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signup_stats() TO authenticated;
