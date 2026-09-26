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
  resolveAndGate,
  deductCredits,
  runInBackground,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_DAYS = 30;
// A digest that violates the required article+video mix (zero videos even
// after Sonnet escalation) is served but only cached briefly — a full 30-day
// TTL poisons the destination with a below-standard edition (Bali 2026-08).
const VIDEOLESS_TTL_DAYS = 2;
const MODEL = "claude-haiku-4-5-20251001";
// Rescue model. Haiku sometimes over-refuses this strict task and returns an
// empty digest even for content-rich destinations (e.g. Morocco). When the
// Haiku cold call comes back with zero inspirations we retry once with Sonnet
// 4.6 — the model this feature originally shipped on — which reliably finds
// content. Only fires on the ~10% of cold calls Haiku bails on.
const ESCALATION_MODEL = "claude-sonnet-5";
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
- The hosting DOMAIN must plausibly match the outlet and the content. Search results often surface expired-domain content farms — e.g. a "Coorg in July" article hosted on statueofunity.in. If the domain has nothing to do with the creator or the destination, REJECT the result no matter how relevant the title looks
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
- MINIMUM 5 inspirations, target 6–10. If your first searches come back thin, spend your REMAINING searches on different angles — the region's alternate names, its best-known towns or festivals, umbrella terms (e.g. "Northeast India" for Arunachal), "<destination> travel vlog" — rather than returning fewer than 5. Returning 3 results is a failure unless the destination genuinely has almost no first-person coverage.
- REQUIRED mix of articles and videos:
    • Dedicate at least ONE search explicitly to YouTube vlogs (site:youtube.com "<destination>" vlog, "<destination>" travel vlog YouTube) as well as blog/Substack posts.
    • Target at least 2 videos when the destination has any vlog coverage — most destinations do.
    • Never fabricate a video to satisfy the mix. If web_search truly surfaces no quality vlogs, strong articles alone are acceptable.
  Prefer videos posted to a named YouTube channel (not auto-generated topic channels).
- Mix well-known and less-known creators. STRICT: only ONE entry per author/creator — if you find multiple videos or articles from the same person, include only the single best one. Never list the same creator twice regardless of how many pieces they have published.
- Every inspirations entry MUST also appear in sources (same URL, dedup by url; sources[].id is 1-indexed).
- 0–6 place_insights. Each insight is short (≤ 15 words), in your own words, attributed via source_ids.
- CRITICAL URL RULE: Every URL you include MUST be one that web_search actually returned to you in this session. Do NOT construct, guess, or infer URLs — even if you know the website or author. If you did not receive a specific URL from web_search, do not include that article. A missing entry is far better than a broken link.
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

// One web_search-backed research call for a given model. Returns the raw text
// plus usage so the caller can parse, bill, and decide whether to escalate.
async function callResearchLLM(
  model: string,
  maxUses: number,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{
  ok: boolean;
  status: number;
  errText: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  webSearchCount: number;
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      // Claude 5 family: thinking defaults ON and would eat the budget;
      // this call wants structured JSON + web search, not deliberation.
      ...(model.startsWith("claude-sonnet-5")
        ? { thinking: { type: "disabled" } }
        : {}),
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: maxUses },
      ],
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    return {
      ok: false,
      status: res.status,
      errText,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      webSearchCount: 0,
    };
  }
  const data = await res.json();
  return {
    ok: true,
    status: res.status,
    errText: "",
    text: extractText(data?.content || []),
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
    webSearchCount: countWebSearches(data?.content || [], data?.usage),
  };
}

