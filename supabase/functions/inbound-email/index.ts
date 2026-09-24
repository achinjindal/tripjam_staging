// Inbound booking-email ingestion (TripIt-style):
//   forward a hotel confirmation → Resend inbound → this webhook → Haiku
//   parse → the matching trip's hotels_data gains {status:"booked",
//   confirmation} → the itinerary shows ✓ Booked.
//
// Deploy with --no-verify-jwt (Resend calls it); authenticity comes from
// Svix signature verification (RESEND_INBOUND_WEBHOOK_SECRET). Payload is
// metadata-only — full body is fetched from Resend's Receiving API with
// RESEND_INBOUND_API_KEY (needs a full-access key; the sending-only key
// can't read received mail).
//
// Safety model:
//   - only `email.received` events, signature-verified
//   - sender must match a profiles.email (real addresses only — the
//     @tripjam.app shim can't receive mail anyway); unknown senders drop
//   - target trip: sender's soonest not-yet-ended trip
//   - hotel bookings write hotels_data; flights/others only surface as an
//     activity-feed row (no risky field writes in v1)
//   - message_id dedupe via email_log so Resend retries can't double-apply

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

const enc = new TextEncoder();

async function verifySvix(req: Request, payload: string): Promise<boolean> {
  const secret = Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET") || "";
  if (!secret) return false;
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigs = req.headers.get("svix-signature");
  if (!id || !ts || !sigs) return false;
  // 5-minute tolerance window against replays
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const secretBytes = Uint8Array.from(
    atob(secret.startsWith("whsec_") ? secret.slice(6) : secret),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${id}.${ts}.${payload}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sigs
    .split(" ")
    .some((s) => s.split(",")[1] === expected || s === `v1,${expected}`);
}

function extractAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
): Promise<{ text: string; html: string; subject: string } | null> {
  // The Receiving API path isn't pinned in public docs — try the known
  // candidates; first 200 wins.
  for (const path of [
    `https://api.resend.com/emails/receiving/${emailId}`,
    `https://api.resend.com/emails/received/${emailId}`,
    `https://api.resend.com/emails/${emailId}`,
  ]) {
    try {
      const res = await fetch(path, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const d = await res.json();
        return {
          text: d.text || "",
          html: d.html || "",
          subject: d.subject || "",
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function parseBooking(
  anthropicKey: string,
  subject: string,
  bodyText: string,
): Promise<{ parsed: any; usage: any } | null> {
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `This is a forwarded travel confirmation email. Extract booking facts as MINIFIED JSON only (no prose):
{"kind":"hotel"|"flight"|"other","status":"confirmed"|"cancelled","hotel":{"name":"","city":"","confirmation":"","checkin":"YYYY-MM-DD or empty","checkout":"YYYY-MM-DD or empty"},"flight":{"carrier":"","number":"","date":"","from":"","to":"","confirmation":""},"summary":"one line describing the booking"}
Only include facts explicitly present. Empty strings for anything absent. kind="other" if it is not clearly a hotel or flight booking. status="cancelled" when the email announces a cancellation (even of a previously confirmed booking) — NEVER "confirmed" for cancellation/refund notices.

SUBJECT: ${subject}
BODY:
${bodyText || "(body unavailable — use the subject line only)"}`,
        },
      ],
    }),
  });
  if (!aiRes.ok) return null;
  const ai = await aiRes.json();
  const rawOut = ai?.content?.[0]?.text || "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(
      rawOut.slice(rawOut.indexOf("{"), rawOut.lastIndexOf("}") + 1),
    );
  } catch {
    parsed = { kind: "other", summary: subject };
  }
  return { parsed, usage: ai?.usage || {} };
}

