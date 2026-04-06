CREATE TABLE IF NOT EXISTS trip_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE NOT NULL,
  text text NOT NULL,
  done boolean DEFAULT false NOT NULL,
  position int DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE trip_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage todos for their trips"
  ON trip_todos
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
  );
