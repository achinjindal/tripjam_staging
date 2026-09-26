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
    "authorization, x-client-info, apikey, content-type, x-chat-stream",
};

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
      screen,
      trip,
      routes,
      days,
      form,
      message,
      history,
      spend_personal,
      members,
      sender,
      preferences,
    } = await req.json();

    // Pre-flight (Phase 2.5): resolve which wallet pays — personal for a solo
    // trip (byte-identical to before), the trip pool for a shared trip; a short
    // shared pool forks with code 'empty_trip_pool'. Requires >=1.0 so a partial
    // decimal at the boundary can't overdraw mid-call.
    const { gate, source } = await resolveAndGate(
      user,
      trip?.id || null,
      spend_personal === true,
      corsHeaders,
    );
    if (gate) return gate;

    // ── Build context based on current screen ──
    const isBrainstorm = screen === "brainstorm";
    const isItinerary = screen === "itinerary";

    // Route summary (for brainstorm context)
    const routeSummary = (routes || [])
      .map((r: any, i: number) => {
        const points = (r.points || [])
          .map((p: any) => `  • ${p.good === false ? "✗" : "✓"} ${p.text}`)
          .join("\n");
        const dayLines = (r.days || [])
          .map((d: string, di: number) => `    Day ${di + 1}: ${d}`)
          .join("\n");
        return `PLAN P${i + 1} (id="${r.id}") — ${r.title}
  Cities: ${r.city || ""}
  Tagline: ${r.tagline || ""}
  Best for: ${r.bestFor || ""}
  Warning: ${r.warning || "none"}
  Recommended: ${r.recommended ? "YES" : "no"}
  Days:
${dayLines}
  Points:
${points}`;
      })
      .join("\n\n");

    // Itinerary summary (for itinerary context)
    const itinerarySummary = (days || [])
      .map((d: any) => {
        const acts = (d.activities || [])
          .map((a: any) => `${a.time} ${a.title}`)
          .join(", ");
        const gems = d.wishlist?.length
          ? ` | Local gems: ${d.wishlist.map((w: any) => w.title).join(", ")}`
          : "";
        return `${d.label} - ${d.city}: ${acts}${gems}`;
      })
      .join("\n");

    // Logistics
    const fmtTime = (iso: string) =>
      iso ? iso.split("T")[1]?.substring(0, 5) : null;
    const logisticsParts: string[] = [];
    if (trip?.arrival_time) {
      const t = fmtTime(trip.arrival_time);
      logisticsParts.push(
        `Arrival: ${t}${trip.arrival_city ? ` at ${trip.arrival_city}` : ""}${trip.arrival_mode ? ` (${trip.arrival_mode})` : ""} on Day 1`,
      );
    }
    if (trip?.departure_time) {
      const t = fmtTime(trip.departure_time);
      const lastDay = days?.[days.length - 1]?.label || "last day";
      logisticsParts.push(
        `Departure: ${t}${trip.departure_city ? ` from ${trip.departure_city}` : ""}${trip.departure_mode ? ` (${trip.departure_mode})` : ""} on ${lastDay}`,
      );
    }
    const logisticsNote = logisticsParts.length
      ? `\nLogistics: ${logisticsParts.join(" · ")}`
      : "";

    // Form info
    const formInfo = form
      ? `
TRAVELLER PREFERENCES:
- Destinations: ${(form.destinations || []).join(", ")}
- Travel month: ${form.startDate ? new Date(form.startDate).toLocaleString("en-US", { month: "long" }) : "not set"}
- Duration: ${form.startDate && form.endDate ? Math.max(1, Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 864e5) + 1) + " days" : "not set"}
- Travelers: ${form.travelers || "not set"}
- Budget: ${form.budget || "not set"}
- Notes: ${form.notes || "none"}`
      : "";

    // ── System prompt split for prompt caching ──
    // The static instructions (identity, action vocabulary, response rules,
    // examples) depend only on the current screen, so they form a stable
    // cacheable prefix that is reused across every turn of a conversation.
    // The per-call trip/plan context lives in a separate, uncached block
    // appended after it.
    const staticInstructions = `You are Trippy, a friendly travel planning assistant. Refer to yourself as Trippy if asked.

CURRENT SCREEN: ${isBrainstorm ? "ROUTE PLANNING (pre-trip)" : isItinerary ? "ITINERARY (trip built)" : "GENERAL"}

═══════════════════════════════════════════════
ACTIONS — You can perform these actions by including an "actions" array in your response.
Each action is an object with a "type" field and action-specific data.

AVAILABLE ACTIONS:
${
  isBrainstorm
    ? `
