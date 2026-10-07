// ─────────────────────────────────────────────────────────────────────────────
// model-bench — TEMPORARY benchmarking harness. STAGING ONLY. DELETE AFTER USE.
//
// Multi-provider inference + an objective venue-reality scorer, so model
// comparisons can be driven from a local script without shipping the
// candidate model into any real code path.
//
// Gated on x-bench-secret (BENCH_SECRET env). Without that gate this would be
// an open proxy to three paid APIs — exactly the hole closed in the 2026-09-30
// abuse pass. Do NOT deploy to production.
//
//   POST ?action=infer   { provider, model, system, user, maxTokens, json }
//                      → { text, usage:{input,output}, ms }
//   POST ?action=verify  { places: [{name, city}] }
//                      → { results: [{name, city, ok, reason, resolved_name}] }
//   GET  ?action=list&provider=anthropic|openai|google
// ─────────────────────────────────────────────────────────────────────────────

import { callLLM, streamLLM, parseLLMJson } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bench-secret",
};

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const BENCH_SECRET = Deno.env.get("BENCH_SECRET") ?? "";

const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Usage = { input: number; output: number };
type InferResult = { text: string; usage: Usage };

// ── Anthropic ────────────────────────────────────────────────────────────────
async function callAnthropic(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<InferResult> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  // Claude 5 family: thinking is ON by default and eats max_tokens, and the
  // API rejects `temperature` outright.
  if (/claude-(opus-5|sonnet-5|haiku-5|fable-5)/.test(model)) {
    body.thinking = { type: "disabled" };
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(d)}`);
  const text = (d.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  return {
    text,
    usage: {
      input:
        (d.usage?.input_tokens ?? 0) +
        (d.usage?.cache_read_input_tokens ?? 0) +
        (d.usage?.cache_creation_input_tokens ?? 0),
      output: d.usage?.output_tokens ?? 0,
    },
  };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
async function callOpenAI(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  json: boolean,
): Promise<InferResult> {
  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (json) body.response_format = { type: "json_object" };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(d)}`);
  return {
    text: d.choices?.[0]?.message?.content ?? "",
    usage: {
      input: d.usage?.prompt_tokens ?? 0,
      // Reasoning tokens are billed as output.
      output: d.usage?.completion_tokens ?? 0,
    },
  };
}

// ── Google Gemini ────────────────────────────────────────────────────────────
async function callGemini(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  json: boolean,
): Promise<InferResult> {
  const mkBody = (withThinkingOff: boolean) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
      // Older Gemini 3.x needs this or thought tokens consume maxOutputTokens
      // and the body truncates. Newer tiers (3.5-flash-lite, *-latest) reject
      // thinkingBudget:0 outright with INVALID_ARGUMENT, so fall back.
      ...(withThinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const post = (b: unknown) =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(b),
      },
    );
  let r = await post(mkBody(true));
  if (r.status === 400) r = await post(mkBody(false));
  const d = await r.json();
  if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(d)}`);
  const text = (d.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  return {
    text,
    usage: {
      input: d.usageMetadata?.promptTokenCount ?? 0,
      output:
        (d.usageMetadata?.candidatesTokenCount ?? 0) +
        (d.usageMetadata?.thoughtsTokenCount ?? 0),
    },
  };
}

// ── Objective venue-reality scorer ───────────────────────────────────────────
// Runs a candidate venue name through Google Places Text Search and checks
// that (a) Google knows it and (b) the result sits within 60km of the named
// city. This replaces LLM-as-judge for the factual-recall use cases: it is
// deterministic, cheap (free under the 5k/month Pro tier), and it is the same
// oracle the production verify-place ladder uses.
const cityCentroids = new Map<string, { lat: number; lng: number } | null>();

async function centroid(city: string) {
  const k = city.toLowerCase();
  if (cityCentroids.has(k)) return cityCentroids.get(k)!;
  let out: { lat: number; lng: number } | null = null;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`,
      { headers: { "User-Agent": "tripjam-bench/1.0" } },
    );
    const d = await r.json();
    if (d?.[0]) out = { lat: +d[0].lat, lng: +d[0].lon };
  } catch {
    /* leave null */
  }
  cityCentroids.set(k, out);
  return out;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function verifyPlace(name: string, city: string) {
  const q = city ? `${name}, ${city}` : name;
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY,
      "X-Goog-FieldMask":
        "places.id,places.location,places.businessStatus,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({
      textQuery: q,
      languageCode: "en",
      maxResultCount: 1,
    }),
  });
  if (!r.ok) {
    return { name, city, ok: false, reason: `google_http_${r.status}` };
  }
  const d = await r.json();
  const p = d?.places?.[0];
  if (!p?.location?.latitude) {
    return { name, city, ok: false, reason: "not_found" };
  }
  const c = await centroid(city);
  const dist = c
    ? haversineKm(c, { lat: p.location.latitude, lng: p.location.longitude })
    : null;
  const closed = p.businessStatus && p.businessStatus !== "OPERATIONAL";
  const farAway = dist != null && dist > 60;
  return {
    name,
    city,
    ok: !closed && !farAway,
    reason: closed
      ? `closed_${p.businessStatus}`
      : farAway
        ? `${Math.round(dist!)}km_away`
        : "ok",
    resolved_name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    km: dist == null ? null : Math.round(dist),
  };
}

