Audit LLM cost efficiency across the TripJam app. This is a read-only analysis — do not modify any files.

## What to analyze

For each edge function in `supabase/functions/`:

1. **Model choice**: Which model does it use? Could it use Haiku instead of Sonnet without quality loss? Functions that do simple extraction, classification, or templated output are Haiku candidates. Functions that need creative generation, complex reasoning, or nuanced writing should stay on Sonnet.

2. **max_tokens**: Is it set higher than the function actually needs? Check the system prompt expectations and typical output size. Oversized max_tokens wastes money on long-context billing.

3. **System prompt size**: Count approximate tokens in each system prompt. Flag prompts over 1,500 tokens — are they bloated with examples that could be trimmed?

4. **Streaming vs batch**: Does the function stream responses? If the frontend doesn't display partial results (i.e., it waits for the full response), streaming adds overhead for no benefit.

5. **Duplicate calls**: Check the frontend (`src/App.jsx`, `src/components/`) for patterns where the same function might be called multiple times for the same input (e.g., re-renders, missing dedup, no caching).

6. **Token estimation accuracy**: Check how each function estimates input/output tokens for `llm_usage` logging. Flag any that use rough approximations (like `length / 4`) vs actual API usage data.

## Cost rates

- Sonnet 4.6: $3/M input, $15/M output
- Haiku 4.5: $0.80/M input, $4/M output

## Output format

```
## Cost Audit Summary

| Function | Model | max_tokens | System prompt (~tokens) | Streams? | Est. cost/call | Issue |
|----------|-------|------------|------------------------|----------|---------------|-------|
| ...      | ...   | ...        | ...                    | ...      | ...           | ...   |

## Recommendations (ranked by savings)

1. **[Highest impact change]** — explanation + estimated savings
2. ...

## Duplicate/Wasted Calls

List any frontend patterns that trigger unnecessary LLM calls.
```

Be specific and actionable. "Switch X to Haiku" with reasoning, not "consider cheaper models." Estimate dollar savings where possible based on current usage patterns.
