-- Day 1 Part C — Auth migration (D9): email mandatory + Google OAuth + Identity Linking
--
-- Adds `email` and `display_name` columns to profiles. A trigger keeps them in sync
-- with auth.users (whose email is now the authoritative source).
--
-- Existing username-only accounts get a synthetic "<username>@tripjam.app" email
-- so they don't break — they'll be prompted on next login to add a real one.

-- 1. Add new profile columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 2. Backfill existing rows from auth.users.email so nothing breaks
UPDATE profiles p
SET email = u.email,
    display_name = COALESCE(p.display_name, p.username)
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 3. Sync trigger: when auth.users.email changes (e.g., user updates email),
--    keep profiles.email in sync. Service role can call this; user updates flow
--    through auth.update_user which fires this.
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_email_on_auth_change ON auth.users;
CREATE TRIGGER sync_profile_email_on_auth_change
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- 4. Profile auto-create on signup: if a new auth.users row appears without
--    a corresponding profiles row (Google OAuth, future providers), create one
--    using auth metadata.
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

  -- INSERT only if not present (avoids racing with manual upsert from Auth.jsx)
  INSERT INTO public.profiles (id, username, email, display_name, face_icon)
  VALUES (NEW.id, v_username, NEW.email, v_display_name, 1)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email
    WHERE public.profiles.email IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_profile_on_auth_signup ON auth.users;
CREATE TRIGGER create_profile_on_auth_signup
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.create_profile_on_signup();

-- 5. Index for email-based lookups (Identity Linking queries it)
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email) WHERE email IS NOT NULL;
