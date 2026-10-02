// Diagnostic probe: inspect Sonnet 5 non-streamed response shape (stop_reason,
// content block types, usage) at day-fill-sized max_tokens. Staging-only tool.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const j = (o: unknown) =>
    new Response(JSON.stringify(o), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (!key) return j({ error: "ANTHROPIC_API_KEY not set" });
  const url = new URL(req.url);
  const model = url.searchParams.get("model") || "claude-sonnet-5";
  const maxTokens = Number(url.searchParams.get("max") || 3500);
  const started = Date.now();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(url.searchParams.get("think") === "off"
        ? { thinking: { type: "disabled" } }
        : url.searchParams.get("think")
          ? {
              thinking: {
                type: "enabled",
                budget_tokens: Number(url.searchParams.get("think")),
              },
            }
          : {}),
      stream: false,
      system:
        "You output travel data as raw MINIFIED JSON only — no code fences, no prose. Start with { end with }.",
      messages: [
        {
          role: "user",
          content:
            'Produce a detailed one-day Kyoto itinerary as minified JSON: {"label":"Day 1","city":"...","story_title":"...","narrative":"2-3 sentences","description":"2-3 sentences","activities":[8 items each with time,title,geocode,type,duration,gloss,photo_query,icon],"wishlist":[3 items with title,geocode,near]}',
        },
      ],
    }),
  });
  const d = await r.json();
  const blocks = (d.content || []).map(
    (b: { type?: string; text?: string; thinking?: string }) => ({
      type: b.type,
      textLen: (b.text || "").length,
      thinkingLen: (b.thinking || "").length,
    }),
  );
  const text = (d.content || [])
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text || "")
    .join("");
  let parseOk = true;
  let parseErr = "";
  try {
    JSON.parse(text.trim());
  } catch (e) {
    parseOk = false;
    parseErr = e.message;
  }
  return j({
    status: r.status,
    ms: Date.now() - started,
    stop_reason: d.stop_reason,
    usage: d.usage,
    blocks,
    parseOk,
    parseErr,
    textHead: text.slice(0, 120),
    textTail: text.slice(-80),
    apiError: d.error,
  });
});
