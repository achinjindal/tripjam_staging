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
    const { screen, trip, routes, days, form, message, history } = await req.json();

    // ── Build context based on current screen ──
    const isBrainstorm = screen === "brainstorm";
    const isItinerary = screen === "itinerary";

    // Route summary (for brainstorm context)
    const routeSummary = (routes || []).map((r: any, i: number) => {
      const points = (r.points || []).map((p: any) => `  • ${p.good === false ? "✗" : "✓"} ${p.text}`).join("\n");
      const dayLines = (r.days || []).map((d: string, di: number) => `    Day ${di + 1}: ${d}`).join("\n");
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
    }).join("\n\n");

    // Itinerary summary (for itinerary context)
    const itinerarySummary = (days || []).map((d: any) => {
      const acts = (d.activities || []).map((a: any) => `${a.time} ${a.title}`).join(", ");
      const gems = d.wishlist?.length ? ` | Local gems: ${d.wishlist.map((w: any) => w.title).join(", ")}` : "";
      return `${d.label} - ${d.city}: ${acts}${gems}`;
    }).join("\n");

    // Logistics
    const fmtTime = (iso: string) => iso ? iso.split("T")[1]?.substring(0, 5) : null;
    const logisticsParts: string[] = [];
    if (trip?.arrival_time) {
      const t = fmtTime(trip.arrival_time);
      logisticsParts.push(`Arrival: ${t}${trip.arrival_city ? ` at ${trip.arrival_city}` : ""}${trip.arrival_mode ? ` (${trip.arrival_mode})` : ""} on Day 1`);
    }
    if (trip?.departure_time) {
      const t = fmtTime(trip.departure_time);
      const lastDay = days?.[days.length - 1]?.label || "last day";
      logisticsParts.push(`Departure: ${t}${trip.departure_city ? ` from ${trip.departure_city}` : ""}${trip.departure_mode ? ` (${trip.departure_mode})` : ""} on ${lastDay}`);
    }
    const logisticsNote = logisticsParts.length ? `\nLogistics: ${logisticsParts.join(" · ")}` : "";

    // Form info
    const formInfo = form ? `
TRAVELLER PREFERENCES:
- Destinations: ${(form.destinations || []).join(", ")}
- Travel month: ${form.startDate ? new Date(form.startDate).toLocaleString("en-US", { month: "long" }) : "not set"}
- Duration: ${form.startDate && form.endDate ? Math.max(1, Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 864e5) + 1) + " days" : "not set"}
- Travelers: ${form.travelers || "not set"}
- Budget: ${form.budget || "not set"}
- Notes: ${form.notes || "none"}` : "";

    const systemPrompt = `You are Trippy, a friendly travel planning assistant. Refer to yourself as Trippy if asked.

CURRENT SCREEN: ${isBrainstorm ? "ROUTE PLANNING (pre-trip)" : isItinerary ? "ITINERARY (trip built)" : "GENERAL"}
${trip ? `Trip: ${trip.name} (${trip.destination})${logisticsNote}` : ""}
${formInfo}
${isBrainstorm && routeSummary ? `\nCURRENT PLAN OPTIONS:\n${routeSummary}` : ""}
${isItinerary && itinerarySummary ? `\nITINERARY:\n${itinerarySummary}` : ""}

═══════════════════════════════════════════════
ACTIONS — You can perform these actions by including an "actions" array in your response.
Each action is an object with a "type" field and action-specific data.

AVAILABLE ACTIONS:
${isBrainstorm ? `
1. update_route — Modify an existing plan's fields (title, days, cities, points, etc.)
   {"type":"update_route","route":{...full route object with id...}}
   RULES:
   - Always include the route's original "id"
   - Return the ENTIRE route object — all fields: id, title, tagline, tier, category, icon, city, days, bestFor, warning, recommended, points
   - "days" MUST be an array of complete descriptive strings. NEVER placeholders.
   - "points" format: [{"text":"...","good":true|false}] — text must NOT start with ✓/✗/•/-
   - "city" field must list every city named in days, comma-separated, in travel order
   - PRESERVE trip duration (days array length) unless user explicitly asks to change it
   - You CAN completely replace a plan with a different destination/theme if asked

2. dismiss_route — Remove plan(s) from view (user can undo)
   Single: {"type":"dismiss_route","routeId":"..."}
   Bulk: {"type":"dismiss_route","routeIds":["id1","id2","id3"]}
   Use routeIds (array) when dismissing multiple plans at once. Use the actual id values from the plan data above.
   Use when user says "remove P3", "dismiss P2", "clear all plans", "dismiss P1 to P6", etc.