function tryParseJson(text: string): any | null {
  if (!text) return null;
  // Strategy 1: try the whole text (fastest, works when model outputs pure JSON)
  try {
    return JSON.parse(text.trim());
  } catch {
    // fall through
  }
  // Strategy 2: strip markdown code fences then parse
  const stripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```$/im, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through
  }
  // Strategy 3: find the outermost { } pair — handles leading/trailing prose
  // Use lastIndexOf for the closing brace so we grab the whole JSON blob
  // even when there are nested objects.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  // Strategy 4: look for the "inspirations" key specifically — sometimes
  // the model wraps output in extra commentary before the JSON.
  const jsonStart = text.indexOf('{"inspirations"');
  if (jsonStart >= 0) {
    const end2 = text.lastIndexOf("}");
    if (end2 > jsonStart) {
      try {
        return JSON.parse(text.slice(jsonStart, end2 + 1));
      } catch {
        // fall through
      }
    }
  }
  return null;
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

  try {
    const body = await req.json();
    const destinations = normaliseList(body.destinations);
    const notes: string = typeof body.notes === "string" ? body.notes : "";
    const monthBucket = monthBucketFor(body.startDate);
    const tripId: string | null = body.tripId || null;

    // Pre-flight credit check (Phase 2.5): resolve which wallet pays — personal
    // for a solo trip (unchanged), the trip pool for a shared trip. We DON'T
    // return the gate yet: cache hits below should still work at low balance, so
    // we capture it and apply only on cache miss.
    const { gate: noFunds, source } = await resolveAndGate(
      user,
      tripId,
      body.spend_personal === true,
      corsHeaders,
      MIN_CREDITS,
    );
    // Refinement: free-text focus for "Load more" batches (e.g. "hiking blogs").
    // Empty string = default load with no specific focus.
    const refinement: string =
      typeof body.refinement === "string" ? body.refinement.trim() : "";
    // quick: fast-first pass — 2 web searches, 4 best finds, no escalation,
    // never cached. The client fires it alongside the full call so the first
    // cards paint in ~15s instead of 60-90s; the full digest replaces it.
    const quick: boolean = !!body.quick;
    // bypass_cache: when true, skip the 30-day cache so the user gets a fresh
    // batch instead of the same cached result. Used when Load more is clicked
    // with no refinement (user explicitly wants something new).
    const bypassCache: boolean = !!body.bypass_cache;

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
    // `r` scopes the cache to the refinement so each distinct focus phrase
    // ("hiking", "solo female travel", …) gets its own 30-day cache entry.
    const cacheKey = await sha1(
      JSON.stringify({
        d: destinations,
        t: tagResult.tags,
        m: monthBucket,
        v: 5, // bump: strict one-per-creator rule added
        r: refinement,
      }),
    );

    // Cache lookup — skipped when the caller explicitly wants a fresh batch
    // (bypass_cache=true, used for Load-more with no refinement).
    if (!bypassCache)
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

    // Cache miss (or bypassed) → cold call. Now we enforce the min-credits gate.
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
      (refinement
        ? `\n\nAdditional focus for this batch: "${refinement}". Prioritise content that specifically addresses this angle. The person has already seen general inspiration for this destination — find something they haven't seen yet.`
        : "") +
      `\n\nUse web_search to find recent (≤ 24 months) first-person articles and YouTube videos by named individual creators. Return the JSON object only.` +
      (quick
        ? `\n\nTIME-CRITICAL FIRST PASS: you have only 2 web searches. Return the 4 single strongest finds you can locate fast (include at least 1 video if possible). Quality over quantity — a small, excellent batch beats a padded one. All other rules still apply.`
        : "");

    // Haiku first (cheap, 6 web searches). If it returns an empty digest
    // (over-refusal), escalate once to Sonnet 4.6 (8 web searches).
    const HAIKU_MAX_USES = 6;
    const SONNET_MAX_USES = 8;

    const haiku = await callResearchLLM(
      MODEL,
      quick ? 2 : HAIKU_MAX_USES,
      apiKey,
      SYSTEM_PROMPT,
      userMessage,
    );
    if (!haiku.ok) {
      throw new Error(`Anthropic error ${haiku.status}: ${haiku.errText}`);
    }

    let parsed = tryParseJson(haiku.text);
    let usedModel = MODEL;
    let webSearchCount = haiku.webSearchCount;
    let sonnet: Awaited<ReturnType<typeof callResearchLLM>> | null = null;

    // Escalate not just on EMPTY but on WEAK results — thin destinations had
    // Haiku return 3 items all from one blogger (which the author cap then
    // collapsed to a single card). Weak = under 5 items, fewer than 3 distinct
    // authors, or no videos at all.
    const items = Array.isArray(parsed?.inspirations)
      ? parsed.inspirations
      : [];
    const distinctAuthors = new Set(
      items.map((i: { author?: string }) =>
        (i.author || "").toLowerCase().trim(),
      ),
    ).size;
    const videoCount = items.filter(
      (i: { type?: string }) => i.type === "video",
    ).length;
    const haikuEmpty =
      !parsed || items.length < 5 || distinctAuthors < 3 || videoCount === 0;

    if (haikuEmpty && !quick) {
      sonnet = await callResearchLLM(
        ESCALATION_MODEL,
        SONNET_MAX_USES,
        apiKey,
        SYSTEM_PROMPT,
        userMessage,
      );
      if (sonnet.ok) {
        const sonnetParsed = tryParseJson(sonnet.text);
        const sonnetItems = Array.isArray(sonnetParsed?.inspirations)
          ? sonnetParsed.inspirations
          : [];
        if (sonnetItems.length > 0) {
          // Merge both models' finds (Sonnet first, dedupe by URL) — on thin
          // destinations the union is how we reach a usable minimum.
          const seenUrls = new Set<string>();
          sonnetParsed.inspirations = [...sonnetItems, ...items].filter(
            (i: { url?: string }) => {
              const u = (i.url || "").trim();
              if (!u || seenUrls.has(u)) return false;
              seenUrls.add(u);
              return true;
            },
          );
          parsed = sonnetParsed;
          usedModel = ESCALATION_MODEL;
          webSearchCount = sonnet.webSearchCount;
        } else if (!parsed && sonnetParsed) {
          // Haiku unparseable and Sonnet at least parsed (even to empty).
          parsed = sonnetParsed;
          usedModel = ESCALATION_MODEL;
          webSearchCount = sonnet.webSearchCount;
        }
      }
    }

    if (!parsed) {
      // Both models failed to produce parseable JSON.
      console.error(
        "unparseable digest. haiku raw (first 500):",
        haiku.text?.slice(0, 500),
        sonnet ? "| sonnet raw (first 500): " + sonnet.text?.slice(0, 500) : "",
      );
      throw new Error("model returned unparseable digest");
    }
    if (!Array.isArray(parsed.inspirations)) parsed.inspirations = [];
    // Enforce the named-author rule deterministically — the model sometimes
    // lets "unnamed blogger" through, which correlates strongly with
    // content-farm/spam results (the statueofunity.in Coorg incident).
    parsed.inspirations = parsed.inspirations.filter(
      (i: { author?: string }) =>
        i?.author &&
        !/unnamed|unknown|anonymous|staff writer|editorial team/i.test(
          String(i.author),
        ),
    );
    // Deterministic link validation before anything reaches the 30-day cache
    // (statueofunity.in incident: expired-domain content farm served a
    // plausible Coorg article). Two layers, both fail-open on infra errors:
    //   1. Liveness — drop dead/parked URLs (HEAD-ish GET, 5s timeout).
    //   2. Haiku spam-screen for NON-platform domains — is this domain
    //      plausibly the named creator's own site, or a content farm?
    parsed.inspirations = await validateInspirationLinks(
      parsed.inspirations,
      destinations,
      apiKey,
    );
    parsed.place_insights = parsed.place_insights || [];
    parsed.sources = parsed.sources || [];

    const digest = {
      destinations,
      tags: tagResult.tags,
      monthBucket,
      inspirations: parsed.inspirations || [],
      place_insights: parsed.place_insights || [],
      sources: parsed.sources || [],
      generated_at: new Date().toISOString(),
    };

    // Persist — upsert by cache_key. NEVER cache an empty digest: caching a
    // zero-result run for 30 days poisons the destination after a single bad
    // generation. Skipping the write lets the next open retry (and re-escalate).
    if (digest.inspirations.length > 0 && !quick) {
      const finalVideoCount = digest.inspirations.filter(
        (i: { type?: string }) => i.type === "video",
      ).length;
      const ttlDays =
        finalVideoCount === 0 ? VIDEOLESS_TTL_DAYS : CACHE_TTL_DAYS;
      const expiresAt = new Date(
        Date.now() + ttlDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      fetch(
        `${supabaseUrl}/rest/v1/destination_research?on_conflict=cache_key`,
        {
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
        },
      ).catch(() => {});
    }

    // Log llm_usage (fire-and-forget) — one row per model actually called.
    fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        trip_id: tripId,
        function_name: "generate-destination-research",
        model: MODEL,
        input_tokens: haiku.inputTokens,
        output_tokens: haiku.outputTokens,
        web_search_count: haiku.webSearchCount,
      }),
    }).catch(() => {});
    if (sonnet && sonnet.ok) {
      fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
        method: "POST",
        headers: dbHeaders,
        body: JSON.stringify({
          trip_id: tripId,
          function_name: "generate-destination-research:escalation",
          model: ESCALATION_MODEL,
          input_tokens: sonnet.inputTokens,
          output_tokens: sonnet.outputTokens,
          web_search_count: sonnet.webSearchCount,
        }),
      }).catch(() => {});
    }

    // Deduct credits — Haiku (tag-extract + main) always; Sonnet on escalation.
    // Web search is billed by Anthropic SEPARATELY from tokens ($10/1k
    // requests) — the old comment claiming input_tokens "absorbs" it was
    // wrong and undercharged every searched call by ~$0.01/search.
    runInBackground(
      deductCredits({
        userId: user.id,
        model: MODEL,
        inputTokens: haiku.inputTokens + tagResult.inputTokens,
        outputTokens: haiku.outputTokens + tagResult.outputTokens,
        webSearchCount: haiku.webSearchCount,
        functionName: "generate-destination-research",
        tripId,
        source,
      }),
    );
    if (sonnet && sonnet.ok) {
      runInBackground(
        deductCredits({
          userId: user.id,
          model: ESCALATION_MODEL,
          inputTokens: sonnet.inputTokens,
          outputTokens: sonnet.outputTokens,
          webSearchCount: sonnet.webSearchCount,
          functionName: "generate-destination-research:escalation",
          tripId,
          source,
        }),
      );
    }

    return new Response(
      JSON.stringify({
        digest,
        cached: false,
        quick,
        tags: tagResult.tags,
        model: usedModel,
      }),
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

// ── Link validation ladder (permanent spam/dead-link defense) ────────────────

// Platform domains where the creator≠domain relationship is inherent — no
// spam-screen needed (liveness still applies).
const TRUSTED_PLATFORM_RE =
  /(^|\.)(youtube\.com|youtu\.be|substack\.com|medium\.com|wordpress\.com|blogspot\.com|instagram\.com|vimeo\.com|tumblr\.com)$/i;

function registrableHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/** True when the URL responds 2xx/3xx within the timeout. Fail-open on
 *  network-layer errors is deliberately NOT done here — an unreachable link
 *  is worthless to the user regardless of why. */
async function urlAlive(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    // GET (not HEAD — many blogs 405 HEAD); body is never read.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TripJamBot/1.0)" },
    });
    clearTimeout(t);
    try {
      await res.body?.cancel();
    } catch {
      /* body already consumed/closed */
    }
    return res.ok;
  } catch {
    return false;
  }
}

