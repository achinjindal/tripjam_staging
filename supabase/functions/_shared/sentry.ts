// Minimal Sentry capture for Deno edge functions — no SDK dependency.
//
// Uses Sentry's HTTP envelope API directly. Gated on SENTRY_DSN env var:
// if not set, captureException is a no-op (silent).
//
// To enable: set SENTRY_DSN secret on the Supabase project (Edge Function secrets).
//   supabase secrets set SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<projectId> --project-ref <ref>
//
// Usage in an edge function:
//   import { captureException } from "../_shared/sentry.ts";
//   try { ... } catch (e) { await captureException(e, { functionName: "...", userId: "..." }); throw e; }

const DSN = Deno.env.get("SENTRY_DSN") || "";
const ENVIRONMENT =
  Deno.env.get("APP_ENV") || Deno.env.get("SUPABASE_URL")?.includes("viyvd")
    ? "production"
    : "staging";

interface SentryContext {
  functionName?: string;
  userId?: string | null;
  tripId?: string | null;
  [k: string]: unknown;
}

function parseDsn(
  dsn: string,
): { envelopeUrl: string; publicKey: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    const envelopeUrl = `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`;
    return { envelopeUrl, publicKey, projectId };
  } catch {
    return null;
  }
}

const PARSED = DSN ? parseDsn(DSN) : null;

export async function captureException(
  error: unknown,
  context?: SentryContext,
): Promise<void> {
  if (!PARSED) return;

  try {
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const isError = error instanceof Error;
    const message = isError ? (error as Error).message : String(error);
    const type = isError ? (error as Error).name : "Error";
    const stack = isError ? (error as Error).stack : undefined;

    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      level: "error",
      platform: "javascript",
      environment: ENVIRONMENT,
      message: { formatted: message },
      exception: {
        values: [
          {
            type,
            value: message,
            stacktrace: stack ? { frames: parseStack(stack) } : undefined,
          },
        ],
      },
      tags: {
        function_name: context?.functionName || "unknown",
      },
      user: context?.userId ? { id: context.userId } : undefined,
      extra: context,
    };

    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");

    await fetch(PARSED.envelopeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    });
  } catch (e) {
    // Don't let Sentry errors break the caller — just log
    console.error("Sentry capture failed:", (e as Error).message);
  }
}

function parseStack(stack: string): Array<{
  filename: string;
  function: string;
  lineno: number;
  colno: number;
}> {
  // Lightweight Deno/V8 stack parser. Good enough for grouping.
  return stack
    .split("\n")
    .slice(1, 20)
    .map((line) => {
      const m = line.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?/);
      return m
        ? {
            function: m[1] || "?",
            filename: m[2] || "?",
            lineno: parseInt(m[3], 10) || 0,
            colno: parseInt(m[4], 10) || 0,
          }
        : { function: line.trim(), filename: "?", lineno: 0, colno: 0 };
    });
}

// Convenience: wraps a handler so any thrown error is captured and re-thrown.
export function withSentry<T>(
  functionName: string,
  fn: (req: Request) => Promise<T>,
): (req: Request) => Promise<T> {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      await captureException(err, { functionName });
      throw err;
    }
  };
}
