import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You extract travel preferences from user notes and chat history.

Return a JSON object with exactly these fields:
- budget: one of "budget", "mid", or "luxury" (default "mid")
- morningStart: one of "early", "mid", or "late" (default "early")
- pace: one of "active", "moderate", or "relaxed" (default "active")

Clues to look for:
- Budget: "cheap", "backpacker", "hostel", "budget" → "budget". "luxury", "5 star", "fine dining", "splurge", "premium" → "luxury". Otherwise "mid".
- Morning: "sleep in", "late start", "no early mornings", "lazy" → "late". "mid morning", "10am" → "mid". "early bird", "sunrise", "packed day" → "early".
- Pace: "relaxed", "chill", "slow", "take it easy", "not rushed" → "relaxed". "moderate", "balanced" → "moderate". "packed", "active", "see everything", "adventurous" → "active".

If there are no clues for a field, return null for that field (not the default).
Return ONLY the JSON object, no explanation.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { notes, chatHistory } = await req.json();

    // Build user message from available context
    const parts: string[] = [];
    if (notes?.trim()) parts.push(`User notes: "${notes.trim()}"`);
    if (chatHistory?.length) {
      const chatText = chatHistory
        .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
        .slice(-10) // last 10 messages max
        .join("\n");
      parts.push(`Chat history:\n${chatText}`);
    }

    if (!parts.length) {
      return new Response(
        JSON.stringify({ budget: null, morningStart: null, pace: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const Anthropic = (await import("npm:@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const parsed = JSON.parse(text);

    return new Response(
      JSON.stringify({
        budget: ["budget", "mid", "luxury"].includes(parsed.budget) ? parsed.budget : null,
        morningStart: ["early", "mid", "late"].includes(parsed.morningStart) ? parsed.morningStart : null,
        pace: ["active", "moderate", "relaxed"].includes(parsed.pace) ? parsed.pace : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ budget: null, morningStart: null, pace: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
