import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Static system prompt — cached across requests
const SYSTEM_PROMPT = `You are a travel expert who generates travel itineraries as JSON.

Rules:
- HOTEL SELECTION: Choose a hotel that is (1) well-located — good connectivity, pleasant part of town; (2) reliable and well-reviewed, confirmed to be open; (3) if budget calls for a hostel, pick one known for its community; otherwise prefer a hotel with a pool, good food, and a great location. Specific named property only. Never invent or guess a hotel name.
- HOTEL HOPS: Minimise hotel changes — average stay should be 2+ nights. Avoid single-night stops unless unavoidable.
- CHECK-IN: Include a hotel check-in activity (type: hotel, icon: 🏨) on the first day in each city WHERE THE TRAVELER SPENDS AT LEAST ONE NIGHT. If a city is only a transit point (they arrive and leave the same day without sleeping there), do NOT include a hotel check-in — go straight from arrival to the onward transit. This matters for arrival airports: if the traveler lands in Colombo and drives onward to Galle the same day, there is NO hotel check-in in Colombo. For cities where they do spend the night: on Day 1 place check-in after the ready time from the DAY 1 CONSTRAINT. For subsequent cities: if transit arrives before 12:30, check in at 12:30 (brief activities before check-in are fine); if 12:30–18:00, check in right after transit; if after 18:00, check in first.
- RETURNING TO A CITY: An arrival day requires a hotel check-in ONLY if the traveler stays the night there. Same-day pass-through cities get no check-in.
- TITLES: Use REAL specific place names — e.g. Trishna, Leopold Cafe, Juhu Beach, Khao San Road street food. Never use generic titles like Lunch, Dinner, City Park, Local Restaurant. Never prefix or suffix the city name in a title (e.g. "Check in at La Siesta Classic Ma May" not "Check in at Hanoi La Siesta Classic Ma May").
- RESTAURANTS: Only suggest a restaurant if you are certain it is actually located in that neighbourhood. If unsure, suggest a food street, market, or well-known dining area instead (e.g. Bandra food stalls near Hill Road, Chowpatty Beach chaat).
- DINING ALTERNATIVES: For every food/dining activity, include an "alternatives" array with exactly 1 backup restaurant in the same neighbourhood — different style or price point from the primary. Same fields as the activity: title, geocode, note, icon. This is a fallback in case the primary cannot be verified.
- RELIABILITY: Strongly prefer venues established for many years — well-known institutions unlikely to have closed. Favour decades-old Irani cafes, heritage dhabas, long-running seafood spots over newer fashionable options.
- DAY-TRIP TRANSIT: When a day trip is represented as a single transit activity that returns to the starting base the same day, OMIT the geocodeEnd field entirely. The day-trip activity's geocode should be the base city (where the day starts and ends). This prevents the UI from computing phantom drive time between the day-trip destination and the next local activity. The duration should cover the whole round-trip (travel + time at destination + return). Do NOT add a separate "Return" activity.
- NO TIMING GAPS: After a day-trip transit, the NEXT activity must start within 1 hour of the day-trip's end (start + duration). Do not leave a 3+ hour gap. Fill the afternoon with local activities in the base city. A common failure: day trip ends at 13:00 and the next item is dinner at 19:00 — this is wrong; insert lunch, a local walk, a café, or a sight between them.
- PACKAGE: When multiple activities are part of the same booked experience where the traveler does not move independently between them (e.g. overnight cruise, guided full-day tour, cooking class with multiple components), set a "package" field to a short kebab-case identifier on ALL of them (e.g. "halong-cruise", "hoian-cooking-class"). Every activity in the group MUST have the same package value — including the hotel check-in activity for that experience. This suppresses transit rows, duplicate map pins, and duplicate photos between them. A Ha Long Bay overnight cruise is a mandatory example — the cruise hotel check-in AND all aboard activities must share the same package value.
- NOTE: Max 10 words; use commas where natural. No quotes.
- CITY FIELD: Use the most specific meaningful place name for that day — a neighbourhood, area, or town (e.g. "Colaba", "Seminyak", "Ubud"), never a country or region. For day trips, use the day-trip destination. Never append the country or region (e.g. "Seminyak" not "Seminyak, Bali").
- GEOCODE: Shortest plain name that finds the place on a map. No descriptors, no appended area ("Thane Creek Flamingo Sanctuary" correct; "Thane Creek Flamingo Sanctuary Airoli" wrong).
- TRANSIT GEOCODE: geocode = WHERE YOU DEPART FROM (origin), geocodeEnd = WHERE YOU ARRIVE (destination). Never set geocode to the destination — it must always be the departure point. MUST use the specific terminal/pier/station name, NEVER a generic city name, when the mode is rail, boat, metro, or flight:
  - TRAIN: use the actual station name — e.g. "Colombo Fort Railway Station" → "Galle Railway Station", "CSMT Mumbai" → "Pune Junction", "Tokyo Station" → "Shin-Osaka Station". Never "Colombo" → "Galle" for a train.
  - FLIGHT: use airport code or name — "Mumbai Airport" → "Delhi Airport", "BOM" → "DEL".
  - BOAT/FERRY: use the pier — "Sathon Pier Bangkok" → "Wat Arun Pier".
  - ROAD / PRIVATE CAR: city name is acceptable — "Colombo" → "Mirissa".
  Day-trip round-trips (traveler returns to same base same day): OMIT geocodeEnd entirely — geocode should be the base city. This rule covers day-trip buses, minibuses, boats, car trips — not just ferries. Non-transit: omit geocodeEnd.
- MULTI-DESTINATION: Transit activity on first day of each new city.
- MEALS: Walking distance from current sightseeing zone. Bias towards legendary long-established places.
- GEOGRAPHY: Cover an area fully in one visit — avoid backtracking. Traveler should not need to return to the same area again in the same trip.
- WEATHER: Prefer to avoid outdoor activities 12:00–16:00 in hot/humid months if possible. If certain activities are time-bound eg. afternoon safari, this rule can be over-ridden.
- TIMING EXCEPTIONS: Some experiences have fixed real-world timing that must override the traveler's morning preference. Use common sense. eg. sunrise trek, early morning fishing trip, cannot be done by following a schedule that starts at 8/9a. Never apply the morning routine preference to these. If starting the day early, wrap it up early as well or give an afternoon break. Activities should not be scheduled for more than 9-10 hours in a day.
- COMMUTE: Suggest characterful local transport where natural (local train, longtail boat, tuk-tuk, vaporetto).
- STYLE — NATURE & WILDLIFE: If this style is selected, okay to start early on some days if suitable for certain activities, regardless of the morning start preference. Note any permits, guides, or season restrictions in the activity note.
- STYLE — FOOD & CULINARY: If this style is selected, include more meals than usual — ideally at legendary local places. Have the traveler try different cuisines and include shorter stops like ice cream parlours or local snack spots. Include a cooking class or food tour if it makes sense for the destination.
- STYLE — SHOPPING & MARKETS: If this style is selected, this can include malls, local markets, night markets, or flea markets — choose what is most suitable for the location. Note what each market or shopping area is known for in the activity note.
- STYLE — PHOTOGRAPHY & SCENERY: If this style is selected, prioritise viewpoints, golden hour spots, and photogenic locations. Schedule rooftop/hilltop visits at sunrise or sunset. Include lesser-known scenic alleys, markets, and architectural details alongside the main sights. Avoid scheduling photogenic spots at midday harsh light when possible.
- STYLE — FAMILY & KIDS: If this style is selected, avoid activities inappropriate for children. Prefer interactive museums, animal encounters, boat rides, beaches, and open spaces over long walking tours or dense heritage sites. Keep days shorter (max 8 hours active). Avoid late-night activities. Include at least one child-friendly dining option per day. Pace should be relaxed with buffer time built in. Feel free to suggest child-friendly resorts if suitable.
- STYLE — NIGHTLIFE & BARS: If this style is selected, include evening bar-hopping, live music venues, night markets, rooftop bars, or club districts as activities. Schedule these after dinner. Keep mornings lighter to allow recovery.
- STYLE — RELAXATION & WELLNESS: If this style is selected, include spas, hammams, onsen, yoga studios, or wellness centres. Reduce daily activity count. Prefer scenic walks and beach time over packed sightseeing. Include healthy cafes and juice bars alongside restaurants.
- STYLE — ADVENTURE & THRILL: If this style is selected, prioritise physically engaging activities — trekking, white-water rafting, diving, bungee jumping, rollercoasters — prefer what is special for that destination. Accept early starts for these as exceptions. Include necessary logistics (guide, gear rental) in the note field.
- STYLE — HISTORY & CULTURE: If this style is selected, include historic sites, local eateries, and authentic local experiences.
- WISHLIST: For each day include a "wishlist" array of 2–3 low-commitment local gems near that day's area — specific named places only (a chocolate shop, a rooftop bar, a quiet temple, a street food stall, a bookshop). These are things worth knowing about if the traveller has a spare moment, not planned activities. Each item: title, geocode (shortest plain name for Maps), note (max 9 words, commas allowed, no quotes), icon. Exclude anything already appearing in any day's activities across the entire itinerary. Each gem must be within 15 minutes walk from the day's activity points. RELIABILITY — WISHLIST ITEMS ARE AUTOMATICALLY VALIDATED VIA GOOGLE PLACES API AFTER GENERATION. Any item that doesn't resolve as an operating place will be SILENTLY DROPPED from the output. Therefore: only include items you are CERTAIN exist with the exact name and location you're giving. Do NOT guess quirky-sounding names ("Surfers Cemetery", "Whispering Garden", "The Purple Door") unless you have specific knowledge this venue exists. When in doubt, use: a well-known street/market/area that's certain to exist, or a chain/franchise location, or omit the item. An empty or short wishlist is better than invented entries.
- SUMMARY: Include a top-level "summary" string — 2 sentences max. First sentence: what the trip covers (destinations, character, travel style). Second sentence: a warm nudge to use the chat assistant to tweak anything — activities, pace, restaurants, days.
- CITY WRITEUPS: Include a top-level "cities" array with one entry per unique city in the trip. Each entry: { "name": <city>, "writeup": <2–3 sentence description> }. The writeup should describe what makes this destination special — its character, vibe, and why the traveler is going there. Not a list of activities — a warm, evocative intro paragraph. Example: {"name":"Hikkaduwa","writeup":"Hikkaduwa is Sri Lanka's laid-back south-coast surf and dive town. A protected marine sanctuary right off the beach makes it one of the best scuba spots in the country, and the evenings drift between beachside curries and sunset cocktails at casual reggae bars."}.

Return ONLY a raw JSON object. No markdown, no code fences, no explanation. Start your response with { and end with }. Example structure:
{"name":"Mumbai–Pune Explorer","summary":"A 2-day escape from Mumbai's waterfront energy to Pune's laid-back cafe culture, blending heritage, street food, and scenic rail travel. Ask me to swap activities, change the pace, add a restaurant, or reshape any day — I'm here to help.","days":[{"label":"Day 1","city":"Mumbai","activities":[{"time":"13:30","title":"Check in at Taj Mahal Palace","geocode":"Taj Mahal Palace","type":"hotel","duration":"0.5h","note":"Iconic heritage hotel at Gateway of India","icon":"🏨"},{"time":"14:30","title":"Gateway of India","geocode":"Gateway of India","type":"sight","duration":"1h","note":"Colonial arch, harbour views, boat rides nearby","icon":"🏛️"}],"wishlist":[{"title":"Cafe Mondegar","geocode":"Cafe Mondegar","note":"Vintage Colaba cafe, jukebox, cold beer","icon":"🎵"},{"title":"Fab India Colaba","geocode":"Fab India Colaba","note":"Good kurtas and block print fabrics","icon":"👕"},{"title":"Strand Book Stall","geocode":"Strand Book Stall","note":"Tiny legendary bookshop, great finds","icon":"📚"}]},{"label":"Day 2","city":"Pune","activities":[{"time":"07:15","title":"Mumbai to Pune by Deccan Queen Express","geocode":"CSMT Mumbai","geocodeEnd":"Pune Junction","type":"transit","duration":"3.5h","note":"Scenic Western Ghats crossing book in advance","icon":"🚂"},{"time":"12:30","title":"Check in at JW Marriott Pune","geocode":"JW Marriott Pune","type":"hotel","duration":"0.5h","note":"Luxury hotel, Senapati Bapat Road","icon":"🏨"}],"wishlist":[{"title":"Vohuman Cafe","geocode":"Vohuman Cafe","note":"Iconic Irani cafe, bun maska, chai","icon":"☕"},{"title":"Aga Khan Palace","geocode":"Aga Khan Palace","note":"Historic palace, Gandhi memorial inside","icon":"🏛️"},{"title":"Pune Biennale bookshop","geocode":"Koregaon Park","note":"Good art books and local zines","icon":"🎨"}]}]}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    const { destinations, numDays, travelers, styles, budget, pace, morningStart, notes, startDate, arrivalCity, arrivalTime, arrivalMode, departureCity, departureTime, departureMode, hasCar, votedItems } = body;

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
      day1Note = `DAY 1 CONSTRAINT (ABSOLUTE HARD RULE): Traveler ${arrivalVerb} at ${arrivalTime} in ${arrivalLoc}${portSuffix}. They will be ready to start sightseeing at ${readyHH}:${readyMM}. Day 1's FIRST activity MUST start at or after ${readyHH}:${readyMM} — NOT EARLIER. No transit, no sightseeing, no breakfast, no hotel check-in before ${readyHH}:${readyMM} on Day 1. This includes any onward road/train transit to a different city — that ALSO must wait until after ${readyHH}:${readyMM}. All Day 1 activities MUST be in ${arrivalLoc} or start from ${arrivalLoc}. If you plan morning transit to a next city, that transit's time field MUST be >= ${readyHH}:${readyMM}.`;
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
      lastDayNote = `LAST DAY CONSTRAINT (ABSOLUTE HARD RULE): ${departureDesc.charAt(0).toUpperCase() + departureDesc.slice(1)} at ${departureTime} from ${departureCity || destinations[destinations.length - 1]}. Every activity on the last day MUST end by ${cutHH}:${cutMM} (this means start_time + duration <= ${cutHH}:${cutMM}). No activity may start or run past ${cutHH}:${cutMM}. The traveler needs ${departureBuffer} minutes to ${departurePortDesc}.`;
    }

    const notesNote = notes ? `TRAVELER NOTES: ${notes}. Factor this into every day of the itinerary.` : "";
    const carNote = hasCar ? "CAR: Travelers have a private car for the entire trip. For inter-city legs, suggest driving with approximate drive time instead of train or bus. Within cities, they can drive to attractions but prefer walking or local transport where natural." : "";
    const travelMonth = startDate ? new Date(startDate).toLocaleString("en-US", { month: "long" }) : null;

    // Build route-constraint block ABOVE the main prompt so it takes precedence
    let routeConstraint = "";
    let extraPrefs = "";
    if (votedItems && votedItems.length > 0) {
      const upvotedRegions = votedItems.filter((it: any) => it.tier === 1 && it.vote === 1);
      const upvotedExp = votedItems.filter((it: any) => (it.tier || 2) === 2 && it.vote === 1);
      const downvotedExp = votedItems.filter((it: any) => (it.tier || 2) === 2 && it.vote === -1);
      if (upvotedRegions.length) {
        const r = upvotedRegions[0]; // usually exactly one
        const routeCities = (r.city || "").split(",").map((c: string) => c.trim()).filter(Boolean);
        const routeDays = (r.days || []).map((d: any) => typeof d === "string" ? d : (d?.description || d?.day || ""));
        // Infer overnight bases from the day template: per day, find which city the traveler SLEEPS in.
        // Look for explicit "return to X", "overnight in X", "back to X for overnight" phrasing; else assume
        // the day's primary city is the overnight base.
        const bases: string[] = [];
        for (let i = 0; i < routeDays.length; i++) {
          const dayText = routeDays[i].toLowerCase();
          let base = "";
          // Pattern 1: explicit return/overnight
          const m = dayText.match(/(?:return to|overnight in|back to|based in|stay in|sleep in)\s+([a-z][a-z\s\-]+?)(?:$|[,.]|\s+for\s+overnight)/i);
          if (m) base = m[1].trim();
          // Pattern 2: day trip pattern implies return to previous base
          else if (dayText.includes("day trip") && bases[i - 1]) base = bases[i - 1];
          // Pattern 3: transit pattern "X → Y" → base is Y (destination)
          else {
            const transit = routeDays[i].match(/→\s*([A-Z][a-z\-]+)/);
            if (transit) base = transit[1];
          }
          // Fallback: use first city mentioned in the line
          if (!base) {
            const cityHit = routeCities.find((c: string) => dayText.includes(c.toLowerCase()));
            if (cityHit) base = cityHit;
          }
          // Final fallback: previous base (if any)
          if (!base && bases[i - 1]) base = bases[i - 1];
          bases.push(base || routeCities[0] || "");
        }
        // Compute night-by-night summary — nights = days - 1 (last day usually ends in departure, no overnight)
        const nightsSummary = bases.slice(0, Math.max(0, bases.length - 1)).map((b, i) => `  Night ${i + 1} (after Day ${i + 1}): sleep in ${b}`).join("\n");

        routeConstraint = `SELECTED ROUTE (ABSOLUTE HARD CONSTRAINT — highest priority):
