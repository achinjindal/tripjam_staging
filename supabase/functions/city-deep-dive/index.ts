import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { captureException } from "../_shared/errortrack.ts";
import {
  callLLM,
  modelFor,
  suggestCap,
  type JSONSchema,
} from "../_shared/llm.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  llmKillSwitch,
  resolveAndGate,
  deductCredits,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Mirrors the field list in SYSTEM_PROMPT, enforced by the provider. This is
// the call most exposed to truncation (it is the longest single JSON object we
// generate), and a half-written object used to surface as the Magazine deep
// dive silently rendering empty — now it fails loudly instead.
const DEEPDIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "writeup",
    "foodSpecialties",
    "weather",
    "gettingAround",
    "etiquette",
    "didYouKnow",
    "moreSights",
  ],
  properties: {
    writeup: { type: "string" },
    foodSpecialties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "note", "icon"],
        properties: {
          name: { type: "string" },
          note: { type: "string" },
          icon: { type: "string" },
        },
      },
    },
    weather: { type: "string" },
    gettingAround: { type: "string" },
    etiquette: { type: "array", items: { type: "string" } },
    didYouKnow: { type: "string" },
    moreSights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "geocode", "note", "icon", "photo_query"],
        properties: {
          title: { type: "string" },
          geocode: { type: "string" },
          note: { type: "string" },
          icon: { type: "string" },
          photo_query: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a travel expert writing a deep-dive guide for a specific destination. The traveler is already planning a trip there — your job is to give them colour, context, and practical tips that don't fit in the main itinerary.

Return ONLY a raw JSON object with these fields:
{
  "writeup": "2-3 evocative sentences about this city — its character, vibe, and why a traveler would want to visit. Not a list of sights, but a warm introduction like a Lonely Planet opening paragraph.",
  "foodSpecialties": [{"name": "dish or drink name", "note": "max 8 words, what it is or why try it", "icon": "single emoji"}],
  "weather": "2-3 sentences about climate, what to expect in the traveler's travel month",
  "gettingAround": "2-3 sentences naming the specific local transport (tuk-tuk, Shinkansen, vaporetto, etc.), walking areas, and any useful practical tips",
  "etiquette": ["tip 1", "tip 2", "tip 3"],
  "didYouKnow": "2-3 sentences of interesting history, architecture, or cultural trivia about this specific place",
  "moreSights": [{"title": "place name", "geocode": "exact name for map/Wikipedia lookup", "note": "max 8 words", "icon": "single emoji", "photo_query": "iconic photographed view of this exact place, 2-6 words, phrased as a Wikimedia Commons image search (e.g. 'Tawang Monastery valley view', 'Ita Fort brick ramparts'); name the place, no adjectives like 'beautiful'"}]
}

Rules:
- foodSpecialties: 3–5 items. Well-known authentic local dishes or drinks only. Use the local-language name where natural (e.g. "Kottu roti", "Pho bo", "Cacio e pepe").
- weather: factor in the travel month given. Mention rain, heat, best-time-of-day if relevant.
- gettingAround: be specific. Not "you can take a taxi" — name the mode ("tuk-tuks are plentiful, Uber works in central areas, walk within the Fort"). Include practical notes (tipping, negotiating, apps).
- etiquette: 3–5 CONCRETE practical tips. Not "be respectful" — instead "cover shoulders and knees inside Buddhist temples", "remove shoes before entering homes and temples", "tip 10% at restaurants". Specific, actionable.
- didYouKnow: one or two interesting facts. Prefer things a local would know that a guidebook often omits.
- moreSights: 5–8 specific named places, landmarks, or experiences in or near this city that a traveler should know about — NOT limited to the itinerary. Think broadly: temples, viewpoints, hidden beaches, street art, local markets, nature spots, museums, neighborhoods to wander.
  CRITICAL: Every place MUST be real and verifiable. Use only places that have a Wikipedia article or Google Maps listing. NEVER invent, combine, or embellish place names. If you're not 100% certain a place exists with that exact name, do not include it. "Uzuki Matsuri Valley" is an example of a HALLUCINATED name — it does not exist. Prefer well-known, established places over obscure ones.
  NEVER rename or restyle a real place into something grander — use the plain common name exactly. WRONG: "Itanagar Citadel" (does not exist). RIGHT: "Ita Fort" (the real name of that fortress). If you only half-remember a name, OMIT the place.
  For remote or lesser-documented regions, return FEWER sights (3-4) you are completely certain about rather than padding to 8 — an invented sight destroys trust in the whole guide.
  "geocode" must be the exact real-world name as it appears on Wikipedia/Maps (e.g. title "Golden Pavilion" → geocode "Kinkaku-ji", title "Shibuya Crossing" → geocode "Shibuya Crossing"). This is a discovery section — surprise the traveler with things they might not have planned.
- If the traveler's notes mention a specific interest (scuba, photography, kids, food), subtly bias the content to reflect it (e.g. diving-specific etiquette for a scuba trip).
- No markdown, no bullets inside string values. Short and readable.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const killed = llmKillSwitch(corsHeaders);
  if (killed) return killed;

  const user = await authenticateUser(req);
  if (!user) return unauthorized(corsHeaders);

  const rateLimited = await rateLimit(user.id, corsHeaders);
  if (rateLimited) return rateLimited;

  try {
    const {
      city,
      country,
      travelMonth,
      styles,
      budget,
      notes,
      tripDays,
      tripId,
      spend_personal,
    } = await req.json();
    if (!city) throw new Error("city is required");

    // Pre-flight (Phase 2.5): personal for solo (unchanged), pool for shared.
    const { gate, source } = await resolveAndGate(
      user,
      tripId || null,
      spend_personal === true,
      corsHeaders,
    );
    if (gate) return gate;

    const userMessage = `Deep dive on: ${city}${country ? `, ${country}` : ""}.
Trip context: ${tripDays ? `${tripDays} day${tripDays > 1 ? "s" : ""} in this city` : "short visit"}, traveling in ${travelMonth || "unspecified month"}.
Style: ${(styles || []).join(", ") || "general"}, ${budget || "mid-range"} budget.
${notes ? `Traveler notes: ${notes}` : ""}`;

    // Default moved Haiku 4.5 -> gpt-6-luna on 2026-10-05, on measured data
    // from the 14-trip bench (bench-results-2026-10-05.md): per deep-dive call
    //   haiku-4.5   $0.00916   39-57% of sights resolve to the named place
    //   gpt-6-luna  $0.00115   86% resolve, and it returns MORE sights/call
    // i.e. 8x cheaper AND more accurate — Haiku's Feb-2025 knowledge cutoff
    // shows up badly on a "does this venue exist" task.
    //
    // TRADE-OFF: gpt-6-luna takes ~23.8s/call vs Haiku's ~15.7s, and deep
    // dives are lazy-loaded when the user opens Magazine, so this is visible
    // latency. If that matters more than cost, gpt-5.6-luna is the middle
    // option (~15.7s, 4.7x cheaper, lowest substitution rate at 5%) — set
    // LLM_MODEL_DEEPDIVE rather than editing this default.
    //
    // 2048 is the Haiku-tuned baseline; suggestCap scales it per model
    // (gpt-6-luna measured 1623-2048 output here, i.e. it truncated AT the
    // old literal cap).
    const model = modelFor("DEEPDIVE", "gpt-6-luna");
    const result = await callLLM({
      model,
      system: SYSTEM_PROMPT,
      user: userMessage,
      maxTokens: suggestCap(model, 2048),
      json: true,
      schema: DEEPDIVE_SCHEMA as unknown as JSONSchema,
    });

    // Deduct credits and log usage (both fire-and-forget)
    deductCredits({
      userId: user.id,
      model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheCreationTokens: result.usage.cache_creation_input_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      functionName: "city-deep-dive",
      tripId: tripId || null,
      source,
    }).catch(() => {});

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
        function_name: "city-deep-dive",
        model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_tokens: result.usage.cache_creation_input_tokens,
        cache_read_tokens: result.usage.cache_read_input_tokens,
        duration_ms: result.ms,
      }),
    }).catch(() => {});

    // Schema-guaranteed. parse_failed is now reachable only if the response
    // was cut off even after callLLM's 1.5x retry, so it gets logged rather
    // than quietly handed to the UI as a shape it cannot render.
    const data = (result.parsed ?? null) as Record<string, unknown> | null;
    if (!data) {
      console.error(
        `[deep-dive] unparseable (truncated=${result.truncated}, ` +
          `schemaUnsupported=${result.schemaUnsupported}): ` +
          result.text.slice(0, 300),
      );
      return new Response(
        JSON.stringify({ error: "parse_failed", raw: result.text }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("city-deep-dive error:", err.message);
    await captureException(err, { functionName: "city-deep-dive" });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
