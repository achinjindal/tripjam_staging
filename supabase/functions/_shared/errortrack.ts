// Minimal PostHog exception capture for Deno edge functions — no SDK.
// Successor to _shared/sentry.ts (PostHog is the single error sink).
//
// Gated on the POSTHOG_KEY secret: if not set, captureException is a silent
// no-op. The key is the same public project key the frontend uses (phc_…).
//
//   supabase secrets set POSTHOG_KEY=phc_… --project-ref <ref>
//
// Usage:
//   import { captureException } from "../_shared/errortrack.ts";
//   try { ... } catch (e) {
//     await captureException(e, { functionName: "chat", userId: user.id });
//     throw e;
//   }

const KEY = Deno.env.get("POSTHOG_KEY") || "";
const HOST = Deno.env.get("POSTHOG_HOST") || "https://us.i.posthog.com";
const ENVIRONMENT = (Deno.env.get("SUPABASE_URL") || "").includes("viyvd")
  ? "production"
  : "staging";

interface ErrorContext {
  functionName?: string;
  userId?: string | null;
  tripId?: string | null;
  [k: string]: unknown;
}

// The three named fields map to dedicated properties below; everything else a
// caller passes is forwarded verbatim. Without this, `[k: string]: unknown`
// advertised arbitrary context that was silently dropped at runtime — a
// diagnostic passed to captureException never reached PostHog, which is how
// "model returned unparseable digest" (issue #13) arrived with no raw output
// attached and had to be chased through 24h-retention edge logs instead.
const NAMED_KEYS = new Set(["functionName", "userId", "tripId"]);

// PostHog rejects oversized payloads; a raw model response can be far larger
// than anything useful to read in the UI.
const MAX_PROP_CHARS = 8_000;

function clip(s: string): string {
  return s.length > MAX_PROP_CHARS
    ? `${s.slice(0, MAX_PROP_CHARS)}…[truncated, ${s.length} chars total]`
    : s;
}

/** Forward caller-supplied context as PostHog properties. Never throws. */
function extraProps(ctx: ErrorContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    // `$`-prefixed keys are PostHog's own namespace — never let a caller
    // overwrite $exception_list and friends.
    if (NAMED_KEYS.has(k) || k.startsWith("$") || v === undefined) continue;
    if (typeof v === "string") out[k] = clip(v);
    else if (v === null || typeof v === "number" || typeof v === "boolean")
      out[k] = v;
    else {
      try {
        out[k] = clip(JSON.stringify(v) ?? String(v));
      } catch {
        out[k] = String(v); // circular or otherwise unserializable
      }
    }
  }
  return out;
}

/** Send an exception to PostHog error tracking. Never throws. */
export async function captureException(
  err: unknown,
  ctx: ErrorContext = {},
): Promise<void> {
  if (!KEY) return;
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    await fetch(`${HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        event: "$exception",
        distinct_id: ctx.userId || `edge:${ctx.functionName || "unknown"}`,
        properties: {
          // Spread first so the canonical fields below always win — a caller
          // passing `app_env` or `function_name` must not shadow them.
          ...extraProps(ctx),
          $exception_list: [
            {
              type: e.name,
              value: e.message,
              mechanism: { handled: true, synthetic: false },
            },
          ],
          $exception_message: e.message,
          $exception_type: e.name,
          $exception_stack_trace_raw: e.stack || null,
          app_env: ENVIRONMENT,
          runtime: "supabase-edge",
          function_name: ctx.functionName || null,
          trip_id: ctx.tripId || null,
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    /* telemetry must never break the caller */
  }
}
