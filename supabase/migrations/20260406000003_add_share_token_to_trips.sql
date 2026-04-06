-- Nullable: token is only generated when the owner explicitly shares
ALTER TABLE trips ADD COLUMN IF NOT EXISTS share_token uuid;

-- Allow anonymous read of a trip that has a share token
CREATE POLICY "Public read trips by share token"
  ON trips FOR SELECT
  TO anon
  USING (share_token IS NOT NULL);

-- Allow anonymous read of days belonging to a shared trip
CREATE POLICY "Public read days by share token"
  ON days FOR SELECT
  TO anon
  USING (
    trip_id IN (SELECT id FROM trips WHERE share_token IS NOT NULL)
  );

-- Allow anonymous read of activities belonging to a shared trip
CREATE POLICY "Public read activities by share token"
  ON activities FOR SELECT
  TO anon
  USING (
    day_id IN (
      SELECT d.id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE t.share_token IS NOT NULL
    )
  );
