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

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    `${supabaseUrl}/rest/v1/trips?created_by=eq.${prof.id}&end_date=gte.${today}&select=id,name,hotels_data,destination,start_date,end_date&order=start_date.asc&limit=20`,
    { headers: db },
  );
  const candidates: any[] = tripRes.ok ? await tripRes.json() : [];
  if (candidates.length === 0)
    return Response.json(
      { dropped: "no active trip" },
      { headers: corsHeaders },
    );

  // ── Full content ─────────────────────────────────────────────────────
  const full = await fetchReceivedEmail(String(data.email_id || ""), resendKey);
  const bodyText = full
    ? (full.text || stripHtml(full.html)).slice(0, 8000)
    : "";

  // ── Haiku parse ──────────────────────────────────────────────────────
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
{"kind":"hotel"|"flight"|"other","hotel":{"name":"","city":"","confirmation":"","checkin":"YYYY-MM-DD or empty","checkout":"YYYY-MM-DD or empty"},"flight":{"carrier":"","number":"","date":"","from":"","to":"","confirmation":""},"summary":"one line describing the booking"}
Only include facts explicitly present. Empty strings for anything absent. kind="other" if it is not clearly a hotel or flight booking.

SUBJECT: ${subject}
BODY:
${bodyText || "(body unavailable — use the subject line only)"}`,
        },
      ],
    }),
  });
  if (!aiRes.ok)
    return new Response(JSON.stringify({ error: "parse model failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  const ai = await aiRes.json();
  const rawOut = ai?.content?.[0]?.text || "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(rawOut.slice(rawOut.indexOf("{")));
  } catch {
    parsed = { kind: "other", summary: subject };
  }

  // ── Deterministic trip routing ───────────────────────────────────────
  // 1. Per-trip address: bookings+<first 8 of trip id>@… (shown in the
  //    Travel & Hotels header) — exact, user-chosen, wins outright.
  // 2. Check-in date inside a trip's date range — strong deterministic
  //    signal from the booking itself.
  // 3. Soonest not-yet-ended trip — last resort, matches v1 behavior.
  const toAddrs: string[] = Array.isArray(data.to)
    ? data.to.map((t: any) => String(t).toLowerCase())
    : [String(data.to || "").toLowerCase()];
  let trip: any = null;
  let routedBy = "fallback";
  const plusMatch = toAddrs
    .map((a) => a.match(/\+([a-f0-9-]{4,36})@/))
    .find(Boolean);
  if (plusMatch) {
    const code = plusMatch[1];
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
  if (parsed.kind === "hotel" && parsed.hotel?.name) {
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

  return Response.json(
    { ok: true, applied, kind: parsed.kind, trip: trip.name, routedBy },
    { headers: corsHeaders },
  );
});
