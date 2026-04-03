import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Static system prompt — cached across requests
const SYSTEM_PROMPT = `You are a travel expert who generates travel itineraries as JSON.

Rules:
- HOTEL CHECK-IN: Include a hotel check-in activity (type: hotel, icon: 🏨) on the first day in each city — mandatory, never skip. For Day 1: place check-in after the ready time from the DAY 1 CONSTRAINT. For subsequent cities: if transit arrives before 12:30, check in at 12:30; if 12:30–18:00, check in right after transit; if after 18:00, check in first. Use a real, well-established, highly-rated hotel matching the budget — specific named property only.
- TITLES: Use REAL specific place names — e.g. Trishna, Leopold Cafe, Juhu Beach, Khao San Road street food. Never use generic titles like Lunch, Dinner, City Park, Local Restaurant.
- RESTAURANTS: Only suggest a restaurant if you are certain it is actually located in that neighbourhood. If unsure, suggest a food street, market, or well-known dining area instead (e.g. Bandra food stalls near Hill Road, Chowpatty Beach chaat).
- DINING ALTERNATIVES: For every food/dining activity, include an "alternatives" array with exactly 2 backup restaurants in the same neighbourhood — different style or price point from the primary. Same fields as the activity: title, geocode, note, icon. These are fallbacks in case the primary cannot be verified.
- RELIABILITY: Strongly prefer venues established for many years — well-known institutions unlikely to have closed. Favour decades-old Irani cafes, heritage dhabas, long-running seafood spots over newer fashionable options. For hotels: only name properties you are confident actually exist and are currently operating — major chain hotels, well-known heritage properties, or internationally-listed boutique hotels. Never invent or guess a hotel name.
- DAY-TRIP TRANSIT: Includes return if it is a single activity — do not add a separate Return activity if possible.
- NOTE: Max 10 words; use commas where natural. No quotes. Describe the place or experience — never give timing advice like "arrive early", "go at opening", "avoid midday heat" (the time field handles scheduling).
- CITY FIELD: Use the most specific meaningful place name for that day — a neighbourhood, area, or town (e.g. "Colaba", "Seminyak", "Ubud"), never a country or region. For day trips, use the day-trip destination. Never append the country or region (e.g. "Seminyak" not "Seminyak, Bali").
- GEOCODE: Shortest plain name that finds the place on a map. No descriptors, no appended area ("Thane Creek Flamingo Sanctuary" correct; "Thane Creek Flamingo Sanctuary Airoli" wrong).
- TRANSIT GEOCODE: geocode = departure point, geocodeEnd = arrival point. Use specific terminal/pier/station name (e.g. train: geocode "CSMT Mumbai", geocodeEnd "Pune Junction"; boat: geocode "Sathon Pier Bangkok", geocodeEnd "Wat Arun Pier"). Day-trip ferries returning to same pier: omit geocodeEnd. Non-transit: omit geocodeEnd.
- MULTI-DESTINATION: Transit activity on first day of each new city.
- MEALS: Walking distance from current sightseeing zone. Bias towards legendary long-established places.
- GEOGRAPHY: Cover an area fully in one visit — avoid backtracking. Traveler should not need to return to the same area again.
- WEATHER: No outdoor activities 12:00–16:00 in hot/humid months. Indoor activities fine in afternoon heat.
- TIMING EXCEPTIONS: Some experiences have fixed real-world timing that must override the traveler's morning preference. Use common sense — a sunrise trek departs 02:00–04:00, a sunrise viewpoint visit 04:30–05:30, a fish market 05:00–06:00, a dawn temple ritual at its stated hour. Schedule the rest of that day from late morning to allow recovery. Never apply the morning routine preference to these.
- COMMUTE: Suggest characterful local transport where natural (local train, longtail boat, tuk-tuk, vaporetto).
- HOTEL HOPS: Minimise hotel changes — average stay should be 2+ nights. Avoid single-night stops unless unavoidable.
- WISHLIST: For each day include a "wishlist" array of 3–5 low-commitment local gems near that day's area — specific named places only (a chocolate shop, a rooftop bar, a quiet temple, a street food stall, a bookshop). These are things worth knowing about if the traveller has a spare moment, not planned activities. Each item: title, geocode (shortest plain name for Maps), note (max 9 words, commas allowed, no quotes), icon. Exclude anything already appearing in any day's activities across the entire itinerary. Each gem must be within 15 minutes walk from the day's activity points. RELIABILITY applies here too — only suggest wishlist items you are confident actually exist. No invented or uncertain venues; if unsure, suggest a well-known street, market, or area instead.
- SUMMARY: Include a top-level "summary" string — 2 sentences max. First sentence: what the trip covers (destinations, character, travel style). Second sentence: a warm nudge to use the chat assistant to tweak anything — activities, pace, restaurants, days.

Return ONLY a raw JSON object. No markdown, no code fences, no explanation. Start your response with { and end with }. Example structure:
{"name":"Mumbai–Pune Explorer","summary":"A 2-day escape from Mumbai's waterfront energy to Pune's laid-back cafe culture, blending heritage, street food, and scenic rail travel. Ask me to swap activities, change the pace, add a restaurant, or reshape any day — I'm here to help.","days":[{"label":"Day 1","city":"Mumbai","activities":[{"time":"13:30","title":"Check in at Taj Mahal Palace","geocode":"Taj Mahal Palace Mumbai","type":"hotel","duration":"0.5h","note":"Iconic heritage hotel at Gateway of India","icon":"🏨"},{"time":"14:30","title":"Gateway of India","geocode":"Gateway of India","type":"sight","duration":"1h","note":"Colonial arch, harbour views, boat rides nearby","icon":"🏛️"}],"wishlist":[{"title":"Cafe Mondegar","geocode":"Cafe Mondegar Mumbai","note":"Vintage Colaba cafe, jukebox, cold beer","icon":"🎵"},{"title":"Fab India Colaba","geocode":"Fab India Colaba Mumbai","note":"Good kurtas and block print fabrics","icon":"👕"},{"title":"Strand Book Stall","geocode":"Strand Book Stall Mumbai","note":"Tiny legendary bookshop, great finds","icon":"📚"}]},{"label":"Day 2","city":"Pune","activities":[{"time":"07:15","title":"Mumbai to Pune by Deccan Queen Express","geocode":"CSMT Mumbai","geocodeEnd":"Pune Junction","type":"transit","duration":"3.5h","note":"Scenic Western Ghats crossing book in advance","icon":"🚂"}],"wishlist":[{"title":"Vohuman Cafe","geocode":"Vohuman Cafe Pune","note":"Iconic Irani cafe, bun maska, chai","icon":"☕"},{"title":"Aga Khan Palace","geocode":"Aga Khan Palace Pune","note":"Historic palace, Gandhi memorial inside","icon":"🏛️"},{"title":"Pune Biennale bookshop","geocode":"Koregaon Park Pune","note":"Good art books and local zines","icon":"🎨"}]}]}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    const { destinations, numDays, travelers, styles, budget, pace, morningStart, notes, startDate, arrivalCity, arrivalTime, arrivalMode, departureCity, departureTime, departureMode, hasCar } = body;

    const budgetLabel = { budget: "budget (hostels, street food)", mid: "mid-range (3-star hotels, local restaurants)", luxury: "luxury (5-star hotels, fine dining)" }[budget] || "mid-range";
    const stylesText = styles.join(", ");
    const paceNote = pace === "relaxed"
      ? "PACE: This is a relaxed trip. Plan 4-5 activities per day, with gaps for rest, wandering, or sitting at a cafe. Do not pack the day."
      : "PACE: This is an active trip. Aim for 5-7 activities per day — push toward the higher end unless an activity is genuinely long (3h+). Make good use of the time available and plan till dinner.";
    const morningNote = morningStart === "late"
      ? "MORNING ROUTINE: These travelers like a slow start. On days without an arrival constraint, the first activity should not begin before 10:30–11:00. Build in time for a leisurely breakfast. Only start earlier if there is a genuinely unmissable reason (e.g. sunrise at a landmark, avoiding extreme midday heat, timed entry)."
      : "MORNING ROUTINE: These travelers are early birds. From Day 2 onwards, first activity can start at 08:00–09:00 to beat crowds and enjoy the cool morning. Plan till dinner with breaks as needed.";

    // Buffers by travel mode
    const arrivalBuffers:  Record<string,number> = { flight: 90, train: 45, bus: 20, road: 20 };
    const departureBuffers: Record<string,number> = { flight: 150, train: 60, bus: 30, road: 30 };
    const arrivalBuffer  = arrivalBuffers[arrivalMode  ?? "flight"] ?? 90;
    const arrivalVerb    = { flight: "lands", train: "arrives by train", bus: "arrives by bus", road: "arrives by road" }[arrivalMode ?? "flight"] ?? "arrives";
    const arrivalPort    = { flight: "airport", train: "station", bus: "bus station", road: "" }[arrivalMode ?? "flight"] ?? "";

    let day1Note = "";
    if (arrivalTime) {
      const [h, m] = arrivalTime.split(":").map(Number);
      const rawReady = h * 60 + m + arrivalBuffer;
      const readyMins = Math.round(rawReady / 30) * 30;
      const readyHH = String(Math.floor(readyMins / 60) % 24).padStart(2, "0");
      const readyMM = String(readyMins % 60).padStart(2, "0");
      const arrivalLoc = arrivalCity || destinations[0];
      const portSuffix = arrivalPort ? ` ${arrivalPort}` : "";
      day1Note = `DAY 1 CONSTRAINT: Traveler ${arrivalVerb} at ${arrivalTime} in ${arrivalLoc}${portSuffix}. They will be ready to start sightseeing at ${readyHH}:${readyMM}. NOTHING may be scheduled before ${readyHH}:${readyMM} on Day 1 — no morning sightseeing, no breakfast, no hotel check-in before this time. All Day 1 activities MUST be in ${arrivalLoc}.`;
    }

    const departureBuffer = departureBuffers[departureMode ?? "flight"] ?? 150;
    const departureDesc = { flight: "return flight departs", train: "return train departs", bus: "return bus departs", road: "travelers depart by road" }[departureMode ?? "flight"] ?? "return departs";
    const departurePortDesc = { flight: "travel to the airport and check in", train: "travel to the station", bus: "travel to the bus station", road: "pack up and begin the drive" }[departureMode ?? "flight"] ?? "depart";

    let lastDayNote = "";
    if (departureTime) {
      const [h, m] = departureTime.split(":").map(Number);
      const cutoffMins = h * 60 + m - departureBuffer;
      const cutHH = String(Math.floor(cutoffMins / 60) % 24).padStart(2, "0");
      const cutMM = String(cutoffMins % 60).padStart(2, "0");
      lastDayNote = `LAST DAY CONSTRAINT: ${departureDesc.charAt(0).toUpperCase() + departureDesc.slice(1)} at ${departureTime} from ${departureCity || destinations[destinations.length - 1]}. All activities on the last day must end by ${cutHH}:${cutMM} to allow time to ${departurePortDesc}.`;
    }

    const notesNote = notes ? `TRAVELER NOTES: ${notes}. Factor this into every day of the itinerary.` : "";
    const carNote = hasCar ? "CAR: Travelers have a private car for the entire trip. For inter-city legs, suggest driving with approximate drive time instead of train or bus. Within cities, they can drive to attractions but prefer walking or local transport where natural." : "";
    const travelMonth = startDate ? new Date(startDate).toLocaleString("en-US", { month: "long" }) : null;

    console.log("day1Note:", day1Note);

    const userMessage = `Generate a ${numDays}-day itinerary for: ${destinations.join(" → ")}.

Trip: ${travelers} travelers, ${stylesText} style, ${budgetLabel} budget.${travelMonth ? ` Travel dates: ${travelMonth}.` : ""}

${paceNote}
${morningNote}${day1Note ? `\n\n${day1Note}` : ""}${lastDayNote ? `\n\n${lastDayNote}` : ""}${carNote ? `\n\n${carNote}` : ""}${notesNote ? `\n${notesNote}` : ""}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(12000, numDays * 800 + 1200),
        temperature: 0.8,
        stream: true,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          { role: "user", content: userMessage },
        ],
      }),
    });

    console.log("Anthropic response status:", response.status);
    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      throw new Error(`Anthropic error: ${err}`);
    }

    // Forward text deltas as simple SSE stream
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
            } catch { /* skip malformed events */ }
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
    console.error("Function error:", err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
