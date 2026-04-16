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
      return `ROUTE id="${r.id}" [${i + 1}/${routes.length}] ${r.title}
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

CURRENT ROUTE OPTIONS:
${routeSummary}

RULES:
- INTENT: Answer questions about the routes OR modify them when the user requests a clear change. Keep "message" conversational, 2-3 sentences max.
- MUTATION: When the user asks to change a route (e.g. "add Ella to the hills route", "make route 2 slower", "change the scuba route to include Yala instead"), include an "updatedRoutes" array with the modified route objects. Each must include the route's original id, plus whichever fields changed. Unchanged fields can be omitted, but it's safer to return the full route object.
- NO MUTATION: For questions, comparisons, or informational answers, DO NOT include updatedRoutes. Respond conversationally.
- Respect the existing 4-route structure. Don't add new routes. Don't remove routes.
- MAINTAIN INVARIANTS: If you modify a route, ensure (a) its "city" field lists every city/town named in its days outline in travel order, (b) every day has a readable phrase naming the place and activity, (c) if the traveller's notes mention a requirement (e.g. scuba), reflect compatibility in "points".
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
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error: ${err}`);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || "{}";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    let data: any = { message: "Done." };
    try {
      data = JSON.parse(text.slice(start, end + 1));
      if (!data.message) data.message = "Done.";
    } catch {
      data = { message: text };
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
