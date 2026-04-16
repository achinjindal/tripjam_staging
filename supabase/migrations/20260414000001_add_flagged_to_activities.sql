ALTER TABLE days ADD COLUMN IF NOT EXISTS hotel_options jsonb;
ALTER TABLE days ADD COLUMN IF NOT EXISTS hotel_check_in_time text;
