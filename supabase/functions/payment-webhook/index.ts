// Lemon Squeezy webhook handler.
//
// Lemon Squeezy POSTs events here. We verify the HMAC-SHA256 signature in
// X-Signature, then on order_created we grant credits via the idempotent
// grant_credits RPC (UNIQUE on credit_transactions.provider_session_id).
//
// Required env (Edge Function secrets):
//   LEMONSQUEEZY_WEBHOOK_SECRET   (the secret you set when creating the webhook)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set)
//
// IMPORTANT: Deploy with --no-verify-jwt so Lemon Squeezy can call without
// a Supabase auth header. Signature verification replaces JWT auth.
//   supabase functions deploy payment-webhook --no-verify-jwt --project-ref <ref>

import { grantCredits } from "../_shared/credits.ts";
import { captureException } from "../_shared/errortrack.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const WEBHOOK_SECRET = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") || "";

// HMAC-SHA256 hex digest of raw body. Constant-time compare against
// X-Signature header.
async function verifyLemonSqueezySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signatureHeader.length) return false;
  let ok = 1;
  for (let i = 0; i < expected.length; i++) {
    ok &= expected.charCodeAt(i) === signatureHeader.charCodeAt(i) ? 1 : 0;
  }
  return ok === 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (!WEBHOOK_SECRET) {
    return new Response(
      JSON.stringify({ error: "Webhook secret not configured" }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const rawBody = await req.text();
  const sigHeader =
    req.headers.get("x-signature") || req.headers.get("X-Signature") || "";

  const valid = await verifyLemonSqueezySignature(
    rawBody,
    sigHeader,
    WEBHOOK_SECRET,
  );
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Lemon Squeezy payload shape:
  //   { meta: { event_name, custom_data: { user_id, credits, pack } }, data: { id, type, attributes: {...} } }
  const eventName = event?.meta?.event_name;
  const eventId = event?.meta?.webhook_id || event?.meta?.event_id;
  const orderId = event?.data?.id;
  const custom = event?.meta?.custom_data || {};

  try {
    if (eventName === "order_created") {
      const userId = custom.user_id;
      const credits = Number(custom.credits);
      const pack = custom.pack || "unknown";
      // Phase 2.5: when create-checkout stamped a trip_id, fund that trip's pool
      // instead of the buyer's personal wallet. Absent → personal grant (unchanged).
      const tripId =
        typeof custom.trip_id === "string" && custom.trip_id
          ? custom.trip_id
          : null;

      if (!userId || !Number.isFinite(credits) || credits <= 0) {
        await captureException(
          new Error("order_created missing user_id or credits"),
          {
            functionName: "payment-webhook",
            orderId,
            custom,
          },
        );
        // Return 200 so LS doesn't retry indefinitely; Sentry will alert.
        return new Response(
          JSON.stringify({ received: true, warning: "missing_custom_data" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const newBalance = await grantCredits({
        userId,
        amount: credits,
        reason: "lemonsqueezy",
        providerSessionId: String(orderId),
        tripId,
        metadata: {
          pack,
          event_id: eventId,
          ...(tripId ? { trip_id: tripId } : {}),
          ls_order_attributes: {
            total: event?.data?.attributes?.total,
            total_usd: event?.data?.attributes?.total_usd,
            currency: event?.data?.attributes?.currency,
            tax: event?.data?.attributes?.tax,
            user_email: event?.data?.attributes?.user_email,
          },
        },
      });

      return new Response(
        JSON.stringify({
          received: true,
          granted: credits,
          balance: newBalance,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Other event types (subscription_*, order_refunded, etc) — ack + ignore for now.
    // TODO: handle order_refunded to claw back credits if needed.
    return new Response(
      JSON.stringify({ received: true, ignored: eventName }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    await captureException(e, {
      functionName: "payment-webhook",
      event_name: eventName,
      orderId,
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
