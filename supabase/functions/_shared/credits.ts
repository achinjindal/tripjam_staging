// Shared credit-system helpers for edge functions.
//
// Pricing model (Day 2 rebuild — D11-D18 + D24):
//   1 credit = $0.01 user value.
//   LLM calls:    credits_charged = ceil((actual_llm_cost_usd / 0.007) * 100) / 100
//                 (70% LLM budget per credit; 30% margin)
//   Google/ext:   credits_charged = ceil((external_api_cost_usd / 0.01) * 100) / 100
//                 (pass-through — no founder margin per D24)
//
// Stored as NUMERIC(10,2) in profiles.credits; displayed as Math.floor() to user.

const RATES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
};

// D18: Each credit covers $0.007 of LLM spend (70% of $0.01 user value)
export const CREDIT_LLM_BUDGET_USD = 0.007;
// D24: External APIs (Google Places, Photos) pass through at full $0.01/credit
export const EXTERNAL_API_USER_VALUE = 0.01;

export function computeLLMCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const r = RATES[model] || RATES["claude-sonnet-4-6"];
  return (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
}

// Round up to nearest 0.01 (whole cent of LLM spend). No `Math.max(1, ...)`
// floor — tiny Haiku calls can deduct < 1 credit.
export function costToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil((usd / CREDIT_LLM_BUDGET_USD) * 100) / 100;
}

// Pass-through pricing for external API costs (no founder margin). 1 credit = $0.01.
export function costToCreditsPassthrough(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil((usd / EXTERNAL_API_USER_VALUE) * 100) / 100;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type AuthedUser = { id: string; credits: number };

// Verify the bearer token, return the user + current credit balance.
// Returns null if the token is missing/invalid.
export async function authenticateUser(
  req: Request,
): Promise<AuthedUser | null> {
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  // Anon-key requests should not be authenticated as a user.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (anonKey && token === anonKey) return null;

  const supa = adminClient();
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await supa
    .from("profiles")
    .select("credits")
    .eq("id", data.user.id)
    .maybeSingle();

  return { id: data.user.id, credits: profile?.credits ?? 0 };
}

// Standard 401 response.
export function unauthorized(corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Standard 402 (Payment Required) response when the user is out of credits.
export function outOfCredits(
  corsHeaders: Record<string, string>,
  balance: number,
) {
  return new Response(
    JSON.stringify({
      error: "Out of credits",
      code: "insufficient_credits",
      credits: balance,
    }),
    {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

// Pre-flight check: returns null when the user has enough credits, else a 402 Response.
// Default minimum of 1.0 covers worst-case Haiku call without overdraw at boundary.
export function requireMinCredits(
  user: AuthedUser | null,
  corsHeaders: Record<string, string>,
  min = 1.0,
): Response | null {
  if (!user) return unauthorized(corsHeaders);
  if (user.credits < min) return outOfCredits(corsHeaders, user.credits);
  return null;
}

// Day 7: per-user per-minute rate limit. Returns 429 Response when over the
// limit; null otherwise. Uses Postgres SECURITY DEFINER RPC for atomicity.
// Limit defaults to 20 calls/min/user — comfortable for normal usage,
// catches runaway loops and basic abuse.
export async function rateLimit(
  userId: string,
  corsHeaders: Record<string, string>,
  bucket = "llm",
  limit = 20,
): Promise<Response | null> {
  if (!userId) return null;
  const supa = adminClient();
  try {
    const { data, error } = await supa.rpc("incr_rate_limit", {
      p_user_id: userId,
      p_bucket: bucket,
    });
    if (error) {
      // Fail-open: log + allow request through. Avoid blocking valid users
      // because of a transient DB hiccup.
      console.warn("rateLimit RPC failed:", error.message);
      return null;
    }
    const count = typeof data === "number" ? data : Number(data);
    if (count > limit) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          code: "rate_limited",
          limit,
          retry_after_seconds: 60,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        },
      );
    }
    return null;
  } catch (e) {
    console.warn("rateLimit exception:", (e as Error).message);
    return null;
  }
}

// Day 7: global kill switch. Set LLM_KILL_SWITCH=true on Supabase edge
// function secrets to block all LLM-touching endpoints within ~1 minute
// (next cold start picks up the env). Returns 503 when active.
export function llmKillSwitch(
  corsHeaders: Record<string, string>,
): Response | null {
  if (Deno.env.get("LLM_KILL_SWITCH") === "true") {
    return new Response(
      JSON.stringify({
        error:
          "Service temporarily unavailable. Please retry in a few minutes.",
        code: "kill_switch",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  return null;
}

// Atomically deduct credits and log a transaction. Fire-and-forget — failure
// to record a deduction should not break the user-facing response.
export async function deductCredits(args: {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  functionName: string;
  tripId?: string | null;
}): Promise<void> {
  const usd = computeLLMCost(args.model, args.inputTokens, args.outputTokens);
  const credits = costToCredits(usd);
  if (credits <= 0) return;
  const supa = adminClient();
  try {
    await supa.rpc("deduct_credits", {
      p_user_id: args.userId,
      p_amount: credits,
      p_reason: args.functionName,
      p_function_name: args.functionName,
      p_trip_id: args.tripId ?? null,
      p_llm_cost_usd: usd,
      p_metadata: {
        model: args.model,
        input_tokens: args.inputTokens,
        output_tokens: args.outputTokens,
      },
    });
  } catch (e) {
    console.error("deductCredits failed:", (e as Error).message);
  }
}

// Pass-through external API charge (Google Places, Photos, etc). The caller
// already computed the USD cost from the API's published rate sheet. Uses
// $0.01-per-credit pass-through scale (no founder margin per D24).
export async function deductExternalApiCredits(args: {
  userId: string;
  costUsd: number;
  reason: string; // e.g. "places-proxy:google-find-place"
  functionName: string;
  tripId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const credits = costToCreditsPassthrough(args.costUsd);
  if (credits <= 0) return;
  const supa = adminClient();
  try {
    await supa.rpc("deduct_credits", {
      p_user_id: args.userId,
      p_amount: credits,
      p_reason: args.reason,
      p_function_name: args.functionName,
      p_trip_id: args.tripId ?? null,
      p_llm_cost_usd: args.costUsd, // re-using column for any external $ cost
      p_metadata: { ...(args.metadata ?? {}), pricing: "passthrough" },
    });
  } catch (e) {
    console.error("deductExternalApiCredits failed:", (e as Error).message);
  }
}

// Idempotent credit grant (used by payment-webhook). Pass `providerSessionId`
// (Lemon Squeezy order_id, Stripe checkout session id, etc) to leverage the
// UNIQUE constraint on credit_transactions for at-most-once semantics on
// webhook replays.
export async function grantCredits(args: {
  userId: string;
  amount: number;
  reason: string;
  providerSessionId?: string;
  metadata?: Record<string, unknown>;
}): Promise<number | null> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) return null;
  const supa = adminClient();
  try {
    const { data, error } = await supa.rpc("grant_credits", {
      p_user_id: args.userId,
      p_amount: args.amount,
      p_reason: args.reason,
      p_metadata: args.metadata ?? null,
      p_provider_session_id: args.providerSessionId ?? null,
    });
    if (error) throw error;
    return typeof data === "number" ? data : Number(data);
  } catch (e) {
    console.error("grantCredits failed:", (e as Error).message);
    return null;
  }
}
