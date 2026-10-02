const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("GEMINI_API_KEY");
  const j = (o: unknown) =>
    new Response(JSON.stringify(o), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (!key) return j({ error: "GEMINI_API_KEY not set" });
  const url = new URL(req.url);
  const B = "https://generativelanguage.googleapis.com/v1beta";
  if (url.searchParams.has("list")) {
    const r = await fetch(`${B}/models`, {
      headers: { "x-goog-api-key": key },
    });
    const d = await r.json();
    return j({
      status: r.status,
      matched: (d.models || [])
        .map((m: { name: string }) => m.name)
        .filter((n: string) => /flash-lite|2\.5|3\./i.test(n)),
      total: (d.models || []).length,
      error: d.error,
    });
  }
  const model = url.searchParams.get("model") || "gemini-2.5-flash-lite";
  const r = await fetch(`${B}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "Reply as JSON." }] },
      contents: [
        {
          role: "user",
          parts: [{ text: 'Return {"ok":true} and nothing else.' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 100,
        responseMimeType: "application/json",
      },
    }),
  });
  const d = await r.json();
  return j({
    status: r.status,
    model,
    reply: d.candidates?.[0]?.content?.parts?.[0]?.text,
    usage: d.usageMetadata,
    error: d.error,
  });
});
