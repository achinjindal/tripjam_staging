import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

// Style rules — only included in the user message for selected styles (identical to variant A)
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

// PLAN call system prompt — trip skeleton only, no hour-by-hour detail.
const PLAN_SYSTEM = `You are a travel expert who PLANS multi-day itineraries as JSON — the trip skeleton, not the hour-by-hour detail.
Rules:
- The "compact" array is the AUTHORITATIVE plan: one entry per day: label, city, hotel (a SPECIFIC, well-located, confirmed-open hotel name — minimise hotel changes, 2+ nights per base; only name a hotel in cities where the traveler sleeps overnight), highlights (3-5 objects each {title, icon-emoji} — the SPECIFIC named places/experiences that anchor that day; REAL place names only, never generic like "lunch" or "temple"), and description (1 sentence).
- NO REPEATS ACROSS DAYS: every highlighted place appears on AT MOST ONE day in the whole trip. Never place the same restaurant, sight, market, beach, or activity on two different days.
- GEOGRAPHIC SEQUENCE & PACING: order the days so travel flows logically, cover each area fully in one visit, no backtracking. relaxed pace → 3-4 highlights/day; active pace → 4-5 highlights/day. Fixed-time things (sunrise, markets) go on sensible days.
- Obey the SELECTED ROUTE cities/overnight-bases and any arrival/departure hard rules in the user message EXACTLY.
- Also produce top-level "name", "summary" (2 sentences max), and "cities" (one {name, writeup} per unique city, writeup = 2-3 evocative sentences).
Return ONLY a raw JSON object, no code fences, start with { end with }:
{"name":"...","summary":"...","cities":[{"name":"...","writeup":"..."}],"compact":[{"label":"Day 1","city":"...","hotel":"...","highlights":[{"title":"...","icon":"🏛"}],"description":"..."}]}
Do NOT include a "days" array — that is filled in a later step.`;

// DAY-FILL call system prompt — expands ONE day into a detailed schedule (copies A's day/activity rules).
const DAYFILL_SYSTEM = `You are a travel expert expanding ONE day of an ALREADY-AGREED trip plan into a detailed hour-by-hour schedule as JSON. You are given the whole-trip plan for context and told which single day to expand. Output ONLY that one day object.
Rules:
- HOTELS: Title MUST be "Check in at [SPECIFIC HOTEL NAME]" (use the hotel named for this day's city in the plan). Include check-in (type:hotel, icon:🏨) ONLY if the traveler sleeps overnight in this day's city AND it's the first night there (a new base). Day 1: check in after ready time. Later cities: before 12:30 → 12:30; 12:30–18:00 → right after transit; after 18:00 → first.
- TITLES: Real specific place names only (Trishna, Leopold Cafe). Never generic (Lunch, Dinner). Don't prefix city name.
- RESTAURANTS: Only if certain it's in that neighbourhood; else use a food street/market. Prefer long-established venues.
- DAY TRIPS: Single transit activity covers round-trip; OMIT geocodeEnd; duration = full round-trip; no separate Return; next activity within 1h.
- PACKAGE: Same-experience activities share a kebab-case "package" id.
- FIELDS: note max 8 words AND actionable ("Book 1 week ahead", "Cash only") or OMIT it. city = ONE short neighbourhood (1-2 words). geocode = FULLY QUALIFIED "[Specific Place], [neighborhood], [city], [country]"; each activity a DIFFERENT geocode; never the city/park name alone.
- TRANSIT GEOCODE: geocode=origin, geocodeEnd=destination; day-trip round-trips omit geocodeEnd.
- MEALS: walking distance from current zone; legendary established places.
- GEOGRAPHY: cover the area fully, no backtracking. WEATHER: avoid outdoor 12–16:00 in hot months. TIMING: fixed-time experiences override morning pref; max 9-10h/day.
- COMMUTE: characterful local transport where natural.
- TRANSITION: for each activity except the last, include an optional "transition":{"mode":"metro"|"bus"|"ferry"|"tram"} when public transit is practical (omit for rural/beach/<500m).
- INTER-CITY TRANSIT: every type:"transit" activity MUST include service, from_station, to_station, transit_duration, cost_estimate, booking_tip. Mandatory.
- WISHLIST: 4-5 nearby real named local gems for THIS day, each with a "near" field matching one of THIS day's activity titles verbatim. Empty > invented.
- TRANSIT_TIP: optional 1-sentence actionable local-transport tip for this day (name the card/lines/day-pass+price). Omit for rural/beach/single-venue days or cities without transit.
- Expand ONLY this day's highlights from the plan; stay within this day's city/base. NEVER use a place the plan assigns to a DIFFERENT day. Honor Day-1 arrival / last-day departure hard rules ONLY if they apply to this day.
Return ONLY a raw JSON object for the single day, no code fences, start with { end with }:
{"label":"Day K","city":"...","transit_tip":"...","activities":[{"time":"09:00","title":"...","geocode":"...","type":"sight","duration":"1h","note":"...","icon":"🏛️","transition":{"mode":"metro"}}],"wishlist":[{"title":"...","geocode":"...","note":"...","icon":"...","near":"Activity Title from this day"}]}`;

