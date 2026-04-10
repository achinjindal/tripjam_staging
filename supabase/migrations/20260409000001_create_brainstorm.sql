CREATE TABLE brainstorm_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid REFERENCES trips(id) ON DELETE CASCADE,
  title       text NOT NULL,
  city        text,
  category    text NOT NULL,
  note        text,
  icon        text,
  geocode     text,
  position    integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE brainstorm_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid REFERENCES brainstorm_items(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  vote        integer NOT NULL CHECK (vote IN (-1, 1)),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(item_id, user_id)
);

ALTER TABLE brainstorm_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE brainstorm_votes ENABLE ROW LEVEL SECURITY;

-- Trip owner can manage items
CREATE POLICY "Trip owner manages brainstorm items"
  ON brainstorm_items FOR ALL
  TO authenticated
  USING (trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid()))
  WITH CHECK (trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid()));

-- All authenticated users can read items for trips they're a member of
CREATE POLICY "Trip members read brainstorm items"
  ON brainstorm_items FOR SELECT
  TO authenticated
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );

-- Users can manage their own votes
CREATE POLICY "Users manage own brainstorm votes"
  ON brainstorm_votes FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can read all votes on items in their trips
CREATE POLICY "Users read brainstorm votes on their trips"
  ON brainstorm_votes FOR SELECT
  TO authenticated
  USING (
    item_id IN (
      SELECT bi.id FROM brainstorm_items bi
      JOIN trips t ON t.id = bi.trip_id
      WHERE t.created_by = auth.uid()
        OR t.id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
    )
  );