// ── router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  if (!BENCH_SECRET || req.headers.get("x-bench-secret") !== BENCH_SECRET) {
    return j({ error: "forbidden" }, 403);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "infer";

  try {
    // ?action=raw { provider, body } — forward a literal request body to the
    // provider so structured-output shapes can be probed for real acceptance
    // instead of guessed from docs. Returns the HTTP status too, because a 400
    // IS the answer we are looking for on unsupported parameters.
    if (action === "raw") {
      const { provider, body } = await req.json();
      const ep: Record<string, [string, Record<string, string>]> = {
        anthropic: [
          "https://api.anthropic.com/v1/messages",
          {
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
        ],
        openai: [
          "https://api.openai.com/v1/chat/completions",
          {
            Authorization: `Bearer ${OPENAI_KEY}`,
            "Content-Type": "application/json",
          },
        ],
        google: [
          `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${GEMINI_KEY}`,
          { "Content-Type": "application/json" },
        ],
      };
      const [url, headers] = ep[provider];
      const t0 = Date.now();
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await r.text();
      return j({ status: r.status, ms: Date.now() - t0, body: text });
    }

    // ?action=youtube&q=...  — TEMPORARY. Verifies whether the existing
    // GOOGLE_PLACES_KEY can drive the YouTube Data API (same Google Cloud
    // project), and what a search.list response actually contains, before
    // committing to a self-served video-discovery design. Bounded to
    // search.list so this cannot become a general Google proxy.
    if (action === "youtube") {
      const q = url.searchParams.get("q") || "";
      const part = url.searchParams.get("part") || "snippet";
      const t0 = Date.now();
      const yt = new URL("https://www.googleapis.com/youtube/v3/search");
      // Prefer a dedicated YouTube key; fall back to the Places key so the
      // probe still reports the "blocked" error clearly if it is unset.
      yt.searchParams.set("key", Deno.env.get("YOUTUBE_API_KEY") || PLACES_KEY);
      yt.searchParams.set("part", part);
      yt.searchParams.set("q", q);
      yt.searchParams.set("type", "video");
      yt.searchParams.set("maxResults", url.searchParams.get("n") || "10");
      yt.searchParams.set("relevanceLanguage", "en");
      const r = await fetch(yt);
      const text = await r.text();
      return j({ status: r.status, ms: Date.now() - t0, body: text });
    }

    if (action === "list") {
      const p = url.searchParams.get("provider");
      if (p === "anthropic") {
        const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
          headers: {
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
          },
        });
        const d = await r.json();
        return j({ models: (d.data || []).map((m: { id: string }) => m.id) });
      }
      if (p === "openai") {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        });
        const d = await r.json();
        return j({
          models: (d.data || [])
            .map((m: { id: string }) => m.id)
            .filter((n: string) => /^(gpt|o[0-9])/.test(n))
            .sort(),
        });
      }
      if (p === "google") {
        const r = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models",
          { headers: { "x-goog-api-key": GEMINI_KEY } },
        );
        const d = await r.json();
        return j({
          models: (d.models || [])
            .map((m: { name: string }) => m.name.replace("models/", ""))
            .filter((n: string) => /gemini/.test(n))
            .sort(),
        });
      }
      return j({ error: "unknown provider" }, 400);
    }

    // Integration test of the REAL shared adapter (_shared/llm.ts) — the code
    // that will ship, not a copy. Exercises provider routing, JSON mode,
    // array handling, usage normalisation and truncation retry.
    if (action === "adapter") {
      const {
        model,
        system,
        user,
        maxTokens,
        json,
        expectArray,
        stream,
        schema,
      } = await req.json();
      if (stream) {
        let text = "";
        let usage: unknown = null;
        let truncated = false;
        for await (const ev of streamLLM({
          model,
          system: system ?? "",
          user: user ?? "",
          maxTokens: maxTokens ?? 500,
          json,
          expectArray,
          schema,
        })) {
          if (ev.type === "delta") text += ev.text;
          else {
            usage = ev.usage;
            truncated = ev.truncated;
          }
        }
        return j({ text, usage, truncated, parsed: parseLLMJson(text) });
      }
      const r = await callLLM({
        model,
        system: system ?? "",
        user: user ?? "",
        maxTokens: maxTokens ?? 500,
        json,
        expectArray,
        schema,
      });
      return j({ ...r, fallbackParsed: parseLLMJson(r.text) });
    }

    if (action === "verify") {
      const { places } = await req.json();
      if (!Array.isArray(places)) return j({ error: "places[] required" }, 400);
      const results: Awaited<ReturnType<typeof verifyPlace>>[] = [];
      // Serial: Nominatim centroid lookups must stay under 1 req/sec.
      for (const p of places.slice(0, 120)) {
        results.push(
          await verifyPlace(String(p.name ?? ""), String(p.city ?? "")),
        );
        await new Promise((r) => setTimeout(r, 120));
      }
      return j({ results });
    }

    if (action === "infer") {
      const {
        provider,
        model,
        system = "",
        user = "",
        maxTokens = 2000,
        json: wantJson = false,
      } = await req.json();
      const t0 = Date.now();
      let out: InferResult;
      if (provider === "anthropic")
        out = await callAnthropic(model, system, user, maxTokens);
      else if (provider === "openai")
        out = await callOpenAI(model, system, user, maxTokens, wantJson);
      else if (provider === "google")
        out = await callGemini(model, system, user, maxTokens, wantJson);
      else return j({ error: `unknown provider ${provider}` }, 400);
      return j({ ...out, ms: Date.now() - t0, model, provider });
    }

    return j({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    return j({ error: (e as Error).message }, 500);
  }
});
