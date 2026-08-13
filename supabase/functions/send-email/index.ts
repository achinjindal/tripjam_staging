// Phase 4 minimal slice — transactional email via Resend.
//
// Types: config (capability probe), invite_external (join link to a non-user
// email), invite_member (targeted invite to an existing account), poll_opened,
// itinerary_ready. Ships dark: RESEND_API_KEY unset → every call returns
// { disabled: true } and sends nothing, so the UI can probe and hide actions.
//
// Recipient emails come from public.profiles.email via the service role
// (auth.users is not PostgREST-readable); legacy username-shim addresses
// (@tripjam.app) are always skipped. All sends are logged to email_log, which
// also powers the per-user daily cap on external invites and the 24h dedupe
// on itinerary_ready.
//
// Prod setup: supabase secrets set RESEND_API_KEY=... EMAIL_FROM="TripJam <trips@yourdomain>"

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  unauthorized,
  rateLimit,
} from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "TripJam <trips@tripjam.app>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REST = `${SUPABASE_URL}/rest/v1`;
const svcHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const EXTERNAL_INVITES_PER_DAY = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Minimal warm-palette template: one line, one button.
function template(heading: string, line: string, cta: string, url: string) {
  return `<!doctype html><body style="margin:0;background:#FAF6F0;padding:32px 16px;font-family:Georgia,serif;color:#0F1923">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2DDD5;border-radius:16px;padding:28px">
    <div style="font-size:14px;letter-spacing:.08em;color:#587284;margin-bottom:14px">TRIPJAM</div>
    <div style="font-size:21px;margin-bottom:10px">${heading}</div>
    <div style="font-size:14px;line-height:1.6;color:#3a4a58;margin-bottom:22px">${line}</div>
    <a href="${url}" style="display:inline-block;background:#2563A8;color:#fff;text-decoration:none;border-radius:12px;padding:12px 22px;font-size:15px">${cta}</a>
    <div style="font-size:11px;color:#8BA5BB;margin-top:26px">You received this because a TripJam trip involves you. Reply to this email to reach the sender.</div>
  </div></body>`;
}

async function isMember(tripId: string, userId: string): Promise<boolean> {
  const res = await fetch(
    `${REST}/trip_members?trip_id=eq.${tripId}&user_id=eq.${userId}&select=user_id&limit=1`,
    { headers: svcHeaders },
  );
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length > 0;
}

/** Real emails of trip members, excluding `excludeUserId` and shim addresses. */
async function memberEmails(
  tripId: string,
  excludeUserId: string,
): Promise<string[]> {
  const mRes = await fetch(
    `${REST}/trip_members?trip_id=eq.${tripId}&select=user_id`,
    { headers: svcHeaders },
  );
  if (!mRes.ok) return [];
  const ids = ((await mRes.json()) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id !== excludeUserId);
  if (!ids.length) return [];
  const pRes = await fetch(
    `${REST}/profiles?id=in.(${ids.join(",")})&select=email`,
    { headers: svcHeaders },
  );
  if (!pRes.ok) return [];
  return ((await pRes.json()) as { email: string | null }[])
    .map((r) => r.email || "")
    .filter((e) => e && !e.toLowerCase().endsWith("@tripjam.app"));
}

async function profileField(
  userId: string,
  field: "email" | "username",
): Promise<string | null> {
  const res = await fetch(
    `${REST}/profiles?id=eq.${userId}&select=${field}&limit=1`,
    { headers: svcHeaders },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Record<string, string | null>[];
  return rows[0]?.[field] ?? null;
}

async function logSend(
  type: string,
  tripId: string,
  senderId: string,
  recipient: string,
) {
  await fetch(`${REST}/email_log`, {
    method: "POST",
    headers: { ...svcHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      type,
      trip_id: tripId,
      sender_id: senderId,
      recipient,
    }),
  }).catch(() => {});
}

async function countLog(filter: string, sinceIso: string): Promise<number> {
  const res = await fetch(
    `${REST}/email_log?${filter}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id`,
    { headers: { ...svcHeaders, Prefer: "count=exact", Range: "0-0" } },
  );
  const range = res.headers.get("content-range") || "";
  const total = parseInt(range.split("/")[1] || "0", 10);
  return Number.isFinite(total) ? total : 0;
}

