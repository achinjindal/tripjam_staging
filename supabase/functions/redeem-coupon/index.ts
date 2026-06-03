// Coupon code redemption — grants free credits without payment.
// Each coupon is single-use per user (idempotent via provider_session_id UNIQUE constraint).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  grantCredits,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// code → credits granted
const VALID_COUPONS: Record<string, number> = {
  IKNOWACHIN: 300,
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
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Coupon code is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const normalised = code.trim().toUpperCase();
    const credits = VALID_COUPONS[normalised];

    if (!credits) {
      return new Response(
        JSON.stringify({ error: "Invalid coupon code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // provider_session_id is UNIQUE — second redemption will throw and be caught below
    const newBalance = await grantCredits({
      userId: user.id,
      amount: credits,
      reason: "coupon",
      providerSessionId: `coupon_${normalised}_${user.id}`,
      metadata: { code: normalised },
    });

    if (newBalance === null) {
      // grantCredits returns null if the RPC threw — most likely a duplicate
      return new Response(
        JSON.stringify({ error: "Coupon already redeemed" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ granted: credits, balance: newBalance }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("redeem-coupon error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
