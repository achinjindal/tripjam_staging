// F1 — Inspirations. Cached web-search-backed research digest per
// (destinations, tags, monthBucket) using Anthropic Haiku 4.5 + web_search.
// Surfaces in the Magazine view as "Inspirations" (first-person recent
// articles + videos from named individual creators).
//
// Cost model:
//   - Cache hit: free.
//   - Cache miss: 1 small Haiku tag-extraction call + 1 Haiku call with
//     web_search (max 4 invocations @ $0.01/search). At Haiku + 4 web
//     searches the per-call charge is ~6-8 credits via the standard
//     LLM cost → credits conversion (deductCredits + costToCredits).
//
// Migrated from the `inspiration` git worktree branch (originally Sonnet 4.6
// + 8 web searches, no auth, no credit charging). On-merge changes:
//   - Sonnet → Haiku 4.5  (~70% cost reduction)
//   - web_search max_uses 8 → 4
//   - Add authentication / rate limiting / kill switch (D15 / D7)
//   - Charge credits on cache-miss (D2 / D24)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  llmKillSwitch,
  requireMinCredits,
  deductCredits,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_DAYS = 30;
const MODEL = "claude-haiku-4-5-20251001";
// Min credits required to attempt a cold call. Sized to comfortably cover
// the worst case (1 tag-extract Haiku + 1 main Haiku with 4 web searches).
const MIN_CREDITS = 8;

const INSPIRATION_TAGS = [
  "food",
  "scuba",
  "hiking",
  "photography",
  "nature",
  "wildlife",
  "beaches",
  "mountains",
  "history",
  "culture",
  "art",
  "nightlife",
  "festivals",
  "spirituality",
  "road-trip",
  "slow-travel",
  "adventure",
  "family",
  "romance",
  "vegetarian",
] as const;
const TAG_SET = new Set<string>(INSPIRATION_TAGS as readonly string[]);

const SYSTEM_PROMPT = `You are researching travel inspirations from REAL INDIVIDUAL CREATORS — not listicle sites, not corporate tourism boards, not aggregator publications. You will use the web_search tool to find recent (last 24 months, prefer last 12) content for a specific destination + traveller interests.

REQUIREMENTS for each inspirations entry:
- Must have a named human author (personal blogger, named YouTuber, named Substack/newsletter writer, named journalist with a recognisable voice)
- Must be published within the last 24 months (prefer last 12)
- Author must have a track record — a single-post blog or new channel with very low reach is too risky
- Skip these source types:
  • Listicle sites (BuzzFeed, TimeOut "Best of" pages, generic Conde Nast roundups by staff)
  • Aggregators (City Unscripted, TourScanner, Trip.com guides, GetYourGuide content)
  • Corporate tourism boards (visitjapan.com, *.gov.* tourism pages, official DMO sites)
  • AI-written travel guides (no byline or generic "Editorial Team")
  • SEO-farm content (giveaways: 47-section tables of contents, "Updated 2026!" stamps, thin paraphrases)
- Prefer creators with FIRST-PERSON voice ("we", "I", "my partner and I") over third-person "tourists should…"

OUTPUT FORMAT — return ONLY a single raw JSON object, no prose, no markdown fences. Schema:
{
  "inspirations": [
    {
      "type": "article" | "video",
      "title": "exact title of the piece",
      "author": "named human author",
      "author_type": "personal_blog" | "youtuber" | "substack" | "instagram" | "journalist",
      "outlet": "blog/publication/channel name",
      "date": "YYYY-MM",
      "url": "canonical URL of the piece",
      "blurb": "1–2 sentences in your own words on what makes this piece worth reading/watching for this traveller"
    }
  ],
  "place_insights": [
    {
      "place": "specific named place (city, neighbourhood, sight, walk, dish)",
      "insights": ["short paraphrased insight from a creator", "another"],
      "source_ids": [1, 3]
    }
  ],
  "sources": [
    { "id": 1, "title": "...", "author": "...", "url": "...", "date": "YYYY-MM" }
  ]
}

Rules:
- 6–10 inspirations TOTAL.
- MANDATORY MIX — the final list must contain BOTH formats:
    • at LEAST 3 entries with type="article" (named blog/Substack/journalist posts)
    • at LEAST 3 entries with type="video" (YouTube videos by named individual creators)
  If you can't surface 3 of either format, surface as many as you can find — but you MUST attempt explicit searches for both. Do not return only articles. Do not return only videos.
- To find videos, run web_search queries that target YouTube specifically, e.g.:
    site:youtube.com "<destination>" vlog
    "<destination>" travel vlog YouTube
    "<creator name>" "<destination>" YouTube
  Prefer videos posted to a named YouTube channel (not auto-generated topic channels).
- Mix well-known and less-known creators. No duplicates by author.
- Every inspirations entry MUST also appear in sources (same URL, dedup by url; sources[].id is 1-indexed).
- 0–6 place_insights. Each insight is short (≤ 15 words), in your own words, attributed via source_ids.
- Do NOT fabricate authors, URLs, or dates. If web_search did not surface a fitting piece, return fewer entries. Better empty than fake.
- No markdown, no code fences, no commentary outside the JSON.`;

