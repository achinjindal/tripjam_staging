-- ============================================================================
-- Phase 0a · 03 — Create tables absent in prod (present in staging, unverified)
-- Canonical shapes from documentation.md §2. Target: PROD (creates them).
--
-- SCOPE (user decision 2026-07-20): staging is out of scope — we work prod-direct
-- until launch. These four tables exist in staging with an unverified shape, but
-- we are not reconciling staging now. Applied to prod, `IF NOT EXISTS` creates
-- them fresh at the canonical shape. Before launch, when staging is re-
-- established, drop+recreate the staging copies to match (deferred).
-- ============================================================================

-- Per-traveler preferences fed to Trippy (Phase 5)
CREATE TABLE IF NOT EXISTS trip_preferences (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  prefs_text text,
  prefs_struct jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Read-tracking for "what changed while you were away" (Phase 3)
CREATE TABLE IF NOT EXISTS trip_read_state (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Daily email digest bookkeeping (Phase 4)
CREATE TABLE IF NOT EXISTS notification_prefs (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  email_digest boolean NOT NULL DEFAULT true,
  last_digest_sent_at timestamptz,
  PRIMARY KEY (trip_id, user_id)
);

-- Polls (Phase 6). entity_type includes 'route' for the v1.1 routes surface.
CREATE TABLE IF NOT EXISTS polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),   -- NULL/system id when Trippy-created
  question text NOT NULL,
  options jsonb NOT NULL,                     -- [{id,label}]; route polls: id = brainstorm route id
  mode text NOT NULL DEFAULT 'single',        -- single | approval | ranking (ranking deferred)
  entity_type text,                           -- route | day | activity | freeform
  entity_id uuid,
  status text NOT NULL DEFAULT 'open',        -- open | resolved | cancelled
  resolved_option_id text,
  closes_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- One row per (voter, chosen option). single = 1 row/voter (app-enforced),
-- approval = several, ranking uses `rank`.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id uuid REFERENCES polls(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  option_id text NOT NULL,
  rank int,
  PRIMARY KEY (poll_id, user_id, option_id)
);
