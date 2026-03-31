import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { trip, days, message, history } = await req.json();

    const itinerarySummary = days.map((d: any) => {
      const acts = d.activities.map((a: any) => `${a.time} ${a.title}`).join(", ");
      const gems = d.wishlist?.length
        ? ` | Local gems: ${d.wishlist.map((w: any) => w.title).join(", ")}`
        : "";
      return `${d.label} - ${d.city}: ${acts}${gems}`;
    }).join("\n");

    const systemPrompt = `You are a travel planning assistant for this trip. Your job is to answer questions and make changes when asked.

Current trip: ${trip.name} (${trip.destination})
Itinerary:
${itinerarySummary}

RULES:
- INTENT: Only modify the itinerary when the user explicitly requests a change — words like replace, add, remove, change, update, swap, move, skip, swap out, or similar. For exploratory or informational questions ("what's the best time to visit X", "how long does Y take", "what if we..."), answer conversationally without touching the itinerary.
- When making a change, act immediately using your best judgment. Only ask a clarifying question if the request is genuinely ambiguous in a way that would produce a meaningfully different result (e.g. "change Day 3" with no other context). At most one short question — never multiple.
- At most one short clarifying question — never multiple questions at once.
- Use real, specific place names only — for meals always name the actual restaurant (e.g. Trishna, Leopold Cafe) or food street; never use generic titles like Lunch, Dinner, or Return ferry and lunch.
- CRITICAL: Only suggest a restaurant if you are certain it is actually in that neighbourhood. Never relocate a famous restaurant to a different zone to satisfy geography rules. If unsure of exact location, suggest a food street or dining area instead.
- Each activity must cover exactly ONE thing — never combine transit with a meal in the same entry.
- Transit to a day-trip destination implicitly includes the return — do NOT add a separate "Return ferry" activity unless it needs its own time slot.
- GEOGRAPHY — STRICT RULE: Before placing any meal, ask: what neighbourhood am I currently in? The meal MUST be in that same neighbourhood or within a 10-minute walk/ride. Crossing the city for a meal is never acceptable when good options exist nearby.
- ROUTING: Activities must flow geographically — each stop near the previous one. No more than one significant transit per day. Never return to a neighbourhood already left.
- THINK IN ZONES: Mentally divide each city into zones (e.g. South Mumbai: Colaba/Fort/Marine Drive; Central: Bandra/Juhu; North: Andheri/Vile Parle). Each day stays within one zone or moves through adjacent zones in sequence. Meals must be in the same zone as surrounding sightseeing.
- Keep "message" short: 1-2 sentences — either confirming what you changed or asking your one question.
- ALWAYS include "updatedDays" when making any change. Never omit it for change requests.
- Only include days that actually changed — not unchanged days.
- If asking a clarifying question (no change made), omit "updatedDays".
- Each activity: time, title, geocode, type (sight/food/shop/transit/hotel), duration, note (short, no apostrophes, no timing advice like "arrive early" or "go at opening" — describe the place instead), icon (emoji).
- geocode field: shortest plain name to find this place on a map (e.g. title "Colaba Causeway Street Market" → geocode "Colaba Causeway"; title "Lunch at Trishna" → geocode "Trishna"). Strip descriptors, just the place name.
- WISHLIST: When you change a day's activities, also return an updated "wishlist" array for that day — 3 to 5 low-commitment local gems near that day's area (a cafe, rooftop bar, bookshop, etc.) that are NOT already in the day's activities. Each item: title, geocode, note (max 9 words), icon.

CRITICAL: Each day in "updatedDays" MUST have a "label" field matching EXACTLY the label from the itinerary above (e.g. "Day 1", "Day 3"). Do not rename or omit the label.

Example response format:
{"message": "Replaced Day 3 with beach activities.", "updatedDays": [{"label": "Day 3", "city": "Mumbai", "activities": [{"time": "09:00", "title": "Juhu Beach", "geocode": "Juhu Beach", "type": "sight", "duration": "2h", "note": "Arrive early to avoid crowds", "icon": "🏖️"}], "wishlist": [{"title": "Prithvi Theatre", "geocode": "Prithvi Theatre Juhu", "note": "Intimate venue, good chai outside", "icon": "🎭"}]}]}`;

    const messages = [
      ...(history || []),
      { role: "user", content: message },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);

    const data = await response.json();
    const text = data.content[0].text;

    let result;
    try {
      // Strip markdown fences then find the outermost JSON object
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      // Find first { and last } to extract the JSON object
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("no JSON object found");
      result = JSON.parse(stripped.slice(start, end + 1));
      if (!result.message) result.message = "Done.";
    } catch (e) {
      console.error("JSON parse failed:", e.message, "raw:", text.slice(0, 300));
      result = { message: text };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