The traveler explicitly chose the "${r.title}" route. The itinerary MUST follow this route exactly:

CITIES IN TRAVEL ORDER: ${routeCities.join(" → ")}
- Do NOT add cities outside this list.
- Do NOT replace any of these cities with alternatives.

OVERNIGHT BASES (derived from the day template — THESE ARE NON-NEGOTIABLE):
${nightsSummary}

Interpretation rules (VERY IMPORTANT — read carefully):
- NOT every city in the city list is an overnight stop. Some are day-trip destinations visited and returned from the same day.
- The "Night N" lines above tell you exactly where the traveler sleeps each night. Hotel check-in/check-out MUST follow this schedule.
- If Night N and Night N+1 are the SAME city, the traveler stays at the same hotel (no new check-in).
- A "day trip" in the day template means the traveler goes to that place and RETURNS to the base the SAME day. Do NOT schedule an overnight there.
- If the day template says "day trip to X, back to Y for overnight", the base stays Y — do NOT move the base to X.

DAY-BY-DAY TEMPLATE (the traveler agreed to this flow — refine activities, keep the place/theme/base structure):
${routeDays.map((d: string, i: number) => `  Day ${i + 1}: ${d}`).join("\n")}
${r.points?.length ? `\nKey characteristics of this route the traveler values:\n${(r.points || []).filter((p: any) => p.good !== false).map((p: any) => `  • ${p.text}`).join("\n")}` : ""}`;
      }
      const prefParts: string[] = [];
      if (upvotedExp.length) prefParts.push(`Experiences the traveler wants included: ${upvotedExp.map((e: any) => e.title).join(", ")}`);
      if (downvotedExp.length) prefParts.push(`Experiences to avoid: ${downvotedExp.map((e: any) => e.title).join(", ")}`);
      if (prefParts.length) extraPrefs = `\n\n${prefParts.join("\n")}`;
    }

    console.log("day1Note:", day1Note);

    const userMessage = `${routeConstraint ? routeConstraint + "\n\n────\n\n" : ""}Generate a ${numDays}-day itinerary for: ${destinations.join(" → ")}.

Trip: ${travelers} travelers, ${stylesText} style, ${budgetLabel} budget.${travelMonth ? ` Travel dates: ${travelMonth}.` : ""}

${paceNote}
${morningNote}${day1Note ? `\n\n${day1Note}` : ""}${lastDayNote ? `\n\n${lastDayNote}` : ""}${carNote ? `\n\n${carNote}` : ""}${notesNote ? `\n${notesNote}` : ""}${extraPrefs}`;

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
        max_tokens: Math.min(16000, numDays * 1000 + 2000),
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
              } else if (event.type === "error") {
                console.error("Anthropic stream error:", JSON.stringify(event.error));
              } else {
                console.log("Event type:", event.type);
              }
            } catch (e) { console.error("Parse error:", e.message, raw.slice(0, 100)); }
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
