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
