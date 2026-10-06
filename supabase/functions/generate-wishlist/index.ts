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

const WISHLIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["wishlists"],
  properties: {
    wishlists: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "items"],
        properties: {
          label: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "geocode", "note", "icon"],
              properties: {
                title: { type: "string" },
                geocode: {
                  type: "string",
                  description: "shortest plain name for Maps, no descriptors",
                },
                note: { type: "string", description: "max 9 words, no quotes" },
                icon: { type: "string", description: "single emoji" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a local travel expert. For each day of a trip, suggest exactly 3 local gems the traveller might enjoy if they have a spare moment.

Rules:
- Each gem must be within 15 minutes walk from that day's activity area
- Specific named places only — a chocolate shop, rooftop bar, quiet temple, street food stall, bookshop, vinyl record store, etc.
- Exclude anything already appearing in any day's activities across the entire itinerary
- Low-commitment: these are not planned activities, just things worth knowing about
- Each item: title, geocode (shortest plain name for Maps, no descriptors), note (max 9 words, commas allowed, no quotes), icon (emoji)

Return ONLY a raw JSON object. No markdown, no code fences. Example:
{"wishlists":[{"label":"Day 1","items":[{"title":"Cafe Mondegar","geocode":"Cafe Mondegar Mumbai","note":"Vintage Colaba cafe, jukebox, cold beer","icon":"🎵"}]}]}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const killed = llmKillSwitch(corsHeaders);
    if (killed) return killed;

    const user = await authenticateUser(req);
    if (!user) return unauthorized(corsHeaders);

    const rateLimited = await rateLimit(user.id, corsHeaders);
    if (rateLimited) return rateLimited;

    const { days, tripId, spend_personal } = await req.json();

    // Pre-flight (Phase 2.5): personal for solo (unchanged), pool for shared.
    const { gate, source } = await resolveAndGate(
      user,
      tripId || null,
      spend_personal === true,
      corsHeaders,
    );
    if (gate) return gate;

    // Build a compact summary of each day's area and existing activities
    const daysSummary = days
      .map(
        (d: any) =>
          `${d.label} (${d.city}): ${d.activities.map((a: any) => a.title).join(", ")}`,
      )
      .join("\n");

    const allActivities = days
      .flatMap((d: any) => d.activities.map((a: any) => a.title))
      .join(", ");

    const userMessage = `Generate local gems for each day of this trip:

${daysSummary}

Already in the itinerary (exclude these): ${allActivities}`;

    const model = modelFor("WISHLIST", "claude-haiku-4-5-20251001");
    const data = await callLLM({
      model,
      system: SYSTEM_PROMPT,
      user: userMessage,
      maxTokens: suggestCap(model, 2000),
      json: true,
      // Honoured only by pre-Claude-5 Anthropic models; the adapter drops it
      // everywhere else rather than risking a 400 on an unsupported param.
      temperature: 0.8,
      schema: WISHLIST_SCHEMA as unknown as JSONSchema,
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
        function_name: "generate-wishlist",
        model,
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        cache_creation_tokens: data.usage.cache_creation_input_tokens,
        cache_read_tokens: data.usage.cache_read_input_tokens,
        duration_ms: data.ms,
      }),
    }).catch(() => {});

    deductCredits({
      userId: user.id,
      model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      cacheCreationTokens: data.usage.cache_creation_input_tokens,
      cacheReadTokens: data.usage.cache_read_input_tokens,
      functionName: "generate-wishlist",
      tripId: tripId || null,
      source,
    });

    // Schema-guaranteed; the fence-stripping regex this replaces existed
    // because Haiku wrapped output in ```json despite being told not to.
    const result = data.parsed;
    if (!result)
      throw new Error(
        `No JSON in response (truncated=${data.truncated}, ` +
          `schemaUnsupported=${data.schemaUnsupported})`,
      );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-wishlist error:", err.message);
    await captureException(err, { functionName: "generate-wishlist" });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
