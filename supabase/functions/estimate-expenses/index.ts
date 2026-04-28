import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a travel budget estimator. Generate realistic cost estimates for a trip.

Rules:
- Generate 8–12 expense items covering all major categories
- Categories: Stay | Transport | Food | Activities | Shopping | Other
- Use USD amounts — be realistic for the destination and budget level
- Stay: total accommodation cost for all nights
- Transport: flights, trains, local transport, taxis
- Food: daily food budget × number of days (break into a few line items if useful)
- Activities: entry fees, tours, experiences mentioned in the itinerary
- Shopping: a reasonable estimate based on budget level
- Be specific in titles (e.g. "3 nights at mid-range hotel in Tokyo" not "Hotel")

Return ONLY a raw JSON array. No markdown, no code fences.
Each item: {"title": "...", "amount": number, "category": "Stay|Transport|Food|Activities|Shopping|Other"}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { trip } = await req.json();

    const igReq = trip.ig_request || {};
    const budgetLabel = { budget: "budget", mid: "mid-range", luxury: "luxury" }[igReq.budget] || "mid-range";
    const numDays = (trip.start_date && trip.end_date)
      ? Math.max(1, Math.round((new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 864e5) + 1)
      : 5;

    const userMessage = `Estimate costs for:
- Destination: ${trip.destination}
- Duration: ${numDays} days
- Travelers: ${igReq.travelers || 2}
- Budget: ${budgetLabel}
- Style: ${(igReq.styles || []).join(", ") || "mixed"}${trip.notes ? `\n- Notes: ${trip.notes}` : ""}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
    const data = await response.json();
    const text = data.content[0].text.trim();

    let items = [];
    try {
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      items = JSON.parse(text.slice(start, end + 1));
    } catch {
      items = [];
    }

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, items: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
