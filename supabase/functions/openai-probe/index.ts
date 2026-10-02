const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("OPENAI_API_KEY");
  const j = (o: unknown) =>
    new Response(JSON.stringify(o), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (!key) return j({ error: "OPENAI_API_KEY not set" });
  const url = new URL(req.url);
  if (url.searchParams.has("list")) {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const d = await r.json();
    return j({
      status: r.status,
      matched: (d.data || [])
        .map((m: { id: string }) => m.id)
        .filter((id: string) => /5\.?6|luna|terra|sol/i.test(id)),
      total: (d.data || []).length,
      error: d.error,
    });
  }
  const model = url.searchParams.get("model") || "gpt-5.6-luna";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_completion_tokens: 20,
    }),
  });
  const d = await r.json();
  return j({
    status: r.status,
    model,
    reply: d.choices?.[0]?.message?.content,
    usage: d.usage,
    error: d.error,
  });
});
