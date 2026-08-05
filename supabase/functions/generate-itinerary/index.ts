import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  resolveAndGate,
  deductCredits,
  rateLimit,
  llmKillSwitch,
  newStreamUsage,
  accumulateStreamUsage,
  hasStreamUsage,
  runInBackground,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Static system prompt — cached across requests
// Style rules — only included in the user message for selected styles, not in the cached system prompt
const STYLE_RULES: Record<string, string> = {
  "Nature & Wildlife":
    "Okay to start early for wildlife/nature activities. Note permits, guides, or season restrictions.",
  "Food & Culinary":
    "Include more meals than usual at legendary local places. Add shorter stops (ice cream, snack spots). Include a cooking class or food tour if it fits.",
  "Shopping & Markets":
    "Include local markets, night markets, flea markets. Note what each is known for.",
  "Photography & Scenery":
    "Prioritise viewpoints, golden-hour spots, photogenic locations. Schedule hilltop/rooftop visits at sunrise/sunset. Avoid midday harsh light.",
  "Family & Kids":
    "Avoid kid-inappropriate activities. Prefer interactive museums, animal encounters, beaches. Keep days ≤8h. No late nights. Include child-friendly dining. Relaxed pace.",
  "Nightlife & Bars":
    "Include bar-hopping, live music, night markets, rooftop bars after dinner. Keep mornings lighter.",
  "Relaxation & Wellness":
    "Include spas, hammams, onsen, yoga. Reduce activity count. Prefer scenic walks and beach time.",
  "Adventure & Thrill":
    "Prioritise trekking, rafting, diving, bungee — what's special for this destination. Early starts OK. Note gear/guide logistics.",
  "History & Culture":
    "Include historic sites, local eateries, authentic local experiences.",
};

