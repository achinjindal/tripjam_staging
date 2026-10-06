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
import { captureException } from "../_shared/errortrack.ts";
import { traitsOf, providerOf } from "../_shared/llm.ts";
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

// Raised 30 -> 90 on 2026-10-05. Measured on staging: 42 distinct cache keys
// against 118 LLM calls, i.e. every key was re-researched ~2.8 times, and only
// 1 of 42 entries was unexpired at any moment. The prompt itself selects
// content published in the LAST 24 MONTHS, so a 30-day TTL was ~24x more
// conservative than the content window it draws from — we were paying to
// re-find the same year-old articles every month. 90 days collapses the
// regeneration factor to ~1 (-64% of calls).
const CACHE_TTL_DAYS = 90;
// A digest that violates the required article+video mix (zero videos even
// after Sonnet escalation) is served but only cached briefly — a full 30-day
// TTL poisons the destination with a below-standard edition (Bali 2026-08).
// A video-less digest used to be worth retrying in 48h, because the model's
// video search was unreliable. YouTube now fills videos deterministically, so
// zero videos means the destination genuinely has none — retrying soon just
// re-spends the article searches. Kept short-ish in case quota was exhausted
// at generation time, which IS worth retrying.
const VIDEOLESS_TTL_DAYS = 7;
const MODEL = "claude-haiku-4-5-20251001";
// Rescue model. Haiku sometimes over-refuses this strict task and returns an
// empty digest even for content-rich destinations (e.g. Morocco), and also
// returns thin results on sparse destinations. We then retry once on a
// stronger model, which reliably finds content. Measured over 139 staging
// calls: fires on 26% of cold calls, 19% of total Inspirations token spend.
//
// Sonnet 5.5 (was 5): a drop-in upgrade at the SAME $2/$10, with Jun-2026
// knowledge — which matters here, because this prompt asks for current
// creators and recent articles. Missed by the 2026-10-05 RG/IG upgrade
// because it was a bare const, invisible to a review of modelFor call sites.
//
// Read from its OWN env var, NOT modelFor(): modelFor's chain ends at
// LLM_MODEL_DEFAULT, and a global default pointing at Gemini/OpenAI would
// route a non-Anthropic model into this Anthropic-only path (web_search is
// an Anthropic server tool). Same reasoning as INSPIRATIONS_GROUNDED_MODEL.
// The guard below enforces it rather than trusting the operator.
const ESCALATION_MODEL = (() => {
  const want = (
    Deno.env.get("INSPIRATIONS_ESCALATION_MODEL") || "claude-sonnet-5-5"
  )
    .trim()
    .toLowerCase();
  if (providerOf(want) !== "anthropic") {
    console.error(
      `[inspirations] INSPIRATIONS_ESCALATION_MODEL="${want}" is not an ` +
        `Anthropic model, but this path needs Anthropic's web_search server ` +
        `tool — falling back to claude-sonnet-5-5.`,
    );
    return "claude-sonnet-5-5";
  }
  return want;
})();
// Min credits required to attempt a cold call. Sized to comfortably cover
// the worst case (1 tag-extract Haiku + 1 main Haiku with 4 web searches).
const MIN_CREDITS = 8;
// Escalation is the single most expensive step (~2.8x the primary call). This
// is a kill-switch for when its spend needs capping, and the lever that makes
// the primary call's unaided yield measurable — with it off, the digest you
// get IS what Haiku produced on its own.
const ESCALATION_ENABLED =
  (Deno.env.get("INSPIRATIONS_ESCALATION_ENABLED") || "1").trim() !== "0";

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
- VIDEOS ARE NOT OPTIONAL. Spend at least one of your searches on video specifically — search the way someone looks for a vlog (for example: site:youtube.com <destination> travel vlog, or "<destination> vlog 2026"), not just article queries. Aim for 2+ videos in the final set. A digest of articles only is a failed digest: measured, barely 1 in 8 results has been a video, which is not a reflection of what exists.
- For a video, "author" is the CHANNEL NAME exactly as YouTube shows it, and the URL must be a real watch URL you saw in search results — never assemble or guess a video id.

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

