CREATE TABLE IF NOT EXISTS trip_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  amount numeric NOT NULL,
  currency text DEFAULT 'USD' NOT NULL,
  category text NOT NULL,
  is_planned boolean DEFAULT false NOT NULL,
  day_label text,
  note text,
  position int DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE trip_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage expenses for their trips"
  ON trip_expenses
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
  );

-- Budget field on trips table
ALTER TABLE trips ADD COLUMN IF NOT EXISTS budget_amount numeric;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS budget_currency text DEFAULT 'USD';
