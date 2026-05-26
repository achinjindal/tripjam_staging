// Day 2 Part C — Stripe Checkout session creator (D2 two-pack pricing).
//
// Request: POST /create-checkout-session?pack=small|large  (Bearer token required)
// Response: { url: "https://checkout.stripe.com/..." }
//
// Required env (Edge Function secrets):
//   STRIPE_SECRET_KEY            (test key for staging, live key for prod)
//   STRIPE_PRICE_ID_SMALL        (Price ID for the 300-credit pack)
//   STRIPE_PRICE_ID_LARGE        (Price ID for the 1000-credit pack)
//   APP_PUBLIC_URL               (e.g. https://tripjam.vercel.app)
//
// After purchase, Stripe redirects to:
//   {APP_PUBLIC_URL}/?credits_success=300   (or 1000)
// On cancel: {APP_PUBLIC_URL}/?credits_cancel=1

import { authenticateUser, unauthorized } from "../_shared/credits.ts";
import { captureException } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PACKS = {
  small: { credits: 300, priceEnv: "STRIPE_PRICE_ID_SMALL" },
  large: { credits: 1000, priceEnv: "STRIPE_PRICE_ID_LARGE" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const user = await authenticateUser(req);
    if (!user) return unauthorized(corsHeaders);

    const url = new URL(req.url);
    const packParam = (url.searchParams.get("pack") || "small").toLowerCase();
    const pack = PACKS[packParam as keyof typeof PACKS];
    if (!pack) {
      return new Response(JSON.stringify({ error: "Invalid pack. Use 'small' or 'large'." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = Deno.env.get(pack.priceEnv);
    const appUrl = Deno.env.get("APP_PUBLIC_URL") || "https://tripjam.vercel.app";

    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured (STRIPE_SECRET_KEY missing)." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Stripe price not configured for pack '${packParam}'.` }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create a Stripe Checkout Session via REST. We avoid the Stripe SDK to
    // keep cold-starts fast in Deno; the form-encoded API is simple.
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", `${appUrl}/?credits_success=${pack.credits}&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${appUrl}/?credits_cancel=1`);
    params.set("client_reference_id", user.id);
    params.set("metadata[user_id]", user.id);
    params.set("metadata[credits]", String(pack.credits));
    params.set("metadata[pack]", packParam);
    // Adaptive pricing (D3): let Stripe handle currency conversion + local presentment.
    params.set("automatic_tax[enabled]", "false");
    params.set("allow_promotion_codes", "true");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await res.json();
    if (!res.ok) {
      const msg = session?.error?.message || "Stripe API error";
      await captureException(new Error(msg), {
        functionName: "create-checkout-session",
        userId: user.id,
        stripe_status: res.status,
        stripe_code: session?.error?.code,
      });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: session.url, id: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await captureException(e, { functionName: "create-checkout-session" });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