const ANTHROPIC_HEADERS = {
  "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "prompt-caching-2024-07-31",
  "content-type": "application/json",
};

// Strip ```json ... ``` fences and return the raw JSON string.
function stripFences(text: string): string {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    // remove opening fence (``` or ```json) up to the first newline
    const nl = t.indexOf("\n");
    if (nl !== -1) t = t.slice(nl + 1);
    // remove trailing fence
    if (t.endsWith("```")) t = t.slice(0, -3);
  }
  return t.trim();
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResult {
  text: string;
  usage: AnthropicUsage;
}

// Single non-streamed Anthropic call → text + usage.
async function callAnthropic(
  system: string,
  userMessage: string,
  maxTokens: number,
): Promise<AnthropicResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: ANTHROPIC_HEADERS,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      temperature: 0.8,
      stream: false,
      system: [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Anthropic error:", err);
    throw new Error(`Anthropic error: ${err}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text || "")
    .join("");
  return { text, usage: (data.usage || {}) as AnthropicUsage };
}

interface Highlight {
  title: string;
  icon?: string;
}

interface CompactDay {
  label: string;
  city: string;
  hotel?: string;
  highlights: Highlight[];
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
      tripId,
      spend_personal,
    } = body;

    // Pre-flight (Phase 2.5): resolve which wallet pays — same args as variant A.
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
        ? "PACE: This is a relaxed trip. Plan 4-5 activities per day, with gaps for rest, wandering, or sitting at a cafe. Do not pack the day."
        : "PACE: This is an active trip. Aim for 5-7 activities per day — push toward the higher end unless an activity is genuinely long (3h+). Make good use of the time available and plan till dinner.";
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

    // ─────────────────────────────────────────────────────────────
    // PHASE 1 — PLAN call (one, awaited, non-streamed)
    // ─────────────────────────────────────────────────────────────
    const totalStart = Date.now();
    const planStart = Date.now();
    const planResult = await callAnthropic(PLAN_SYSTEM, userMessage, 4000);
    const planMs = Date.now() - planStart;

    let plan: {
      name: string;
      summary: string;
      cities: unknown[];
      compact: CompactDay[];
    };
    try {
      plan = JSON.parse(stripFences(planResult.text));
    } catch (e) {
      console.error(
        "Plan parse error:",
        e.message,
        planResult.text.slice(0, 200),
      );
      throw new Error("Failed to parse plan JSON");
    }
    const compact: CompactDay[] = Array.isArray(plan.compact)
      ? plan.compact
      : [];
    if (compact.length === 0) throw new Error("Plan produced no compact days");

    // Build a skeleton string listing ALL days for cross-day context.
    const skeleton = compact
      .map((d) => {
        const titles = (d.highlights || []).map((h) => h.title).join(", ");
        return `${d.label} — ${d.city}${d.hotel ? ` (hotel: ${d.hotel})` : ""}\n  Highlights: ${titles}\n  ${d.description || ""}`.trim();
      })
      .join("\n\n");

    // ─────────────────────────────────────────────────────────────
    // PHASE 2 — parallel DAY-FILL calls (Promise.all over compact)
    // ─────────────────────────────────────────────────────────────
    interface DayResult {
      day: any;
      usage: AnthropicUsage;
    }

    const errors: { day: string; error: string }[] = [];

    async function fillOne(day: CompactDay): Promise<DayResult> {
      const titles = (day.highlights || []).map((h) => h.title).join(", ");
      const dayUser =
        userMessage +
        "\n\n──── AGREED WHOLE-TRIP PLAN (all days) ────\n" +
        skeleton +
        "\n\n──── YOUR TASK ────\nProduce ONLY the detailed day object for " +
        day.label +
        " in " +
        day.city +
        ". Expand THIS day's highlights (" +
        titles +
        ") into a full schedule. NEVER use any place assigned to a different day in the plan above.";

      const attempt = async (): Promise<DayResult> => {
        const res = await callAnthropic(DAYFILL_SYSTEM, dayUser, 2600);
        const parsed = JSON.parse(stripFences(res.text));
        return { day: parsed, usage: res.usage };
      };

      try {
        return await attempt();
      } catch (e1) {
        console.error(
          `Day-fill failed for ${day.label}, retrying:`,
          e1.message,
        );
        try {
          return await attempt();
        } catch (e2) {
          console.error(`Day-fill failed twice for ${day.label}:`, e2.message);
          errors.push({ day: day.label, error: e2.message });
          return {
            day: {
              label: day.label,
              city: day.city,
              activities: [],
              wishlist: [],
            },
            usage: {},
          };
        }
      }
    }

    const expandStart = Date.now();
    const dayResults = await Promise.all(compact.map((d) => fillOne(d)));
    const expandMs = Date.now() - expandStart;

    const days = dayResults.map((r) => r.day);
    const totalMs = Date.now() - totalStart;

    // Assemble the final itinerary — same shape as variant A's streamed JSON.
    const result = {
      name: plan.name,
      summary: plan.summary,
      cities: plan.cities,
      compact: plan.compact,
      days,
    };

    // ─────────────────────────────────────────────────────────────
    // Timing + usage — sum tokens across ALL calls (plan + every day)
    // ─────────────────────────────────────────────────────────────
    const allUsages: AnthropicUsage[] = [
      planResult.usage,
      ...dayResults.map((r) => r.usage),
    ];
    const sum = (fn: (u: AnthropicUsage) => number | undefined) =>
      allUsages.reduce((acc, u) => acc + (fn(u) || 0), 0);
    const inputTokens = sum((u) => u.input_tokens);
    const outputTokens = sum((u) => u.output_tokens);
    const cacheCreationTokens = sum((u) => u.cache_creation_input_tokens);
    const cacheReadTokens = sum((u) => u.cache_read_input_tokens);

    // Log LLM usage + deduct credits — fire-and-forget via runInBackground so the
    // isolate is not reclaimed before they run (mirrors variant A).
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
            function_name: "generate-itinerary-parallel",
            model: "claude-sonnet-4-6",
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_tokens: cacheCreationTokens,
            cache_read_tokens: cacheReadTokens,
            duration_ms: totalMs,
          }),
        }).catch(() => {});

        await deductCredits({
          userId: user.id,
          model: "claude-sonnet-4-6",
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          functionName: "generate-itinerary-parallel",
          tripId: tripId || null,
          source,
        });
      })(),
    );

    return new Response(
      JSON.stringify({
        itinerary: result,
        timing: { planMs, expandMs, totalMs, dayCount: compact.length },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        errors,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Function error:", err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
