import { captureException } from "../_shared/errortrack.ts";
// Client-triggered purchase verification for Android Google Play purchases.
// Called immediately after a successful RevenueCat SDK purchase to grant
// credits without waiting for the RevenueCat webhook (which fires async).
//
// Security: verifies the transactionIdentifier actually belongs to the
// authenticated user by calling RevenueCat REST API before granting.
// The revenuecat-webhook is the idempotent backup — same provider_session_id
// prevents double-grants if both paths fire.
//
// Required Supabase secrets:
//   REVENUECAT_SECRET_KEY  — server API key (starts with sk_)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  grantCredits,
} from "../_shared/credits.ts";
// PINNED. A floating `@2` meant esm.sh resolved to whatever was newest at
// deploy time — and on 2026-10-07 that was 2.117.3, whose transitive
// auth-js build 404s on their CDN. Every edge function imports this
// (directly or via _shared/credits.ts), so ALL deploys failed at once with
// an error naming a module none of our code references. Pin the version so
// an upstream publish can never break deploys again; bump deliberately.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PRODUCT_CREDITS: Record<string, number> = {
  tripjam_credits_300: 300,
  tripjam_credits_1000: 1000,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const user = await authenticateUser(req);
  if (!user) return unauthorized(corsHeaders);

  try {
    const { transactionId, productId, trip_id } = await req.json();

    if (!transactionId || !productId) {
      return new Response(
        JSON.stringify({ error: "transactionId and productId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Phase 2.5 — optional pool recharge. When trip_id is present the buyer must
    // be a current member of that trip (guards funding a pool you can't see).
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

    const credits = PRODUCT_CREDITS[productId];
    if (!credits) {
      return new Response(
        JSON.stringify({ error: `Unknown product: ${productId}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Verify this transaction actually exists for this user via RevenueCat REST API
    const rcKey = Deno.env.get("REVENUECAT_SECRET_KEY");
    if (!rcKey) {
      console.error("REVENUECAT_SECRET_KEY not set");
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // NOTE: Do NOT send the X-Platform header here. It marks the request as an
    // app/SDK call, for which RevenueCat forbids secret keys (error 7243
    // "Secret API keys should not be used in your app"). The server-side
    // Get-Subscriber endpoint authenticates with the secret key alone.
    const rcRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`,
      {
        headers: {
          Authorization: `Bearer ${rcKey}`,
        },
      },
    );

    if (!rcRes.ok) {
      const err = await rcRes.text();
      console.error("RevenueCat API error:", rcRes.status, err);
      return new Response(
        JSON.stringify({ error: "Could not verify purchase. Try again." }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const rcData = await rcRes.json();
    const nonSubs: Record<string, { id: string }[]> =
      rcData?.subscriber?.non_subscriptions ?? {};

    // Check the transactionId exists in the subscriber's non-subscription transactions
    const productTransactions = nonSubs[productId] ?? [];
    const verified = productTransactions.some((t) => t.id === transactionId);

    if (!verified) {
      console.warn("Transaction not found in RC subscriber:", {
        userId: user.id,
        transactionId,
        productId,
      });
      return new Response(
        JSON.stringify({ error: "Purchase could not be verified." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Idempotency key matches revenuecat-webhook so only one path grants
    const newBalance = await grantCredits({
      userId: user.id,
      amount: credits,
      reason: "revenuecat",
      providerSessionId: `rc_${transactionId}`,
      tripId,
      metadata: {
        product_id: productId,
        source: "client-verify",
        ...(tripId ? { trip_id: tripId } : {}),
      },
    });

    return new Response(
      JSON.stringify({ granted: credits, balance: newBalance }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("revenuecat-verify error:", (err as Error).message);
    await captureException(err, { functionName: "revenuecat-verify" });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
