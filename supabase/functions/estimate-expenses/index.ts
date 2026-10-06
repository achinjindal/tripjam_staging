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

// Provider-enforced shape. `amount` as a typed number matters here: a model
// that answers "$450" or "450 USD" as a string used to sum to NaN in the
// Expenses widget, and `category` is pinned to the six the UI buckets by.
const EXPENSES_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["title", "amount", "category"],
    properties: {
      title: { type: "string", description: "specific line-item title" },
      amount: { type: "number", description: "USD, number only" },
      category: {
        type: "string",
        enum: ["Stay", "Transport", "Food", "Activities", "Shopping", "Other"],
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a travel budget estimator. Generate realistic cost estimates for a trip.

Rules:
- Generate 8–12 expense items covering all major categories
- Categories: Stay | Transport | Food | Activities | Shopping | Other
- Use USD amounts — be realistic for the destination and budget level
- Stay: total accommodation cost for all nights
- Transport: flights, trains, local transport, taxis
- Food: daily food budget × number of days (break into a few line items if useful)
- Activities: entry fees, tours, experiences mentioned in the itinerary
- Shopping: a reasonable estimate based on budget level
- Be specific in titles (e.g. "3 nights at mid-range hotel in Tokyo" not "Hotel")

Return ONLY a raw JSON array. No markdown, no code fences.
Each item: {"title": "...", "amount": number, "category": "Stay|Transport|Food|Activities|Shopping|Other"}`;

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

    const igReq = trip.ig_request || {};
    const budgetLabel =
      { budget: "budget", mid: "mid-range", luxury: "luxury" }[igReq.budget] ||
      "mid-range";
    const numDays =
      trip.start_date && trip.end_date
        ? Math.max(
            1,
            Math.round(
              (new Date(trip.end_date).getTime() -
                new Date(trip.start_date).getTime()) /
                864e5,
            ) + 1,
          )
        : 5;

    const userMessage = `Estimate costs for:
- Destination: ${trip.destination}
- Duration: ${numDays} days
- Travelers: ${igReq.travelers || 2}
- Budget: ${budgetLabel}
- Style: ${(igReq.styles || []).join(", ") || "mixed"}${trip.notes ? `\n- Notes: ${trip.notes}` : ""}`;

    // Top-level JSON ARRAY — rides wrapped on OpenAI, bare everywhere else.
    const model = modelFor("EXPENSES", "claude-haiku-4-5-20251001");
    const result = await callLLM({
      model,
      system: SYSTEM_PROMPT,
      user: userMessage,
      maxTokens: suggestCap(model, 1024),
      json: true,
      expectArray: true,
      schema: EXPENSES_SCHEMA as unknown as JSONSchema,
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
        function_name: "estimate-expenses",
        model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_tokens: result.usage.cache_creation_input_tokens,
        cache_read_tokens: result.usage.cache_read_input_tokens,
        duration_ms: result.ms,
      }),
    }).catch(() => {});

    deductCredits({
      userId: user.id,
      model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheCreationTokens: result.usage.cache_creation_input_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      functionName: "estimate-expenses",
      tripId: trip?.id || null,
      source,
    });

    const items = Array.isArray(result.parsed) ? result.parsed : [];
    if (!items.length)
      console.error(
        `[expenses] empty after schema parse (truncated=${result.truncated}, ` +
          `schemaUnsupported=${result.schemaUnsupported}): ` +
          result.text.slice(0, 200),
      );

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await captureException(err, { functionName: "estimate-expenses" });
    return new Response(JSON.stringify({ error: err.message, items: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
