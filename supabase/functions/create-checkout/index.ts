// Lemon Squeezy hosted checkout creator (D2 two-pack pricing).
//
// Request:  POST /create-checkout?pack=small|large  (Bearer token required)
// Response: { url: "https://<store>.lemonsqueezy.com/checkout/..." }
//
// Required env (Edge Function secrets):
//   LEMONSQUEEZY_API_KEY         (from Settings → API)
//   LEMONSQUEEZY_STORE_ID        (Settings → Stores → numeric ID)
//   LEMONSQUEEZY_VARIANT_SMALL   (variant ID of the 300-credit product)
//   LEMONSQUEEZY_VARIANT_LARGE   (variant ID of the 1000-credit product)
//   APP_PUBLIC_URL               (e.g. https://tripjam.vercel.app)
//
// After purchase, Lemon Squeezy redirects to:
//   {APP_PUBLIC_URL}/?credits_success=300   (or 1000)

import { authenticateUser, unauthorized } from "../_shared/credits.ts";
import { captureException } from "../_shared/errortrack.ts";
// PINNED. A floating `@2` meant esm.sh resolved to whatever was newest at
// deploy time — and on 2026-10-07 that was 2.117.3, whose transitive
// auth-js build 404s on their CDN. Every edge function imports this
// (directly or via _shared/credits.ts), so ALL deploys failed at once with
// an error naming a module none of our code references. Pin the version so
// an upstream publish can never break deploys again; bump deliberately.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PACKS = {
  small: { credits: 300, variantEnv: "LEMONSQUEEZY_VARIANT_SMALL" },
  large: { credits: 1000, variantEnv: "LEMONSQUEEZY_VARIANT_LARGE" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
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
    // pack + optional trip_id come from either the query string or a JSON body.
    let bodyPack: string | undefined;
    let bodyTripId: string | undefined;
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.pack === "string") bodyPack = parsed.pack;
        if (typeof parsed.trip_id === "string") bodyTripId = parsed.trip_id;
      }
    } catch {
      // No/invalid JSON body — fall back to query params.
    }

    const packParam = (
      url.searchParams.get("pack") ||
      bodyPack ||
      "small"
    ).toLowerCase();
    const pack = PACKS[packParam as keyof typeof PACKS];
    if (!pack) {
      return new Response(
        JSON.stringify({ error: "Invalid pack. Use 'small' or 'large'." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Phase 2.5 — optional pool recharge. When trip_id is present the buyer must
    // be a current member of that trip (guards funding a pool you can't see).
    const tripId = url.searchParams.get("trip_id") || bodyTripId || null;
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

    const apiKey = Deno.env.get("LEMONSQUEEZY_API_KEY");
    const storeId = Deno.env.get("LEMONSQUEEZY_STORE_ID");
    const variantId = Deno.env.get(pack.variantEnv);
    const appUrl =
      Deno.env.get("APP_PUBLIC_URL") || "https://tripjam.vercel.app";

    if (!apiKey || !storeId || !variantId) {
      const missing = [
        !apiKey && "LEMONSQUEEZY_API_KEY",
        !storeId && "LEMONSQUEEZY_STORE_ID",
        !variantId && pack.variantEnv,
      ]
        .filter(Boolean)
        .join(", ");
      return new Response(
        JSON.stringify({
          error: `Payments not configured. Missing: ${missing}`,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Get user email for prefilling checkout ──
    // The auth header already validated the token; pull email from Supabase.
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let userEmail: string | null = null;
    try {
      const r = await fetch(`${sbUrl}/auth/v1/admin/users/${user.id}`, {
        headers: {
          Authorization: `Bearer ${sbServiceKey}`,
          apikey: sbServiceKey,
        },
      });
      if (r.ok) {
        const u = await r.json();
        userEmail = u?.email ?? null;
      }
    } catch {
      // non-fatal — Lemon Squeezy will prompt for email
    }

    const body = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: userEmail || undefined,
            // custom is returned in webhook as meta.custom_data.
            // LS requires all custom values to be strings.
            custom: {
              user_id: String(user.id),
              credits: String(pack.credits),
              pack: String(packParam),
              // Phase 2.5: only present for pool recharges. The webhook reads
              // this back and funds trips.credit_balance instead of the wallet.
              ...(tripId ? { trip_id: String(tripId) } : {}),
            },
          },
          checkout_options: {
            embed: false,
            media: false,
            logo: true,
          },
          product_options: {
            redirect_url: `${appUrl}/?credits_success=${pack.credits}`,
            receipt_button_text: "Return to TripJam",
            receipt_thank_you_note:
              "Your credits are now active. Happy planning!",
          },
        },
        relationships: {
          store: { data: { type: "stores", id: String(storeId) } },
          variant: { data: { type: "variants", id: String(variantId) } },
        },
      },
    };

    const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify(body),
    });

    const payload = await res.json();
    if (!res.ok) {
      const msg =
        payload?.errors?.[0]?.detail ||
        payload?.message ||
        "Lemon Squeezy API error";
      await captureException(new Error(msg), {
        functionName: "create-checkout",
        userId: user.id,
        ls_status: res.status,
        ls_errors: payload?.errors,
      });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const checkoutUrl = payload?.data?.attributes?.url;
    const checkoutId = payload?.data?.id;
    if (!checkoutUrl) {
      await captureException(
        new Error("Lemon Squeezy returned no checkout URL"),
        {
          functionName: "create-checkout",
          userId: user.id,
        },
      );
      return new Response(
        JSON.stringify({ error: "No checkout URL returned" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ url: checkoutUrl, id: checkoutId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await captureException(e, { functionName: "create-checkout" });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
