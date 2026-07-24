-- Per-call LLM latency. duration_ms = server-side time spent on the Anthropic
-- request (from just before the API fetch to when streaming completes), written
-- alongside the existing token/cost columns on each llm_usage row. Nullable so
-- historical rows (and any function not yet instrumented) stay valid.
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS duration_ms integer;