1. update_route — Modify an existing plan's fields (title, days, cities, points, etc.)
   {"type":"update_route","route":{...full route object with id...}}
   RULES:
   - Always include the route's original "id"
   - Return the ENTIRE route object — all fields: id, title, tagline, tier, category, icon, city, days, bestFor, warning, recommended, points
   - "days" MUST be an array of complete descriptive strings. NEVER placeholders.
   - DAY-STRING FORMAT (must match the original generator exactly): highlight the key places in **bold** markdown — the overnight base city and 1-3 named sights/experiences per day (e.g. "Galle → **Mirissa** (1h), beach day, whale watching at **Mirissa Harbour**"). NEVER start a day string with "Day N:" or any day-number prefix — the UI renders its own day labels.
   - ALSO return "stops": the overnight bases in travel order as [{"city":"<base>","nights":<int≥1>}] — nights must sum to (days.length − 1); only cities where the traveller SLEEPS (day-trip destinations excluded).
   - When your "message" text describes any route's shape, write it as a nights-annotated chain: "Galle (2 nights) → Mirissa (2 nights) → Kandy (1 night)" — never a bare city list.
   - "points" format: [{"text":"...","good":true|false}] — text must NOT start with ✓/✗/•/-
   - "city" field must list every city named in days, comma-separated, in travel order
   - PRESERVE trip duration (days array length) unless user explicitly asks to change it
   - You CAN completely replace a plan with a different destination/theme if asked

2. dismiss_route — Remove plan(s) from view (user can undo)
   Single: {"type":"dismiss_route","routeId":"..."}
   Bulk: {"type":"dismiss_route","routeIds":["id1","id2","id3"]}
   REQUIRED: every dismiss_route action MUST include "routeId" (one plan) or "routeIds" (multiple) — NEVER emit a dismiss_route without it. Copy the exact id from the matching PLAN Pn (id="...") in the TRIP CONTEXT; do not invent or omit it. A dismiss_route with no routeId/routeIds is invalid and will do nothing.
   Use routeIds (array) when dismissing multiple plans at once.
   Use when user says "remove P3", "dismiss P2", "clear all plans", "dismiss P1 to P6", etc.

3. generate_more_plans — Trigger generation of additional plan options
   {"type":"generate_more_plans"}
   Use when user says "show me more options", "suggest more destinations", "I want more choices"
`
    : ""
}
${
  isItinerary
    ? `
1. update_day — Modify a day's activities in the itinerary
   {"type":"update_day","day":{...day object with label, city, activities, wishlist...}}
   RULES:
   - "label" MUST match exactly (e.g. "Day 1", "Day 3")
   - Each activity: time, title, geocode, type (sight/food/shop/transit/hotel), duration, note, icon
   - geocode: shortest plain name for maps (e.g. "Colaba Causeway" not "Colaba Causeway Street Market")
   - Transit geocode = departure point, geocodeEnd = arrival point (use station/airport names)
   - Use real specific place names — never generic "Lunch" or "Dinner"
   - Geography: meals must be in same neighbourhood as surrounding activities
   - Recalculate ALL times when changing activities — no gaps or overlaps
   - "wishlist": OMIT this field entirely when the day's gems are unchanged (the app keeps the existing ones). Only include it (3-5 local gems) when the day's area actually changed.
   - Only include days that actually changed
   - DEPARTURE CONSTRAINT: last day activities must finish before departure time

