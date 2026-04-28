CREATE TABLE IF NOT EXISTS trip_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  icon text DEFAULT '🔗' NOT NULL,
  position int DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE trip_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage bookmarks for their trips"
  ON trip_bookmarks
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
  );
