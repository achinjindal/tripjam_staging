-- Remove the face_icon emoji avatar feature entirely (2026-05-28)
--
-- The Avatar component now renders an initial-in-coloured-circle keyed on
-- username, so the face_icon column + picker UI are obsolete. This migration:
--
--   1. Replaces the create_profile_on_signup trigger so new signups stop
--      inserting face_icon. MUST happen before dropping the column or any
--      INSERT racing the migration will fail.
--   2. Drops the trips_with_creator view (it selects p.face_icon and would
--      block the column drop). Recreated below without face_icon.
--   3. Drops profiles.face_icon.
--   4. Recreates trips_with_creator without the created_by_face_icon field
--      (no app code references it; it was admin/debug only).
--   5. Defensively backfills any NULL usernames (no-op on prod where
--      username is already NOT NULL with 0 nulls, but covers any local /
--      staging state where the column was added later or differently).
--   6. Ensures profiles.username is NOT NULL so we always have a stable
--      handle for every user (auto-derived from email at signup or via
--      the trigger).

-- 1. Replace the trigger BEFORE dropping the column.
CREATE OR REPLACE FUNCTION public.create_profile_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_display_name TEXT;
BEGIN
  -- Derive username from email (left of @) or from raw_user_meta_data
  v_username := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(NEW.raw_user_meta_data->>'preferred_username', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'user_' || substr(NEW.id::text, 1, 8)
  );
  v_display_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    v_username
  );

  -- INSERT only if not present (avoids racing with manual upsert from Auth.jsx).
  -- face_icon column is gone; we no longer set it.
  INSERT INTO public.profiles (id, username, email, display_name)
  VALUES (NEW.id, v_username, NEW.email, v_display_name)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email
    WHERE public.profiles.email IS NULL;

  RETURN NEW;
END;
$$;

-- 2. Drop the dependent view so the column can be dropped.
DROP VIEW IF EXISTS trips_with_creator;

-- 3. Drop the column. IF EXISTS guard makes the migration idempotent.
ALTER TABLE profiles DROP COLUMN IF EXISTS face_icon;

-- 4. Recreate the view WITHOUT created_by_face_icon. Mirrors the shape from
-- 20260423000001_add_ig_count_to_trips.sql minus that one field.
CREATE VIEW trips_with_creator AS
SELECT
  t.*,
  p.username                                                                  AS created_by_username,
  EXTRACT(EPOCH FROM (t.generation_completed_at - t.generation_started_at))::int AS ig_seconds,
  CASE WHEN t.ig_count > 1 THEN true ELSE false END                          AS is_regenerated
FROM trips t
LEFT JOIN profiles p ON p.id = t.created_by;

-- 5. Backfill any NULL usernames defensively (zero rows on prod today).
UPDATE profiles p
SET username = COALESCE(
  NULLIF(split_part(u.email, '@', 1), ''),
  'user_' || substr(p.id::text, 1, 8)
)
FROM auth.users u
WHERE p.id = u.id AND p.username IS NULL;

-- 6. Enforce NOT NULL at the database level so the app can always rely on
-- every user having a username. SET NOT NULL is a no-op when the column is
-- already NOT NULL (which is the case on prod).
ALTER TABLE profiles ALTER COLUMN username SET NOT NULL;