const TAG_SYSTEM_PROMPT = `You extract travel interest tags from user trip notes.

Pick UP TO 5 tags from this exact list — never invent tags:
  food, scuba, hiking, photography, nature, wildlife, beaches, mountains,
  history, culture, art, nightlife, festivals, spirituality, road-trip,
  slow-travel, adventure, family, romance, vegetarian

Only include tags clearly supported by the notes. If unclear or empty notes, return [].
Return ONLY a JSON object: {"tags": ["tag1", "tag2"]}`;

function monthBucketFor(dateStr: string | null | undefined): string {
  if (!dateStr) return "any";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "any";
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const m = d.getMonth();
  const start = m - (m % 2);
  return `${months[start]}-${months[start + 1]}`;
}

function normaliseList(xs: unknown): string[] {
  if (!Array.isArray(xs)) return [];
  return xs
    .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
    .filter(Boolean)
    .sort();
}

async function sha1(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractText(content: any[]): string {
  return (content || [])
    .filter((b) => b?.type === "text" && typeof b?.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function countWebSearches(content: any[], usage: any): number {
  const fromUsage = usage?.server_tool_use?.web_search_requests;
  if (typeof fromUsage === "number") return fromUsage;
  return (content || []).filter(
    (b) => b?.type === "server_tool_use" && b?.name === "web_search",
  ).length;
}

function tryParseJson(text: string): any | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function extractTags(
  notes: string,
  apiKey: string,
  dbHeaders: Record<string, string>,
  supabaseUrl: string,
  tripId: string | null,
): Promise<{ tags: string[]; inputTokens: number; outputTokens: number }> {
  const trimmed = notes.trim();
  if (!trimmed) return { tags: [], inputTokens: 0, outputTokens: 0 };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: TAG_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Trip notes:\n"${trimmed}"` }],
      }),
    });
    if (!res.ok) return { tags: [], inputTokens: 0, outputTokens: 0 };
    const data = await res.json();
    const text =
      data?.content?.[0]?.type === "text" ? data.content[0].text : "{}";
    const parsed = tryParseJson(text);
    const raw = Array.isArray(parsed?.tags) ? parsed.tags : [];
    const tags = raw
      .map((t: unknown) =>
        typeof t === "string" ? t.trim().toLowerCase() : "",
      )
      .filter((t: string) => TAG_SET.has(t));
    // Dedup, sort, cap at 5
    const out = Array.from(new Set<string>(tags)).sort().slice(0, 5);

    // Log usage (fire-and-forget). Note: llm_usage doesn't carry user_id
    // currently — attribution happens via the credit_transactions table
    // written by deductCredits() in the parent caller.
    fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        trip_id: tripId,
        function_name: "generate-destination-research:tags",
        model: MODEL,
        input_tokens: data?.usage?.input_tokens || 0,
        output_tokens: data?.usage?.output_tokens || 0,
      }),
    }).catch(() => {});

    return {
      tags: out,
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
    };
  } catch (e) {
    console.warn("tag extraction failed:", (e as Error).message);
    return { tags: [], inputTokens: 0, outputTokens: 0 };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // D7: global kill switch.
  const killed = llmKillSwitch(corsHeaders);
  if (killed) return killed;

  // D15: require authentication.
  const user = await authenticateUser(req);
  if (!user) return unauthorized(corsHeaders);

  // D7: rate limit.
  const rateLimited = await rateLimit(user.id, corsHeaders);
  if (rateLimited) return rateLimited;

  // Pre-flight credit check. Cache hits below bypass this naturally because
  // they short-circuit before any LLM call — but we still check here so a
  // user with 0 credits never even attempts.
  const noFunds = requireMinCredits(user, corsHeaders, MIN_CREDITS);
  // (We don't return noFunds yet — cache hits should still work even at low
  // balance. We capture it and apply only on cache miss.)

  try {
    const body = await req.json();
    const destinations = normaliseList(body.destinations);
    const notes: string = typeof body.notes === "string" ? body.notes : "";
    const monthBucket = monthBucketFor(body.startDate);
    const tripId: string | null = body.tripId || null;

    if (destinations.length === 0) {
      return new Response(JSON.stringify({ error: "destinations required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const dbHeaders = {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    };

    // Bounded-vocabulary tag extraction — tiny Haiku call (~100 tokens),
    // free-ish but tracked. Drives the cache key.
    const tagResult = await extractTags(
      notes,
      apiKey,
      dbHeaders,
      supabaseUrl,
      tripId,
    );

    // `v` invalidates the 30-day cache when the prompt changes shape (e.g.
    // requiring article+video mix). Bump on any breaking prompt change.
    const cacheKey = await sha1(
      JSON.stringify({
        d: destinations,
        t: tagResult.tags,
        m: monthBucket,
        v: 2,
      }),
    );

    // Cache lookup
    try {
      const lookup = await fetch(
        `${supabaseUrl}/rest/v1/destination_research?cache_key=eq.${encodeURIComponent(cacheKey)}&select=digest,generated_at,expires_at&limit=1`,
        { headers: dbHeaders },
      );
      if (lookup.ok) {
        const rows = await lookup.json();
        const hit = Array.isArray(rows) && rows[0];
        if (
          hit &&
          hit.expires_at &&
          new Date(hit.expires_at).getTime() > Date.now()
        ) {
          return new Response(
            JSON.stringify({
              digest: hit.digest,
              cached: true,
              tags: tagResult.tags,
              generated_at: hit.generated_at,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }
    } catch (e) {
      console.warn(
        "destination_research cache lookup failed:",
        (e as Error).message,
      );
    }

    // Cache miss → cold call. Now we enforce the min-credits gate.
    if (noFunds) return noFunds;

    // Cache miss → LLM call with web_search. Append the raw notes so the
    // research reflects what the user actually said.
    const userMessage =
      `Research destination: ${destinations.join(", ")}.` +
      (tagResult.tags.length
        ? `\nTraveller interests: ${tagResult.tags.join(", ")}.`
        : "") +
      (monthBucket !== "any" ? `\nTravelling around: ${monthBucket}.` : "") +
      (notes.trim()
        ? `\n\nFree-text traveller notes (use these to bias what you surface):\n"${notes.trim()}"`
        : "") +
      `\n\nUse web_search to find recent (≤ 24 months) first-person articles and YouTube videos by named individual creators. Return the JSON object only.`;

    const llmRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        // Bumped to 6 (was 4) so Haiku has room for separate article-focused
        // and YouTube-focused queries (enforced by the prompt's mandatory mix).
        // Cost ceiling: 6 × $0.01 = $0.06 per cold call. Cache hits are free.
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 6 },
        ],
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      throw new Error(`Anthropic error ${llmRes.status}: ${errText}`);
    }
    const llm = await llmRes.json();

    const text = extractText(llm?.content || []);
    const webSearchCount = countWebSearches(llm?.content || [], llm?.usage);
    const parsed = tryParseJson(text);
    if (!parsed || !Array.isArray(parsed.inspirations)) {
      throw new Error("model returned unparseable digest");
    }

    const digest = {
      destinations,
      tags: tagResult.tags,
      monthBucket,
      inspirations: parsed.inspirations || [],
      place_insights: parsed.place_insights || [],
      sources: parsed.sources || [],
      generated_at: new Date().toISOString(),
    };

    // Persist — upsert by cache_key.
    const expiresAt = new Date(
      Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    fetch(`${supabaseUrl}/rest/v1/destination_research?on_conflict=cache_key`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        cache_key: cacheKey,
        destinations,
        tags: tagResult.tags,
        month_bucket: monthBucket,
        digest,
        web_search_count: webSearchCount,
        expires_at: expiresAt,
      }),
    }).catch(() => {});

    // Log llm_usage (fire-and-forget)
    fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        trip_id: tripId,
        function_name: "generate-destination-research",
        model: MODEL,
        input_tokens: llm?.usage?.input_tokens || 0,
        output_tokens: llm?.usage?.output_tokens || 0,
        web_search_count: webSearchCount,
      }),
    }).catch(() => {});

    // Deduct credits — combined cost of tag-extract Haiku + main Haiku call.
    // Web search cost is currently absorbed in the input_tokens bill from
    // Anthropic (server-side tool call) so the standard costToCredits()
    // captures it implicitly. If Anthropic bills web_search separately in
    // the future we can add a per-search surcharge here.
    const mainIn = llm?.usage?.input_tokens || 0;
    const mainOut = llm?.usage?.output_tokens || 0;
    deductCredits({
      userId: user.id,
      model: MODEL,
      inputTokens: mainIn + tagResult.inputTokens,
      outputTokens: mainOut + tagResult.outputTokens,
      functionName: "generate-destination-research",
      tripId,
    }).catch(() => {});

    return new Response(
      JSON.stringify({ digest, cached: false, tags: tagResult.tags }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error(
      "generate-destination-research error:",
      (err as Error).message,
    );
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
