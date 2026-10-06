import { captureException } from "../_shared/errortrack.ts";
import {
  callLLM,
  modelFor,
  suggestCap,
  type JSONSchema,
} from "../_shared/llm.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  llmKillSwitch,
  resolveAndGate,
  deductCredits,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The ids are echoed back from our own payload, so the schema pins the
// envelope while the id-membership filter below still guards against
// hallucinated ids — a schema constrains shape, never truthfulness.
const NARRATIVES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["days", "activities"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "story_title", "narrative"],
        properties: {
          id: { type: "string" },
          story_title: { type: "string" },
          narrative: { type: "string" },
        },
      },
    },
    activities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "gloss"],
        properties: {
          id: { type: "string" },
          gloss: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a travel-magazine editor writing story content for an existing trip itinerary.

You receive the trip's days and activities as JSON with ids. Return ONLY a raw JSON object:
{"days":[{"id":"<day id>","story_title":"...","narrative":"..."}],"activities":[{"id":"<activity id>","gloss":"..."}]}

Rules:
- story_title: a 2–4 word evocative title for the day (e.g. "Lanterns and Backstreets", "Into the Caldera"). No city names, no "Day N".
- narrative: 2–3 magazine-style sentences with the day's mood and arc — sensory and specific, written like a travel-magazine opening paragraph. Avoid listing stops: mention at most one place, by the exact name used in that day's activities.
- gloss: one evocative line, max 12 words, capturing what this place IS (e.g. "Ten thousand vermilion gates threading up a sacred mountainside"). Not practical advice.
- Return an entry for EVERY day and EVERY activity you were given — use their exact ids. Do not invent ids.
- No markdown inside string values.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const killed = llmKillSwitch(corsHeaders);
  if (killed) return killed;

  const user = await authenticateUser(req);
  if (!user) return unauthorized(corsHeaders);

  const rateLimited = await rateLimit(user.id, corsHeaders);
  if (rateLimited) return rateLimited;

  try {
    // SECURITY: input is tripId ONLY. All day/activity ids are fetched
    // server-side below — client-supplied ids + service role would allow
    // cross-trip writes.
    const { tripId, spend_personal } = await req.json();
    if (!tripId) throw new Error("tripId is required");

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Caller must be the trip owner or a member.
    const { data: tripRow } = await supa
      .from("trips")
      .select("id, created_by")
      .eq("id", tripId)
      .single();
    if (!tripRow) throw new Error("trip not found");
    if (tripRow.created_by !== user.id) {
      const { data: membership } = await supa
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) return unauthorized(corsHeaders);
    }

    const { data: days } = await supa
      .from("days")
      .select(
        "id, label, city, date, description, story_title, narrative, activities(id, time, title, type, note, gloss, position)",
      )
      .eq("trip_id", tripId)
      .order("position");
    if (!days?.length) {
      return new Response(JSON.stringify({ days: [], activities: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only ask for what's missing; transit rows carry no gloss.
    const dayIds = new Set(days.map((d: any) => d.id));
    const actById = new Map<string, any>();
    const payload = days.map((d: any) => {
      const acts = (d.activities || [])
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
        .filter((a: any) => a.type !== "transit");
      for (const a of acts) actById.set(a.id, a);
      return {
        id: d.id,
        label: d.label,
        city: d.city,
        needs_story: !d.story_title || !d.narrative,
        description: d.description || undefined,
        activities: acts.map((a: any) => ({
          id: a.id,
          time: a.time,
          title: a.title,
          type: a.type,
          needs_gloss: !a.gloss,
        })),
      };
    });

    const anythingMissing = payload.some(
      (d: any) => d.needs_story || d.activities.some((a: any) => a.needs_gloss),
    );
    if (!anythingMissing) {
      return new Response(JSON.stringify({ days: [], activities: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-flight (Phase 2.5): personal for solo, pool for shared trips.
    const { gate, source } = await resolveAndGate(
      user,
      tripId,
      spend_personal === true,
      corsHeaders,
    );
    if (gate) return gate;

    const userMessage = `Write story content for every day with needs_story:true and a gloss for every activity with needs_gloss:true. Trip days:
${JSON.stringify(payload)}`;

    const model = modelFor("NARRATIVES", "claude-haiku-4-5-20251001");
    // Measured ~520 output tokens/day (uuid keys + narrative); headroom on top.
    // The 16000 ceiling stays: it is an edge-function wall-clock guard, not a
    // model-verbosity figure, so suggestCap scales the per-day budget only.
    const result = await callLLM({
      model,
      system: SYSTEM_PROMPT,
      user: userMessage,
      maxTokens: Math.min(16000, suggestCap(model, days.length * 800 + 1000)),
      json: true,
      schema: NARRATIVES_SCHEMA as unknown as JSONSchema,
    });

    deductCredits({
      userId: user.id,
      model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheCreationTokens: result.usage.cache_creation_input_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      functionName: "generate-day-narratives",
      tripId,
      source,
    }).catch(() => {});

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        trip_id: tripId,
        function_name: "generate-day-narratives",
        model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_tokens: result.usage.cache_creation_input_tokens,
        cache_read_tokens: result.usage.cache_read_input_tokens,
        duration_ms: result.ms,
      }),
    }).catch(() => {});

    // Loose element typing to match the id-membership filters below, which
    // are what actually guard this data (a schema pins shape, not truth).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = result.parsed as { days?: any[]; activities?: any[] } | null;
    if (!parsed)
      throw new Error(
        `parse_failed (truncated=${result.truncated}, ` +
          `schemaUnsupported=${result.schemaUnsupported})`,
      );

    // Only write rows whose ids we fetched ourselves (hallucinated ids dropped),
    // and never overwrite existing content.
    const dayPatches = (parsed.days || []).filter(
      (d: any) => d?.id && dayIds.has(d.id) && (d.story_title || d.narrative),
    );
    const actPatches = (parsed.activities || []).filter(
      (a: any) => a?.id && actById.has(a.id) && a.gloss,
    );

    const writes: PromiseLike<unknown>[] = [];
    const appliedDays: any[] = [];
    const appliedActs: any[] = [];
    for (const d of dayPatches) {
      const existing: any = days.find((x: any) => x.id === d.id);
      const patch: Record<string, string> = {};
      if (d.story_title && !existing.story_title)
        patch.story_title = String(d.story_title);
      if (d.narrative && !existing.narrative)
        patch.narrative = String(d.narrative);
      if (!Object.keys(patch).length) continue;
      appliedDays.push({ id: d.id, ...patch });
      writes.push(supa.from("days").update(patch).eq("id", d.id));
    }
    for (const a of actPatches) {
      if (actById.get(a.id).gloss) continue;
      const patch = { gloss: String(a.gloss) };
      appliedActs.push({ id: a.id, ...patch });
      writes.push(supa.from("activities").update(patch).eq("id", a.id));
    }
    await Promise.all(writes);

    return new Response(
      JSON.stringify({ days: appliedDays, activities: appliedActs }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("generate-day-narratives error:", err.message);
    await captureException(err, { functionName: "generate-day-narratives" });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