2. suggest — Show alternatives without changing the itinerary
   {"type":"suggest","context":"hotel"|"activity"|"food","city":"...","suggestions":[{title, geocode, note, icon, type, description, duration, distance_hint, cost_hint},...]}
   MANDATORY whenever you propose alternative places (hotels, activities, restaurants): 2-3 suggestions as this action, NEVER as prose descriptions. Keep "message" to 1-2 sentences that name each suggested place once.
   Per-item fields:
   - type: REQUIRED — "hotel" for hotel alternatives (this routes photos + booking links), else "sight"/"food"/"activity"
   - title + geocode: real, well-established places ONLY — fully-qualified geocode ("[Place], [area], [city], [country]"). If unsure a place exists under that exact name, pick a better-known one instead.
   - LOCATION SANITY: alternatives MUST be in the same town/area as the place they replace (walkable or a few minutes away). Never suggest a venue in a different town — e.g. an Oia restaurant is NOT an alternative to a Fira dinner.
   - note: what it IS, max 8 words
   - description: 1-2 sentences a traveler needs to DECIDE — what's there, why it fits their ask
   - duration: rough time needed (e.g. "~1.5h") — activities/food only
   - distance_hint: from the day's base or the place being replaced (e.g. "10 min walk from hotel")
   - cost_hint: e.g. "Free", "~€2 bus", "€€"
   For hotel suggestions add: area, price ("$"/"$$"/"$$$"/"$$$$"), bullets (3 phrases)
