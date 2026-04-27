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
    const { routes, form, message, history } = await req.json();

    const routeSummary = (routes || []).map((r: any, i: number) => {
      const points = (r.points || []).map((p: any) => `  • ${p.good === false ? "✗" : "✓"} ${p.text}`).join("\n");
      const days = (r.days || []).map((d: string, di: number) => `    Day ${di + 1}: ${d}`).join("\n");
      return `PLAN P${i + 1} (id="${r.id}") — ${r.title}
  Cities: ${r.city || ""}
  Tagline: ${r.tagline || ""}
  Best for: ${r.bestFor || ""}
  Warning: ${r.warning || "none"}
  Recommended: ${r.recommended ? "YES" : "no"}
  Days:
${days}
  Points:
${points}`;
    }).join("\n\n");

    const systemPrompt = `You are a travel planning assistant helping the traveller shape their itinerary route BEFORE the full itinerary is generated.

TRAVELLER FORM:
- Destinations: ${(form.destinations || []).join(", ")}
- Travel month: ${form.startDate ? new Date(form.startDate).toLocaleString("en-US", { month: "long" }) : "not set"}
- Duration: ${form.startDate && form.endDate ? Math.max(1, Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 864e5) + 1) + " days" : "not set"}
- Travelers: ${form.travelers || "not set"}
- Styles: ${(form.styles || []).join(", ") || "not set"}
- Budget: ${form.budget || "not set"}
- Notes: ${form.notes || "none"}

CURRENT PLAN OPTIONS:
${routeSummary}

RULES:
- PLAN LABELS: Plans are labelled P1, P2, P3, P4 in the UI. Always refer to plans by their label (e.g. "P2" not "route 2" or the full title). When the user says "P2", they mean the plan labelled P2 above.
- INTENT: Answer questions about the plans OR modify them when the user requests a clear change. Keep "message" conversational, 2-3 sentences max. Always reference the plan label (P1–P4) in your response.
- MUTATION: When the user asks to change a plan (e.g. "add Ella to P2", "make P3 slower", "rename P1 to Beach Paradise", "change the title of P2"), include an "updatedRoutes" array with the modified route objects. You CAN change ANY field including title, tagline, icon, days, cities, points, bestFor, warning. Each must include the route's original id, plus whichever fields changed. Unchanged fields can be omitted, but it's safer to return the full route object.
- NO MUTATION: For questions, comparisons, or informational answers, DO NOT include updatedRoutes. Respond conversationally.
- You CAN completely replace a plan with a different destination/theme if the user asks (e.g. "Replace P3 with a Portugal plan", "Make P2 about food instead"). Return the full updated plan object with the same id.
- When only 1-3 routes need changing, return their full objects in "updatedRoutes".
- When ALL routes need changing (e.g. "make all plans kid-friendly", "add beach days to every plan"), return ONLY the FIRST 3 plans in "updatedRoutes" and include "pendingRoutes": [list of remaining route ids that still need the same change]. The app will apply the change to the remaining routes in follow-up calls automatically.
- PRESERVE TRIP DURATION: Each plan.s "days" array length MUST stay the same as the original UNLESS the user explicitly asks to add or remove days (e.g. "make it a 6-day trip", "can we add 2 more days?", "shorten to 3 days"). Reshuffling activities within the same number of days is fine. If the user DOES explicitly request a different duration, include a "durationChanged" field set to the new number of days (e.g. "durationChanged": 6) alongside the updated plan — this tells the app to adjust the trip dates.
- MAINTAIN INVARIANTS: If you modify a plan, ensure (a) its "city" field lists every city/town named in its days outline in travel order, (b) every day has a readable phrase naming the place and activity, (c) if the traveller's notes mention a requirement (e.g. scuba), reflect compatibility in "points".
- DAYS FORMAT: "days" MUST be an array of complete descriptive strings, one per day. NEVER use numbers or short placeholders. Correct: ["Colombo → Galle (2.5h drive)", "Galle Fort walk and Unawatuna beach", "Day trip to Hikkaduwa for scuba", "Drive back to Colombo"]. WRONG: ["1","2","3","4"] or ["Day 1","Day 2"] or [{"day":1}]. When modifying a route, rewrite the FULL days array with complete descriptions — do NOT abbreviate or omit.
- ROUTE OBJECT COMPLETENESS: Always return the ENTIRE route object in "updatedRoutes" — all fields: id, title, tagline, tier, category, icon, city, days (full strings), bestFor, warning, recommended, points. Partial returns cause the UI to render broken data.
- POINTS FORMAT: Each point is { "text": "...", "good": true|false }. The "text" field must NOT start with ✓, ✗, •, or "-". The UI already renders a checkmark/cross based on the "good" boolean — don't duplicate it. Good: {"text":"Hikkaduwa has top scuba sites","good":true}. Bad: {"text":"✓ Hikkaduwa has top scuba sites","good":true}.
- If the user asks "which route is best for X", identify the most compatible route by title and explain briefly. Do NOT toggle "recommended".
- Keep drives honest for the destination. Don't invent routes that take travellers 6+ hours in a car.

Return ONLY a raw JSON object. No markdown, no code fences. Structure:
{"message": "short conversational response", "updatedRoutes": [{...full route...}]}

If no mutation, omit updatedRoutes:
{"message": "conversational answer"}`;

    // Clean history: only role+content, drop empty, ensure strict alternation
    const cleanHistory = (history || [])
      .filter((m: any) => m.content && m.content.trim())
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
    const messages = [...trimmed, { role: "user", content: message }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
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

    // Stream-accumulate to avoid Supabase EarlyDrop timeout
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

    const start = accumulated.indexOf("{");
    const end = accumulated.lastIndexOf("}");
    let data: any = { message: "Done." };
    try {
      data = JSON.parse(accumulated.slice(start, end + 1));
      if (!data.message) data.message = "Done.";
    } catch {
      data = { message: accumulated };
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("chat-brainstorm error:", err.message);
    return new Response(JSON.stringify({ error: err.message, message: "Sorry, something went wrong." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
