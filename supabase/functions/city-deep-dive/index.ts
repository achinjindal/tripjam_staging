import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  llmKillSwitch,
  requireMinCredits,
  deductCredits,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a travel expert writing a deep-dive guide for a specific destination. The traveler is already planning a trip there — your job is to give them colour, context, and practical tips that don't fit in the main itinerary.

Return ONLY a raw JSON object with these fields:
{
  "writeup": "2-3 evocative sentences about this city — its character, vibe, and why a traveler would want to visit. Not a list of sights, but a warm introduction like a Lonely Planet opening paragraph.",
  "foodSpecialties": [{"name": "dish or drink name", "note": "max 8 words, what it is or why try it", "icon": "single emoji"}],
  "weather": "2-3 sentences about climate, what to expect in the traveler's travel month",
  "gettingAround": "2-3 sentences naming the specific local transport (tuk-tuk, Shinkansen, vaporetto, etc.), walking areas, and any useful practical tips",
  "etiquette": ["tip 1", "tip 2", "tip 3"],
  "didYouKnow": "2-3 sentences of interesting history, architecture, or cultural trivia about this specific place",
  "moreSights": [{"title": "place name", "geocode": "exact name for map/Wikipedia lookup", "note": "max 8 words", "icon": "single emoji"}]
}

Rules:
- foodSpecialties: 3–5 items. Well-known authentic local dishes or drinks only. Use the local-language name where natural (e.g. "Kottu roti", "Pho bo", "Cacio e pepe").
- weather: factor in the travel month given. Mention rain, heat, best-time-of-day if relevant.
- gettingAround: be specific. Not "you can take a taxi" — name the mode ("tuk-tuks are plentiful, Uber works in central areas, walk within the Fort"). Include practical notes (tipping, negotiating, apps).
- etiquette: 3–5 CONCRETE practical tips. Not "be respectful" — instead "cover shoulders and knees inside Buddhist temples", "remove shoes before entering homes and temples", "tip 10% at restaurants". Specific, actionable.
- didYouKnow: one or two interesting facts. Prefer things a local would know that a guidebook often omits.
- moreSights: 5–8 specific named places, landmarks, or experiences in or near this city that a traveler should know about — NOT limited to the itinerary. Think broadly: temples, viewpoints, hidden beaches, street art, local markets, nature spots, museums, neighborhoods to wander.
  CRITICAL: Every place MUST be real and verifiable. Use only places that have a Wikipedia article or Google Maps listing. NEVER invent, combine, or embellish place names. If you're not 100% certain a place exists with that exact name, do not include it. "Uzuki Matsuri Valley" is an example of a HALLUCINATED name — it does not exist. Prefer well-known, established places over obscure ones.
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

  const creditCheck = requireMinCredits(user, corsHeaders);
  if (creditCheck) return creditCheck;

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
    } = await req.json();
    if (!city) throw new Error("city is required");

    const userMessage = `Deep dive on: ${city}${country ? `, ${country}` : ""}.
Trip context: ${tripDays ? `${tripDays} day${tripDays > 1 ? "s" : ""} in this city` : "short visit"}, traveling in ${travelMonth || "unspecified month"}.
Style: ${(styles || []).join(", ") || "general"}, ${budget || "mid-range"} budget.
${notes ? `Traveler notes: ${notes}` : ""}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error: ${err}`);
    }

    const result = await response.json();
    const accumulated = result.content[0].text;

    // Deduct credits and log usage (both fire-and-forget)
    deductCredits({
      userId: user.id,
      model: "claude-haiku-4-5-20251001",
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
      functionName: "city-deep-dive",
      tripId: tripId || null,
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
        model: "claude-haiku-4-5-20251001",
        input_tokens: result.usage?.input_tokens || 0,
        output_tokens: result.usage?.output_tokens || 0,
      }),
    }).catch(() => {});

    const start = accumulated.indexOf("{");
    const end = accumulated.lastIndexOf("}");
    let data: any = {};
    try {
      data = JSON.parse(accumulated.slice(start, end + 1));
    } catch {
      data = { error: "parse_failed", raw: accumulated };
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("city-deep-dive error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
