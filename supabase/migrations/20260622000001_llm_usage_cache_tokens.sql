-- Track prompt-caching token breakdown on LLM usage so the admin cost
-- dashboard reflects real cost. Anthropic reports three disjoint input
-- buckets: regular input_tokens, cache_creation_input_tokens (write, billed
-- 1.25× input), cache_read_input_tokens (read, billed 0.10× input).
-- Existing rows backfill to 0 (no caching was in effect before this).
ALTER TABLE llm_usage
  ADD COLUMN IF NOT EXISTS cache_creation_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer NOT NULL DEFAULT 0;
