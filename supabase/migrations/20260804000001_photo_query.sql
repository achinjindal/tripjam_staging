-- Story photo quality: LLM-authored photo search query per activity.
-- "Fushimi Inari torii gates tunnel" finds the iconic shot where the raw
-- activity title finds a generic (or wrong) one. Nullable + additive.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS photo_query text;
