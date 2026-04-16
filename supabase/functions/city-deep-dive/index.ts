import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a travel expert writing a deep-dive guide for a specific destination. The traveler is already planning a trip there — your job is to give them colour, context, and practical tips that don't fit in the main itinerary.

Return ONLY a raw JSON object with these fields:
{
  "foodSpecialties": [{"name": "dish or drink name", "note": "max 8 words, what it is or why try it", "icon": "single emoji"}],
  "weather": "2-3 sentences about climate, what to expect in the traveler's travel month",
  "gettingAround": "2-3 sentences naming the specific local transport (tuk-tuk, Shinkansen, vaporetto, etc.), walking areas, and any useful practical tips",
  "etiquette": ["tip 1", "tip 2", "tip 3"],
  "didYouKnow": "2-3 sentences of interesting history, architecture, or cultural trivia about this specific place"
}

Rules:
- foodSpecialties: 3–5 items. Well-known authentic local dishes or drinks only. Use the local-language name where natural (e.g. "Kottu roti", "Pho bo", "Cacio e pepe").
- weather: factor in the travel month given. Mention rain, heat, best-time-of-day if relevant.
- gettingAround: be specific. Not "you can take a taxi" — name the mode ("tuk-tuks are plentiful, Uber works in central areas, walk within the Fort"). Include practical notes (tipping, negotiating, apps).
- etiquette: 3–5 CONCRETE practical tips. Not "be respectful" — instead "cover shoulders and knees inside Buddhist temples", "remove shoes before entering homes and temples", "tip 10% at restaurants". Specific, actionable.
- didYouKnow: one or two interesting facts. Prefer things a local would know that a guidebook often omits.
- If the traveler's notes mention a specific interest (scuba, photography, kids, food), subtly bias the content to reflect it (e.g. diving-specific etiquette for a scuba trip).
- No markdown, no bullets inside string values. Short and readable.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { city, country, travelMonth, styles, budget, notes, tripDays } = await req.json();
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
    const text = result.content?.[0]?.text || "{}";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    let data: any = {};
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch {
      data = { error: "parse_failed", raw: text };
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
