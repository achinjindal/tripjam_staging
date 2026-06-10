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
import { captureException } from "../_shared/sentry.ts";

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
    const packParam = (url.searchParams.get("pack") || "small").toLowerCase();
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
