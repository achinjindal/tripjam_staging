// Coupon code redemption — grants free credits without payment.
// Each coupon is single-use per user (idempotent via provider_session_id UNIQUE constraint).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  grantCredits,
} from "../_shared/credits.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// code → { credits granted, reusable }. reusable:true = no per-user cap —
// every redemption grants again (unique ledger key per redemption). Only the
// per-user rate limit (5/min) brakes it; treat reusable codes as
// founder/insider codes, not public promos.
const VALID_COUPONS: Record<string, { credits: number; reusable?: boolean }> = {
  IKNOWACHIN: { credits: 300, reusable: true },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const user = await authenticateUser(req);
  if (!user) return unauthorized(corsHeaders);

  const rateLimited = await rateLimit(user.id, corsHeaders, "coupon", 5);
  if (rateLimited) return rateLimited;

  try {
    const { code, trip_id } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Coupon code is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Phase 2.5 — optional pool recharge. When trip_id is present the redeemer
    // must be a current member of that trip (guards funding a pool you can't see).
    const tripId = typeof trip_id === "string" && trip_id ? trip_id : null;
    if (tripId) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: isMember, error: memberErr } = await admin.rpc(
        "is_trip_member",
        { p_trip: tripId, p_uid: user.id },
      );
      if (memberErr || !isMember) {
        return new Response(JSON.stringify({ error: "not_a_member" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const normalised = code.trim().toUpperCase();
    const coupon = VALID_COUPONS[normalised];

    if (!coupon) {
      return new Response(JSON.stringify({ error: "Invalid coupon code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const credits = coupon.credits;

    // Ledger key: single-use codes get one key per (code, user) — reusable
    // codes get a fresh key per redemption so every grant goes through.
    const sessionId = coupon.reusable
      ? `coupon_${normalised}_${user.id}_${Date.now()}`
      : `coupon_${normalised}_${user.id}`;

    // Duplicate check MUST be explicit: grant_credits treats a repeated
    // provider_session_id as a silent no-op returning the current balance
    // (webhook-replay semantics) — it does NOT throw. Relying on the UNIQUE
    // constraint here made every repeat redemption a fake 200 success.
    if (!coupon.reusable) {
      const ledger = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: prior } = await ledger
        .from("credit_transactions")
        .select("id")
        .eq("provider_session_id", sessionId)
        .limit(1);
      if (prior?.length) {
        return new Response(
          JSON.stringify({ error: "Coupon already redeemed" }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const newBalance = await grantCredits({
      userId: user.id,
      amount: credits,
      reason: "coupon",
      providerSessionId: sessionId,
      tripId,
      metadata: { code: normalised, ...(tripId ? { trip_id: tripId } : {}) },
    });

    if (newBalance === null) {
      // RPC threw (race on the UNIQUE constraint, or a genuine failure)
      return new Response(
        JSON.stringify({ error: "Coupon already redeemed" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ granted: credits, balance: newBalance }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("redeem-coupon error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
