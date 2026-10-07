import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { captureException } from "../_shared/errortrack.ts";
import {
  streamLLM,
  modelFor,
  suggestCap,
  type LLMUsage,
  type JSONSchema,
} from "../_shared/llm.ts";
import {
  authenticateUser,
  unauthorized,
  resolveAndGate,
  deductCredits,
  rateLimit,
  llmKillSwitch,
  runInBackground,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
- days: array of strings — one per day. Each string must be a READABLE phrase that names the actual place and what happens there. Do NOT use cryptic shorthand like "back same day", "full day", "transit". Always name the base city when returning (e.g. "Day trip to Galle from Colombo, back by evening"). Always name specific activities (e.g. "Scuba diving in Hikkaduwa" not "Scuba"). Use **double asterisks** sparingly to bold only the NEW highlight(s) introduced that day (the main destination or a standout activity), at most 1–2 per day. CRITICAL — bold each distinct place, hotel, or activity AT MOST ONCE in the entire route, on its FIRST mention only. A fixed base you return to (e.g. the same hotel every night) is bolded once when you first arrive/check in, then written as PLAIN text on every later day — never re-bold it. On each later day, bold only names that were not already bolded on an earlier day. Not every day needs bold. Example of the recurring-base rule: Day 1 "check in to **Club Mahindra Madikeri**", then Day 2+ "Chill day based at Club Mahindra Madikeri: **Raja's Seat** sunrise…" (base is now plain text, the new highlight is bold). Good examples: ["**Colombo** → **Galle** (2.5h drive)", "Galle Fort walk and Unawatuna beach", "Day trip to **Hikkaduwa** for scuba diving, return to Galle", "Mirissa beach day and **Coconut Tree Hill** at sunset", "Drive back to Colombo (2.5h)"]
- bestFor: short phrase (e.g. "Relaxed beach lovers", "Variety seekers")
- warning: null, or a single honest concern (e.g. "Nuwara Eliya → Bentota is a 4.5h drive")
- recommended: MUST be set to true on exactly ONE of the 4 routes — the one that best fits the traveler's style, budget, notes, and duration. Every response MUST have exactly one recommended route. On the other 3 routes, set recommended: false.
- stops: array of the route's OVERNIGHT BASES in travel order — [{"city": "<base city>", "nights": <integer ≥ 1>, "why": "<≤12 words: what this stop/duration buys the traveller>"}, ...]. This is machine-read: exact format required. The nights MUST sum to exactly (trip days − 1) — the final day is the departure day and consumes no night. ONLY cities where the traveller SLEEPS appear here; day-trip destinations do NOT. Must be consistent with the "days" text (same bases, same order). "why" is decision support, not description — e.g. "two nights lets the fort and beaches breathe", "acclimatization step before the high villages".
- points: array of 2–4 objects, each with "text" (max 10 words) and "good" (boolean). These are the most salient facts about this route — what makes it compelling OR what it lacks. CRITICAL: if the traveler mentioned specific requirements in their notes (e.g. scuba diving, a cooking class, no long drives), each route MUST include at least one point directly addressing whether this route satisfies or conflicts with that requirement. Non-notes points should highlight the route's strongest feature and one honest tradeoff.

ROUTE RULES:
- Routes must be realistic for the trip duration — don't try to cover too much. A common trap: packing 4+ regions into 5 days means half the trip is in a car.
- MINIMISE HOTEL HOPS: Average stay should be 2+ nights per base. Avoid single-night stops unless genuinely unavoidable (e.g. an overnight train stopover). Flag in "warning" or "points" if any stop is single-night.
- DAY-TRIP vs OVERNIGHT — each day string MUST be internally consistent about where the traveller sleeps. A day is EITHER a day trip (visit X and RETURN to your current base the SAME day → phrase it "Day trip to X from [base], back by evening"; do NOT say you stay or overnight in X) OR an overnight move (travel to X and SLEEP there → phrase it as a move "[base] → X … overnight in X"; do NOT call it a "day trip"). NEVER combine "day trip to X" with "stay/overnight in X" in the same day — they contradict each other. Example — if a route overnights in Hakone: Day N "Tokyo → Hakone — Mt Fuji views, onsen, overnight in Hakone", Day N+1 "Hakone — ropeway and Lake Ashi, return to Tokyo by afternoon" (NOT "Day trip to Hakone … stay overnight in Hakone").
- MINIMISE LOGISTICS: Avoid back-to-back long driving days — travellers should not spend half the trip in transit. Prefer routes where daily drives feel manageable given the destination's road conditions (a 3h drive in Sri Lanka is slow and tiring; a 3h drive on a European highway is easy). Use judgement. Some leeway only if the traveler notes mention a road trip, scenic drive, or similar. If any route is transit-heavy, call that out honestly in "points" with good: false.
- If arrival and departure city are the same (a loop), routes should return to that city.
- DEFAULT START/END: If no arrival or departure city is specified, assume the traveler flies into and out of a major city with an international airport WITHIN the destination region — NOT a gateway city outside the region. For example: Rajasthan → assume Jaipur (not Delhi); Sri Lanka → assume Colombo; Kerala → assume Kochi; Bali → assume Denpasar. IMPORTANT: Not all routes need the same start/end city, and defaulting every route to the same one is a common failure. Where a region has more than one viable arrival airport (Rajasthan: Jaipur, Udaipur, Jodhpur; Japan: Tokyo, Osaka; Italy: Rome, Milan), vary the start/end ACROSS routes — it reduces backtracking and is a large part of what makes the four options feel genuinely distinct rather than reshuffled. A named default (the examples above) is the fallback for a single route, never a constraint binding all four. For example, one Japan route could start in Tokyo and end in Osaka (open-jaw flight), saving a full day of transit.
- All 4 routes must be genuinely different from each other (different themes, different cities, different pace). This is a HARD requirement with a measurable test, not a stylistic preference. Across the 4 routes COMBINED: (a) the overnight bases must cover at least 7 DISTINCT cities, and (b) no city may be an overnight base in more than 2 of the 4 routes — the single exception is the arrival city, which may appear in at most 3. Self-check before answering: list every base you used across all 4 routes and count. If the destination's two best-known cities appear in most routes, you have FAILED this rule — rebuild at least two routes around other genuinely worthwhile bases. Every region has them beyond the postcard pair (for Rajasthan, beyond Jaipur and Udaipur there is Jodhpur, Jaisalmer, Bikaner, Bundi, Ranthambore, the Shekhawati towns, Mount Abu, Chittorgarh). Offering four variations on the same two cities is the single most common way this feature disappoints — the traveller already knows the famous names, and came here to find the ones they did not.
- GEOGRAPHIC COHERENCE: Each route must stay within ONE coherent geographic region. Never combine two distant, unrelated destinations into one route (e.g. "Maldives & Kerala" is two separate trips, not one route). If a traveler can't drive or take a short domestic flight between the places within a few hours, they don't belong in the same route. The only exception is when the destination itself spans multiple areas (e.g. "Japan" naturally covers Tokyo + Kyoto via Shinkansen).
- If a travel month is given, factor in seasonal conditions (e.g. east coast Sri Lanka is best April–September).
- Keep drives honest: Sri Lanka drives are slow. Colombo–Galle ~2.5h, Colombo–Kandy ~3h, Galle–Yala ~3h.
- If traveler notes mention a specific activity (e.g. scuba, safari, cooking class), ensure at least one route is strongly compatible with it. Do not force every route to include it — be honest about which routes work and which don't.

TIER 2 — EXPERIENCES (MANDATORY — your response is INCOMPLETE without these):
After the 4 route options, you MUST ALSO append 15–20 specific named places and activities as separate items with tier = 2. Never stop after the routes — the array always ends with the tier-2 experiences.
Rules:
- Only SPECIFIC named places — "Mirissa Beach", "Galle Fort", "Temple of the Tooth". Never "Local beach" or "City park".
- Only well-established, operating venues.
- Spread across categories: Sightseeing, Dining, Experiences, Nightlife, Nature, Culture, Shopping, Day Trip.
- Tag each with its city/area.
- NOTE: max 10 words.
- CATEGORY: one of Sightseeing, Dining, Nightlife, Experiences, Shopping, Nature, Culture, Day Trip.
- tier: 2
- If traveler notes mention specific interests, bias the tier 2 items to include relevant experiences (e.g. scuba dive sites, cooking schools).

CITY-LEVEL DESTINATIONS (e.g. "Tokyo", "Mumbai", "Barcelona"):
When the destination is a specific city rather than a country/region, STILL generate exactly 4 tier 1 route options — but adapt them to be NEIGHBOURHOOD ROUTES. Each route is a different way to spend the trip days across the city's neighbourhoods and surroundings.
- title: a thematic name (e.g. "Classic Tokyo", "East Side Explorer", "Fashion & Food Trail")
- city: comma-separated NEIGHBOURHOODS/AREAS in visit order (e.g. "Asakusa, Ueno, Shibuya, Shinjuku" — NOT "Tokyo, Tokyo, Tokyo")
- days: describe which neighbourhood and what you do there each day
- At least one route should include a day trip to a nearby town (e.g. Kamakura from Tokyo, Sintra from Lisbon, Nara from Osaka)
- Routes should represent genuinely different styles: one heritage-heavy, one food-focused, one off-the-beaten-path, one with a day trip, etc.
- All the same fields apply (tagline, bestFor, warning, recommended, points)
- The "city" field must use neighbourhood/area names, NOT repeat the city name

OBSCURE / SMALL / AMBIGUOUS DESTINATIONS — NEVER break format to ask questions. This is a one-shot API call: there is no conversation, no chance to clarify, and any prose response is a TOTAL failure that shows the user an error screen. When the destination is a small town, an obscure area, or an ambiguous name (e.g. "Bangkinang", a small regency town in Sumatra), commit to the most sensible interpretation and produce the JSON anyway: treat the place as the traveller's fixed base, build the 4 routes from realistic day trips around it and the surrounding region (nearest hub city, nature, culture within a few hours), and use each route's "warning"/"points" to say honestly that tourist infrastructure is limited or that a nearby hub may serve better. Best-guess routes for a strange destination are ALWAYS better than no routes.

Return ONLY a raw JSON array, MINIFIED — no indentation, no newlines, no spaces between tokens (pretty-printing wastes the output budget and truncates the response). ABSOLUTELY NO prose, preamble, markdown, or code fences — the FIRST character of your response must be [ and the LAST must be ]. The array MUST contain the 4 tier-1 routes FOLLOWED BY 15–20 tier-2 experiences — a response with only the routes and no tier-2 items is invalid.

Example (country-level, 5 days, Colombo to Colombo, traveler wants scuba):
[{"title":"South Coast Loop","tagline":"Minimal travel, best beaches","tier":1,"category":"Route","icon":"🏖️","city":"Galle, Unawatuna, Hikkaduwa, Mirissa","days":["Colombo → Galle (2.5h drive)","Galle Fort walk and Unawatuna beach","Day trip to Hikkaduwa for scuba diving, back to Galle","Galle → Mirissa, beach day and Coconut Tree Hill at sunset","Drive back to Colombo"],"stops":[{"city":"Galle","nights":3,"why":"base for fort, beaches and Hikkaduwa diving day trip"},{"city":"Mirissa","nights":1,"why":"wake up beside the whale-watching harbour"}],"bestFor":"Beach and diving lovers","warning":null,"recommended":true,"points":[{"text":"Hikkaduwa has excellent scuba sites for all levels","good":true},{"text":"Least time in transit of all routes","good":true},{"text":"No wildlife or hill country","good":false}]},{"title":"Hills + Beach","tagline":"Culture, tea country, then coast","tier":1,"category":"Route","icon":"🍃","city":"Kandy, Nuwara Eliya, Bentota","days":["Colombo → Kandy (3h)","Kandy: Temple of the Tooth + lake walk","Kandy → Nuwara Eliya, tea estates","Nuwara Eliya → Bentota (4.5h drive)","Bentota beach + back to Colombo"],"stops":[{"city":"Kandy","nights":2,"why":"culture anchor: Temple of the Tooth without rushing"},{"city":"Nuwara Eliya","nights":1,"why":"one cool tea-country night breaks the descent"},{"city":"Bentota","nights":1,"why":"beach finale an easy hop from Colombo"}],"bestFor":"Variety seekers","warning":"Nuwara Eliya to Bentota is a long 4.5h drive","recommended":false,"points":[{"text":"No dedicated scuba — Bentota is calm, not a dive destination","good":false},{"text":"Best mix of culture and coast","good":true},{"text":"Long drive on day 4","good":false}]},{"title":"Mirissa Beach","city":"Mirissa","category":"Sightseeing","note":"Wide beach, whale watching from Nov to Apr","icon":"🐳","tier":2}]`;

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

    const {
      destinations: rawDest,
      styles,
      budget,
      travelMonth,
      numDays,
      arrivalCity,
      departureCity,
      notes,
      existingPlans,
      baseLocation,
      numPlans: rawNumPlans,
      travellerStyles,
      tripId,
      spend_personal,
    } = await req.json();

    // Pre-flight (Phase 2.5): resolve which wallet pays — personal for a solo
    // trip (byte-identical to before), the trip pool for a shared trip; a short
    // shared pool forks with 'empty_trip_pool'.
    const { gate, source } = await resolveAndGate(
      user,
      tripId || null,
      spend_personal === true,
      corsHeaders,
      1.0, // personal min (solo, unchanged)
      6, // pool floor — RG can cost ~6; fork a near-empty shared pool early
    );
    if (gate) return gate;
    const numPlans = Math.max(1, Math.min(4, rawNumPlans || 4));

    const destinations = rawDest?.length ? rawDest : ["Help me decide"];

    const budgetLabel =
      { budget: "budget", mid: "mid-range", luxury: "luxury" }[budget] ||
      "mid-range";
    const stylesText = (styles || []).join(", ");

    const loopNote =
      arrivalCity &&
      departureCity &&
      arrivalCity.toLowerCase() === departureCity.toLowerCase()
        ? `Arrival and departure city: ${arrivalCity} (loop trip).`
        : arrivalCity && departureCity
          ? `Arrives at ${arrivalCity}, departs from ${departureCity}.`
          : arrivalCity
            ? `Arrives at ${arrivalCity}.`
            : "";

    const isOpenToIdeas =
      destinations.length === 1 &&
      (destinations[0].toLowerCase().includes("help me decide") ||
        destinations[0].toLowerCase().includes("open to ideas"));

    const userMessage = isOpenToIdeas
      ? `The traveler needs HELP DECIDING on a destination — they haven't chosen one yet.${baseLocation ? ` They are based in ${baseLocation}.` : ""} Suggest ${numPlans} completely different destinations around the world that would be ideal for their preferences.` +
        (numDays ? ` Trip duration: ${numDays} days.` : "") +
        (travelMonth ? ` Travel month: ${travelMonth}.` : "") +
        ` Trip style: ${stylesText || "general"}, ${budgetLabel} budget.` +
        (notes ? `\n\nTraveler notes: ${notes}` : "") +
        (existingPlans?.length
          ? `\n\nEXISTING PLANS (already shown to the user — do NOT repeat these destinations or similar itineraries, generate COMPLETELY DIFFERENT countries/regions): ${existingPlans.join(", ")}`
          : "") +
        `\n\nGenerate exactly ${numPlans} tier 1 route options, each in a DIFFERENT country/region. Each route should be a complete itinerary outline for that destination. Make each suggestion genuinely different — e.g. one beach destination, one cultural, one adventure, one off-the-beaten-path. Include the country/region in the title (e.g. "Sri Lanka South Coast", "Patagonia Explorer"). Do NOT generate tier 2 experiences — only tier 1 route options.\n\nCRITICAL RULES:\n1. WEATHER: Only suggest destinations where the WEATHER IS GOOD in the travel month. Do NOT suggest places in their winter, monsoon, or extreme weather season. For example: do NOT suggest New Zealand or Patagonia for June (southern hemisphere winter), do NOT suggest Southeast Asia in August (peak monsoon).\n2. FLIGHT TIME vs TRIP DURATION: ${baseLocation ? `The traveler is based in ${baseLocation}. ` : ""}One-way flight time to the destination must be reasonable relative to the trip length. The round-trip travel time (both ways) MUST NOT exceed 20% of the total trip days. This is a HARD LIMIT — violating it disqualifies a destination. For example: a 6-day trip allows max ~1.2 days of flying round-trip, so one-way flight must be under ~14 hours. A 10-day trip allows ~2 days, so one-way under ~24 hours. NEVER suggest destinations requiring 20+ hour one-way flights for trips under 10 days. For short trips (5-7 days), strongly prefer destinations reachable in under 6-8 hours of flying from the base location.`
      : `Destination: ${destinations.join(", ")}.${baseLocation ? ` Traveler is based in ${baseLocation}.` : ""}` +
        (numDays ? ` Trip duration: ${numDays} days.` : "") +
        (travelMonth ? ` Travel month: ${travelMonth}.` : "") +
        ` Trip style: ${stylesText || "general"}, ${budgetLabel} budget.` +
        (loopNote ? ` ${loopNote}` : "") +
        (notes ? `\n\nTraveler notes: ${notes}` : "") +
        (existingPlans?.length
          ? `\n\nEXISTING PLANS (already shown to the user — do NOT repeat these or generate similar itineraries with overlapping cities/routes, create COMPLETELY DIFFERENT plans): ${existingPlans.join(", ")}`
          : "") +
        `\n\nIf this is a country/region-level destination, generate exactly ${numPlans} realistic route options (tier 1). Do NOT generate tier 2 experiences — only routes.`;

    // Group trips: per-traveller styles. Appended AFTER the ternary so both
    // the help-me-decide and normal branches (and both model paths) get it.
    // Kept out of the cached system prompt — this text varies per trip.
    const stylesBlock =
      Array.isArray(travellerStyles) && travellerStyles.length > 0
        ? `\n\nPER-TRAVELER STYLES (this is a group trip — plan for everyone):\n` +
          travellerStyles
            .map(
              (s: { name?: string; text?: string }) =>
                `- ${String(s?.name || "Traveler").slice(0, 40)}: ${String(s?.text || "").slice(0, 400)}`,
            )
            .join("\n") +
          `\nAcross each route's "points", cover the named travellers whose style this route strongly matches or conflicts with, attributing by name (e.g. "5 festival days — what Ravi asked for"). Stay within the normal points count; prioritise the sharpest per-traveller fits and conflicts.`
        : "";
    const finalUserMessage = userMessage + stylesBlock;

    // Model resolved BEFORE the request body — previously the body hardcoded
    // sonnet-4-6 and RG_MODEL only ever routed the Gemini canary.
    // Default moved to gemini-3.8-flash on 2026-10-05 (bench, Thailand 7d):
    //   claude-sonnet-5-5   171 in / 1,923 out  $0.0195  16.9s  first card 5.8s
    //   gemini-3.8-flash  3,312 in /   857 out  $0.0057   8.6s  first card 4.2s
    // 3.4x cheaper and fastest time-to-first-card in the bench, which is the
    // metric that governs how RG FEELS since cards stream in one at a time.
    // Both return exactly 4 routes; both OpenAI models returned 21-22.
    const rgModel = modelFor("RG", "gemini-3.8-flash");
    // 4 routes + 15-20 tier-2 experiences runs ~3.8-4.4k tokens on 6-day
    // multi-city trips — the old 4000 cap truncated mid-JSON on most runs
    // (llm_usage showed output_tokens pinned at exactly 4000), which read
    // as "RG randomly fails, re-run until it works". gpt-6-luna measured
    // 8710 against this 9000 cap, so the cap scales with the model.
    const rgMaxTokens = suggestCap(rgModel, 9000);
    // The system prompt is fully static, so cache it as a stable prefix
    // (Anthropic only — the adapter drops cache_control elsewhere).
    const rgSystem = [
      {
        type: "text" as const,
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" as const },
      },
    ];

    // RG returns a HETEROGENEOUS top-level array: 4 tier-1 route objects
    // followed by 15-20 tier-2 experience objects, with different field sets.
    // anyOf expresses that and is accepted by all three providers (verified
    // 2026-10-05). The schema is what finally makes "the array MUST contain
    // the routes FOLLOWED BY the tier-2 items" structurally enforced instead
    // of merely instructed.
    const RG_TIER1 = {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "tagline",
        "tier",
        "category",
        "icon",
        "city",
        "days",
        "stops",
        "bestFor",
        "warning",
        "recommended",
        "points",
      ],
      properties: {
        title: { type: "string" },
        tagline: { type: "string" },
        tier: { type: "integer", enum: [1] },
        category: { type: "string", enum: ["Route"] },
        icon: { type: "string" },
        city: { type: "string", description: "comma-separated cities" },
        days: { type: "array", items: { type: "string" } },
        stops: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["city", "nights", "why"],
            properties: {
              city: { type: "string" },
              nights: { type: "integer" },
              why: { type: "string", description: "max 12 words" },
            },
          },
        },
        bestFor: { type: "string" },
        // Genuinely absent most of the time — nullable so OpenAI strict (which
        // requires every key) can still express "no warning".
        warning: { type: ["string", "null"] },
        recommended: { type: "boolean" },
        points: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "good"],
            properties: {
              text: { type: "string" },
              good: { type: "boolean" },
            },
          },
        },
      },
    };
    const RG_TIER2 = {
      type: "object",
      additionalProperties: false,
      required: ["title", "city", "category", "note", "icon", "tier"],
      properties: {
        title: { type: "string" },
        city: { type: "string" },
        category: { type: "string" },
        note: { type: "string" },
        icon: { type: "string" },
        tier: { type: "integer", enum: [2] },
      },
    };
    const RG_SCHEMA = {
      type: "array",
      items: { anyOf: [RG_TIER1, RG_TIER2] },
    };

    // A Gemini-specific single-shot branch used to live here, duplicating the
    // SSE pump and skipping deductCredits entirely ("the credit cost model is
    // Anthropic-priced") — so every Gemini RG was free to the user, and only
    // candidatesTokenCount was logged, dropping the thought tokens Google
    // bills as output. streamLLM now serves every provider through one pump,
    // and billing is model-aware.
    const rgStream = streamLLM({
      model: rgModel,
      system: rgSystem,
      user: finalUserMessage,
      maxTokens: rgMaxTokens,
      json: true,
      // RG returns a TOP-LEVEL JSON ARRAY of route objects. On OpenAI the
      // adapter drops the schema for this streamed-array case rather than
      // wrapping it, because a wrapped object would break the progressive
      // route scanner mid-stream.
      expectArray: true,
      schema: RG_SCHEMA as unknown as JSONSchema,
      // Honoured only by pre-Claude-5 Anthropic models.
      temperature: 0.7,
    });

    // Pull the FIRST event before returning the Response. The provider fetch
    // happens on this first next(), so a 4xx/5xx from the provider still
    // throws here — inside the try, before any Response exists — and the
    // client gets the clean HTTP 500 it already handles. Consume the stream
    // lazily instead and a provider error becomes an empty 200 stream, which
    // the client reports as "took too long to respond".
    const firstEvent = await rgStream.next();

    // Fallback estimate, used only if the stream never reports real usage.
    const estimatedInputTokens = Math.round(
      (SYSTEM_PROMPT.length + finalUserMessage.length) / 4,
    );

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // The whole pump runs under waitUntil: a client disconnect must not
    // reclaim the isolate before billing lands — Anthropic has already
    // charged for every token generated up to that point.
    runInBackground(
      (async () => {
        let outputLength = 0;
        let streamUsage: LLMUsage | null = null;
        try {
          // firstEvent was already pulled above (so provider errors 500);
          // replay it, then drain the rest.
          for (let ev = firstEvent; !ev.done; ev = await rgStream.next()) {
            const event = ev.value;
            if (event.type === "delta") {
              outputLength += event.text.length;
              await writer.write(
                encoder.encode("data: " + JSON.stringify(event.text) + "\n\n"),
              );
            } else {
              streamUsage = event.usage;
              if (event.truncated) {
                // Truncated output = unparseable JSON downstream. Make it
                // loud in the logs instead of masquerading as a client bug.
                console.error(
                  `RG hit max_tokens (${rgMaxTokens}) — output truncated at ~${outputLength} chars`,
                );
              }
            }
          }
        } catch (e) {
          // The pump now owns the provider connection, so a mid-stream
          // failure lands here instead of at the fetch. Bill what was
          // generated (the finally below) and surface it.
          console.error("generate-brainstorm stream error:", e.message);
          await captureException(e, {
            functionName: "generate-brainstorm:stream",
            tripId: tripId || null,
          });
        } finally {
          // BILLING FIRST, stream niceties second. The old order awaited
          // writer.write/close un-caught at the top of this finally — a client
          // disconnect (tab closed, E2E timeout) made those REJECT, the finally
          // threw, and the log + credit deduction below never ran: every
          // abandoned RG stream billed Anthropic in full and recorded nothing.
          // Every provider is normalised to the same four disjoint buckets,
          // so the estimate fallback is the only branch left.
          const inputTokens =
            streamUsage && streamUsage.input_tokens
              ? streamUsage.input_tokens
              : estimatedInputTokens;
          const outputTokens =
            streamUsage?.output_tokens || Math.round(outputLength / 4);
          const cacheCreationTokens =
            streamUsage?.cache_creation_input_tokens ?? 0;
          const cacheReadTokens = streamUsage?.cache_read_input_tokens ?? 0;

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
                  function_name: "generate-brainstorm",
                  model: rgModel,
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  cache_creation_tokens: cacheCreationTokens,
                  cache_read_tokens: cacheReadTokens,
                }),
              }).catch(() => {});

              // Deduct credits based on actual consumption.
              await deductCredits({
                userId: user.id,
                model: rgModel,
                inputTokens,
                outputTokens,
                cacheCreationTokens,
                cacheReadTokens,
                functionName: "generate-brainstorm",
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
    console.error("generate-brainstorm error:", err.message);
    await captureException(err, { functionName: "generate-brainstorm" });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
