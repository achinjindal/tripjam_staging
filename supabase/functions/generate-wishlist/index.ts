import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { days } = await req.json();

    // Build a compact summary of each day's area and existing activities
    const daysSummary = days.map((d: any) =>
      `${d.label} (${d.city}): ${d.activities.map((a: any) => a.title).join(", ")}`
    ).join("\n");

    const allActivities = days.flatMap((d: any) => d.activities.map((a: any) => a.title)).join(", ");

    const userMessage = `Generate local gems for each day of this trip:

${daysSummary}

Already in the itinerary (exclude these): ${allActivities}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        temperature: 0.8,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error: ${err}`);
    }

    const data = await response.json();
    const text = data.content[0].text;

    const jsonMatch = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-wishlist error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
