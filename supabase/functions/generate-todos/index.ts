import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a travel planning assistant. Generate a practical pre-trip to-do checklist tailored to the specific trip.

Rules:
- Generate 15–20 items total across all categories
- Each item must be a clear, specific, actionable task (not vague advice)
- Tailor items to the destination, travel style, budget, and dates given
- Include destination-specific items (e.g. visa requirements, local transport cards, vaccination needs)
- Categories: Bookings | Documents | Packing | Health & safety | Money | Day of travel
- Due dates: assign a realistic due_date to each item relative to the trip. Use these labels:
  "2 months before" — visa applications, major bookings
  "1 month before" — vaccinations, travel insurance, transport passes
  "2 weeks before" — packing, currency exchange, confirmations
  "1 week before" — final checks, downloads, copies
  "Day before" — last-minute packing, charge devices
  "Day of travel" — airport/station tasks, check-in

Return ONLY a raw JSON array. No markdown, no code fences. Start with [ and end with ].
Each item: {"text": "...", "category": "...", "due_date": "..."}

Example:
[
  {"text": "Book train from Mumbai to Goa in advance — sells out fast", "category": "Bookings", "due_date": "1 month before"},
  {"text": "Check visa-on-arrival eligibility for your passport", "category": "Documents", "due_date": "2 months before"},
  {"text": "Pack reef-safe sunscreen — regular sunscreen banned at some beaches", "category": "Packing", "due_date": "2 weeks before"}
]`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { trip } = await req.json();

    const budgetLabel = { budget: "budget", mid: "mid-range", luxury: "luxury" }[trip.budget] || "mid-range";
    const travelMonth = trip.start_date
      ? new Date(trip.start_date).toLocaleString("en-US", { month: "long", year: "numeric" })
      : null;

    const userMessage = `Generate a to-do checklist for this trip:
- Destination: ${trip.destination}
- Travelers: ${trip.travelers || 2} people
- Budget: ${budgetLabel}
- Style: ${(trip.styles || []).join(", ") || "mixed"}
- Travel mode: ${trip.arrival_mode || "flight"}${travelMonth ? `\n- Travel dates: ${travelMonth}` : ""}${trip.notes ? `\n- Notes: ${trip.notes}` : ""}`;

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