3. generate_more_plans — Trigger generation of additional plan options
   {"type":"generate_more_plans"}
   Use when user says "show me more options", "suggest more destinations", "I want more choices"
` : ""}
${isItinerary ? `
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
   - Include "wishlist" array: 3-5 local gems near that day's area
   - Only include days that actually changed
   - DEPARTURE CONSTRAINT: last day activities must finish before departure time

2. suggest — Show alternatives without changing the itinerary
   {"type":"suggest","suggestions":[{title, geocode, note, icon, type},...]}
   For hotel suggestions add: area, price ("$"/"$$"/"$$$"/"$$$$"), bullets (3 phrases)
` : ""}
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
${isBrainstorm ? "- When modifying ALL plans, return the first 3 in actions and include {\"type\":\"pending_routes\",\"routeIds\":[...remaining ids...]} for the app to handle automatically." : ""}

Example (brainstorm):
{"message":"Made P2 more relaxed — swapped the packed Day 3 for a beach day in Mirissa.","actions":[{"type":"update_route","route":{...full P2 object...}}]}

Example (itinerary):
{"message":"Replaced Day 3 lunch with Trishna in Colaba — one of Mumbai's best seafood spots.","actions":[{"type":"update_day","day":{"label":"Day 3","city":"Mumbai","activities":[...],"wishlist":[...]}}]}

Example (no change):
{"message":"P1 is the best fit for beach lovers — it covers the south coast with minimal driving."}

Example (multi-action):
{"message":"Added your hotel booking to bookmarks and a reminder to your to-do list.","actions":[{"type":"add_bookmark","title":"Taj Hotel","url":"https://booking.com/taj"},{"type":"add_todo","text":"Confirm Taj Hotel reservation","category":"Bookings","due_date":"1 week before"}]}`;

    // Clean history
    const cleanHistory = (history || [])
      .filter((m: any) => m.content && m.content.trim() && !m.streaming)
      .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }))
      .reduce((acc: any[], m: any) => {
        if (acc.length > 0 && acc[acc.length - 1].role === m.role) {
          acc[acc.length - 1] = { ...acc[acc.length - 1], content: acc[acc.length - 1].content + "\n" + m.content };
        } else {
          acc.push(m);
        }
        return acc;
      }, []);
    const trimmed = cleanHistory[0]?.role === "assistant" ? cleanHistory.slice(1) : cleanHistory;
    const recent = trimmed.slice(-6); // Keep last 6 messages to cap input token cost
    const messages = [...recent, { role: "user", content: message }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        stream: true,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error: ${err}`);
    }

    // Stream-accumulate
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
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
            accumulated += event.delta.text;
          }
        } catch { /* skip */ }
      }
    }

    // Log LLM usage (fire-and-forget, approximate tokens)
    const requestBodyStr = JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      stream: true,
      system: systemPrompt,
      messages,
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        trip_id: trip?.id || null,
        function_name: "chat",
        model: "claude-sonnet-4-6",
        input_tokens: Math.round(requestBodyStr.length / 4),
        output_tokens: Math.round(accumulated.length / 4),
      }),
    }).catch(() => {});

    const start = accumulated.indexOf("{");
    const end = accumulated.lastIndexOf("}");
    let data: any = { message: "Done." };
    try {
      data = JSON.parse(accumulated.slice(start, end + 1));
      if (!data.message) data.message = "Done.";
    } catch {
      data = { message: accumulated };
    }

    // Backwards compat: convert old-style updatedRoutes/updatedDays to actions format
    if (data.updatedRoutes && !data.actions) {
      data.actions = data.updatedRoutes.map((r: any) => ({ type: "update_route", route: r }));
      if (data.pendingRoutes) {
        data.actions.push({ type: "pending_routes", routeIds: data.pendingRoutes });
      }
      delete data.updatedRoutes;
      delete data.pendingRoutes;
    }
    if (data.updatedDays && !data.actions) {
      data.actions = data.updatedDays.map((d: any) => ({ type: "update_day", day: d }));
      if (data.suggestions) {
        data.actions.push({ type: "suggest", suggestions: data.suggestions });
      }
      delete data.updatedDays;
      delete data.suggestions;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("chat error:", err.message);
    return new Response(JSON.stringify({ error: err.message, message: "Sorry, something went wrong." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
