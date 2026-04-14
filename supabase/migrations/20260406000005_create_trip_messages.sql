CREATE TABLE IF NOT EXISTS trip_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid REFERENCES trips(id) ON DELETE CASCADE NOT NULL,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trip_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read messages for their trips"
  ON trip_messages FOR SELECT TO authenticated
  USING (trip_id IN (
    SELECT trip_id FROM trip_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members insert messages for their trips"
  ON trip_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND trip_id IN (
      SELECT trip_id FROM trip_members WHERE user_id = auth.uid()
    )
  );
