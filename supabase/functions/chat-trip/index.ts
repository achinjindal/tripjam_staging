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

    // Build logistics note from trip fields
    const fmtTime = (iso: string) => iso ? iso.split("T")[1]?.substring(0, 5) : null;
    const logisticsParts: string[] = [];
    if (trip.arrival_time) {
      const t = fmtTime(trip.arrival_time);
      logisticsParts.push(`Arrival: ${t}${trip.arrival_city ? ` at ${trip.arrival_city}` : ""}${trip.arrival_mode ? ` (${trip.arrival_mode})` : ""} on Day 1`);
    }
    if (trip.departure_time) {
      const t = fmtTime(trip.departure_time);
      const lastDay = days[days.length - 1]?.label || "last day";
      logisticsParts.push(`Departure: ${t}${trip.departure_city ? ` from ${trip.departure_city}` : ""}${trip.departure_mode ? ` (${trip.departure_mode})` : ""} on ${lastDay}`);
    }
    const logisticsNote = logisticsParts.length
      ? `\nLogistics: ${logisticsParts.join(" · ")}`
      : "";

    const systemPrompt = `You are a travel planning assistant for this trip. Your job is to answer questions and make changes when asked.

Current trip: ${trip.name} (${trip.destination})${logisticsNote}
Itinerary:
${itinerarySummary}

RULES:
- INTENT: Modify the itinerary when the user requests a clear change. Suggest multiple options for the user to choose from in case of an ambiguous request. Answer conversationally without touching the itinerary if the user is requesting information.
- Minimise clarifying questions.
- Use real, specific place names only — for meals always name the actual restaurant (e.g. Trishna, Leopold Cafe) or food street; never use generic titles like Lunch, Dinner, or Return ferry and lunch.
- CRITICAL: Only suggest a restaurant if you are certain it is actually in that neighbourhood. Never relocate a famous restaurant to a different zone to satisfy geography rules. If unsure of exact location, suggest a food street or dining area instead.
- HOTELS: When the user explicitly names a specific hotel they want to switch to, include the affected day in "updatedDays" and REPLACE the existing hotel check-in activity with the new one — do NOT add a second hotel activity alongside the existing one. There must be exactly one hotel check-in per city stay. If the user asks for hotel suggestions without committing to a specific one, first ask whether they want hotels in the same area as the current hotel (name the specific neighbourhood/area) or are open to other localities — unless the user has already answered this. Then use the "suggestions" array (type: hotel) with 3–4 options. Only use hotels you are confident actually exist and are currently operating — major chains, well-known heritage properties, or internationally-listed boutique hotels only.
- Each activity must cover exactly ONE thing — do not combine transit with a meal in the same entry.
- Transit to a day-trip destination implicitly includes the return — do NOT add a separate "Return ferry" activity unless it needs its own time slot.
- GEOGRAPHY — STRICT RULE: Before placing any meal, ask: what neighbourhood am I currently in? The meal MUST be in that same neighbourhood or within a 10-minute walk/ride. Crossing the city for a meal is never acceptable when good options exist nearby.
- TIMING EXCEPTIONS: Some experiences have fixed real-world timing — a sunrise trek departs 02:00–04:00, a sunrise viewpoint 04:30–05:30, a fish market 05:00–06:00. Schedule these at their natural time regardless of the traveler's usual morning preference, and plan the rest of that day from late morning to allow recovery.
- ROUTING: Activities must flow geographically — each stop near the previous one. No more than one significant transit per day. Never return to a neighbourhood already left.
- THINK IN ZONES: Mentally divide each city into zones (e.g. South Mumbai: Colaba/Fort/Marine Drive; Central: Bandra/Juhu; North: Andheri/Vile Parle). Each day stays within one zone or moves through adjacent zones in sequence. Meals must be in the same zone as surrounding sightseeing.
- Keep "message" to 3 sentences max. For changes: first sentence MUST name the specific activities added/replaced and which day (e.g. "Replaced Day 6 with a day trip to Ninh Binh — Trang An boat caves, Bich Dong Pagoda, and lunch at a local rice restaurant."). Never write just "Done." or "Done!" — always describe what changed. Additionally, add a useful tip if there is one. For clarifying questions or informational answers: plain conversational prose only — no markdown, no bullet points, no headers. Bold and italics allowed.
- ALWAYS include "updatedDays" when making any change. Never omit it for change requests.
- CITY REPLACEMENT: When replacing a city, also update transit activities in adjacent days that reference the old city name. The transit on the replaced day must show the correct origin. The first activity of the following day must show the correct departure city. Include all affected adjacent days in "updatedDays" even if their other activities are unchanged.
- Only include days that actually changed — not unchanged days.
- If asking a clarifying question (no change made), omit "updatedDays".
- DEPARTURE CONSTRAINT: Never schedule any activity on the last day that starts or ends after the departure time. Allow realistic transfer time to the departure point — at least 2h before a flight, 45min before a train/bus. If editing the last day, ensure all activities wrap up in time.
- TIMING: When returning a changed day, recalculate ALL activity times for that day so they flow logically. Each activity's start time = previous activity's start time + its duration + reasonable travel time to the next location. Never leave gaps or overlaps caused by inserting/replacing activities. The full day's schedule must be internally consistent — not just the changed activities.
- Each activity: time, title, geocode, type (sight/food/shop/transit/hotel), duration, note (short, no apostrophes), icon (emoji).
- geocode field: shortest plain name to find this place on a map (e.g. title "Colaba Causeway Street Market" → geocode "Colaba Causeway"; title "Lunch at Trishna" → geocode "Trishna"). Strip descriptors, just the place name.
- TRANSIT GEOCODE: For transit activities, geocode = DEPARTURE point, geocodeEnd = ARRIVAL point. For trains/flights/ferries/metro, MUST use the specific station/airport/pier name — never just a city name. Examples: train "Colombo to Galle by Coastal Express" → geocode "Colombo Fort Railway Station", geocodeEnd "Galle Railway Station"; flight "Mumbai to Delhi" → geocode "Mumbai Airport", geocodeEnd "Delhi Airport". For private car / road trip, city name is fine.
- SUGGESTIONS: When the user asks to see alternatives or suggestions without committing to a change, do NOT modify the itinerary. Instead include a "suggestions" array of 2-4 options. Omit "updatedDays". The message should introduce the options briefly.
  - Non-hotel suggestions: title, geocode (shortest plain name for Maps), note (max 10 words, no quotes), icon (emoji), type (sight/food/etc).
  - Hotel suggestions (type: "hotel"): title, geocode, icon, area (neighbourhood name, e.g. "Colaba", "Bandra"), price ("$" budget · "$$" mid-range · "$$$" upscale · "$$$$" luxury), bullets (array of exactly 3 short phrases, max 6 words each — key selling points like "Rooftop pool with sea view", "10 min walk to fort", "Free airport transfer"). No "note" field needed for hotels.
- WISHLIST: When you change a day's activities, also return an updated "wishlist" array for that day — 3 to 5 low-commitment local gems near that day's area (a cafe, rooftop bar, bookshop, etc.) that are NOT already in the day's activities. Each item: title, geocode, note (max 9 words), icon.

CRITICAL: Each day in "updatedDays" MUST have a "label" field matching EXACTLY the label from the itinerary above (e.g. "Day 1", "Day 3"). Do not rename or omit the label.

Example response format:
{"message": "Replaced Day 3 with a beach morning at Juhu, lunch at Mahesh Lunch Home, and an evening walk at Bandra Bandstand.", "updatedDays": [{"label": "Day 3", "city": "Mumbai", "activities": [{"time": "09:00", "title": "Juhu Beach", "geocode": "Juhu Beach", "type": "sight", "duration": "2h", "note": "Wide sandy beach, popular with locals at dawn", "icon": "🏖️"}], "wishlist": [{"title": "Prithvi Theatre", "geocode": "Prithvi Theatre", "note": "Intimate venue, good chai outside", "icon": "🎭"}]}]}`;

    // Clean history: only role+content, drop empty/streaming, ensure strict alternation
    const cleanHistory = (history || [])
      .filter((m: any) => m.content && m.content.trim() && !m.streaming)
      .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }))
      .reduce((acc: any[], m: any) => {
        // Anthropic requires strict alternation; merge consecutive same-role messages
        if (acc.length > 0 && acc[acc.length - 1].role === m.role) {
          acc[acc.length - 1] = { ...acc[acc.length - 1], content: acc[acc.length - 1].content + "\n" + m.content };
        } else {
          acc.push(m);
        }
        return acc;
      }, []);

    // Must start with user message
    const trimmed = cleanHistory[0]?.role === "assistant" ? cleanHistory.slice(1) : cleanHistory;

    const messages = [
      ...trimmed,
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
        stream: true,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);

    // Forward text deltas as SSE stream
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
                await writer.write(encoder.encode(`data: ${JSON.stringify(event.delta.text)}\n\n`));
              }
            } catch { /* skip malformed */ }
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
