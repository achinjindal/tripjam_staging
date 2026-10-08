-- ============================================================================
-- app_config — public, read-only runtime config (minimum client build)
-- ============================================================================
-- The Android APK runs the web bundle it was built with until a Play Store
-- update, so server contracts can't be retired by redeploying the frontend
-- (chat's v2 update_day contract is the first case). Clients read
-- min_client_build here and show a blocking "Update TripJam" screen when
-- their build number (VITE_APP_BUILD, YYYYMMDDHHmm at build time) is older.
--
--   min_client_build = {"web": <build>, "android": <build>, "message": text|null}
--   0 = no minimum. Raise only once an update with the gate is available.
--
--   chat_protocol1_retired = true|false
--   Builds from before the gate can't show it. When true, the chat function
--   answers clients that don't send protocol:2 with an uncharged "please
--   update" reply instead of calling the model (supabase/functions/chat).
--
-- Readable by everyone (signed out too — the gate runs before sign-in).
-- Written only by the service role / SQL editor.
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app config" ON app_config;
CREATE POLICY "Anyone can read app config" ON app_config
  FOR SELECT USING (true);

GRANT SELECT ON app_config TO anon, authenticated;

INSERT INTO app_config (key, value)
VALUES ('min_client_build', '{"web": 0, "android": 0, "message": null}'),
       ('chat_protocol1_retired', 'false')
ON CONFLICT (key) DO NOTHING;