function routeTrip(
  candidates: any[],
  parsed: any,
  toAddrs: string[],
): { trip: any; routedBy: string } {
  let trip: any = null;
  let routedBy = "fallback";
  const plusMatch = toAddrs
    .map((a) => a.match(/\+([a-f0-9-]{4,36})@/))
    .find(Boolean);
  if (plusMatch) {
    const code = plusMatch[1];
    // candidates is a date-ordered window — match the prefix against ALL
    // of the sender's trips passed in (callers fetch without a tight cap)
    trip = candidates.find((t) => String(t.id).startsWith(code)) || null;
    if (trip) routedBy = "trip_address";
  }
  if (!trip && parsed.kind === "hotel" && parsed.hotel?.checkin) {
    const ci = parsed.hotel.checkin;
    trip =
      candidates.find((t) => ci >= t.start_date && ci <= t.end_date) || null;
    if (trip) routedBy = "checkin_date";
  }
  if (!trip && parsed.kind === "flight" && parsed.flight?.date) {
    const fd = parsed.flight.date;
    trip =
      candidates.find((t) => fd >= t.start_date && fd <= t.end_date) || null;
    if (trip) routedBy = "flight_date";
  }
  if (!trip) trip = candidates[0];
  return { trip, routedBy };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* P0 — reply-back receipt: the product answers the forwarder's email so
 * the loop closes in their inbox. Loop-safety: receipts carry
 * Auto-Submitted, thread via In-Reply-To, go only to the (already
 * profile-verified) sender, and are capped per sender per day. Failures
 * never affect the webhook result. */
async function sendReceipt(opts: {
  supabaseUrl: string;
  db: Record<string, string>;
  to: string;
  origSubject: string;
  origMessageId: string;
  heading: string;
  line: string;
  tripId?: string;
  senderProfileId?: string;
}): Promise<void> {
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM") || "TripJam <trips@tripjam.co>";
    if (!key) return;
    // Cap: 20 receipts per sender per day
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const capRes = await fetch(
      `${opts.supabaseUrl}/rest/v1/email_log?type=eq.receipt&recipient=eq.${encodeURIComponent(opts.to)}&created_at=gte.${dayAgo}&select=id`,
      { headers: opts.db },
    );
    if (capRes.ok && (await capRes.json()).length >= 20) return;
    const tripUrl = opts.tripId
      ? `https://tripjam.co/trip/${opts.tripId}`
      : "https://tripjam.co";
    const html = `
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2DDD5;border-radius:16px;padding:28px;font-family:Georgia,serif">
    <div style="font-size:14px;letter-spacing:.08em;color:#587284;margin-bottom:14px">TRIPJAM</div>
    <div style="font-size:20px;margin-bottom:10px">${opts.heading}</div>
    <div style="font-size:14px;line-height:1.6;color:#3a4a58;margin-bottom:22px">${opts.line}</div>
    <a href="${tripUrl}" style="display:inline-block;background:#2563A8;color:#fff;text-decoration:none;border-radius:10px;padding:11px 22px;font-size:14px">Open the trip</a>
  </div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: `Re: ${opts.origSubject || "your forwarded booking"}`.slice(
          0,
          160,
        ),
        html,
        headers: {
          "Auto-Submitted": "auto-replied",
          ...(opts.origMessageId
            ? {
                "In-Reply-To": opts.origMessageId,
                References: opts.origMessageId,
              }
            : {}),
        },
      }),
    });
    if (res.ok)
      fetch(`${opts.supabaseUrl}/rest/v1/email_log`, {
        method: "POST",
        headers: opts.db,
        body: JSON.stringify({
          type: "receipt",
          recipient: opts.to,
          sender_id: opts.senderProfileId || null,
          trip_id: opts.tripId || null,
        }),
      }).catch(() => {});
  } catch {
    /* receipts are best-effort */
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("method not allowed", {
      status: 405,
      headers: corsHeaders,
    });

  const payload = await req.text();

  // Dry-run mode: authenticated parse+route diagnostics, ZERO writes.
  // Powers testing and a future "paste your confirmation" UI.
  try {
    const maybe = JSON.parse(payload);
    if (maybe?.dry_run === true) {
      const auth = req.headers.get("authorization") || "";
      const userRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/auth/v1/user`,
        {
          headers: {
            Authorization: auth,
            apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
          },
        },
      );
      if (!userRes.ok)
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      const user = await userRes.json();
      const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const dbh = {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        "Content-Type": "application/json",
      };
      const today = new Date().toISOString().slice(0, 10);
      const tRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/rest/v1/trips?created_by=eq.${user.id}&end_date=gte.${today}&select=id,name,start_date,end_date&order=start_date.asc&limit=100`,
        { headers: dbh },
      );
      const cands: any[] = tRes.ok ? await tRes.json() : [];
      const pr = await parseBooking(
        Deno.env.get("ANTHROPIC_API_KEY")!,
        String(maybe.subject || ""),
        String(maybe.body || "").slice(0, 8000),
      );
      if (!pr)
        return new Response(JSON.stringify({ error: "parse failed" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      const routed = cands.length
        ? routeTrip(
            cands,
            pr.parsed,
            (maybe.to ? [String(maybe.to)] : []).map((s) => s.toLowerCase()),
          )
        : { trip: null, routedBy: "no_active_trip" };
      return Response.json(
        {
          dry_run: true,
          parsed: pr.parsed,
          routedBy: routed.routedBy,
          trip: routed.trip?.name || null,
          candidates: cands.map((c) => c.name),
        },
        { headers: corsHeaders },
      );
    }
  } catch {
    /* not JSON or not dry_run — fall through to webhook path */
  }

  if (!(await verifySvix(req, payload)))
    return new Response(JSON.stringify({ error: "invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("bad payload", { status: 400, headers: corsHeaders });
  }
  if (event.type !== "email.received")
    return Response.json({ ignored: event.type }, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const resendKey =
    Deno.env.get("RESEND_INBOUND_API_KEY") || Deno.env.get("RESEND_API_KEY")!;
  const db = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const data = event.data || {};
  const sender = extractAddress(String(data.from || ""));
  const messageId = String(data.message_id || data.email_id || "");
  const subject = String(data.subject || "");

  // ── Dedupe (Resend retries webhooks). email_log has no dedicated
  // dedupe column — the message id rides in `type` (text, service-only
  // table, trivial volume) ───────────────────────────────────────────────
  const dedupeKey = `inbound:${messageId}`.slice(0, 250);
  const dupRes = await fetch(
    `${supabaseUrl}/rest/v1/email_log?type=eq.${encodeURIComponent(dedupeKey)}&select=id&limit=1`,
    { headers: db },
  );
  if (dupRes.ok && (await dupRes.json()).length > 0)
    return Response.json({ deduped: true }, { headers: corsHeaders });

  // ── Sender → user ────────────────────────────────────────────────────
  const profRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(sender)}&select=id&limit=1`,
    { headers: db },
  );
  const prof = profRes.ok ? (await profRes.json())[0] : null;
  if (!prof)
    return Response.json(
      { dropped: "unknown sender" },
      { headers: corsHeaders },
    );

  // ── User → candidate trips (routed deterministically after parse) ────
  const today = new Date().toISOString().slice(0, 10);
  const tripRes = await fetch(
    `${supabaseUrl}/rest/v1/trips?created_by=eq.${prof.id}&end_date=gte.${today}&select=id,name,hotels_data,destination,start_date,end_date&order=start_date.asc&limit=100`,
    { headers: db },
  );
  const candidates: any[] = tripRes.ok ? await tripRes.json() : [];
  if (candidates.length === 0) {
    await sendReceipt({
      supabaseUrl,
      db,
      to: sender,
      origSubject: subject,
      origMessageId: messageId,
      heading: "No upcoming trip to attach this to",
      line: "We received your booking email, but there's no upcoming trip on your account yet. Create the trip first, then forward it again.",
      senderProfileId: prof.id,
    });
    return Response.json(
      { dropped: "no active trip" },
      { headers: corsHeaders },
    );
  }

  // ── Full content ─────────────────────────────────────────────────────
  const full = await fetchReceivedEmail(String(data.email_id || ""), resendKey);
  const bodyText = full
    ? (full.text || stripHtml(full.html)).slice(0, 8000)
    : "";

  // ── Haiku parse (shared helper) ──────────────────────────────────────
  const pr = await parseBooking(anthropicKey, subject, bodyText);
  if (!pr)
    return new Response(JSON.stringify({ error: "parse model failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  const parsed = pr.parsed;
  const ai = { usage: pr.usage };

  // ── Deterministic trip routing ───────────────────────────────────────
  // 1. Per-trip address: bookings+<first 8 of trip id>@… (shown in the
  //    Travel & Hotels header) — exact, user-chosen, wins outright.
  // 2. Check-in date inside a trip's date range — strong deterministic
  //    signal from the booking itself.
  // 3. Soonest not-yet-ended trip — last resort, matches v1 behavior.
  const toAddrs: string[] = Array.isArray(data.to)
    ? data.to.map((t: any) => String(t).toLowerCase())
    : [String(data.to || "").toLowerCase()];
  const { trip, routedBy } = routeTrip(candidates, parsed, toAddrs);

  // usage log (fire-and-forget)
  fetch(`${supabaseUrl}/rest/v1/llm_usage`, {
    method: "POST",
    headers: db,
    body: JSON.stringify({
      trip_id: trip.id,
      function_name: "inbound-email",
      model: "claude-haiku-4-5-20251001",
      input_tokens: ai?.usage?.input_tokens || 0,
      output_tokens: ai?.usage?.output_tokens || 0,
    }),
  }).catch(() => {});

  // ── Apply ────────────────────────────────────────────────────────────
  let applied = "logged";
  if (
    parsed.kind === "hotel" &&
    parsed.hotel?.name &&
    parsed.status === "cancelled"
  ) {
    // A cancellation must never create a booking — and if the stay exists
    // as booked, it unbooks (keeps the hotel name, clears status/conf).
    const list: any[] = Array.isArray(trip.hotels_data)
      ? [...trip.hotels_data]
      : [];
    const idx = list.findIndex(
      (x) =>
        x.name?.toLowerCase() === parsed.hotel.name.toLowerCase() ||
        (parsed.hotel.confirmation &&
          x.confirmation === parsed.hotel.confirmation),
    );
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: null, confirmation: "" };
      const upd = await fetch(`${supabaseUrl}/rest/v1/trips?id=eq.${trip.id}`, {
        method: "PATCH",
        headers: { ...db, Prefer: "return=representation" },
        body: JSON.stringify({ hotels_data: list }),
      });
      applied = upd.ok ? "hotel_unbooked" : "hotel_update_failed";
    } else {
      applied = "cancellation_noted";
    }
  } else if (parsed.kind === "hotel" && parsed.hotel?.name) {
    const h = parsed.hotel;
    const list: any[] = Array.isArray(trip.hotels_data)
      ? [...trip.hotels_data]
      : [];
    const idx = list.findIndex(
      (x) =>
        (h.city && x.city?.toLowerCase() === h.city.toLowerCase()) ||
        x.name?.toLowerCase() === h.name.toLowerCase(),
    );
    const entry = {
      city: idx >= 0 ? list[idx].city : h.city || trip.destination,
      name: h.name,
      status: "booked",
      confirmation: h.confirmation || "",
      via: "email",
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push(entry);
    const upd = await fetch(`${supabaseUrl}/rest/v1/trips?id=eq.${trip.id}`, {
      method: "PATCH",
      headers: { ...db, Prefer: "return=representation" },
      body: JSON.stringify({ hotels_data: list }),
    });
    applied = upd.ok ? "hotel_booked" : "hotel_update_failed";
  }

  // feed row + dedupe marker
  await fetch(`${supabaseUrl}/rest/v1/activity_log`, {
    method: "POST",
    headers: db,
    body: JSON.stringify({
      trip_id: trip.id,
      user_id: prof.id,
      action: "email_ingested",
      entity_type: "trip",
      entity_id: trip.id,
      summary:
        (parsed.summary ||
          `forwarded a booking email${parsed.hotel?.name ? ` — ${parsed.hotel.name}` : ""}`) +
        (routedBy !== "fallback" ? "" : " (routed to soonest trip)"),
    }),
  }).catch(() => {});
  await fetch(`${supabaseUrl}/rest/v1/email_log`, {
    method: "POST",
    headers: db,
    body: JSON.stringify({
      type: dedupeKey,
      recipient: sender,
      sender_id: prof.id,
      trip_id: trip.id,
    }),
  }).catch(() => {});

  // ── P0: reply-back receipt (outcome-specific) ────────────────────────
  const receipt = (() => {
    const tripLabel = `<b>${trip.name}</b>`;
    if (applied === "hotel_booked")
      return {
        heading: `✓ ${parsed.hotel.name} is booked`,
        line: `Marked as booked on ${tripLabel}${parsed.hotel.confirmation ? ` with confirmation <b>#${parsed.hotel.confirmation}</b>` : ""}. You'll see it on the itinerary and in Travel &amp; Hotels.`,
      };
    if (applied === "hotel_unbooked")
      return {
        heading: `Cancellation noted — ${parsed.hotel.name}`,
        line: `That stay is no longer marked booked on ${tripLabel}.`,
      };
    if (applied === "cancellation_noted")
      return {
        heading: "Cancellation received",
        line: `We noted the cancellation on ${tripLabel}'s activity feed — no matching booked stay to update.`,
      };
    if (
      parsed.kind === "flight" &&
      (parsed.flight?.number || parsed.flight?.confirmation)
    )
      return {
        heading: `✈️ Flight noted on ${trip.name}`,
        line: `${parsed.flight.carrier || ""} ${parsed.flight.number || ""} is on the trip's activity feed. Flight bookings land in Travel &amp; Hotels soon.`,
      };
    return {
      heading: "We couldn't read that as a booking",
      line: `It's saved on ${tripLabel}'s activity feed, but nothing was booked. Forwarding the original confirmation email (rather than a summary) usually works best.`,
    };
  })();
  await sendReceipt({
    supabaseUrl,
    db,
    to: sender,
    origSubject: subject,
    origMessageId: messageId,
    heading: receipt.heading,
    line: receipt.line,
    tripId: trip.id,
    senderProfileId: prof.id,
  });

  return Response.json(
    { ok: true, applied, kind: parsed.kind, trip: trip.name, routedBy },
    { headers: corsHeaders },
  );
});