// ── Google Search grounding path (opt-in, OFF by default) ───────────────────
// Set INSPIRATIONS_GROUNDED_MODEL to a "gemini-*" id to route research through
// Google Search grounding instead of Anthropic web_search.
//
// WHY THIS IS WORTH DOING (measured against the live API, 2026-10-05):
//   Anthropic bills retrieved search results as INPUT TOKENS, and every search
//   iteration re-sends the accumulated context, so cost grows quadratically:
//   43,071 billed input tokens for ~5 searches. Google does NOT bill retrieved
//   context at all ("Retrieved context provided by Grounding with Google
//   Search is not charged as input tokens") and gives 5,000 free searches per
//   month. A grounded probe with a real search reported 42 prompt tokens.
//
// WHY IT IS TWO CALLS:
//   Grounding and responseMimeType:"application/json" are MUTUALLY EXCLUSIVE.
//   Measured: with JSON mode on, the model ran ZERO searches and returned an
//   empty body. So step 1 researches in prose (grounded), step 2 structures
//   that prose into our schema (no tools, JSON mode on).
//
// WHY THE GUARD EXISTS — this is the important part:
//   Ported verbatim, today's prompt makes Gemini skip searching entirely and
//   emit a confident, well-formed digest from training data. The probe did
//   exactly that, inventing an attribution ("Mark Wiens" video credited to
//   another creator). An ungrounded answer is indistinguishable from a
//   researched one in the response body — the ONLY reliable signal is
//   groundingMetadata.webSearchQueries. If it is empty we treat the call as
//   FAILED and fall back to Anthropic, because serving unresearched content as
//   research is worse than serving nothing.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini's groundingChunks cite sources as vertexaisearch redirect URLs whose
 * "title" is only a domain. Resolving one follows a single hop to the real
 * article URL — and that resolution is itself a verification: a URL that comes
 * back 200 through Google's redirect is by construction a page Google indexed,
 * which is the same guarantee oEmbed gives us for videos.
 *
 * The grounded path previously threw these away and kept only the prose, so
 * the structuring step had to recall URLs from memory — which is why its A/B
 * run produced MORE dead links than the Anthropic path despite having searched.
 */
