// Day 2 Part C — Stripe webhook handler (D2 two-pack pricing).
//
// Stripe POSTs events here. We verify the signature, look for
// `checkout.session.completed`, and grant credits using the idempotent
// `grant_credits` RPC (UNIQUE on credit_transactions.stripe_session_id).
//
// Required env (Edge Function secrets):
//   STRIPE_SECRET_KEY            (already set for create-checkout-session)
//   STRIPE_WEBHOOK_SECRET        (from Stripe Dashboard → Webhooks → Signing secret)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set)
//
// IMPORTANT: This function MUST be deployed with `--no-verify-jwt` so Stripe
// can call it without a Supabase auth header. The signature verification
// below replaces JWT auth for this endpoint.
//   supabase functions deploy stripe-webhook --no-verify-jwt --project-ref <ref>

import { grantCredits } from "../_shared/credits.ts";
import { captureException } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

// ── Stripe signature verification (Deno-native, no SDK) ─────────────────────
// Format of Stripe-Signature header:  t=<unix_ts>,v1=<hex_sig>[,v1=<hex_sig>...]
async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  ) as Record<string, string>;
  const timestamp = parts.t;
  const sigsRaw = signatureHeader
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!timestamp || sigsRaw.length === 0) return false;

  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) {
    return false; // replay/clock-skew protection
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare against each provided v1 signature
  for (const provided of sigsRaw) {
    if (provided.length === expected.length) {
      let ok = 1;
      for (let i = 0; i < expected.length; i++) {
        ok &= expected.charCodeAt(i) === provided.charCodeAt(i) ? 1 : 0;
      }
      if (ok) return true;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  if (!WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature") || "";

  const valid = await verifyStripeSignature(rawBody, sigHeader, WEBHOOK_SECRET);
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

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.user_id;
      const creditsStr = session.metadata?.credits;
      const pack = session.metadata?.pack || "unknown";
      const sessionId = session.id;

      if (!userId || !creditsStr) {
        await captureException(new Error("checkout.session.completed missing user_id or credits"), {
          functionName: "stripe-webhook",
          sessionId,
          metadata: session.metadata,
        });
        // Return 200 so Stripe doesn't keep retrying — but Sentry has the alert.
        return new Response(JSON.stringify({ received: true, warning: "missing_metadata" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const credits = Number(creditsStr);
      if (!Number.isFinite(credits) || credits <= 0) {
        await captureException(new Error("invalid credits amount in metadata"), {
          functionName: "stripe-webhook",
          sessionId,
          creditsStr,
        });
        return new Response(JSON.stringify({ received: true, warning: "invalid_credits" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newBalance = await grantCredits({
        userId,
        amount: credits,
        reason: "stripe",
        stripeSessionId: sessionId,
        metadata: {
          pack,
          stripe_payment_intent: session.payment_intent,
          amount_total: session.amount_total,
          currency: session.currency,
        },
      });

      return new Response(
        JSON.stringify({ received: true, granted: credits, balance: newBalance }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // All other event types: ack and ignore.
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await captureException(e, { functionName: "stripe-webhook", event_type: event?.type });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
