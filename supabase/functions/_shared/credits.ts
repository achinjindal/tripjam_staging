// Shared credit-system helpers for edge functions.
//
// Pricing model (decided 2026-05-13):
//   1 credit = $0.05 user value · 70% LLM budget = $0.035 LLM/credit.
//   credits_charged = ceil(actual_llm_cost_usd / 0.035)
//
// Anthropic rates as of 2026-05 (USD per 1M tokens):
const RATES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5":  { input: 0.8, output: 4.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
};

const CREDIT_LLM_BUDGET_USD = 0.035; // dollars of LLM cost per credit

export function computeLLMCost(model: string, inputTokens: number, outputTokens: number): number {
  const r = RATES[model] || RATES["claude-sonnet-4-6"];
  return (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
}

export function costToCredits(usd: number): number {
  return Math.max(1, Math.ceil(usd / CREDIT_LLM_BUDGET_USD));
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
export async function authenticateUser(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
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
export function outOfCredits(corsHeaders: Record<string, string>, balance: number) {
  return new Response(
    JSON.stringify({ error: "Out of credits", code: "insufficient_credits", credits: balance }),
    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
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
  const supa = adminClient();
  try {
    await supa.rpc("deduct_credits", {
      p_user_id: args.userId,
      p_amount: credits,
      p_reason: args.functionName,
      p_function_name: args.functionName,
      p_trip_id: args.tripId ?? null,
      p_llm_cost_usd: usd,
      p_metadata: { model: args.model, input_tokens: args.inputTokens, output_tokens: args.outputTokens },
    });
  } catch (e) {
    console.error("deductCredits failed:", (e as Error).message);
  }
}