const SYSTEM_PROMPT = `You are a travel expert who generates travel itineraries as JSON.

Rules:
- HOTELS: Choose a well-located, reliable, confirmed-open hotel. Title MUST be "Check in at [SPECIFIC HOTEL NAME]" (e.g. "Check in at Hotel Gracery Shinjuku", "Check in at Rambagh Palace"). NEVER use generic titles like "Hotel check in" or "Check in at hotel". Minimise hotel changes (2+ nights per base) — NEVER relocate to a different hotel for a single night when staying in the same area; on a small island or single city, ONE base hotel for the whole trip is strongly preferred. Include check-in (type:hotel, icon:🏨) ONLY in cities where the traveler sleeps overnight — skip same-day transit cities. Day 1: check in after ready time. Later cities: before 12:30 → check in at 12:30; 12:30–18:00 → right after transit; after 18:00 → check in first. Any check-in before 14:00 MUST carry the note "Drop bags — room may be ready later".
- TITLES: Real specific place names only (Trishna, Leopold Cafe). Never generic (Lunch, Dinner). Never vague area references like "Stone Town Streets", "Beach day", "City walk", "Explore downtown" — always name the SPECIFIC street, market, temple, beach, or venue (e.g. "Forodhani Night Market", "Kendwa Beach", "Darajani Bazaar"). Don't prefix city name.
- RESTAURANTS: Only suggest if certain it's in that neighbourhood. If unsure, use a food street or market.
- RELIABILITY: Prefer long-established venues unlikely to have closed.
- DAY TRIPS: Single transit activity covers round-trip. OMIT geocodeEnd (geocode = base city). Duration = full round-trip. No separate "Return" activity. Next activity must start within 1h of day-trip end — no 3h+ gaps.
- PACKAGE: Same-experience activities share a "package" kebab-case ID (e.g. "halong-cruise"). Suppresses duplicate transit/pins/photos.
- FIELDS: note max 8 words AND must be actionable (e.g. "Book 1 week ahead", "Closes at 17:00", "Cash only"). MOST activities need NO note — include one ONLY when it prevents a real problem (booking, timing, cash-only). Default to omitting it entirely. city = ONE short neighbourhood or area name (not country, not a list). WRONG: "Tsukiji / Akihabara / Ueno, Tokyo". RIGHT: "Asakusa" or "Shibuya" or "Central Tokyo". Keep it to 1-2 words max. geocode = a FULLY QUALIFIED searchable place name in format "[Specific Place], [neighborhood], [city], [country]". Example: "Hotel Gracery Shinjuku, Yasukuni-dori, Shinjuku, Tokyo, Japan" or "Senso-ji, Asakusa, Tokyo, Japan". This helps map pins resolve precisely without ambiguity (especially important for chain hotels and common-named places). Do NOT combine, abbreviate, or invent place names. WRONG: "Shibuya Scramble Crossing" (doesn't exist). RIGHT: "Shibuya Crossing, Shibuya, Tokyo, Japan". WRONG: using just the city name like "Ubud" as the geocode for a resort. RIGHT: "Alaya Resort Ubud, Ubud, Bali, Indonesia". Each activity MUST have a DIFFERENT geocode. NEVER use the city/region/park name alone as geocode.
- TRANSIT GEOCODE: geocode=origin, geocodeEnd=destination. Train/flight/boat: use station/airport/pier name. Road: city name OK. Day-trip round-trips: omit geocodeEnd.
- MULTI-DESTINATION: Transit activity on first day of each new city.
- DEFAULT START/END: No arrival/departure city given → assume largest city within the destination region (Rajasthan→Jaipur, Sri Lanka→Colombo). Not external gateways.
- MEALS: Walking distance from current zone. Legendary established places.
- GEOGRAPHY: Cover each area fully in one visit. No backtracking.
- WEATHER: Avoid outdoor 12–16:00 in hot months when possible.
- TIMING: Fixed-time experiences (sunrise, markets) override morning preference. Max 9-10h of activities per day. Venues with "night" in their nature (night markets, night bazaars, rooftop bars, nightlife) MUST be scheduled 18:00 or later — never in the afternoon.
- COMMUTE: Characterful local transport where natural (tuk-tuk, longtail boat, vaporetto).
- TRANSITION: For each activity (except the last of the day), include an optional "transition" object when public transit is a practical option to reach the NEXT activity. Only include for cities with meaningful public transit. Omit for rural areas, beach destinations, or very short distances (<500m).
  Fields: mode ("metro"|"bus"|"ferry"|"tram")
  Example: {"mode":"metro"}
- INTER-CITY TRANSIT: EVERY activity with type:"transit" MUST include these extra fields:
  service: specific service name (e.g. "Shinkansen Nozomi", "Odakyu Romancecar", "Blue Star Ferry", "TGV inOui", "FlixBus"). For driving, use "Private car" or "Taxi".
  from_station: departure station/port/airport/city name
  to_station: arrival station/port/airport/city name
  transit_duration: approximate journey time (e.g. "2h 15m", "1.5h")
  cost_estimate: approximate cost with currency (e.g. "~¥13,320 (~$90)"). For driving, estimate fuel/toll or taxi fare.
  booking_tip: one practical tip (e.g. "Reserved seat recommended", "Book 2 days ahead")
  These fields are MANDATORY for all transit activities — never omit them.
- WISHLIST: 2-3 nearby local gems per day (specific named places only). Auto-validated via Google Places — only places you are CERTAIN exist. Empty > invented. Each gem has ONLY three fields: "title", "geocode", "near" (the EXACT verbatim title of the activity in the same day it is closest to). Do NOT add "note" or "icon" to gems.
- TRANSIT_TIP: For each day, include an optional "transit_tip" string with practical local transport advice. Max 1 sentence. Must be actionable — name the specific transit card to buy, the metro/bus lines for that day's route, or a day pass with price. Examples: "Use Suica card · Ginza + Hanzomon Lines · Day pass ¥600", "Navigo Easy card · M12, M1 today · Buy at any station", "Use contactless/Oyster · Zone 1-2 cap £7.70". Only include if the city has meaningful public transit AND the day involves 2+ activities that benefit from it. Omit for rural areas, beach days, single-venue days, or cities without public transit (e.g. Bali, rural Rajasthan).
- SUMMARY: Top-level "summary" string, 2 sentences max.
- CITIES: Top-level "cities" array, one per unique city: {"name":"...","writeup":"2–3 evocative sentences about this destination"}.
- DAY DESCRIPTION: Each entry in "days" MUST include a "description": 2–3 evocative sentences capturing the day's arc and feel — the neighbourhoods, the rhythm, what makes it memorable. Not a list of stops, but a warm narrative like a Lonely Planet opening paragraph. Mention places only by the names used in that day's activities.
- STORY TITLE: Each entry in "days" MUST include a "story_title": a 2–4 word evocative title for the day (e.g. "Lanterns and Backstreets", "Into the Caldera"). NEVER just a place name — "Ang Thong Marine Park" is WRONG; "Emerald Lagoons" is right. No city names, no "Day N", no itinerary words like "arrival", "departure", "return".
- NARRATIVE: Each entry in "days" MUST include a "narrative": 2–3 full magazine-style sentences (a single sentence is NOT acceptable) with the day's mood and arc — sensory and specific, written like a travel-magazine opening paragraph. Unlike "description" (a practical overview), the narrative avoids listing stops: mention at most one place, by the name used in that day's activities.
- GLOSS: Each activity except type:"transit" MUST include a "gloss": one evocative line, max 12 words, capturing what this place IS (e.g. "Ten thousand vermilion gates threading up a sacred mountainside"). Not practical advice — that stays in "note".
- PHOTO QUERY: Each activity except type:"transit" MUST include a "photo_query": 2–6 words describing the iconic photographed view of this exact place, phrased as a Wikimedia Commons image search (e.g. "Fushimi Inari torii gates tunnel", "Kinkaku-ji golden pavilion pond reflection", "Uluwatu temple cliff sunset"). Name the place; no dates, no adjectives like "beautiful".

IMPORTANT OUTPUT ORDER: Generate "name", "summary" and "cities" BEFORE the "days" array. The app saves the trip header immediately while days stream in.

Return ONLY a raw JSON object, MINIFIED — no indentation, no newlines, no spaces between tokens (pretty-printing wastes the output budget and truncates the itinerary). Start with { end with }. Structure:
{"name":"...","summary":"...","cities":[{"name":"...","writeup":"..."}],"days":[{"label":"Day 1","city":"...","story_title":"2–4 word evocative title","narrative":"2–3 magazine-style sentences","description":"2–3 evocative sentences about this day","transit_tip":"Use Suica card · Ginza Line today","activities":[{"time":"09:00","title":"...","geocode":"...","type":"sight","duration":"1h","note":"...","gloss":"one evocative line, max 12 words","photo_query":"iconic view search, 2-6 words","icon":"🏛️","transition":{"mode":"metro"}}],"wishlist":[{"title":"...","geocode":"...","near":"Activity Title from this day"}]}]}`;

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

    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    const {
      destinations,
      numDays,
      travelers,
      styles,
      budget,
      pace,
      morningStart,
      notes,
      startDate,
      arrivalCity,
      arrivalTime,
      arrivalMode,
      departureCity,
      departureTime,
      departureMode,
      votedItems,
      tripId,
      spend_personal,
    } = body;

    // Pre-flight (Phase 2.5): resolve which wallet pays — personal for a solo
    // trip (byte-identical to before), the trip pool for a shared trip; a short
    // shared pool forks with 'empty_trip_pool'.
    const { gate, source } = await resolveAndGate(
      user,
      tripId || null,
      spend_personal === true,
      corsHeaders,
      1.0, // personal min (solo, unchanged)
      15, // pool floor — IG can cost 20-50; fork a near-empty shared pool early
    );
    if (gate) return gate;

    const budgetLabel =
      {
        budget: "budget (hostels, street food)",
        mid: "mid-range (3-star hotels, local restaurants)",
        luxury: "luxury (5-star hotels, fine dining)",
      }[budget] || "mid-range";
    const stylesText = styles.join(", ");
    // Only include style rules for selected styles (saves ~600 tokens vs all 9 in system prompt)
    const styleNotes = (styles || [])
      .map((s: string) => STYLE_RULES[s])
      .filter(Boolean)
      .map((rule: string) => `  • ${rule}`)
      .join("\n");
    const paceNote =
      pace === "relaxed"
        ? "PACE: This is a relaxed trip. Plan 5-6 activities per day (HARD MINIMUM 5 — a day with fewer than 5 feels empty), with some gaps for rest, wandering, or a cafe. Relaxed means unhurried, NOT sparse — still fill the day from morning through dinner."
        : "PACE: This is an active trip. Plan 6-8 activities per day (HARD MINIMUM 6) — push toward the higher end unless an activity is genuinely long (3h+). Make full use of the day, morning through dinner. Never leave a day thin.";
    const morningNote =
      morningStart === "late"
        ? "MORNING ROUTINE: These travelers like a slow start. On days without an arrival constraint, the first activity should not begin before 10:30–11:00. Build in time for a leisurely breakfast. Only start earlier if there is a genuinely unmissable reason (e.g. sunrise at a landmark, avoiding extreme midday heat, timed entry)."
        : "MORNING ROUTINE: These travelers are early birds. From Day 2 onwards, first activity can start at 08:00–09:00 to beat crowds and enjoy the cool morning. Plan till dinner with breaks as needed.";

    // Buffers by travel mode
    const arrivalBuffers: Record<string, number> = {
      flight: 90,
      train: 45,
      bus: 20,
      road: 20,
    };
    const departureBuffers: Record<string, number> = {
      flight: 150,
      train: 60,
      bus: 30,
      road: 30,
    };
    const arrivalBuffer = arrivalBuffers[arrivalMode ?? "flight"] ?? 90;
    const arrivalVerb =
      {
        flight: "lands",
        train: "arrives by train",
        bus: "arrives by bus",
        road: "arrives by road",
      }[arrivalMode ?? "flight"] ?? "arrives";
    const arrivalPort =
      { flight: "airport", train: "station", bus: "bus station", road: "" }[
        arrivalMode ?? "flight"
      ] ?? "";

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
    const departureDesc =
      {
        flight: "return flight departs",
        train: "return train departs",
        bus: "return bus departs",
        road: "travelers depart by road",
      }[departureMode ?? "flight"] ?? "return departs";
    let lastDayNote = "";
    if (departureTime) {
      const [h, m] = departureTime.split(":").map(Number);
      const cutoffMins = h * 60 + m - departureBuffer;
      const cutHH = String(Math.floor(cutoffMins / 60) % 24).padStart(2, "0");
      const cutMM = String(cutoffMins % 60).padStart(2, "0");
      const depCity = departureCity || destinations[destinations.length - 1];
      const depPort =
        {
          flight: "airport",
          train: "train station",
          bus: "bus station",
          road: "",
        }[departureMode ?? "flight"] ?? "";
      lastDayNote = `LAST DAY CONSTRAINT (ABSOLUTE HARD RULE): ${departureDesc.charAt(0).toUpperCase() + departureDesc.slice(1)} at ${departureTime} from ${depCity}. Every sightseeing/food activity on the last day MUST end by ${cutHH}:${cutMM}. The LAST activity of the last day MUST be a transit activity (type:"transit") to the ${depPort || "departure point"} — e.g. title "Transit to ${depCity}${depPort ? " " + depPort : ""}", time "${cutHH}:${cutMM}", duration "${departureBuffer}min". This departure transit is MANDATORY — the itinerary must end with it. No hotel check-in on the last day.`;
    }

    const notesNote = notes
      ? `TRAVELER NOTES: ${notes}. Factor this into every day of the itinerary.`
      : "";
    const travelMonth = startDate
      ? new Date(startDate).toLocaleString("en-US", { month: "long" })
      : null;

    // Build route-constraint block ABOVE the main prompt so it takes precedence
    let routeConstraint = "";
    let extraPrefs = "";
    if (votedItems && votedItems.length > 0) {
      const upvotedRegions = votedItems.filter(
        (it: any) => it.tier === 1 && it.vote === 1,
      );
      const upvotedExp = votedItems.filter(
        (it: any) => (it.tier || 2) === 2 && it.vote === 1,
      );
      const downvotedExp = votedItems.filter(
        (it: any) => (it.tier || 2) === 2 && it.vote === -1,
      );
      if (upvotedRegions.length) {
        const r = upvotedRegions[0]; // usually exactly one
        const routeCities = (r.city || "")
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean);
        const routeDays = (r.days || []).map((d: any) =>
          typeof d === "string" ? d : d?.description || d?.day || "",
        );
        // Infer overnight bases from the day template: per day, find which city the traveler SLEEPS in.
        // Look for explicit "return to X", "overnight in X", "back to X for overnight" phrasing; else assume
        // the day's primary city is the overnight base.
        const bases: string[] = [];
        for (let i = 0; i < routeDays.length; i++) {
          const dayText = routeDays[i].toLowerCase();
          let base = "";
          // Pattern 1: explicit return/overnight
          const m = dayText.match(
            /(?:return to|overnight in|back to|based in|stay in|sleep in)\s+([a-z][a-z\s\-]+?)(?:$|[,.]|\s+for\s+overnight)/i,
          );
          if (m) base = m[1].trim();
          // Pattern 2: day trip pattern implies return to previous base
          else if (dayText.includes("day trip") && bases[i - 1])
            base = bases[i - 1];
          // Pattern 3: transit pattern "X → Y" → base is Y (destination)
          else {
            const transit = routeDays[i].match(/→\s*([A-Z][a-z\-]+)/);
            if (transit) base = transit[1];
          }
          // Fallback: use first city mentioned in the line
          if (!base) {
            const cityHit = routeCities.find((c: string) =>
              dayText.includes(c.toLowerCase()),
            );
            if (cityHit) base = cityHit;
          }
          // Final fallback: previous base (if any)
          if (!base && bases[i - 1]) base = bases[i - 1];
          bases.push(base || routeCities[0] || "");
        }
        // Compute night-by-night summary — nights = days - 1 (last day usually ends in departure, no overnight)
        const nightsSummary = bases
          .slice(0, Math.max(0, bases.length - 1))
          .map((b, i) => `  Night ${i + 1} (after Day ${i + 1}): sleep in ${b}`)
          .join("\n");

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
${
  r.points?.length
    ? `\nKey characteristics of this route the traveler values:\n${(
        r.points || []
      )
        .filter((p: any) => p.good !== false)
        .map((p: any) => `  • ${p.text}`)
        .join("\n")}`
    : ""
}`;
      }
      const prefParts: string[] = [];
      if (upvotedExp.length)
        prefParts.push(
          `Experiences the traveler wants included: ${upvotedExp.map((e: any) => e.title).join(", ")}`,
        );
      if (downvotedExp.length)
        prefParts.push(
          `Experiences to avoid: ${downvotedExp.map((e: any) => e.title).join(", ")}`,
        );
      if (prefParts.length) extraPrefs = `\n\n${prefParts.join("\n")}`;
    }

    console.log("day1Note:", day1Note);

    const userMessage = `${routeConstraint ? routeConstraint + "\n\n────\n\n" : ""}Generate a ${numDays}-day itinerary for: ${destinations.join(" → ")}.

Trip: ${travelers} travelers, ${stylesText} style, ${budgetLabel} budget.${travelMonth ? ` Travel dates: ${travelMonth}.` : ""}

${paceNote}
${morningNote}${styleNotes ? `\n\nSTYLE RULES:\n${styleNotes}` : ""}${day1Note ? `\n\n${day1Note}` : ""}${lastDayNote ? `\n\n${lastDayNote}` : ""}${notesNote ? `\n${notesNote}` : ""}${extraPrefs}`;

    // ── Provider switch: IG_MODEL env var selects the IG model per environment.
    // Unset (prod) → Sonnet 4.6 (the Anthropic path below, unchanged). Set to a
    // "gemini-*" id (staging) → Gemini streaming path (canary A/B). Same code
    // ships to both; behaviour differs only by the env var.
    // Default: Sonnet 4.6. Sonnet 5 (IG_MODEL=claude-sonnet-5) writes noticeably
    // better prose but takes 60s/2-day scaling past the edge runtime's ~150s
    // wall-clock on 4+ day trips — needs chunked generation before it can be the
    // default. Full support (no temperature, minified output, higher caps) is in.
    const igModel = Deno.env.get("IG_MODEL") || "claude-sonnet-4-6";
    if (igModel.startsWith("gemini")) {
      const gResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${igModel}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: {
              maxOutputTokens: Math.min(32000, numDays * 2200 + 6000),
              responseMimeType: "application/json",
            },
          }),
        },
      );
      if (!gResp.ok) {
        const e = await gResp.text();
        throw new Error(`Gemini error: ${e}`);
      }
      // Re-emit Gemini SSE as the client's `data: "<text delta>"` format — same
      // shape the Anthropic path emits, so the client parser is unchanged.
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      (async () => {
        let inTok = 0;
        let outTok = 0;
        try {
          const reader = gResp.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (!raw) continue;
              try {
                const ev = JSON.parse(raw);
                const txt = ev.candidates?.[0]?.content?.parts?.[0]?.text;
                if (txt)
                  await writer.write(
                    encoder.encode(`data: ${JSON.stringify(txt)}\n\n`),
                  );
                if (ev.usageMetadata) {
                  inTok = ev.usageMetadata.promptTokenCount || inTok;
                  outTok = ev.usageMetadata.candidatesTokenCount || outTok;
                }
              } catch {
                /* skip non-JSON keep-alive lines */
              }
            }
          }
        } finally {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          await writer.close();
          // Log usage only (credit deduction on the canary path is skipped —
          // the credit cost model is Anthropic-priced; the gate above still ran).
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          runInBackground(
            fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                trip_id: tripId || null,
                function_name: "generate-itinerary",
                model: igModel,
                input_tokens: inTok,
                output_tokens: outTok,
              }),
            })
              .then(() => {})
              .catch(() => {}),
          );
        }
      })();
      return new Response(readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: igModel,
        max_tokens: Math.min(40000, numDays * 3500 + 3000),
        // temperature is rejected by the Claude 5 family; keep for older models
        ...(igModel.startsWith("claude-sonnet-5") ? {} : { temperature: 0.8 }),
        stream: true,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    console.log("Anthropic response status:", response.status);
    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      throw new Error(`Anthropic error: ${err}`);
    }

    // Estimate input tokens from request body size
    const requestBodyStr = JSON.stringify({
      model: igModel,
      max_tokens: Math.min(40000, numDays * 3500 + 3000),
      ...(igModel.startsWith("claude-sonnet-5") ? {} : { temperature: 0.8 }),
      stream: true,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    const estimatedInputTokens = Math.round(requestBodyStr.length / 4);

    // Forward text deltas as simple SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      let outputLength = 0;
      const usage = newStreamUsage();
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
              accumulateStreamUsage(usage, event);
              if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta"
              ) {
                outputLength += event.delta.text.length;
                await writer.write(
                  encoder.encode(
                    `data: ${JSON.stringify(event.delta.text)}\n\n`,
                  ),
                );
              } else if (event.type === "error") {
                console.error(
                  "Anthropic stream error:",
                  JSON.stringify(event.error),
                );
              } else {
                console.log("Event type:", event.type);
              }
            } catch (e) {
              console.error("Parse error:", e.message, raw.slice(0, 100));
            }
          }
        }
      } finally {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
        await writer.close();

        // Prefer the API's real token counts (incl. cache read/write); fall
        // back to length estimates only when usage events never arrived.
        const inputTokens = hasStreamUsage(usage)
          ? usage.inputTokens
          : estimatedInputTokens;
        const outputTokens = usage.outputTokens || Math.round(outputLength / 4);
        const cacheCreationTokens = usage.cacheCreationTokens;
        const cacheReadTokens = usage.cacheReadTokens;

        // Log LLM usage + deduct credits. Wrapped in runInBackground so the
        // isolate is NOT reclaimed before these run — the bug that dropped
        // every generate-itinerary usage log + credit deduction.
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        runInBackground(
          (async () => {
            await fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                trip_id: tripId || null,
                function_name: "generate-itinerary",
                model: igModel,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_creation_tokens: cacheCreationTokens,
                cache_read_tokens: cacheReadTokens,
              }),
            }).catch(() => {});

            await deductCredits({
              userId: user.id,
              model: igModel,
              inputTokens,
              outputTokens,
              cacheCreationTokens,
              cacheReadTokens,
              functionName: "generate-itinerary",
              tripId: tripId || null,
              source,
            });
          })(),
        );
      }
    })();

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("Function error:", err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
