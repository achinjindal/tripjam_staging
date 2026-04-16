-- Store extra route-option fields (tagline, days, bestFor, warning, recommended, points)
-- as JSON to avoid adding many columns. Also track whether the user selected this option.
ALTER TABLE brainstorm_items ADD COLUMN IF NOT EXISTS data jsonb;
ALTER TABLE brainstorm_items ADD COLUMN IF NOT EXISTS selected boolean DEFAULT false;
