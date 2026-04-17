import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a travel expert who helps travellers choose the right itinerary route before generating a full plan.

TIER 1 — ROUTE OPTIONS (only when destination is country/region-level, e.g. "Sri Lanka", "Japan", "Morocco", "Rajasthan"):
Generate exactly 4 distinct complete route options as the first items in the array. Each option is a realistic loop or one-way journey for the given trip duration.

Route option fields:
- title: short evocative name (e.g. "South Coast Loop", "Hills + Beach")
- tagline: 6–8 words describing the character (e.g. "Minimal travel, best beaches")
- tier: 1
- category: "Route"
- icon: single emoji
- city: comma-separated list of EVERY city/town named in the days array, in travel order. Must include all overnight stops AND day-trip destinations mentioned in any day outline. If a day's outline mentions "Hikkaduwa scuba diving", Hikkaduwa MUST appear here. No omissions — this field is used to plot the route on a map. Do NOT include base cities that aren't actually visited (e.g. "Colombo" should only appear if the traveler spends time there, not just because it's the arrival airport). Examples: "Galle, Unawatuna, Hikkaduwa, Mirissa" or "Kandy, Nuwara Eliya, Ella, Bentota".
- days: array of strings — one per day. Each string must be a READABLE phrase that names the actual place and what happens there. Do NOT use cryptic shorthand like "back same day", "full day", "transit". Always name the base city when returning (e.g. "Day trip to Galle from Colombo, back by evening"). Always name specific activities (e.g. "Scuba diving in Hikkaduwa" not "Scuba"). Good examples: ["Colombo → Galle (2.5h drive)", "Galle Fort walk and Unawatuna beach", "Day trip to Hikkaduwa for scuba diving, return to Galle", "Mirissa beach day and Coconut Tree Hill at sunset", "Drive back to Colombo (2.5h)"]
- bestFor: short phrase (e.g. "Relaxed beach lovers", "Variety seekers")
- warning: null, or a single honest concern (e.g. "Nuwara Eliya → Bentota is a 4.5h drive")
- recommended: MUST be set to true on exactly ONE of the 4 routes — the one that best fits the traveler's style, budget, notes, and duration. Every response MUST have exactly one recommended route. On the other 3 routes, set recommended: false.
- points: array of 2–4 objects, each with "text" (max 10 words) and "good" (boolean). These are the most salient facts about this route — what makes it compelling OR what it lacks. CRITICAL: if the traveler mentioned specific requirements in their notes (e.g. scuba diving, a cooking class, no long drives), each route MUST include at least one point directly addressing whether this route satisfies or conflicts with that requirement. Non-notes points should highlight the route's strongest feature and one honest tradeoff.

ROUTE RULES:
- Routes must be realistic for the trip duration — don't try to cover too much. A common trap: packing 4+ regions into 5 days means half the trip is in a car.
- MINIMISE HOTEL HOPS: Average stay should be 2+ nights per base. Avoid single-night stops unless genuinely unavoidable (e.g. an overnight train stopover). Flag in "warning" or "points" if any stop is single-night.
- MINIMISE LOGISTICS: Avoid back-to-back long driving days — travellers should not spend half the trip in transit. Prefer routes where daily drives feel manageable given the destination's road conditions (a 3h drive in Sri Lanka is slow and tiring; a 3h drive on a European highway is easy). Use judgement. Some leeway only if the traveler notes mention a road trip, scenic drive, or similar. If any route is transit-heavy, call that out honestly in "points" with good: false.
- If arrival and departure city are the same (a loop), routes should return to that city.
- DEFAULT START/END: If no arrival or departure city is specified, assume the traveler flies into and out of the largest city / main airport WITHIN the destination region — NOT a gateway city outside the region. For example: Rajasthan → assume Jaipur (not Delhi); Sri Lanka → assume Colombo; Kerala → assume Kochi; Bali → assume Denpasar. Only use an external gateway city if the traveler explicitly names it.
- All 4 routes must be genuinely different from each other (different themes, different cities, different pace).
- If a travel month is given, factor in seasonal conditions (e.g. east coast Sri Lanka is best April–September).
- Keep drives honest: Sri Lanka drives are slow. Colombo–Galle ~2.5h, Colombo–Kandy ~3h, Galle–Yala ~3h.
- If traveler notes mention a specific activity (e.g. scuba, safari, cooking class), ensure at least one route is strongly compatible with it. Do not force every route to include it — be honest about which routes work and which don't.

TIER 2 — EXPERIENCES:
After route options, generate 15–20 specific named places and activities. tier = 2.
Rules:
- Only SPECIFIC named places — "Mirissa Beach", "Galle Fort", "Temple of the Tooth". Never "Local beach" or "City park".
- Only well-established, operating venues.
- Spread across categories: Sightseeing, Dining, Experiences, Nightlife, Nature, Culture, Shopping, Day Trip.
- Tag each with its city/area.
- NOTE: max 10 words.
- CATEGORY: one of Sightseeing, Dining, Nightlife, Experiences, Shopping, Nature, Culture, Day Trip.
- tier: 2
- If traveler notes mention specific interests, bias the tier 2 items to include relevant experiences (e.g. scuba dive sites, cooking schools).

If destination is already a specific city (e.g. "Tokyo", "Galle"), skip tier 1 entirely and only generate tier 2 items.

Return ONLY a raw JSON array. No markdown, no code fences. Start with [ and end with ].

Example (country-level, 5 days, Colombo to Colombo, traveler wants scuba):
[{"title":"South Coast Loop","tagline":"Minimal travel, best beaches","tier":1,"category":"Route","icon":"🏖️","city":"Galle, Unawatuna, Hikkaduwa, Mirissa","days":["Colombo → Galle (2.5h drive)","Galle Fort walk and Unawatuna beach","Day trip to Hikkaduwa for scuba diving, back to Galle","Mirissa beach day and Coconut Tree Hill at sunset","Drive back to Colombo"],"bestFor":"Beach and diving lovers","warning":null,"recommended":true,"points":[{"text":"Hikkaduwa has excellent scuba sites for all levels","good":true},{"text":"Least time in transit of all routes","good":true},{"text":"No wildlife or hill country","good":false}]},{"title":"Hills + Beach","tagline":"Culture, tea country, then coast","tier":1,"category":"Route","icon":"🍃","city":"Kandy, Nuwara Eliya, Bentota","days":["Colombo → Kandy (3h)","Kandy: Temple of the Tooth + lake walk","Kandy → Nuwara Eliya, tea estates","Nuwara Eliya → Bentota (4.5h drive)","Bentota beach + back to Colombo"],"bestFor":"Variety seekers","warning":"Nuwara Eliya to Bentota is a long 4.5h drive","recommended":false,"points":[{"text":"No dedicated scuba — Bentota is calm, not a dive destination","good":false},{"text":"Best mix of culture and coast","good":true},{"text":"Long drive on day 4","good":false}]},{"title":"Mirissa Beach","city":"Mirissa","category":"Sightseeing","note":"Wide beach, whale watching from Nov to Apr","icon":"🐳","tier":2}]`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { destinations, styles, budget, travelMonth, numDays, arrivalCity, departureCity, notes } = await req.json();

    const budgetLabel = { budget: "budget", mid: "mid-range", luxury: "luxury" }[budget] || "mid-range";
    const stylesText = (styles || []).join(", ");

    const loopNote = (arrivalCity && departureCity && arrivalCity.toLowerCase() === departureCity.toLowerCase())
      ? `Arrival and departure city: ${arrivalCity} (loop trip).`
      : (arrivalCity && departureCity) ? `Arrives at ${arrivalCity}, departs from ${departureCity}.`
      : arrivalCity ? `Arrives at ${arrivalCity}.` : "";

    const userMessage =
      `Destination: ${destinations.join(", ")}.` +
      (numDays ? ` Trip duration: ${numDays} days.` : "") +
      (travelMonth ? ` Travel month: ${travelMonth}.` : "") +
      ` Trip style: ${stylesText || "general"}, ${budgetLabel} budget.` +
      (loopNote ? ` ${loopNote}` : "") +
      (notes ? `\n\nTraveler notes: ${notes}` : "") +
      `\n\nIf this is a country/region-level destination, generate 3–4 realistic route options (tier 1) first, then 15–20 specific experiences (tier 2). Only specific named places.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5000,
        temperature: 0.7,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error("Anthropic error: " + err);
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const event = JSON.parse(raw);
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                await writer.write(encoder.encode("data: " + JSON.stringify(event.delta.text) + "\n\n"));
              }
            } catch { /* ignore */ }
          }
        }
      } finally {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error("generate-brainstorm error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
