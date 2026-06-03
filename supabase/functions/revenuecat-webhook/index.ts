// RevenueCat webhook — grants credits on Android In-App Purchase completion.
// Deployed with --no-verify-jwt (RevenueCat calls this without a Supabase token).
// Auth: compares Authorization header against REVENUECAT_WEBHOOK_SECRET.
// Idempotent: uses "rc_<transactionId>" as provider_session_id (UNIQUE constraint).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { grantCredits } from "../_shared/credits.ts";

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

  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!secret) {
    console.error("REVENUECAT_WEBHOOK_SECRET not set");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // RevenueCat sends Authorization header equal to the configured webhook secret
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const event = body?.event;

    if (!event) {
      return new Response(JSON.stringify({ received: true, skipped: "no event" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventType: string = event.type;

    // Only process consumable purchases
    if (eventType !== "NON_SUBSCRIPTION_PURCHASE") {
      return new Response(
        JSON.stringify({ received: true, skipped: `event type ${eventType}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId: string = event.app_user_id;
    const productId: string = event.product_id;
    const transactionId: string = event.id;

    if (!userId || !productId || !transactionId) {
      console.error("Missing required fields:", { userId, productId, transactionId });
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credits = PRODUCT_CREDITS[productId];
    if (!credits) {
      console.warn("Unknown product:", productId);
      return new Response(
        JSON.stringify({ received: true, skipped: `unknown product ${productId}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const newBalance = await grantCredits({
      userId,
      amount: credits,
      reason: "revenuecat",
      providerSessionId: `rc_${transactionId}`,
      metadata: {
        product_id: productId,
        event_type: eventType,
        store: event.store,
        purchased_at_ms: event.purchased_at_ms,
      },
    });

    return new Response(
      JSON.stringify({ received: true, granted: credits, balance: newBalance }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("revenuecat-webhook error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