`
    : ""
}
ACTIONS AVAILABLE ON ALL SCREENS:

${isBrainstorm || isItinerary ? "" : ""}A. add_todo — Add an item to the trip checklist
   {"type":"add_todo","text":"...","category":"Bookings|Documents|Packing|Health & safety|Money|Day of travel","due_date":"2 weeks before"}

B. add_expense — Add a planned or actual expense
   {"type":"add_expense","title":"...","amount":500,"currency":"USD","category":"Stay|Transport|Food|Activities|Shopping|Other","is_planned":true}

C. add_bookmark — Save a link
   {"type":"add_bookmark","title":"...","url":"https://..."}

D. set_budget — Set the trip budget
   {"type":"set_budget","amount":3000}

E. navigate — Switch the user to a different tab
   {"type":"navigate","tab":"magazine|itinerary|map|board"}
   Use when user says "show me the map", "go to magazine", "open board"

═══════════════════════════════════════════════
RESPONSE RULES:
- Return ONLY a raw JSON object. No markdown, no code fences.
- "message": conversational response, 2-3 sentences max. Plain prose — no markdown headers, no bullet lists. Bold and italics OK.
- "actions": array of action objects. Omit if no actions needed (pure conversation).
- ACTION BIAS: When user asks for a change, DO IT immediately. Don't present options or ask clarifying questions unless genuinely ambiguous.
- HONESTY: If you cannot do something (e.g. book a flight, check real-time prices), say so. Never pretend an action was taken if it wasn't.
- PLAN LABELS: Refer to plans as P1, P2, etc. (not "route 2" or the full title).
- NO MARKDOWN in message: no ##, ---, or bullet-point lists.
${isBrainstorm ? '- When modifying ALL plans, return the first 3 in actions and include {"type":"pending_routes","routeIds":[...remaining ids...]} for the app to handle automatically.' : ""}

Example (brainstorm):
{"message":"Made P2 more relaxed — swapped the packed Day 3 for a beach day in Mirissa.","actions":[{"type":"update_route","route":{...full P2 object...}}]}

Example (itinerary):
{"message":"Replaced Day 3 lunch with Trishna in Colaba — one of Mumbai's best seafood spots.","actions":[{"type":"update_day","day":{"label":"Day 3","city":"Mumbai","activities":[...],"wishlist":[...]}}]}

Example (no change):
{"message":"P1 is the best fit for beach lovers — it covers the south coast with minimal driving."}

Example (multi-action):
{"message":"Added your hotel booking to bookmarks and a reminder to your to-do list.","actions":[{"type":"add_bookmark","title":"Taj Hotel","url":"https://booking.com/taj"},{"type":"add_todo","text":"Confirm Taj Hotel reservation","category":"Bookings","due_date":"1 week before"}]}`;

    // Group context (shared trips) — NOT cached, so this never busts the cached
    // static prefix. Only usernames are sent (no ids/emails). Empty for solo.
    const groupContext =
      Array.isArray(members) && members.length > 1
        ? `\n\nGROUP TRIP: ${members.length} people are planning together — ${members
            .map((m: any) => m?.name)
            .filter(Boolean)
            .join(
              ", ",
            )}. Messages below are prefixed with the speaker's name. When travelers want different things, don't just pick one — name the tension, propose a compromise that respects everyone, and attribute who wanted what. Address people by name.`
        : "";

    // Per-traveller preferences (shared trips) — NOT cached. The free-text
    // "travel style" each member shared, so Trippy plans for everyone and
    // attributes by name. Empty for solo or when nobody has shared.
    const prefsContext =
      Array.isArray(preferences) &&
      preferences.length > 0 &&
      Array.isArray(members) &&
      members.length > 1
        ? `\n\nPER-TRAVELER PREFERENCES (plan for everyone; attribute by name):\n${preferences
            .map((p: any) =>
              p?.name && p?.prefs_text ? `- ${p.name}: ${p.prefs_text}` : "",
            )
            .filter(Boolean)
            .join("\n")}`
        : "";

    // Per-call context — NOT cached (changes every request).
    const dynamicContext = `TRIP CONTEXT (specific to this request)
${trip ? `Trip: ${trip.name} (${trip.destination})${logisticsNote}` : ""}
${formInfo}
${isBrainstorm && routeSummary ? `\nCURRENT PLAN OPTIONS:\n${routeSummary}` : ""}
${isItinerary && itinerarySummary ? `\nITINERARY:\n${itinerarySummary}` : ""}${groupContext}${prefsContext}`;

    // Clean history. On group trips, prefix each human turn with its author so
    // Trippy can attribute across speakers; assistant turns are left bare.
    const cleanHistory = (history || [])
      .filter((m: any) => m.content && m.content.trim() && !m.streaming)
      .map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content:
          m.role !== "assistant" && m.author
            ? `${m.author}: ${String(m.content)}`
            : String(m.content),
      }))
      .reduce((acc: any[], m: any) => {
        if (acc.length > 0 && acc[acc.length - 1].role === m.role) {
          acc[acc.length - 1] = {
            ...acc[acc.length - 1],
            content: acc[acc.length - 1].content + "\n" + m.content,
          };
        } else {
          acc.push(m);
        }
        return acc;
      }, []);
    const trimmed =
      cleanHistory[0]?.role === "assistant"
        ? cleanHistory.slice(1)
        : cleanHistory;
    const recent = trimmed.slice(-6); // Keep last 6 messages to cap input token cost
    // Attribute the incoming turn too, so Trippy knows who's asking in a group.
    const currentContent =
      groupContext && sender ? `${sender}: ${message}` : message;
    const messages = [...recent, { role: "user", content: currentContent }];

    // ── Provider switch: CHAT_MODEL env var selects the chat model per env.
    // Unset → Sonnet 4.6. A "claude-*" id routes the Anthropic path below with
    // that model (threaded through the request AND billing — it was hardcoded
    // before, which would have billed a Haiku A/B at Sonnet rates). A
    // "gemini-*" id → Gemini non-streaming path (returns full JSON).
    const chatModel = Deno.env.get("CHAT_MODEL") || "claude-sonnet-4-6";

    const requestBody = JSON.stringify({
      model: chatModel,
      max_tokens: 8192,
      // Claude 5 family: thinking is on by default and its tokens count
      // against max_tokens (see generate-itinerary) — disable for chat.
      ...(chatModel.startsWith("claude-sonnet-5")
        ? { thinking: { type: "disabled" } }
        : {}),
      stream: true,
      // Static instructions are cached; per-call context is not.
      system: [
        {
          type: "text",
          text: staticInstructions,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: dynamicContext },
      ],
      messages,
    });
    if (chatModel.startsWith("gemini")) {
      const gResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${chatModel}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: staticInstructions + "\n\n" + dynamicContext }],
            },
            contents: (
              messages as Array<{ role: string; content: string }>
            ).map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: 4000,
              responseMimeType: "application/json",
            },
          }),
        },
      );
      if (!gResp.ok) {
        const e = await gResp.text();
        throw new Error(`Gemini error: ${e}`);
      }
      const gdata = (await gResp.json()) as any;
      const content: string =
        gdata.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      // Log usage only (credit deduction on the canary path is skipped — the
      // credit cost model is Anthropic-priced; resolveAndGate above still ran).
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
            trip_id: trip?.id || null,
            function_name: "chat",
            model: chatModel,
            input_tokens: gdata.usageMetadata?.promptTokenCount || 0,
            output_tokens: gdata.usageMetadata?.candidatesTokenCount || 0,
          }),
        })
          .then(() => {})
          .catch(() => {}),
      );

      // Parse the same way the Anthropic path does: first `{` / last `}`.
      const gStart = content.indexOf("{");
      const gEnd = content.lastIndexOf("}");
      let data: any = { message: "Done." };
      try {
        data = JSON.parse(content.slice(gStart, gEnd + 1));
        if (!data.message) data.message = "Done.";
      } catch {
        data = { message: content };
      }

      // Backwards compat: convert old-style updatedRoutes/updatedDays to actions.
      if (data.updatedRoutes && !data.actions) {
        data.actions = data.updatedRoutes.map((r: any) => ({
          type: "update_route",
          route: r,
        }));
        if (data.pendingRoutes) {
          data.actions.push({
            type: "pending_routes",
            routeIds: data.pendingRoutes,
          });
        }
        delete data.updatedRoutes;
        delete data.pendingRoutes;
      }
      if (data.updatedDays && !data.actions) {
        data.actions = data.updatedDays.map((d: any) => ({
          type: "update_day",
          day: d,
        }));
        if (data.suggestions) {
          data.actions.push({ type: "suggest", suggestions: data.suggestions });
        }
        delete data.updatedDays;
        delete data.suggestions;
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Latency: time from just before the Anthropic request to when the stream
    // finishes (written to llm_usage.duration_ms below).
    const __anthropicStart = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: requestBody,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error: ${err}`);
    }

    // ── True streaming to the client (opt-in via the x-chat-stream header so
    // OLD deployed clients — which res.json() the body — keep getting buffered
    // JSON from this same handler). The model's reply is raw JSON with the
    // "message" field FIRST; we extract that string incrementally server-side
    // (escape-safe across chunk boundaries) and re-emit clean SSE events:
    //   data: {"type":"delta","text":"..."}   — conversational text, as written
    //   data: {"type":"final","data":{...}}   — full parsed {message, actions}
    //   data: [DONE]
    // The client renders deltas into the bubble immediately and applies
    // actions on "final". Non-streaming responses (Gemini path, 402s, errors)
    // stay application/json — the client branches on Content-Type.
    const wantsStream = req.headers.get("x-chat-stream") === "1";
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const sendEvent = (obj: unknown) => {
      if (!wantsStream) return Promise.resolve();
      return writer
        .write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        .catch(() => {});
    };

    // Incremental extractor for the "message" string in streaming JSON. Holds
    // partial escape sequences (\", \n, \uXXXX) across chunk boundaries.
    const extractor = {
      raw: "",
      inStr: false,
      strDone: false,
      scanPos: 0,
      esc: "",
      decoded: "",
      push(chunk: string): string {
        this.raw += chunk;
        if (this.strDone) return "";
        if (!this.inStr) {
          const m = this.raw.match(/"message"\s*:\s*"/);
          if (!m) return "";
          this.inStr = true;
          this.scanPos = (m.index ?? 0) + m[0].length;
        }
        let out = "";
        while (this.scanPos < this.raw.length) {
          const ch = this.raw[this.scanPos];
          if (this.esc) {
            this.esc += ch;
            const complete =
              this.esc[1] === "u"
                ? this.esc.length === 6
                : this.esc.length === 2;
            if (complete) {
              try {
                out += JSON.parse(`"${this.esc}"`);
              } catch {
                /* drop malformed escape */
              }
              this.esc = "";
            }
            this.scanPos++;
            continue;
          }
          if (ch === "\\") {
            this.esc = "\\";
            this.scanPos++;
            continue;
          }
          if (ch === '"') {
            this.strDone = true;
            this.scanPos++;
            break;
          }
          out += ch;
          this.scanPos++;
        }
        this.decoded += out;
        return out;
      },
    };

    const pump = (async () => {
      const usage = newStreamUsage();
      let accumulated = "";
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
                accumulated += event.delta.text;
                const fresh = extractor.push(event.delta.text);
                if (fresh) await sendEvent({ type: "delta", text: fresh });
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        console.error("chat stream error:", (e as Error).message);
      }

      // Parse the complete reply. If parsing fails, prefer the cleanly
      // extracted message (already streamed) over dumping raw JSON-ish text.
      const start = accumulated.indexOf("{");
      const end = accumulated.lastIndexOf("}");
      let data: any = { message: "Done." };
      try {
        data = JSON.parse(accumulated.slice(start, end + 1));
        if (!data.message) data.message = "Done.";
      } catch {
        data = { message: extractor.decoded || accumulated };
      }

      // Backwards compat: convert old-style updatedRoutes/updatedDays to actions format
      if (data.updatedRoutes && !data.actions) {
        data.actions = data.updatedRoutes.map((r: any) => ({
          type: "update_route",
          route: r,
        }));
        if (data.pendingRoutes) {
          data.actions.push({
            type: "pending_routes",
            routeIds: data.pendingRoutes,
          });
        }
        delete data.updatedRoutes;
        delete data.pendingRoutes;
      }
      if (data.updatedDays && !data.actions) {
        data.actions = data.updatedDays.map((d: any) => ({
          type: "update_day",
          day: d,
        }));
        if (data.suggestions) {
          data.actions.push({ type: "suggest", suggestions: data.suggestions });
        }
        delete data.updatedDays;
        delete data.suggestions;
      }

      await sendEvent({ type: "final", data });
      if (wantsStream) {
        await writer.write(encoder.encode("data: [DONE]\n\n")).catch(() => {});
        await writer.close().catch(() => {});
      }

      // Prefer the API's real token counts; fall back to a length estimate only
      // if the usage events never arrived (so billing never silently zeroes out).
      const durationMs = Date.now() - __anthropicStart;
      const inputTokens = hasStreamUsage(usage)
        ? usage.inputTokens
        : Math.round(requestBody.length / 4);
      const outputTokens =
        usage.outputTokens || Math.round(accumulated.length / 4);
      const cacheCreationTokens = usage.cacheCreationTokens;
      const cacheReadTokens = usage.cacheReadTokens;

      // Log LLM usage + deduct credits. Wrapped in runInBackground so the
      // isolate stays alive until both complete (see runInBackground docs).
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
              trip_id: trip?.id || null,
              function_name: "chat",
              model: chatModel,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_creation_tokens: cacheCreationTokens,
              cache_read_tokens: cacheReadTokens,
              duration_ms: durationMs,
            }),
          }).catch(() => {});

          await deductCredits({
            userId: user.id,
            model: chatModel,
            inputTokens,
            outputTokens,
            cacheCreationTokens,
            cacheReadTokens,
            functionName: "chat",
            tripId: trip?.id || null,
            source,
          });
        })(),
      );
      return data;
    })();
    // Keep the isolate alive for the WHOLE pump, not just the trailing log —
    // a client disconnect mid-stream must still land the usage row and the
    // credit deduction (Anthropic billed the tokens either way).
    runInBackground(pump.then(() => {}));

    if (!wantsStream) {
      const data = await pump;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("chat error:", err.message);
    return new Response(
      JSON.stringify({
        error: err.message,
        message: "Sorry, something went wrong.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