type InspirationItem = {
  url?: string;
  title?: string;
  author?: string;
  outlet?: string;
  type?: string;
};

async function validateInspirationLinks(
  items: InspirationItem[],
  destinations: string[],
  apiKey: string,
): Promise<InspirationItem[]> {
  if (!items?.length) return [];
  // 1. Liveness — parallel, bounded by the 5s per-request timeout.
  const liveFlags = await Promise.all(
    items.map((i) => (i?.url ? urlAlive(i.url) : Promise.resolve(false))),
  );
  const live = items.filter((_, idx) => liveFlags[idx]);
  const dropped = items.length - live.length;
  if (dropped > 0)
    console.warn(`inspirations: dropped ${dropped} dead/unreachable links`);

  // 2. Spam-screen the independent-domain items with one cheap Haiku call.
  const suspects = live.filter(
    (i) => !TRUSTED_PLATFORM_RE.test(registrableHost(i.url || "") || ""),
  );
  if (!suspects.length) return live;
  try {
    const list = suspects
      .map(
        (i, n) =>
          `${n}. domain=${registrableHost(i.url || "")} outlet="${i.outlet}" author="${i.author}" title="${i.title}"`,
      )
      .join("\n");
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
        messages: [
          {
            role: "user",
            content: `These are travel-blog links about ${destinations.join(", ")}. For each, judge ONLY whether the DOMAIN is plausibly the named creator's/outlet's own website. Reject expired-domain content farms — domains whose name is about a completely unrelated topic (e.g. a monuments site hosting a coffee-country travel blog), keyword-stuffed spam domains, or domains contradicting the outlet name.\n\n${list}\n\nReply with ONLY a JSON array of the numbers to REJECT, e.g. [1,3]. Reply [] if all are fine.`,
          },
        ],
      }),
    });
    if (!res.ok) return live; // fail-open: screening is best-effort
    const data = await res.json();
    const text: string = data?.content?.[0]?.text || "[]";
    const rejected: number[] = JSON.parse(
      (text.match(/\[[\d,\s]*\]/) || ["[]"])[0],
    );
    if (!rejected.length) return live;
    const rejectedUrls = new Set(
      rejected.map((n) => suspects[n]?.url).filter(Boolean),
    );
    console.warn(
      `inspirations: spam-screen rejected ${rejectedUrls.size}:`,
      [...rejectedUrls].join(", "),
    );
    return live.filter((i) => !rejectedUrls.has(i.url));
  } catch {
    return live; // fail-open
  }
}
