import { captureException } from "../_shared/errortrack.ts";
import {
  callLLM,
  modelFor,
  suggestCap,
  type JSONSchema,
} from "../_shared/llm.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticateUser, unauthorized } from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// All three fields are required but nullable — "no clue in the notes" is a
// real answer the IG pre-sheet relies on, and a nullable union expresses it
// on every provider (OpenAI strict would 400 on an omitted key).
const PREFS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["budget", "morningStart", "pace"],
  properties: {
    budget: {
      type: ["string", "null"],
      enum: ["budget", "mid", "luxury", null],
    },
    morningStart: {
      type: ["string", "null"],
      enum: ["early", "mid", "late", null],
    },
    pace: {
      type: ["string", "null"],
      enum: ["active", "moderate", "relaxed", null],
    },
  },
} as const;

const SYSTEM_PROMPT = `You extract travel preferences from user notes and chat history.

Return a JSON object with exactly these fields:
- budget: one of "budget", "mid", or "luxury" (default "mid")
- morningStart: one of "early", "mid", or "late" (default "early")
- pace: one of "active", "moderate", or "relaxed" (default "active")

Clues to look for:
- Budget: "cheap", "backpacker", "hostel", "budget" → "budget". "luxury", "5 star", "fine dining", "splurge", "premium" → "luxury". Otherwise "mid".
- Morning: "sleep in", "late start", "no early mornings", "lazy" → "late". "mid morning", "10am" → "mid". "early bird", "sunrise", "packed day" → "early".
- Pace: "relaxed", "chill", "slow", "take it easy", "not rushed" → "relaxed". "moderate", "balanced" → "moderate". "packed", "active", "see everything", "adventurous" → "active".

If there are no clues for a field, return null for that field (not the default).
Return ONLY the JSON object, no explanation.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // D15: extract-preferences requires authentication to prevent abuse.
  // This is a free system-internal call — no credit deduction. Cost (~$0.0007/call)
  // is absorbed by the founder since it runs invisibly between user actions
  // (Build button click → pre-IG sheet open) and would be a surprise charge.
  const user = await authenticateUser(req);
  if (!user) return unauthorized(corsHeaders);

  try {
    const { notes, chatHistory, tripId } = await req.json();

    // Build user message from available context
    const parts: string[] = [];
    if (notes?.trim()) parts.push(`User notes: "${notes.trim()}"`);
    if (chatHistory?.length) {
      const chatText = chatHistory
        .map(
          (m: { role: string; content: string }) => `${m.role}: ${m.content}`,
        )
        .slice(-10) // last 10 messages max
        .join("\n");
      parts.push(`Chat history:\n${chatText}`);
    }

    if (!parts.length) {
      return new Response(
        JSON.stringify({ budget: null, morningStart: null, pace: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Was the npm Anthropic SDK; the shared adapter replaces it (one less
    // cold-start import, and this call can now run any provider).
    //
    // The 100-token cap is the reason suggestCap has an ADDITIVE floor: a
    // reasoning model spends more than 100 tokens thinking before it emits
    // the first character of JSON, so a pure multiplier (160) would return an
    // empty string and every preference would silently fall back to default.
    const model = modelFor("PREFS", "claude-haiku-4-5-20251001");
    const msg = await callLLM({
      model,
      system: SYSTEM_PROMPT,
      user: parts.join("\n\n"),
      maxTokens: suggestCap(model, 100),
      json: true,
      schema: PREFS_SCHEMA as unknown as JSONSchema,
    });

    // Log LLM usage (fire-and-forget)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        trip_id: tripId || null,
        function_name: "extract-preferences",
        model,
        input_tokens: msg.usage.input_tokens,
        output_tokens: msg.usage.output_tokens,
        cache_creation_tokens: msg.usage.cache_creation_input_tokens,
        cache_read_tokens: msg.usage.cache_read_input_tokens,
        duration_ms: msg.ms,
      }),
    }).catch(() => {});

    // Schema-guaranteed shape — this used to need a fence-safe slice because
    // Haiku intermittently wrapped output in ```json fences despite the
    // instructions (same bug hit inbound-email; PostHog issue #11). The enum
    // re-check below is kept deliberately: it is the safety net for the
    // degraded prompt-only path when a model does not support schemas.
    // Typed as string for the enum checks below; a schema-returned null simply
    // fails `includes` and maps to null, which is the intended "no clue" answer.
    const parsed = (msg.parsed ?? {}) as Record<string, string>;

    return new Response(
      JSON.stringify({
        budget: ["budget", "mid", "luxury"].includes(parsed.budget)
          ? parsed.budget
          : null,
        morningStart: ["early", "mid", "late"].includes(parsed.morningStart)
          ? parsed.morningStart
          : null,
        pace: ["active", "moderate", "relaxed"].includes(parsed.pace)
          ? parsed.pace
          : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    // Fail-open by design (never block IG) — but REPORT the swallow: this
    // silent path hid the 2026-09 Anthropic balance outage from every probe.
    await captureException(err, { functionName: "extract-preferences" });
    return new Response(
      JSON.stringify({ budget: null, morningStart: null, pace: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
