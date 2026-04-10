import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a travel expert who generates a curated list of things to do, see, and eat in a destination.

Rules:
- Only suggest SPECIFIC named places -- e.g. "Bun Cha Huong Lien", "Hoan Kiem Lake", "Train Street". Never generic names like "Local Restaurant" or "City Park".
- Only well-established, reliably operating venues that are highly likely to still exist.
- Spread items proportionally across categories. Aim for roughly: 5-6 Sightseeing, 5-6 Dining, 3-4 Experiences, 2-3 Nightlife, 2-3 Nature, 2-3 Culture, 1-2 Shopping, 1-2 Day Trip (if relevant).
- For multi-destination trips, distribute items across cities -- tag each item with its city.
- CITY field: use neighbourhood/area name where relevant (e.g. "Old Quarter" not "Hanoi").
- NOTE: max 10 words, commas where natural, no quotes.
- ICON: single emoji matching the item.
- CATEGORY: must be one of: Sightseeing, Dining, Nightlife, Experiences, Shopping, Nature, Culture, Day Trip.

Return ONLY a raw JSON array. Absolutely no markdown, no code fences. Your entire response must start with [ and end with ].
Example: [{"title":"Bun Cha Huong Lien","city":"Old Quarter","category":"Dining","note":"Obama's famous bun cha spot, queue expected","icon":"🍜","geocode":"Bun Cha Huong Lien Hanoi"},{"title":"Hoan Kiem Lake","city":"Old Quarter","category":"Sightseeing","note":"Iconic lake, Ngoc Son Temple, morning walks","icon":"🏛️","geocode":"Hoan Kiem Lake"}]`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { destinations, styles, budget, travelMonth } = await req.json();

    const budgetLabel = { budget: "budget", mid: "mid-range", luxury: "luxury" }[budget] || "mid-range";
    const stylesText = (styles || []).join(", ");

    const userMessage = "Generate 20-25 things to do, see, and eat for: " + destinations.join(", ") + ".\n\n" +
      "Trip style: " + (stylesText || "general") + ", " + budgetLabel + " budget." +
      (travelMonth ? " Travel month: " + travelMonth + "." : "") + "\n\n" +
      "Cover all major categories. Only specific named places.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        temperature: 0.7,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error("Anthropic error: " + err);
    }

    // Forward text deltas as SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
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
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                await writer.write(encoder.encode("data: " + JSON.stringify(event.delta.text) + "\n\n"));
              }
            } catch { /* ignore parse errors */ }
          }
        }
      } finally {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error("generate-brainstorm error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
