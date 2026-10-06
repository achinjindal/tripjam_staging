import { captureException } from "../_shared/errortrack.ts";
import {
  callLLM,
  modelFor,
  suggestCap,
  type JSONSchema,
} from "../_shared/llm.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  resolveAndGate,
  rateLimit,
  llmKillSwitch,
  deductCredits,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Schema-constrained decoding: the shape below is enforced by the provider,
// so a malformed or mis-keyed response is not possible. The enums also pin
// `category` and `due_date` to the exact strings the UI groups by — free-text
// drift ("Health/Safety", "one month before") used to land items in no group.
const TODOS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["text", "category", "due_date"],
    properties: {
      text: { type: "string", description: "specific, actionable task" },
      category: {
        type: "string",
        enum: [
          "Bookings",
          "Documents",
          "Packing",
          "Health & safety",
          "Money",
          "Day of travel",
        ],
      },
      due_date: {
        type: "string",
        enum: [
          "2 months before",
          "1 month before",
          "2 weeks before",
          "1 week before",
          "Day before",
          "Day of travel",
        ],
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a travel planning assistant. Generate a practical pre-trip to-do checklist tailored to the specific trip.

Rules:
- Generate 15–20 items total across all categories
- Each item must be a clear, specific, actionable task (not vague advice)
- Tailor items to the destination, travel style, budget, and dates given
- Include destination-specific items (e.g. visa requirements, local transport cards, vaccination needs)
- Categories: Bookings | Documents | Packing | Health & safety | Money | Day of travel
- Due dates: assign a realistic due_date to each item relative to the trip. Use these labels:
  "2 months before" — visa applications, major bookings
  "1 month before" — vaccinations, travel insurance, transport passes
  "2 weeks before" — packing, currency exchange, confirmations
  "1 week before" — final checks, downloads, copies
  "Day before" — last-minute packing, charge devices
  "Day of travel" — airport/station tasks, check-in

Return ONLY a raw JSON array. No markdown, no code fences. Start with [ and end with ].
Each item: {"text": "...", "category": "...", "due_date": "..."}

Example:
[
  {"text": "Book train from Mumbai to Goa in advance — sells out fast", "category": "Bookings", "due_date": "1 month before"},
  {"text": "Check visa-on-arrival eligibility for your passport", "category": "Documents", "due_date": "2 months before"},
  {"text": "Pack reef-safe sunscreen — regular sunscreen banned at some beaches", "category": "Packing", "due_date": "2 weeks before"}
]`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const killed = llmKillSwitch(corsHeaders);
    if (killed) return killed;

    const user = await authenticateUser(req);
    if (!user) return unauthorized(corsHeaders);

    const rateLimited = await rateLimit(user.id, corsHeaders);
    if (rateLimited) return rateLimited;

    const { trip, spend_personal } = await req.json();

    // Pre-flight (Phase 2.5): personal for solo (unchanged), pool for shared.
    const { gate, source } = await resolveAndGate(
      user,
      trip?.id || null,
      spend_personal === true,
      corsHeaders,
    );
    if (gate) return gate;

    const budgetLabel =
      { budget: "budget", mid: "mid-range", luxury: "luxury" }[trip.budget] ||
      "mid-range";
    const travelMonth = trip.start_date
      ? new Date(trip.start_date).toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        })
      : null;

    const userMessage = `Generate a to-do checklist for this trip:
- Destination: ${trip.destination}
- Travelers: ${trip.travelers || 2} people
- Budget: ${budgetLabel}
- Style: ${(trip.styles || []).join(", ") || "mixed"}
- Travel mode: ${trip.arrival_mode || "flight"}${travelMonth ? `\n- Travel dates: ${travelMonth}` : ""}${trip.notes ? `\n- Notes: ${trip.notes}` : ""}`;

    // Top-level JSON ARRAY. With a schema, expectArray also tells the adapter
    // to wrap the array root for OpenAI (which 400s on one) and unwrap it on
    // the way back, so every provider hands us a bare array.
    const model = modelFor("TODOS", "claude-haiku-4-5-20251001");
    const result = await callLLM({
      model,
      system: SYSTEM_PROMPT,
      user: userMessage,
      // 1500, not 1024: the prompt demands 15-20 items and Haiku measured
      // 809 output tokens against the old cap (79% of it), gpt-6-luna 938 —
      // and the schema now forces all three fields on every item, pushing it
      // higher. A truncation retry bills BOTH attempts (2,560 output tokens,
      // 3.2x the normal cost), while raising max_tokens costs nothing on any
      // provider. Strictly dominant.
      maxTokens: suggestCap(model, 1500),
      json: true,
      expectArray: true,
      schema: TODOS_SCHEMA as unknown as JSONSchema,
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
        trip_id: trip?.id || null,
        function_name: "generate-todos",
        model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_tokens: result.usage.cache_creation_input_tokens,
        cache_read_tokens: result.usage.cache_read_input_tokens,
        duration_ms: result.ms,
      }),
    }).catch(() => {});

    // Day 7: meter credit deduction for this previously-unmetered Haiku call.
    deductCredits({
      userId: user.id,
      model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheCreationTokens: result.usage.cache_creation_input_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      functionName: "generate-todos",
      tripId: trip?.id || null,
      source,
    });

    // Guaranteed by the schema. The only residual failure is truncation
    // (callLLM already retries once at 1.5x), which is loud rather than
    // silent — an empty list here means the model never produced JSON.
    const items = Array.isArray(result.parsed) ? result.parsed : [];
    if (!items.length)
      console.error(
        `[todos] empty after schema parse (truncated=${result.truncated}, ` +
          `schemaUnsupported=${result.schemaUnsupported}): ` +
          result.text.slice(0, 200),
      );

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await captureException(err, { functionName: "generate-todos" });
    return new Response(JSON.stringify({ error: err.message, items: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
