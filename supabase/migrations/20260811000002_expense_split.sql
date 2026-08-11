-- WS4: expense splitting (Gap 9 — group trips need who-paid / who-owes).
-- paid_by: the member who fronted the money. split_mode 'none' keeps today's
-- solo behavior; 'even' splits across the trip's members. split_count freezes
-- the member count at entry time so past splits don't drift when membership
-- changes later.

ALTER TABLE trip_expenses
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS split_count integer;