async function resolveGroundingCitations(
  chunks: unknown[],
): Promise<{ url: string; domain: string; title: string }[]> {
  const uris = chunks
    .map((c) => ((c as { web?: { uri?: string } })?.web || {}).uri)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, 12); // bounded: one HTTP hop each, run in parallel

  const settled = await Promise.all(
    uris.map(async (uri) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(uri, {
          redirect: "follow",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; TripJam/1.0)" },
        });
        clearTimeout(t);
        if (!r.ok) return null;
        const finalUrl = r.url || "";
        if (!finalUrl || /vertexaisearch\.cloud\.google\.com/.test(finalUrl))
          return null;
        // Ground-truth title from the page itself, not the model's claim.
        let title = "";
        try {
          const html = (await r.text()).slice(0, 120_000);
          const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (m) title = decodeEntities(m[1].trim()).slice(0, 200);
        } catch {
          /* title is a bonus, not a requirement */
        }
        return {
          url: finalUrl,
          domain: registrableHost(finalUrl) || "",
          title,
        };
      } catch {
        return null;
      }
    }),
  );
  const out: { url: string; domain: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (!r || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

async function callGeminiGroundedResearch(
  model: string,
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
  grounded: boolean;
}> {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const fail = (status: number, errText: string) => ({
    ok: false,
    status,
    errText,
    text: "",
    inputTokens: 0,
    outputTokens: 0,
    webSearchCount: 0,
    grounded: false,
  });
  if (!key) return fail(0, "GEMINI_API_KEY not set");

  // The editorial rules (named creators, reject content farms, first-person
  // voice) are everything above the OUTPUT FORMAT block. Reuse them verbatim
  // so the two providers are held to the SAME standard; swap only the output
  // contract, since step 1 must produce prose for grounding to engage.
  const rules = systemPrompt.split("OUTPUT FORMAT")[0].trim();
  const researchSystem =
    rules +
    "\n\nOUTPUT FOR THIS STEP: you MUST call Google Search before answering — " +
    "do not answer from memory, and do not return JSON. Write plain prose " +
    "notes listing each find on its own line as: TYPE | TITLE | AUTHOR | " +
    "OUTLET | YYYY-MM | URL, followed by one sentence on why it is worth the " +
    "traveller's time. Only list items you actually found via search.";

  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: researchSystem }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        // `google_search` is the only accepted key — googleSearchRetrieval
        // returns 400 "not supported" on Gemini 3.x.
        tools: [{ google_search: {} }],
        generationConfig: {
          maxOutputTokens: 4000,
          // NO responseMimeType here: it silently disables search.
          // thinkingBudget 0 keeps thought tokens from eating the budget,
          // matching what _shared/llm.ts sends for gemini-3.8-flash.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (e) {
    return fail(0, `gemini fetch failed: ${(e as Error).message}`);
  }
  if (!res.ok) return fail(res.status, await res.text());

  const d = await res.json();
  const cand = d?.candidates?.[0];
  const notes = (cand?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "")
    .join("");
  const queries: string[] = cand?.groundingMetadata?.webSearchQueries ?? [];
  const chunks: unknown[] = cand?.groundingMetadata?.groundingChunks ?? [];
  const u1 = d?.usageMetadata || {};
  const in1 = u1.promptTokenCount || 0;
  const out1 = (u1.candidatesTokenCount || 0) + (u1.thoughtsTokenCount || 0);

  // THE GUARD. No searches => the model answered from memory => reject.
  if (!queries.length || !notes.trim()) {
    console.warn(
      `[inspirations] gemini returned ungrounded output ` +
        `(${queries.length} searches, ${notes.length} chars) — rejecting so the ` +
        `Anthropic path can serve real research instead`,
    );
    return {
      ...fail(res.status, "ungrounded: model did not call Google Search"),
      inputTokens: in1,
      outputTokens: out1,
    };
  }

  // Resolve the citations BEFORE structuring, and hand the real URLs to step 2
  // as a closed set. Without this the structuring model supplies URLs from
  // memory — the measured cause of the grounded path's dead links.
  const citations = await resolveGroundingCitations(chunks);
  console.log(
    `[inspirations] grounded: ${queries.length} searches, ` +
      `${chunks.length} citations, ${citations.length} resolved`,
  );

  // Step 2: structure the grounded notes. No tools, so JSON mode is safe here.
  const formatSpec = "OUTPUT FORMAT" + systemPrompt.split("OUTPUT FORMAT")[1];
  const citationBlock = citations.length
    ? "\n\nVERIFIED SOURCE URLS — these were actually retrieved by the search " +
      "and are the ONLY urls you may use. Use the exact url string. If a find " +
      "from the notes has no matching url here, DROP it rather than inventing " +
      "one. Page titles are ground truth; prefer them over the notes.\n" +
      citations
        .map((c) => `- ${c.url}${c.title ? `  [page title: ${c.title}]` : ""}`)
        .join("\n")
    : "";
  let res2: Response;
  try {
    res2 = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                "You convert research notes into JSON. Use ONLY what the notes " +
                "contain — never invent an entry, author, URL or date, and drop " +
                "anything the notes do not support.\n\n" +
                formatSpec,
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: `Research notes:\n\n${notes}${citationBlock}` }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (e) {
    return fail(0, `gemini structuring failed: ${(e as Error).message}`);
  }
  if (!res2.ok) return fail(res2.status, await res2.text());

  const d2 = await res2.json();
  const u2 = d2?.usageMetadata || {};
  return {
    ok: true,
    status: 200,
    errText: "",
    text: (d2?.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p.text || "")
      .join(""),
    // Both calls are billed to this request.
    inputTokens: in1 + (u2.promptTokenCount || 0),
    outputTokens:
      out1 + (u2.candidatesTokenCount || 0) + (u2.thoughtsTokenCount || 0),
    // Gemini has NO max_uses equivalent — the model decides how many searches
    // to run — so the only honest count is what it reports back.
    webSearchCount: queries.length,
    grounded: true,
  };
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
      // this call wants structured JSON + web search, not deliberation. The
      // off-switch shape differs per model (Sonnet 5.5 rejects "disabled"),
      // so read it from the adapter's trait table. NOTE: this function stays
      // Anthropic-only by design — web_search is an Anthropic server tool —
      // so it deliberately does NOT use modelFor().
      ...(traitsOf(model).thinkingBody
        ? { thinking: traitsOf(model).thinkingBody }
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
    // Which "Load more" page this is. 1 = first load. Unrefined Load-more used
    // to set bypass_cache so the user got a FRESH batch rather than the same
    // set — correct intent, expensive implementation: it skipped the shared
    // cache entirely, so every user regenerated every extra batch from scratch
    // at full price. Putting the ordinal in the cache key preserves the intent
    // (batch 2 != batch 1) while making batch 2 itself cacheable and shared.
    const batch: number = Math.max(
      1,
      Math.min(10, parseInt(String(body.batch ?? 1), 10) || 1),
    );
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
        v: 6, // bump: videos now sourced from the YouTube Data API
        r: refinement,
        b: batch, // paging: each Load-more batch is its own cacheable entry
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
    const batchNote =
      batch > 1
        ? `\n\nThis is batch ${batch} for this destination: the traveller has ` +
          `already seen ${(batch - 1) * 6} earlier finds and wants MORE. Return ` +
          `different creators and less obvious sources than a first page would — ` +
          `go deeper, not broader.`
        : "";
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
        : "") +
      batchNote;

    // Haiku first (cheap, 6 web searches). If it returns an empty digest
    // (over-refusal), escalate once to Sonnet.
    // COST: the escalation measured $0.46 in a single call — more than an
    // entire itinerary — because 8 Sonnet searches dragged 112k input tokens
    // through a $3/M model. Searches also cost $0.01 each on top. Capped to
    // 4: the rescue only has to beat an EMPTY digest, and the primary Haiku
    // pass has already done the broad sweep whose results it can build on.
    // Cut 6 -> 3 on 2026-10-05. Input cost here is QUADRATIC in search count,
    // not linear: every search iteration re-sends the whole accumulated
    // context, so results from search 1 are billed again in 2, 3, 4...
    // Measured 43,071 billed input tokens for 5.03 searches => ~3,200 tokens
    // of results per search. Modelled: 6 searches ~= $0.1011/call,
    // 3 ~= $0.0536 (-47%), 2 ~= $0.0351 (-65%). The `quick` path already
    // runs at 2 and is considered acceptable output.
    // Env-overridable so the 3-vs-6 quality question can be A/B'd on staging
    // without a redeploy, and so it can be dialled back instantly in prod if
    // thin destinations start returning empty digests.
    const HAIKU_MAX_USES = Math.max(
      1,
      parseInt(Deno.env.get("INSPIRATIONS_MAX_SEARCHES") || "3", 10) || 3,
    );
    // Escalation used to re-research from scratch with 4 fresh searches, even
    // though the documented reason it exists is that Haiku OVER-REFUSES — a
    // synthesis failure, not a search failure. The content was usually already
    // retrieved. Telling Sonnet what the primary pass already surfaced lets it
    // spend its budget on the gap instead of repeating work: 4 searches -> 2,
    // which at ~$0.021 all-in per search is ~$0.04 off the most expensive step.
    const SONNET_MAX_USES = 2;

    // Opt-in Google Search grounding. Deliberately read from its OWN env var
    // rather than modelFor(): a global LLM_MODEL_DEFAULT must never be able to
    // reach this function, because the Anthropic path depends on a server tool
    // (web_search) that no other provider implements. Unset => Anthropic.
    const groundedModel = (
      Deno.env.get("INSPIRATIONS_GROUNDED_MODEL") || ""
    ).trim();
    let haiku = null as Awaited<ReturnType<typeof callResearchLLM>> | null;
    let grounded: Awaited<
      ReturnType<typeof callGeminiGroundedResearch>
    > | null = null;

    if (groundedModel.startsWith("gemini")) {
      grounded = await callGeminiGroundedResearch(
        groundedModel,
        SYSTEM_PROMPT,
        userMessage,
      );
      if (!grounded.ok) {
        // Includes the ungrounded-output rejection. Fall through to Anthropic
        // rather than serving unresearched content — the tokens already spent
        // are still billed below so the attempt is never invisible.
        console.warn(
          `[inspirations] grounded path unusable (${grounded.status}: ` +
            `${grounded.errText.slice(0, 160)}) — falling back to Anthropic`,
        );
      }
    }

    if (!grounded?.ok) {
      haiku = await callResearchLLM(
        MODEL,
        quick ? 2 : HAIKU_MAX_USES,
        apiKey,
        SYSTEM_PROMPT,
        userMessage,
      );
      if (!haiku.ok) {
        throw new Error(`Anthropic error ${haiku.status}: ${haiku.errText}`);
      }
    }

    // From here the two paths converge: `research` is whichever one produced
    // usable text, and the escalation logic below is unchanged.
    const research = grounded?.ok ? grounded : haiku!;
    let parsed = tryParseJson(research.text);
    // researchModel = who actually generated `research` (never reassigned).
    // usedModel     = whose content is in the final digest; the escalation
    //                 block below reassigns it to ESCALATION_MODEL.
    // These MUST stay distinct: billing the primary row against usedModel
    // charges Haiku's tokens at Sonnet's rate whenever escalation wins.
    const researchModel = grounded?.ok ? groundedModel : MODEL;
    let usedModel = researchModel;
    let webSearchCount = research.webSearchCount;
    let sonnet: Awaited<ReturnType<typeof callResearchLLM>> | null = null;

    // Escalate not just on EMPTY but on WEAK results — thin destinations had
    // Haiku return 3 items all from one blogger (which the author cap then
    // collapsed to a single card). Weak = under 5 items, fewer than 3 distinct
    // authors, or no videos at all.
    // `let`, because YouTube enrichment below merges into it BEFORE the
    // weak-set test is computed. Order matters twice over: videos sourced here
    // count toward the "is this digest thin?" question (so a destination no
    // longer escalates for a gap YouTube can fill for free), and the
    // escalation merge further down reads THIS array — videos written only to
    // parsed.inspirations were silently discarded when Sonnet reassigned
    // `parsed`, which is why Kazbegi came back with 1 video instead of 3.
    let items = Array.isArray(parsed?.inspirations) ? parsed.inspirations : [];

    if (!quick && destinations.length) {
      const haveVideos = items.filter(
        (i: { type?: string }) => i.type === "video",
      ).length;
      if (haveVideos < 3) {
        const yt = await youtubeSearchVideos(
          destinations[0], // one quota unit per load, not one per city
          3 - haveVideos,
          dbHeaders,
          supabaseUrl,
          batch,
        );
        const seenUrl = new Set(
          items.map((i: { url?: string }) => (i.url || "").trim()),
        );
        // One item per creator across the MERGED set, matching the rule the
        // prompt asks of the model — enforced here rather than hoped for.
        const seenAuthor = new Set(
          items.map((i: { author?: string }) =>
            (i.author || "").toLowerCase().trim(),
          ),
        );
        const fresh = yt
          .filter((v) => {
            const a = v.author.toLowerCase();
            if (seenUrl.has(v.url) || seenAuthor.has(a)) return false;
            seenUrl.add(v.url);
            seenAuthor.add(a);
            return true;
          })
          .map((v) => ({
            title: v.title,
            url: v.url,
            author: v.author,
            type: "video",
            blurb: `Travel vlog by ${v.author}${v.published ? ` · ${v.published.slice(0, 4)}` : ""}.`,
          }));
        if (fresh.length) {
          items = [...items, ...fresh];
          // parsed can be null when the model returned unparseable output.
          // Don't drop the videos on the floor — seed an object so they
          // survive into the escalation merge below. (Writing straight to
          // parsed.inspirations here threw "Cannot set properties of null".)
          if (!parsed) parsed = { inspirations: [] };
          parsed.inspirations = items;
          console.log(
            `[inspirations] YouTube added ${fresh.length} video(s) for ` +
              `"${destinations[0]}" (had ${haveVideos})`,
          );
        }
      }
    }

    const distinctAuthors = new Set(
      items.map((i: { author?: string }) =>
        (i.author || "").toLowerCase().trim(),
      ),
    ).size;
    const videoCount = items.filter(
      (i: { type?: string }) => i.type === "video",
    ).length;
    // weakOverall is now the ONLY reason to escalate. "No videos" used to be a
    // second trigger that burned a Sonnet re-research (Lisbon: 6 strong
    // articles, escalated solely for a missing video, found none anyway, then
    // cached for 48h so the ~$0.25 sequence repeated). YouTube fills that gap
    // for free below, so the expensive remedy is gone.
    const weakOverall = !parsed || items.length < 5 || distinctAuthors < 3;
    const haikuEmpty = weakOverall;

    if (haikuEmpty && !quick && !ESCALATION_ENABLED)
      console.log(
        `[inspirations] weak digest (${items.length} items, ` +
          `${distinctAuthors} authors) but escalation is disabled`,
      );
    if (haikuEmpty && !quick && ESCALATION_ENABLED) {
      // Hand over what the primary pass already found, so Sonnet does not
      // re-derive it. Deliberately the titles/urls only, not the full
      // retrieved page content: passing Haiku's entire tool-result context
      // would cost ~30k tokens at Sonnet's 2x input rate, which is more than
      // the searches it saves.
      const alreadyFound = items.length
        ? `\n\nThe first pass already found these — do NOT repeat them, and do ` +
          `not spend searches re-finding this ground. Add DIFFERENT creators ` +
          `and sources that complement them:\n` +
          items
            .map(
              (i: { type?: string; title?: string; author?: string }) =>
                `- [${i.type || "article"}] ${i.title || "?"} — ${i.author || "?"}`,
            )
            .join("\n")
        : "\n\nThe first pass found nothing usable. Search broadly.";
      sonnet = await callResearchLLM(
        ESCALATION_MODEL,
        SONNET_MAX_USES,
        apiKey,
        SYSTEM_PROMPT,
        userMessage + alreadyFound,
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
          webSearchCount += sonnet.webSearchCount;
        } else if (!parsed && sonnetParsed) {
          // Haiku unparseable and Sonnet at least parsed (even to empty).
          parsed = sonnetParsed;
          usedModel = ESCALATION_MODEL;
          webSearchCount += sonnet.webSearchCount;
        }
      }
    }

    if (!parsed) {
      // Both models failed to produce parseable JSON.
      console.error(
        `unparseable digest. ${usedModel} raw (first 500):`,
        research.text?.slice(0, 500),
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
        // researchModel, not usedModel: this row is the PRIMARY call's usage,
        // and usedModel may have been reassigned to the escalation model.
        model: researchModel,
        input_tokens: research.inputTokens,
        output_tokens: research.outputTokens,
        web_search_count: research.webSearchCount,
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
        model: researchModel,
        // tagResult is always a Haiku call; folding its tokens in here bills
        // them at usedModel's rate. That is a rounding-level distortion on a
        // ~200-token call and always in the over-charge direction when the
        // research model is cheaper than Haiku, which it is for Gemini.
        inputTokens: research.inputTokens + tagResult.inputTokens,
        outputTokens: research.outputTokens + tagResult.outputTokens,
        webSearchCount: research.webSearchCount,
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
    await captureException(err, {
      functionName: "generate-destination-research",
    });
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
// YouTube is a liveness BLIND SPOT for urlAlive: youtube.com returns HTTP 200
// for every /watch URL, including ids that do not exist, so a hallucinated
// video passes the check. Measured 2026-10-05: of 40 stored video links, 4
// were dead (two 400, one 401, one 404) and had been cached as real. YouTube
// is also exempt from the spam screen (TRUSTED_PLATFORM_RE), so videos were
// receiving NO validation of any kind while articles got two layers.
//
// oEmbed is the correct probe — it 400s on a nonexistent id — and it returns
// the CANONICAL title and author, which lets us replace the model's claimed
// attribution with ground truth. Measured mismatches: claimed "Mona" was
// actually "Unique Japan Travel"; claimed "Unknown" was "ONLY in JAPAN * GO".
const VIDEO_HOST_RE = /(^|\.)(youtube\.com|youtu\.be)$/i;

// ── YouTube video discovery ──────────────────────────────────────────────────
// Videos used to be found by asking Haiku to web_search for them, which was
// both the most expensive and the least reliable part of this function:
//   * two extra billed searches ($0.02) whenever the video top-up fired
//   * the model INVENTED watch URLs (urlAlive returns 200 for any youtube.com
//     path, so dead ids sailed through until the oEmbed probe was added)
//   * it misattributed real videos to the wrong creator
// YouTube's own search returns the channel title authoritatively, in ~350ms,
// for free. There is nothing for a model to get wrong here.
//
// Quota: search.list has its own bucket of 100 calls/day per project (the
// model changed in June 2026; other methods share a separate 10,000-unit
// pool). There is no paid tier and no overage — exceeding it fails until
// midnight Pacific — so results are cached for 30 days and every failure path
// degrades silently to whatever the model found on its own.
const YOUTUBE_CACHE_DAYS = 30;

type YtVideo = {
  title: string;
  url: string;
  author: string;
  published: string;
};

/** Minimal HTML-entity decode. YouTube returns &amp; / &#39; in titles. */
function decodeEntities(x: string): string {
  return x
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function youtubeSearchVideos(
  destination: string,
  want: number,
  dbHeaders: Record<string, string>,
  supabaseUrl: string,
  batch = 1,
): Promise<YtVideo[]> {
  const key = Deno.env.get("YOUTUBE_API_KEY") || "";
  if (!key) return [];
  const q = `${destination} travel vlog`;
  // Cache the whole deduped POOL, not just the 3 we want now, and take a
  // different window per Load-more batch. Returning the same top 3 every time
  // is what made batch 2 look like batch 1 — measured on Seville, 3 of the 4
  // duplicates were videos. Paging the pool costs no extra quota.
  const cacheKey = `yt-pool:${q.toLowerCase()}`;

  // Cache first — a destination's best travel videos do not change hourly, and
  // the 100/day quota is a hard wall rather than something we can pay past.
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/place_cache?key=eq.${encodeURIComponent(cacheKey)}&select=result,expires_at`,
      { headers: dbHeaders },
    );
    if (r.ok) {
      const rows = await r.json();
      const hit = Array.isArray(rows) && rows[0];
      if (hit && (!hit.expires_at || new Date(hit.expires_at) > new Date()))
        return sliceForBatch((hit.result as YtVideo[]) || [], want, batch);
    }
  } catch {
    /* cache is an optimisation, never a dependency */
  }

  let items: unknown[] = [];
  try {
    const u = new URL("https://www.googleapis.com/youtube/v3/search");
    u.searchParams.set("key", key);
    u.searchParams.set("part", "snippet");
    u.searchParams.set("q", q);
    u.searchParams.set("type", "video");
    // Over-fetch: the per-creator dedupe and Shorts filter below discard some.
    // One deep fetch (one quota unit) that later batches page through.
    u.searchParams.set("maxResults", "25");
    u.searchParams.set("relevanceLanguage", "en");
    u.searchParams.set("videoEmbeddable", "true");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(u, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.text();
      // quotaExceeded is expected at the wall, not an incident. Anything else
      // (bad key, API restriction) is a misconfiguration worth seeing.
      const quota = /quotaExceeded|dailyLimitExceeded/i.test(body);
      console.warn(
        `[inspirations] YouTube search ${res.status}${quota ? " (quota exhausted — degrading)" : ""}: ${body.slice(0, 200)}`,
      );
      if (!quota)
        void captureException(
          new Error(`youtube_search_failed_${res.status}`),
          { functionName: "generate-destination-research:youtube", q },
        );
      return [];
    }
    items = (await res.json())?.items ?? [];
  } catch (e) {
    console.warn(
      `[inspirations] YouTube search threw: ${(e as Error).message}`,
    );
    return [];
  }

  const out: YtVideo[] = [];
  const seenChannels = new Set<string>();
  for (const raw of items) {
    const it = raw as {
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
      };
    };
    const id = it.id?.videoId;
    const sn = it.snippet;
    if (!id || !sn?.channelTitle) continue;
    const title = decodeEntities(String(sn.title || "")).trim();
    // Shorts are vertical clips, not the trip-planning content this feature is
    // for; they surface heavily on travel queries and read as filler.
    if (/#shorts?\b/i.test(title)) continue;
    // One item per creator — the same rule the prompt enforces for articles,
    // applied here deterministically instead of hopefully.
    const chan = sn.channelTitle.trim();
    const chanKey = chan.toLowerCase();
    if (seenChannels.has(chanKey)) continue;
    seenChannels.add(chanKey);
    out.push({
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      author: chan,
      published: String(sn.publishedAt || "").slice(0, 10),
    });
  }

  // Persist even an empty result: a destination with no usable videos should
  // not re-spend quota on every load.
  fetch(`${supabaseUrl}/rest/v1/place_cache`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      key: cacheKey,
      action: "yt-search",
      result: out,
      source: "youtube",
      expires_at: new Date(
        Date.now() + YOUTUBE_CACHE_DAYS * 86400000,
      ).toISOString(),
      created_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  return sliceForBatch(out, want, batch);
}

/** Window into the cached pool for one Load-more batch. A batch past the end
 *  falls back to the pool head, so late batches show something rather than
 *  nothing. */
function sliceForBatch(
  pool: YtVideo[],
  want: number,
  batch: number,
): YtVideo[] {
  if (!pool.length) return [];
  const start = Math.max(0, (batch - 1) * want);
  if (start >= pool.length) return pool.slice(0, want);
  return pool.slice(start, start + want);
}

async function youtubeOEmbed(
  url: string,
): Promise<{ title: string; author: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      title: String(d?.title || "").trim(),
      author: String(d?.author_name || "").trim(),
    };
  } catch {
    return null;
  }
}

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
  // 0. Normalise type from the URL before anything else. The model sometimes
  //    labels a youtube.com link as "article", which then fails the
  //    video-count gate and fires a ~$0.19 Sonnet escalation for a video we
  //    already had. Measured: 40 YouTube URLs, only 38 typed "video".
  for (const i of items) {
    if (i?.url && VIDEO_HOST_RE.test(registrableHost(i.url) || "")) {
      i.type = "video";
    }
  }

  // 1. Liveness — parallel, bounded by the 5s per-request timeout. Video
  //    platforms go through oEmbed instead, which actually validates
  //    existence and yields canonical metadata.
  const liveFlags = await Promise.all(
    items.map(async (i) => {
      if (!i?.url) return false;
      if (VIDEO_HOST_RE.test(registrableHost(i.url) || "")) {
        const meta = await youtubeOEmbed(i.url);
        if (!meta) return false;
        // Ground truth beats the model's claim: this feature's whole premise
        // is a correctly attributed named creator.
        if (meta.author) i.author = meta.author;
        if (meta.title) i.title = meta.title;
        return true;
      }
      return urlAlive(i.url);
    }),
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
