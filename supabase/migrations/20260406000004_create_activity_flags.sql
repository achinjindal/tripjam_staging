CREATE TABLE activity_flags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid REFERENCES activities(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  flag       text CHECK (flag IN ('love', 'skip', 'discuss')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(activity_id, user_id)
);

ALTER TABLE activity_flags ENABLE ROW LEVEL SECURITY;

-- Users can manage their own flags
CREATE POLICY "Users manage own flags"
  ON activity_flags FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can read all flags on activities belonging to their trips
CREATE POLICY "Users read flags on their trips"
  ON activity_flags FOR SELECT
  TO authenticated
  USING (
    activity_id IN (
      SELECT a.id FROM activities a
      JOIN days d ON d.id = a.day_id
      JOIN trips t ON t.id = d.trip_id
      WHERE t.user_id = auth.uid()
    )
  );
