import { captureException } from "../_shared/errortrack.ts";
// Coupon code redemption — grants free credits without payment.
// Each coupon is single-use per user (idempotent via provider_session_id UNIQUE constraint).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
  grantCredits,
  runInBackground,
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

// code → { credits granted, reusable }. reusable:true = no per-user cap —
// every redemption grants again (unique ledger key per redemption). Only the
// per-user rate limit (5/min) brakes it; treat reusable codes as
// founder/insider codes, not public promos.
const VALID_COUPONS: Record<string, { credits: number; reusable?: boolean }> = {
  IKNOWACHIN: { credits: 300, reusable: true },
};

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Founder alert on every coupon redemption. Reusable codes (IKNOWACHIN) are
// uncapped by design, so the only thing standing between a leaked code and a
// drained LLM budget is noticing fast — this email carries the two numbers
// that distinguish "a friend redeemed" from "the code is loose": how many
// times THIS user has used THIS code, and how many times it's been used in
// total. Best-effort: never blocks or fails the redemption.
async function alertCouponUsed(args: {
  code: string;
  reusable: boolean;
  credits: number;
  newBalance: number;
  userId: string;
}): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("ALERT_EMAIL");
  if (!key || !to) return;
  const from = Deno.env.get("EMAIL_FROM") || "TripJam <trips@tripjam.co>";
  const appEnv = Deno.env.get("APP_ENV") || "production";

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  // AuthedUser is {id, credits} only — resolve a human label for the subject.
  let userEmail: string | null = null;
  try {
    const { data: prof } = await db
      .from("profiles")
      .select("email,username")
      .eq("id", args.userId)
      .maybeSingle();
    userEmail = prof?.email || prof?.username || null;
  } catch {
    /* label is optional */
  }

  let byUser = "?";
  let total = "?";
  try {
    const [u, t] = await Promise.all([
      db
        .from("credit_transactions")
        .select("id", { count: "exact", head: true })
        .eq("reason", "coupon")
        .eq("user_id", args.userId)
        .contains("metadata", { code: args.code }),
      db
        .from("credit_transactions")
        .select("id", { count: "exact", head: true })
        .eq("reason", "coupon")
        .contains("metadata", { code: args.code }),
    ]);
    byUser = String(u.count ?? "?");
    total = String(t.count ?? "?");
  } catch {
    /* counts are a nicety — send the alert regardless */
  }

  const hot = Number(byUser) > 1;
  const html = `
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2DDD5;border-radius:16px;padding:26px;font-family:Georgia,serif;color:#0F1923">
    <div style="font-size:13px;letter-spacing:.08em;color:#587284;margin-bottom:12px">TRIPJAM · ${esc(appEnv).toUpperCase()}</div>
    <div style="font-size:20px;margin-bottom:6px">🎟️ Coupon <b>${esc(args.code)}</b> redeemed</div>
    <div style="font-size:14px;line-height:1.7;color:#3a4a58">
      <b>${esc(userEmail || args.userId)}</b> received <b>${args.credits}</b> credits
      (new balance <b>${args.newBalance}</b>).
    </div>
    <table style="width:100%;margin-top:16px;font-size:13px;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#587284">This code, this user</td>
          <td style="padding:6px 0;text-align:right;${hot ? "color:#C53030;font-weight:bold" : ""}">${esc(byUser)}×</td></tr>
      <tr><td style="padding:6px 0;color:#587284">This code, all users</td>
          <td style="padding:6px 0;text-align:right">${esc(total)}×</td></tr>
      <tr><td style="padding:6px 0;color:#587284">Type</td>
          <td style="padding:6px 0;text-align:right">${args.reusable ? "reusable (uncapped)" : "single-use"}</td></tr>
    </table>
    ${
      hot
        ? `<div style="margin-top:16px;padding:11px 13px;background:#FEE2E2;border:1px solid #FECACA;border-radius:10px;font-size:13px">
             Repeat redemption by the same account — if this wasn't you, retire the code in
             <code>redeem-coupon</code> and redeploy.
           </div>`
        : ""
    }
  </div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `🎟️ ${args.code} redeemed — ${args.credits} credits to ${userEmail || args.userId}`,
      html,
    }),
  });
}

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

    // Fire-and-forget under waitUntil so the isolate survives long enough to
    // send, without delaying the user's response.
    runInBackground(
      alertCouponUsed({
        code: normalised,
        reusable: !!coupon.reusable,
        credits,
        newBalance,
        userId: user.id,
      }).catch(() => {}),
    );

    return new Response(
      JSON.stringify({ granted: credits, balance: newBalance }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("redeem-coupon error:", (err as Error).message);
    await captureException(err, { functionName: "redeem-coupon" });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