async function sendViaResend(
  to: string[],
  subject: string,
  html: string,
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) {
    console.error("send-email: Resend", res.status, await res.text());
    return false;
  }
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const user = await authenticateUser(req);
    if (!user) return unauthorized(corsHeaders);

    const body = await req.json();
    const type = String(body?.type || "");

    if (type === "config") return json({ enabled: !!RESEND_KEY });
    if (!RESEND_KEY) return json({ disabled: true });

    const limited = await rateLimit(user.id, corsHeaders);
    if (limited) return limited;

    const tripId = String(body?.tripId || "");
    if (!tripId || !(await isMember(tripId, user.id)))
      return json({ error: "not_a_member" }, 403);

    const senderName =
      (await profileField(user.id, "username")) || "A co-traveller";
    const tripName = String(body?.tripName || "your trip").slice(0, 120);
    // URLs come from the client so previews link to previews. Only allow
    // https URLs to our own hosts to keep this from becoming an open redirect.
    const safeUrl = (u: unknown): string | null => {
      const s = String(u || "");
      try {
        const parsed = new URL(s);
        if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
          return null;
        return s;
      } catch {
        return null;
      }
    };

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    if (type === "invite_external") {
      const toEmail = String(body?.toEmail || "")
        .trim()
        .toLowerCase();
      const joinUrl = safeUrl(body?.joinUrl);
      if (!/.+@.+\..+/.test(toEmail) || !joinUrl)
        return json({ error: "bad_request" }, 400);
      const sent24h = await countLog(
        `type=eq.invite_external&sender_id=eq.${user.id}`,
        dayAgo,
      );
      if (sent24h >= EXTERNAL_INVITES_PER_DAY)
        return json({ error: "daily_limit" }, 429);
      const ok = await sendViaResend(
        [toEmail],
        `${senderName} invited you to plan "${tripName}" on TripJam`,
        template(
          `${esc(senderName)} invited you to a trip`,
          `Join <b>${esc(tripName)}</b> on TripJam to plan it together — routes, itinerary, and a shared AI travel planner.`,
          "Join the trip",
          joinUrl,
        ),
      );
      if (ok) await logSend(type, tripId, user.id, toEmail);
      return json({ sent: ok ? 1 : 0 });
    }

    if (type === "invite_member") {
      const targetUserId = String(body?.targetUserId || "");
      const tripUrl = safeUrl(body?.tripUrl);
      if (!targetUserId) return json({ error: "bad_request" }, 400);
      const email = (await profileField(targetUserId, "email")) || "";
      if (!email || email.toLowerCase().endsWith("@tripjam.app"))
        return json({ sent: 0, skipped: "no_real_email" });
      // CTA lands on the /join preview (trip name + one-tap join, survives
      // sign-in) — NOT the marketing homepage. Reuse the trip's active invite
      // link or mint one; accept_invite retires the pending targeted invite,
      // so the two accept paths never leave stale state.
      let joinToken: string | null = null;
      const linkRes = await fetch(
        `${REST}/invite_links?trip_id=eq.${tripId}&select=token,expires_at&order=created_at.desc&limit=1`,
        { headers: svcHeaders },
      );
      if (linkRes.ok) {
        const rows = (await linkRes.json()) as {
          token: string;
          expires_at: string | null;
        }[];
        const live = rows.find(
          (r) => !r.expires_at || new Date(r.expires_at) > new Date(),
        );
        if (live) joinToken = live.token;
      }
      if (!joinToken) {
        joinToken = crypto.randomUUID();
        const mk = await fetch(`${REST}/invite_links`, {
          method: "POST",
          headers: { ...svcHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({
            trip_id: tripId,
            created_by: user.id,
            role: "edit",
            token: joinToken,
          }),
        });
        if (!mk.ok) joinToken = null;
      }
      const origin = (tripUrl || "https://tripjam.co").replace(/\/+$/, "");
      const cta = joinToken ? `${origin}/join/${joinToken}` : origin;
      const ok = await sendViaResend(
        [email],
        `${senderName} invited you to "${tripName}" on TripJam`,
        template(
          `${esc(senderName)} invited you to a trip`,
          `You've been invited to <b>${esc(tripName)}</b> — one tap below to join and start planning together.`,
          "Join the trip",
          cta,
        ),
      );
      if (ok) await logSend(type, tripId, user.id, email);
      return json({ sent: ok ? 1 : 0 });
    }

    if (type === "poll_opened" || type === "itinerary_ready") {
      if (type === "itinerary_ready") {
        // One itinerary_ready per trip per 24h — regenerations shouldn't spam.
        const recent = await countLog(
          `type=eq.itinerary_ready&trip_id=eq.${tripId}`,
          dayAgo,
        );
        if (recent > 0) return json({ sent: 0, skipped: "deduped" });
      }
      const emails = await memberEmails(tripId, user.id);
      if (!emails.length) return json({ sent: 0 });
      const tripUrl = safeUrl(body?.tripUrl) || "https://tripjam.co";
      const subject =
        type === "poll_opened"
          ? `New poll on "${tripName}": ${String(body?.pollTitle || "").slice(0, 80)}`
          : `Your itinerary for "${tripName}" is ready`;
      const html =
        type === "poll_opened"
          ? template(
              "The group wants your vote",
              `${esc(senderName)} opened a poll on <b>${esc(tripName)}</b>: “${esc(String(body?.pollTitle || "")).slice(0, 200)}”`,
              "Vote now",
              tripUrl,
            )
          : template(
              "The day-by-day plan is ready",
              `The itinerary for <b>${esc(tripName)}</b> has been generated. Take a look and tweak anything with Trippy.`,
              "See the itinerary",
              tripUrl,
            );
      const ok = await sendViaResend(emails, subject, html);
      if (ok)
        await Promise.all(emails.map((e) => logSend(type, tripId, user.id, e)));
      return json({ sent: ok ? emails.length : 0 });
    }

    return json({ error: "unknown_type" }, 400);
  } catch (err) {
    console.error("send-email error:", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
