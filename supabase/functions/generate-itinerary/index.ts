import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { captureException } from "../_shared/errortrack.ts";
import {
  callLLM,
  modelFor,
  suggestCap,
  traitsOf,
  providerOf,
  type LLMUsage,
  type SystemBlock,
  type JSONSchema,
} from "../_shared/llm.ts";
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
- OPENING HOURS: Schedule every activity inside its real operating hours. Museums, palaces, temples, shrines, castles and historic houses typically CLOSE between 16:00 and 18:00 (last entry earlier still) — never schedule one to START after it closes. Gardens and parks close around dusk. If a sight must be seen and the day is full, move it earlier rather than tacking it onto the evening. Evening slots belong to markets, bars, restaurants, night-time views and walks.
- DAY TRIPS: Single transit activity covers round-trip. OMIT geocodeEnd (geocode = base city). Duration = full round-trip. No separate "Return" activity. Next activity must start within 1h of day-trip end — no 3h+ gaps.
- PACKAGE: Same-experience activities share a "package" kebab-case ID (e.g. "halong-cruise"). Suppresses duplicate transit/pins/photos.
- FIELDS: note max 8 words AND must be actionable (e.g. "Book 1 week ahead", "Closes at 17:00", "Cash only"). MOST activities need NO note — include one ONLY when it prevents a real problem (booking, timing, cash-only). HARD CAP: at most 1 in 4 activities per day may carry a note; if more than a quarter of your day has notes you are describing, not warning — delete the descriptive ones. A note that merely restates what the place is (e.g. "Housed in a restored Ottoman house", "Quirky retro decor") is WRONG — that belongs in gloss. NEVER emit "note":"" — omit the key entirely instead. city = ONE short neighbourhood or area name (not country, not a list). WRONG: "Tsukiji / Akihabara / Ueno, Tokyo". RIGHT: "Asakusa" or "Shibuya" or "Central Tokyo". Keep it to 1-2 words max. geocode = a FULLY QUALIFIED searchable place name in format "[Specific Place], [neighborhood], [city], [country]". Example: "Hotel Gracery Shinjuku, Yasukuni-dori, Shinjuku, Tokyo, Japan" or "Senso-ji, Asakusa, Tokyo, Japan". This helps map pins resolve precisely without ambiguity (especially important for chain hotels and common-named places). Do NOT combine, abbreviate, or invent place names. WRONG: "Shibuya Scramble Crossing" (doesn't exist). RIGHT: "Shibuya Crossing, Shibuya, Tokyo, Japan". WRONG: using just the city name like "Ubud" as the geocode for a resort. RIGHT: "Alaya Resort Ubud, Ubud, Bali, Indonesia". Each activity MUST have a DIFFERENT geocode. NEVER use the city/region/park name alone as geocode.
- TRANSIT GEOCODE: geocode=origin, geocodeEnd=destination. Train/flight/boat: use station/airport/pier name. Road: city name OK. Day-trip round-trips: omit geocodeEnd.
- MULTI-DESTINATION: Transit activity on first day of each new city.
- DEFAULT START/END: No arrival/departure city given → assume largest city within the destination region (Rajasthan→Jaipur, Sri Lanka→Colombo). Not external gateways.
- MEALS: Walking distance from current zone. Legendary established places. EVERY meal activity MUST name a specific real venue — "Lunch near Pazari i Ri", "Farewell Lunch at a Family Tavern in Gorica", "Breakfast at a Mangalem Family Bakery" are all FORBIDDEN: they name a place the traveler cannot navigate to. If you are not confident a specific named venue exists, name a specific MARKET or FOOD STREET that definitely exists (e.g. "Dinner at Forodhani Night Market") rather than inventing a restaurant or hedging with "a family tavern". Every day MUST include dinner unless the traveler departs before dinner time.
- GEOGRAPHY: Cover each area fully in one visit. No backtracking.
- WEATHER: Avoid outdoor 12–16:00 in hot months when possible.
- TIMING: Fixed-time experiences (sunrise, markets) override morning preference. Max 9-10h of activities per day. Venues with "night" in their nature (night markets, night bazaars, rooftop bars, nightlife) MUST be scheduled 18:00 or later — never in the afternoon.
- COMMUTE: Characterful local transport where natural (tuk-tuk, longtail boat, vaporetto).
- TRANSITION: For each activity (except the last of the day), include an optional "transition" object when public transit is a practical option to reach the NEXT activity. Only include for cities with meaningful public transit. OMIT whenever the next activity is walkable (under ~1.2km, roughly a 15-minute walk) — most old-town, bazaar and historic-quarter hops are walking, and tagging them with "bus"/"metro" is wrong and contradicts the walkability of those areas. Omit for rural areas, beach destinations, or very short distances (<500m).
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
- WISHLIST: 2-3 nearby local gems per day (specific named places only). Auto-validated via Google Places — only places you are CERTAIN exist. Empty > invented. Each gem has ONLY three fields: "title", "geocode", "near". "near" MUST be copied verbatim from one of THIS day's activity titles — it anchors the gem in the UI, and a gem whose near matches nothing gets demoted. Do NOT add "note" or "icon" to gems.
- TRANSIT_TIP: For each day, include an optional "transit_tip" string with practical local transport advice. Max 1 sentence. Must be actionable — name the specific transit card to buy, the metro/bus lines for that day's route, or a day pass with price. Examples: "Use Suica card · Ginza + Hanzomon Lines · Day pass ¥600", "Navigo Easy card · M12, M1 today · Buy at any station", "Use contactless/Oyster · Zone 1-2 cap £7.70". Only include if the city has meaningful public transit AND the day involves 2+ activities that benefit from it. Omit for rural areas, beach days, single-venue days, or cities without public transit (e.g. Bali, rural Rajasthan).
- SUMMARY: Top-level "summary" string, 2 sentences max.
- CITIES: Top-level "cities" array, one per unique city: {"name":"...","writeup":"2–3 evocative sentences about this destination"}.
- DAY DESCRIPTION: Each entry in "days" MUST include a "description": 2–3 evocative sentences capturing the day's arc and feel — the neighbourhoods, the rhythm, what makes it memorable. Not a list of stops, but a warm narrative like a Lonely Planet opening paragraph. Mention places only by the names used in that day's activities.
- TIME-OF-DAY HONESTY: Any time-of-day claim in a title, note or gloss MUST match the scheduled time. Do not call a 14:45 castle visit "golden hour", or a 20:45 drink a "sunset drink" when sunset is 19:45. If you want a sunset moment, SCHEDULE it at sunset; otherwise describe what the place is actually like at the hour you booked.
- NO REPEATS: Never schedule the same named venue twice in the whole trip (not lunch-then-dinner at the same restaurant, not the same bazaar on two days). Each named place appears exactly once across all days.
- STORY TITLE: Each entry in "days" MUST include a "story_title": a 2–4 word evocative title for the day (e.g. "Lanterns and Backstreets", "Into the Caldera"). NEVER just a place name — "Ang Thong Marine Park" is WRONG; "Emerald Lagoons" is right. No city names, no "Day N", no itinerary words like "arrival", "departure", "return".
- NARRATIVE: Each entry in "days" MUST include a "narrative": 2–3 full magazine-style sentences (a single sentence is NOT acceptable) with the day's mood and arc — sensory and specific, written like a travel-magazine opening paragraph. Unlike "description" (a practical overview), the narrative avoids listing stops: mention at most one place, by the name used in that day's activities.
- GLOSS: Each activity except type:"transit" MUST include a "gloss": one evocative line, max 12 words, capturing what this place IS (e.g. "Ten thousand vermilion gates threading up a sacred mountainside"). Not practical advice — that stays in "note".
- PHOTO QUERY: Each activity except type:"transit" MUST include a "photo_query": 2–6 words describing the iconic photographed view of this exact place, phrased as a Wikimedia Commons image search (e.g. "Fushimi Inari torii gates tunnel", "Kinkaku-ji golden pavilion pond reflection", "Uluwatu temple cliff sunset"). Name the place; no dates, no adjectives like "beautiful".

IMPORTANT OUTPUT ORDER: Generate "name", "summary" and "cities" BEFORE the "days" array. The app saves the trip header immediately while days stream in.

Return ONLY a raw JSON object, MINIFIED — no indentation, no newlines, no spaces between tokens (pretty-printing wastes the output budget and truncates the itinerary). Start with { end with }. Structure:
{"name":"...","summary":"...","cities":[{"name":"...","writeup":"..."}],"days":[{"label":"Day 1","city":"...","story_title":"2–4 word evocative title","narrative":"2–3 magazine-style sentences","description":"2–3 evocative sentences about this day","transit_tip":"Use Suica card · Ginza Line today","activities":[{"time":"09:00","title":"...","geocode":"...","type":"sight","duration":"1h","note":"...","gloss":"one evocative line, max 12 words","photo_query":"iconic view search, 2-6 words","icon":"🏛️","transition":{"mode":"metro"}}],"wishlist":[{"title":"...","geocode":"...","near":"Activity Title from this day"}]}]}`;

// ── Parallel architecture (default path) ────────────────────────────────────
// One PLAN call produces the authoritative trip skeleton, then every day is
// expanded concurrently. Wall-clock ≈ plan + slowest single day, regardless of
// trip length — which keeps any model (incl. Sonnet 5) under the edge runtime's
// ~150s limit, vs 2-3min single-shot on 6-day trips.

const PLAN_SYSTEM = `You are a travel expert who PLANS multi-day itineraries as JSON — the trip skeleton, not the hour-by-hour detail.
Rules:
- The "plan" array is the AUTHORITATIVE trip skeleton: one entry per day with:
  label ("Day 1"...), city (the day's base area), hotel (a SPECIFIC well-located confirmed-open hotel name — minimise hotel changes, 2+ nights per base, NEVER relocate to a different hotel for a single night when staying in the same area; on a small island or single city ONE base hotel for the whole trip is strongly preferred; towns under ~30 minutes apart — e.g. along one coastline — share ONE base, visited as day outings, never one-night hops; name a hotel ONLY for cities where the traveler sleeps that night), sleep_city (the city where the traveler sleeps AFTER this day; empty string "" on the final departure day), highlights (4-6 objects {title,icon} — the SPECIFIC named places/experiences anchoring that day, INCLUDING 1-2 legendary meal venues; REAL place names only, never generic like "lunch" or "temple"), description (1 sentence).
- NO REPEATS ACROSS DAYS: every highlighted place — sights AND restaurants/markets — appears on AT MOST ONE day in the whole trip. Never place the same venue on two different days.
- GEOGRAPHIC SEQUENCE & PACING: order days so travel flows logically, cover each area fully in one visit, no backtracking. Fixed-time things (sunrise spots, morning markets, night markets) go on sensible days.
- Obey the SELECTED ROUTE cities/overnight bases and any Day-1 arrival / last-day departure HARD RULES in the user message EXACTLY.
- Also produce top-level "name", "summary" (2 sentences max), and "cities" (one {name,writeup} per unique city; writeup = 2-3 evocative sentences).
Return ONLY a raw JSON object, MINIFIED — no indentation, no newlines. Start with { end with }:
{"name":"...","summary":"...","cities":[{"name":"...","writeup":"..."}],"plan":[{"label":"Day 1","city":"...","hotel":"...","sleep_city":"...","highlights":[{"title":"...","icon":"🏛"}],"description":"..."}]}
Do NOT include a "days" array — days are filled in a later step.`;

// Appended to SYSTEM_PROMPT for day-fill calls: all activity/day rules above
// still apply; only the output shape and plan-obedience rules change. Sharing
// the SYSTEM_PROMPT prefix keeps the prompt cache warm across all fill calls.
const DAYFILL_OVERRIDE = `

──── SINGLE-DAY MODE ────
You are expanding exactly ONE day of an ALREADY-AGREED whole-trip plan (provided in the user message) into its detailed day schedule. Every rule above still applies, with these overrides:
- Output ONLY the single day object for the requested day — do NOT output "name", "summary", "cities", or a "days" array.
- The whole-trip plan is AUTHORITATIVE: stay in this day's city/base, expand THIS day's anchor highlights into a full schedule (adding meals, stops and connective activities around them), and use the hotel the plan names for this day. NEVER use a place the plan assigns to a DIFFERENT day.
- Hotel check-in (type:hotel) appears ONLY if the user message says this day starts a NEW overnight base. If it says the traveler already checked in earlier, do NOT include any check-in activity.
- Honor the Day-1 arrival / last-day departure HARD RULES only if they apply to THIS day.
Return ONLY a raw JSON object for the single day, MINIFIED — no indentation, no newlines. Start with { end with }:
{"label":"Day K","city":"...","story_title":"2–4 word evocative title","narrative":"2–3 magazine-style sentences","description":"2–3 evocative sentences","transit_tip":"...","activities":[{"time":"09:00","title":"...","geocode":"...","type":"sight","duration":"1h","note":"...","gloss":"...","photo_query":"...","icon":"🏛️","transition":{"mode":"metro"}}],"wishlist":[{"title":"...","geocode":"...","near":"Activity Title from this day"}]}`;

// ── Output schemas ──────────────────────────────────────────────────────────
// These mirror the JSON shapes spelled out in SYSTEM_PROMPT / PLAN_OVERRIDE /
// DAYFILL_OVERRIDE and are enforced by the provider, so the parse below cannot
// fail on shape and the "story mode" fields cannot be quietly omitted. The
// adapter reshapes them per provider (OpenAI needs every key in `required`,
// Anthropic rejects maxItems/numeric bounds), so one definition serves all.
const ACTIVITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "time",
    "title",
    "geocode",
    "type",
    "duration",
    "note",
    "gloss",
    "photo_query",
    "icon",
    "transition",
  ],
  properties: {
    time: { type: "string", description: "24h HH:MM" },
    title: { type: "string" },
    geocode: { type: "string", description: "exact name for map lookup" },
    type: { type: "string" },
    duration: { type: "string", description: 'e.g. "1h", "45m"' },
    // Nullable, because SYSTEM_PROMPT spends 80 words insisting "MOST
    // activities need NO note", caps notes at 1-in-4, and says "NEVER emit
    // note:'' — omit the key entirely". A required non-nullable string left
    // the model no legal way to say "no note", forcing it to invent ~37
    // notes on a 7-day trip — exactly the descriptive filler the prompt
    // calls wrong. Stays in `required` because OpenAI strict demands the key.
    note: { type: ["string", "null"] },
    gloss: { type: "string", description: "one evocative line, max 12 words" },
    photo_query: { type: "string" },
    icon: { type: "string" },
    // Nullable rather than absent: OpenAI strict requires every key, so the
    // model says "no transition" with null instead of by omission.
    transition: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["mode"],
      properties: { mode: { type: "string" } },
    },
  },
} as const;

const DAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "label",
    "city",
    "story_title",
    "narrative",
    "description",
    "transit_tip",
    "activities",
    "wishlist",
  ],
  properties: {
    label: { type: "string", description: 'e.g. "Day 1"' },
    city: { type: "string" },
    story_title: { type: "string", description: "2-4 word evocative title" },
    narrative: { type: "string", description: "2-3 magazine-style sentences" },
    description: { type: "string", description: "2-3 evocative sentences" },
    transit_tip: { type: ["string", "null"] },
    activities: { type: "array", items: ACTIVITY_SCHEMA },
    wishlist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "geocode", "near"],
        properties: {
          title: { type: "string" },
          geocode: { type: "string" },
          near: {
            type: "string",
            description: "an activity title from this day",
          },
        },
      },
    },
  },
} as const;

const CITIES_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "writeup"],
    properties: {
      name: { type: "string" },
      writeup: { type: "string", description: "2-3 evocative sentences" },
    },
  },
} as const;

/** Phase 1: the whole-trip skeleton the day fills expand. */
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "cities", "plan"],
  properties: {
    name: { type: "string" },
    summary: { type: "string", description: "2 sentences max" },
    cities: CITIES_SCHEMA,
    plan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "city",
          "hotel",
          "sleep_city",
          "highlights",
          "description",
        ],
        properties: {
          label: { type: "string" },
          city: { type: "string" },
          hotel: { type: ["string", "null"] },
          sleep_city: { type: ["string", "null"] },
          highlights: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "icon"],
              properties: {
                title: { type: "string" },
                icon: { type: ["string", "null"] },
              },
            },
          },
          description: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

/** Phase 2: one day, expanded. */
const DAYFILL_SCHEMA = DAY_SCHEMA;

/** IG_ARCH=single escape hatch: header + every day in one object. */
const SINGLESHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "cities", "days"],
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    cities: CITIES_SCHEMA,
    days: { type: "array", items: DAY_SCHEMA },
  },
} as const;

// Strip \`\`\`json ... \`\`\` fences and return the raw JSON string.
function stripFences(text: string): string {
  let t = (text || "").trim();
  if (t.startsWith("\`\`\`")) {
    const nl = t.indexOf("\n");
    if (nl !== -1) t = t.slice(nl + 1);
    if (t.endsWith("\`\`\`")) t = t.slice(0, -3);
  }
  return t.trim();
}

// Usage shape now comes from the shared adapter.
type AnthropicUsage = LLMUsage;

// Single non-streamed completion → text + usage, via the shared multi-provider
// adapter (_shared/llm.ts). System stays as blocks so fill calls share the
// cached SYSTEM_PROMPT prefix on Anthropic. Provider routing, thinking/
// temperature handling, JSON-mode rules and usage normalisation all live in
// the adapter now — this is just the IG-shaped wrapper around it.
async function callClaude(
  model: string,
  systemBlocks: { type: string; text: string; cache_control?: object }[],
  userMessage: string,
  maxTokens: number,
  schema?: JSONSchema,
): Promise<{ text: string; usage: AnthropicUsage; parsed?: unknown }> {
  const res = await callLLM({
    model,
    system: systemBlocks as SystemBlock[],
    user: userMessage,
    maxTokens,
    json: true,
    temperature: 0.8, // honoured only by pre-Claude-5 Anthropic models
    schema,
  });
  // The adapter already retried once at 1.5x the cap. Still truncated means
  // the output really is unusable, so fail the way callers expect.
  if (res.truncated)
    throw new Error(
      `hit max_tokens (${res.retriedAtCap ?? maxTokens}) — output truncated`,
    );
  return { text: res.text, usage: res.usage, parsed: res.parsed };
}

interface PlanDay {
  label: string;
  city: string;
  hotel?: string;
  sleep_city?: string;
  highlights: { title: string; icon?: string }[];
  description?: string;
}

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
      travellerStyles,
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
        : morningStart === "mid"
          ? "MORNING ROUTINE: These travelers like a normal start. From Day 2 onwards, the first activity should begin between 09:00 and 09:30. Plan till dinner with breaks as needed."
          : "MORNING ROUTINE: These travelers are early birds — this is a stated preference, not a suggestion. From Day 2 onwards the first activity MUST begin by 08:30 at the latest (08:00 is better) to beat crowds and enjoy the cool morning. A day whose first activity starts at 09:00 or later VIOLATES this rule unless the venue physically cannot open earlier. Plan till dinner with breaks as needed.";

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
      // BUG (fixed 2026-10-02): departureBuffer was used as BOTH the journey
      // time to the port AND the check-in allowance, so the generated transit
      // landed the traveller at the airport exactly at departure time
      // ("transit 15:30, duration 150min" for an 18:00 flight). The two are
      // now separate: be AT the port portArrivalBuffer before departure, and
      // the journey finishes before that.
      const portArrivalBuffers: Record<string, number> = {
        flight: 120,
        train: 30,
        bus: 20,
        road: 0,
      };
      const portArrivalBuffer =
        portArrivalBuffers[departureMode ?? "flight"] ?? 120;
      const arriveByMins = h * 60 + m - portArrivalBuffer;
      const arrHH = String(Math.floor(arriveByMins / 60) % 24).padStart(2, "0");
      const arrMM = String(arriveByMins % 60).padStart(2, "0");
      const cutoffMins = arriveByMins - departureBuffer;
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
      lastDayNote = `LAST DAY CONSTRAINT (ABSOLUTE HARD RULE): ${departureDesc.charAt(0).toUpperCase() + departureDesc.slice(1)} at ${departureTime} from ${depCity}. The traveler MUST BE AT the ${depPort || "departure point"} by ${arrHH}:${arrMM} — ${portArrivalBuffer} minutes before departure, non-negotiable. Work backwards from it: the LAST activity of the last day MUST be a transit activity (type:"transit") to the ${depPort || "departure point"} whose start time PLUS its real travel duration is ${arrHH}:${arrMM} or EARLIER. Use the TRUE journey time for that leg (a 2-hour drive is 2 hours — never compress it); if the departure point is in another city the transit may need to start hours earlier, and that is correct. Every sightseeing/food activity must end before that transit starts (around ${cutHH}:${cutMM} for a typical ${departureBuffer}-minute transfer, earlier if the journey is longer). This departure transit is MANDATORY — the itinerary must end with it. No hotel check-in on the last day.`;
    }

    const notesNote = notes
      ? `TRAVELER NOTES: ${notes}. Factor this into every day of the itinerary.`
      : "";
    // Group trips: per-traveller styles (uncached — varies per trip).
    const stylesNote =
      Array.isArray(travellerStyles) && travellerStyles.length > 0
        ? `PER-TRAVELER STYLES (group trip — plan for everyone): ` +
          travellerStyles
            .map(
              (s: { name?: string; text?: string }) =>
                `${String(s?.name || "Traveler").slice(0, 40)}: ${String(s?.text || "").slice(0, 400)}`,
            )
            .join("; ") +
          `. Balance every day across these travellers, and attribute standout choices by name in day descriptions where natural (e.g. "quiet morning — Achin's pace").`
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
        const listedCities = (r.city || "")
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean);
        const routeDays = (r.days || []).map((d: any) =>
          typeof d === "string" ? d : d?.description || d?.day || "",
        );
        // Routes Lens: a structured stops array [{city, nights}] on the voted
        // item is the authoritative night-by-night plan (written by the route
        // editor, and by newer RG responses). Validated hard — malformed or
        // wrong-sum arrays fall through to the legacy regex parsing below.
        const tripNights = Math.max(1, numDays - 1);
        const rStops: any[] | null = Array.isArray((r as any).stops)
          ? (r as any).stops
          : null;
        const stopsValid =
          !!rStops &&
          rStops.length >= 1 &&
          rStops.length <= 8 &&
          rStops.every(
            (s: any) =>
              s &&
              typeof s.city === "string" &&
              s.city.trim() &&
              Number.isInteger(s.nights) &&
              s.nights >= 1,
          ) &&
          rStops.reduce((a: number, s: any) => a + s.nights, 0) === tripNights;

        let routeCities: string[];
        let nightsSummary = "";
        let templateLines = "";
        if (stopsValid) {
          const stopCities = rStops!.map((s: any) => s.city.trim());
          // Bases first, then any extra listed cities (day-trip mentions)
          routeCities = [
            ...stopCities,
            ...listedCities.filter(
              (c: string) =>
                !stopCities.some(
                  (b: string) => b.toLowerCase() === c.toLowerCase(),
                ),
            ),
          ];
          const nightLines: string[] = [];
          const dayLines: string[] = [];
          let day = 1;
          let prev: string | null = null;
          for (const s of rStops!) {
            const c = s.city.trim();
            for (let k = 0; k < s.nights; k++) {
              dayLines.push(
                `  Day ${day}: ${
                  k === 0 && prev
                    ? `travel ${prev} → ${c}, then explore ${c}`
                    : `explore ${c} and around`
                }`,
              );
              nightLines.push(
                `  Night ${day} (after Day ${day}): sleep in ${c}`,
              );
              day++;
            }
            prev = c;
          }
          dayLines.push(
            `  Day ${day}: final morning in ${prev}, then departure`,
          );
          nightsSummary = nightLines.join("\n");
          templateLines = dayLines.join("\n");
        } else {
          routeCities = listedCities;
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
          nightsSummary = bases
            .slice(0, Math.max(0, bases.length - 1))
            .map(
              (b, i) => `  Night ${i + 1} (after Day ${i + 1}): sleep in ${b}`,
            )
            .join("\n");
          templateLines = routeDays
            .map((d: string, i: number) => `  Day ${i + 1}: ${d}`)
            .join("\n");
        }

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
${templateLines}
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
${morningNote}${styleNotes ? `\n\nSTYLE RULES:\n${styleNotes}` : ""}${day1Note ? `\n\n${day1Note}` : ""}${lastDayNote ? `\n\n${lastDayNote}` : ""}${notesNote ? `\n${notesNote}` : ""}${stylesNote ? `\n${stylesNote}` : ""}${extraPrefs}`;

    // ── Provider/arch switch: IG_MODEL picks the model ("gemini-*" → the
    // single-shot Gemini streaming path; anything else → Anthropic). On the
    // Anthropic side, IG_ARCH picks the architecture: default "parallel" =
    // PLAN skeleton + concurrent day fills (wall-clock ≈ plan + one day, any
    // trip length — what makes Sonnet 5 viable under the ~150s edge limit);
    // "single" = the original one-call streaming path, kept as escape hatch.
    // Default moved to gemini-3.8-flash on 2026-10-05 on 14-trip bench data
    // (bench-results-2026-10-05.md), 7-day Thailand itinerary:
    //   claude-sonnet-5-5   $0.2421  38.5s  7/7 days  23 major violations
    //   gemini-3.8-flash    $0.0823  17.6s  7/7 days   0 major violations
    // 3.7x cheaper, 2.2x faster, and the ONLY arm with zero structural
    // violations across both fixtures, plus 4/4 hotels correct.
    //
    // CAVEAT: gemini-3.8-flash's $0.75/$3.75 is promotional and DOUBLES on
    // 2027-01-01, which cuts the advantage to ~1.9x. Re-run the bench in
    // December. Rollback at any time via LLM_MODEL_IG / LLM_MODEL_DEFAULT.
    const igModel = modelFor("IG", "gemini-3.8-flash");
    const igArch = Deno.env.get("IG_ARCH") || "parallel";
    // NOTE: a Gemini-only single-shot branch used to live here. It bypassed
    // this function's parallel plan+fill architecture, so Gemini arms were not
    // comparable with any other model; it counted only candidatesTokenCount
    // (dropping thoughtsTokenCount, which Google bills as output); and it
    // deliberately skipped deductCredits, so every Gemini generation was free
    // to the user and invisible to the credit system. All three are fixed by
    // routing Gemini through the normal path below — _shared/llm.ts handles
    // the provider differences, and billing is model-aware.
    if (igArch !== "single") {
      // ── PHASE 1: PLAN skeleton (awaited before the stream opens, so a plan
      // failure surfaces as a clean HTTP 500 the client already handles).
      // The skeleton is structural (route, anchors, hotels) — IG_PLAN_MODEL
      // lets it run on a faster model than the day fills. Credits are deducted
      // at igModel rates for the whole batch; when the plan model is cheaper,
      // the ~2k plan tokens are slightly overcharged, never undercharged.
      const igPlanModel = modelFor("IG_PLAN", igModel);
      // Cost lever: the per-day fills are ~85% of IG's tokens, so their model
      // is selectable independently. Defaults to igModel (no behaviour
      // change). A/B on 2026-10-02 showed Haiku fills cut cost 72% but
      // hallucinated hotels and restaurants badly — see the IG model note in
      // CLAUDE.md before flipping this.
      const igFillModel = modelFor("IG_FILL", igModel);
      const totalStart = Date.now();
      const planBlocks = [
        {
          type: "text",
          text: PLAN_SYSTEM,
          cache_control: { type: "ephemeral" as const },
        },
      ];
      const planMaxTokens = Math.min(12000, numDays * 350 + 2500);
      let planRes = await callClaude(
        igPlanModel,
        planBlocks,
        userMessage,
        planMaxTokens,
        PLAN_SCHEMA as unknown as JSONSchema,
      );
      let planParsed: unknown = planRes.parsed ?? null;
      let planRetryUsage: AnthropicUsage | null = null;
      if (planParsed === null) {
        // Kept as the safety net for the degraded prompt-only path (a model
        // that rejects schemas) and for truncation past callLLM's 1.5x retry.
        // The fills already retried; the plan did not, so one malformed plan
        // used to 500 the whole generation and the user paid again on re-run.
        console.warn("Plan parse failed — retrying once");
        planRetryUsage = planRes.usage; // the failed attempt was still billed
        planRes = await callClaude(
          igPlanModel,
          planBlocks,
          userMessage,
          planMaxTokens,
          PLAN_SCHEMA as unknown as JSONSchema,
        );
        planParsed = planRes.parsed ?? null;
      }
      let plan: {
        name?: string;
        summary?: string;
        cities?: unknown[];
        plan?: PlanDay[];
      };
      try {
        plan = (planParsed ??
          JSON.parse(stripFences(planRes.text))) as typeof plan;
      } catch (e) {
        console.error(
          "Plan parse error:",
          e.message,
          planRes.text.slice(0, 200),
        );
        throw new Error("Failed to parse itinerary plan");
      }
      const planDays: PlanDay[] = Array.isArray(plan.plan) ? plan.plan : [];
      if (planDays.length === 0) throw new Error("Plan produced no days");
      if (planDays.length !== numDays)
        console.warn(`Plan has ${planDays.length} days, expected ${numDays}`);
      console.log(
        `Plan done in ${Date.now() - totalStart}ms, ${planDays.length} days`,
      );

      // Whole-trip skeleton string — cross-day context for every fill call.
      const skeleton = planDays
        .map((d) => {
          const titles = (d.highlights || []).map((h) => h.title).join(", ");
          const sleeps = d.sleep_city
            ? ` — sleeps in ${d.sleep_city}${d.hotel ? ` (${d.hotel})` : ""}`
            : " — departure day, no overnight";
          return `${d.label} — ${d.city}${sleeps}\n  Anchors: ${titles}\n  ${d.description || ""}`.trim();
        })
        .join("\n\n");

      const fillSystem = [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: DAYFILL_OVERRIDE },
      ];

      // Per phase: plan and fill may be different models, so summing them
      // and billing at one rate would mis-charge.
      const planUsages: AnthropicUsage[] = [planRes.usage];
      if (planRetryUsage) planUsages.push(planRetryUsage);
      const fillUsages: AnthropicUsage[] = [];
      const fillErrors: { day: string; error: string }[] = [];

      async function fillOne(day: PlanDay, i: number): Promise<any> {
        const titles = (day.highlights || []).map((h) => h.title).join(", ");
        const prevSleep = i > 0 ? planDays[i - 1].sleep_city : null;
        const newBase = !!day.sleep_city && day.sleep_city !== prevSleep;
        // The plan model is fast but weaker on venue knowledge — its hotel
        // pick is a SUGGESTION the (stronger) fill model must verify. Only the
        // new-base fill emits a check-in, so an override can't contradict
        // another day.
        const baseNote = newBase
          ? `Tonight the traveler sleeps in ${day.sleep_city} — this day STARTS A NEW OVERNIGHT BASE, so include the hotel check-in activity per the check-in timing rules.${day.hotel ? ` The plan suggests "${day.hotel}" — use it ONLY if you are confident it is a real, currently-operating HOTEL located in ${day.sleep_city}. If it is actually a restaurant/cafe/venue of another kind, located in a different city, or unknown to you, silently substitute a well-located, reliable, confirmed-open hotel you know in ${day.sleep_city} instead.` : ""}`
          : day.sleep_city
            ? `The traveler already checked in at this base on an earlier day — do NOT include any check-in activity today.`
            : `This is the final departure day — no hotel check-in.`;
        const dayUser =
          userMessage +
          "\n\n──── AGREED WHOLE-TRIP PLAN (all days) ────\n" +
          skeleton +
          `\n\n──── YOUR TASK ────\nProduce ONLY the detailed day object for ${day.label} in ${day.city}. Expand THIS day's anchors (${titles}) into a full schedule. NEVER use any place the plan assigns to a different day — this includes meals and connective stops you add yourself: if a venue is named anywhere in the plan for another day, pick a different one. ${baseNote}`;
        const attempt = async () => {
          // 4500 is the Sonnet/Haiku-tuned baseline; suggestCap scales it for
          // verbose models (gpt-6-luna measured ~2.5x output on this prompt).
          const res = await callClaude(
            igFillModel,
            fillSystem,
            dayUser,
            suggestCap(igFillModel, 4500),
            DAYFILL_SCHEMA as unknown as JSONSchema,
          );
          // Record usage BEFORE validating. The provider has already charged
          // us for these tokens (possibly for TWO calls, since callLLM merges
          // its 1.5x retry), so a shape failure below must not make them
          // vanish from llm_usage — the plan path handles this deliberately
          // via planRetryUsage and the fill path simply didn't.
          fillUsages.push(res.usage);
          // Schema-guaranteed: the day object cannot arrive mis-shaped, and
          // the story-mode fields (story_title, narrative) cannot be omitted.
          // The {days:[...]} unwrap stays for the degraded prompt-only path.
          let parsed = res.parsed ?? JSON.parse(stripFences(res.text));
          if (Array.isArray(parsed?.days)) parsed = parsed.days[0];
          if (!parsed || !Array.isArray(parsed.activities))
            throw new Error("day object missing activities");
          parsed.label = day.label;
          parsed.wishlist = Array.isArray(parsed.wishlist)
            ? parsed.wishlist
            : [];
          return parsed;
        };
        // Degrade to a stub rather than throwing: fillOne runs inside
        // Promise.all, so an escaping error would fail the whole generation
        // instead of losing one day.
        const stub = (err: string) => {
          fillErrors.push({ day: day.label, error: err });
          return {
            label: day.label,
            city: day.city,
            description: day.description || "",
            activities: [],
            wishlist: [],
          };
        };
        try {
          return await attempt();
        } catch (e1) {
          // Don't re-run the ladder on truncation: callLLM already retried at
          // 1.5x and billed both attempts, and callClaude threw because even
          // that was short. A second attempt() burns two MORE calls for the
          // same reason — worst case ~25,600 output tokens ($0.096 on Gemini,
          // more than an entire successful IG) and still an empty day.
          if (/hit max_tokens/.test(e1.message)) {
            console.error(
              `Day fill truncated twice for ${day.label}, not re-running:`,
              e1.message,
            );
            return stub(e1.message);
          }
          console.error(
            `Day fill failed for ${day.label}, retrying:`,
            e1.message,
          );
          try {
            return await attempt();
          } catch (e2) {
            console.error(
              `Day fill failed twice for ${day.label}:`,
              e2.message,
            );
            return stub(e2.message);
          }
        }
      }

      // ── PHASE 2: stream header now, then fills in parallel with ordered
      // flush — the client's accumulating parser sees the exact same byte
      // stream shape as the single-shot path.
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      // Serialized, error-swallowing write chain: fragments always land in
      // call order, and a client disconnect can't raise an unhandled rejection
      // from a fire-and-forget send inside flush().
      let sendChain: Promise<void> = Promise.resolve();
      const send = (fragment: string) => {
        sendChain = sendChain
          .then(() =>
            writer.write(
              encoder.encode(`data: ${JSON.stringify(fragment)}\n\n`),
            ),
          )
          .catch((e) => console.error("SSE write failed:", e.message));
        return sendChain;
      };

      // ── Billing flush, callable from two places ───────────────────────
      // The normal path bills in the pump's finally. But a HARD platform
      // wall-clock kill (~150s) reclaims the isolate before any finally runs,
      // so a timed-out generation logged NOTHING and deducted NOTHING while
      // the provider still charged us. Observed 2026-10-05: a gpt-6-luna IG
      // ran 151.7s and left zero generate-itinerary rows in llm_usage.
      // runInBackground/waitUntil protects against client disconnects; it
      // cannot extend the wall clock. So a watchdog flushes early, and the
      // flush is idempotent so the normal path cannot double-bill.
      // Guards re-entrancy within a single flush, NOT "bill once ever": the
      // watchdog takes a snapshot mid-generation and the day-fills still
      // running afterwards must be billed by the completion path. The arrays
      // are drained (splice) rather than read, so no usage is billed twice
      // and none is dropped.
      let flushing = false;
      const flushBilling = async (reason: "complete" | "watchdog") => {
        if (flushing) return;
        flushing = true;
        const tally = (list: AnthropicUsage[]) => ({
          inputTokens: list.reduce((a, u) => a + (u.input_tokens || 0), 0),
          outputTokens: list.reduce((a, u) => a + (u.output_tokens || 0), 0),
          cacheCreationTokens: list.reduce(
            (a, u) => a + (u.cache_creation_input_tokens || 0),
            0,
          ),
          cacheReadTokens: list.reduce(
            (a, u) => a + (u.cache_read_input_tokens || 0),
            0,
          ),
        });
        // DRAIN the usage arrays. A watchdog flush at 135s used to snapshot
        // days 1-4 and set billed=true; days 5-7 then resolved at 141-149s
        // and pushed into arrays nobody read again, so the most expensive
        // part of IG went unbilled. Draining lets the completion path bill
        // exactly the remainder.
        const planBatch = planUsages.splice(0);
        const fillBatch = fillUsages.splice(0);
        // Report igPlanModel, not igModel: the equality test compares the two
        // SUB-models, which can match each other while differing from
        // igModel (set LLM_MODEL_IG_PLAN and _FILL but not LLM_MODEL_IG and
        // every token gets logged and billed against a model never called —
        // a 20x error if igModel is Sonnet and the sub-models are luna).
        const phases =
          igPlanModel === igFillModel
            ? [{ model: igPlanModel, ...tally([...planBatch, ...fillBatch]) }]
            : [
                { model: igPlanModel, ...tally(planBatch) },
                { model: igFillModel, ...tally(fillBatch) },
              ];
        if (reason === "watchdog")
          console.error(
            `IG billing watchdog fired at ${Date.now() - totalStart}ms — ` +
              `flushing partial usage before the platform kills the isolate`,
          );
        console.log(
          `Parallel IG ${reason} in ${Date.now() - totalStart}ms, tokens ` +
            `in=${phases.reduce((a, p) => a + p.inputTokens, 0)} ` +
            `out=${phases.reduce((a, p) => a + p.outputTokens, 0)}`,
        );
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        for (const p of phases) {
          if (!p.inputTokens && !p.outputTokens) continue;
          await fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              trip_id: tripId || null,
              function_name:
                reason === "watchdog"
                  ? "generate-itinerary:timeout"
                  : "generate-itinerary",
              model: p.model,
              input_tokens: p.inputTokens,
              output_tokens: p.outputTokens,
              cache_creation_tokens: p.cacheCreationTokens,
              cache_read_tokens: p.cacheReadTokens,
              duration_ms: Date.now() - totalStart,
            }),
          }).catch(() => {});
          await deductCredits({
            userId: user.id,
            model: p.model,
            inputTokens: p.inputTokens,
            outputTokens: p.outputTokens,
            cacheCreationTokens: p.cacheCreationTokens,
            cacheReadTokens: p.cacheReadTokens,
            // Same name in the ledger as in llm_usage above, so a timeout
            // row and its deduction cannot disagree.
            functionName:
              reason === "watchdog"
                ? "generate-itinerary:timeout"
                : "generate-itinerary",
            tripId: tripId || null,
            source,
          });
        }
        // A watchdog flush is a partial settlement, so re-arm: fills that
        // land afterwards are billed by the completion path.
        if (reason === "watchdog") flushing = false;
      };
      // The deadline is measured from REQUEST START, not from here. This line
      // runs AFTER the awaited plan call (and its possible retry), so a flat
      // 135_000 meant "135s after the plan finished" — on a 22s plan the
      // watchdog would fire at t=157s, past the ~150s wall clock that kills
      // the isolate. The safety net would have missed exactly the runs it was
      // added for. Clamped to a 5s floor so an already-late run still flushes.
      const WATCHDOG_MS = 135_000;
      const billingWatchdog = setTimeout(
        // runInBackground, not a bare call: the flush does network I/O, and
        // without waitUntil registration the isolate can be reclaimed
        // mid-fetch the moment the main pump settles.
        () => runInBackground(flushBilling("watchdog")),
        Math.max(5_000, WATCHDOG_MS - (Date.now() - totalStart)),
      );

      // waitUntil-registered: without this, a client disconnect can reclaim
      // the isolate mid-fill, before the finally's billing/usage logging —
      // same reason the single-shot path registers its post-work.
      runInBackground(
        (async () => {
          try {
            const header =
              `{"name":${JSON.stringify(plan.name || destinations.join(" → "))},` +
              `"summary":${JSON.stringify(plan.summary || "")},` +
              `"cities":${JSON.stringify(plan.cities || [])},"days":[`;
            await send(header);

            const results: any[] = new Array(planDays.length).fill(null);
            let next = 0;
            // Synchronous drain: writer.write queues in call order, so a single
            // pass here cannot interleave with another resolve's pass.
            const flush = () => {
              while (next < results.length && results[next]) {
                send((next > 0 ? "," : "") + JSON.stringify(results[next]));
                next++;
              }
            };
            // CACHE PRIMING (cost lever): the N day-fills fire simultaneously,
            // so every one MISSES the shared SYSTEM_PROMPT cache and pays the
            // 1.25x write premium — measured 23k write tokens against only
            // 14k reads, i.e. the cache was barely paying for itself. One tiny
            // awaited call writes the cache first (~1s), after which all N
            // fills READ it at 0.1x. Best-effort: on failure we simply fall
            // back to today's behaviour.
            // Only Anthropic honours cache_control, so on Gemini/OpenAI the
            // prime buys nothing — those providers cache automatically,
            // server-side — while costing one billed call and ~1s on the
            // critical path. Gate it on the trait rather than the provider
            // name so a future caching provider picks it up for free.
            if (traitsOf(igFillModel).supportsPromptCache) {
              try {
                const warm = await callLLM({
                  model: igFillModel,
                  system: fillSystem as SystemBlock[],
                  user: "warmup",
                  // max_tokens:0 is Anthropic's documented pre-warm form: it
                  // runs prefill (writing the cache) and returns immediately
                  // with no content and ZERO output tokens billed. The old
                  // max_tokens:1 produced a one-token reply to throw away.
                  // Rejected alongside stream/thinking-enabled/json-format/
                  // forced tool_choice — none of which this call uses.
                  maxTokens: 0,
                  // Hitting the cap is the expected outcome here, so the
                  // adapter's retry-at-1.5x must not fire: the cache is
                  // written by processing the INPUT, which this call paid for.
                  retryOnTruncation: false,
                });
                fillUsages.push(warm.usage);
              } catch (e) {
                console.warn("Cache prime failed (non-fatal):", e.message);
              }
            }

            await Promise.all(
              planDays.map(async (d, i) => {
                results[i] = await fillOne(d, i);
                flush();
              }),
            );
            await send("]}");
          } catch (e) {
            console.error("Parallel fill stream error:", e.message);
            await captureException(e, {
              functionName: "generate-itinerary:stream",
              tripId: tripId || null,
            });
          } finally {
            clearTimeout(billingWatchdog);
            await sendChain;
            await writer
              .write(encoder.encode("data: [DONE]\n\n"))
              .catch(() => {});
            await writer.close().catch(() => {});

            // BILLING FIRST, reporting second — the rule RG already documents.
            // captureException is an un-timeouted fetch to PostHog; awaiting
            // it ahead of the flush put an unbounded delay in front of the
            // only billing call on a run that is already near the wall clock.
            runInBackground(flushBilling("complete"));

            if (fillErrors.length) {
              console.error("Fill errors:", JSON.stringify(fillErrors));
              await captureException(
                new Error(
                  `IG day fills failed: ${fillErrors.map((f) => f.day).join(", ")}`,
                ),
                {
                  functionName: "generate-itinerary:fills",
                  tripId: tripId || null,
                  fill_errors: JSON.stringify(fillErrors).slice(0, 900),
                },
              );
            }
          }
        })(),
      );

      return new Response(readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // IG_ARCH=single escape hatch. It still builds its own Anthropic body, so
    // the thinking/temperature decision has to come from the adapter's trait
    // table rather than a startsWith() guess: "claude-sonnet-5" prefixes
    // "claude-sonnet-5-5", where {type:"disabled"} is a 400 and the correct
    // off-switch is {type:"between_tools"}.
    // This path POSTs directly to api.anthropic.com, so a non-Anthropic
    // igModel 404s there. The default is now gemini-3.8-flash, which would
    // have made the escape hatch fail in exactly the incident it exists for.
    if (providerOf(igModel) !== "anthropic")
      throw new Error(
        `IG_ARCH=single requires an Anthropic model (got "${igModel}") — ` +
          `set LLM_MODEL_IG to an Anthropic id or use the parallel path`,
      );
    const igTraits = traitsOf(igModel);
    const singleShotSampling = igTraits.thinkingBody
      ? { thinking: igTraits.thinkingBody }
      : igTraits.allowTemperature
        ? { temperature: 0.8 }
        : {};

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
        ...singleShotSampling,
        // Anthropic-only path, so the schema goes on raw rather than through
        // normaliseSchema — the shape below is already within what Anthropic
        // accepts (no maxItems, no numeric bounds).
        output_config: {
          format: {
            type: "json_schema",
            schema: SINGLESHOT_SCHEMA,
          },
        },
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
      ...singleShotSampling,
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

    // The whole pump runs under waitUntil: a client disconnect must not
    // reclaim the isolate before billing lands — Anthropic has already
    // charged for every token generated up to that point.
    runInBackground(
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
          // BILLING FIRST, stream niceties second: the old order awaited
          // writer.write/close un-caught here — a client disconnect made the
          // finally throw and skipped the log + deduction entirely (billed
          // tokens, zero record). Same bug as generate-brainstorm.
          const inputTokens = hasStreamUsage(usage)
            ? usage.inputTokens
            : estimatedInputTokens;
          const outputTokens =
            usage.outputTokens || Math.round(outputLength / 4);
          const cacheCreationTokens = usage.cacheCreationTokens;
          const cacheReadTokens = usage.cacheReadTokens;

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

          await writer
            .write(encoder.encode("data: [DONE]\n\n"))
            .catch(() => {});
          await writer.close().catch(() => {});
        }
      })(),
    );

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("Function error:", err.message, err.stack);
    await captureException(err, { functionName: "generate-itinerary" });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
