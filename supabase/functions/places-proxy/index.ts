import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { deductCredits } from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const TRIPADVISOR_KEY = Deno.env.get("TRIPADVISOR_KEY") ?? "";
// Stock food photos (free tier). No-op when unset → client falls back to emoji.
const PEXELS_KEY = Deno.env.get("PEXELS_API_KEY") ?? "";
const PLACES_BASE = "https://places.googleapis.com/v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── PostgREST helpers (no SDK needed) ───────────────────────────────────────

const pgHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};
const REST = `${SUPABASE_URL}/rest/v1`;

async function cacheGet(key: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${REST}/place_cache?key=eq.${encodeURIComponent(key)}&select=result,expires_at`,
      { headers: pgHeaders },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length) return null;
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      fetch(`${REST}/place_cache?key=eq.${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: pgHeaders,
      }).catch(() => {});
      return null;
    }
    return row.result;
  } catch {
    return null;
  }
}

async function cacheSet(
  key: string,
  action: string,
  result: any,
  source: string,
  ttlDays?: number,
): Promise<void> {
  try {
    const expires_at = ttlDays
      ? new Date(Date.now() + ttlDays * 86400000).toISOString()
      : null;
    await fetch(`${REST}/place_cache`, {
      method: "POST",
      headers: { ...pgHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        key,
        action,
        result,
        source,
        expires_at,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* fire-and-forget */
  }
}

// ── rate limit helpers (atomic upsert via ON CONFLICT) ──────────────────────

async function getUsage(
  api: string,
  scope: string,
  period: string,
): Promise<number> {
  try {
    const res = await fetch(
      `${REST}/api_usage?api=eq.${encodeURIComponent(api)}&scope=eq.${encodeURIComponent(scope)}&period=eq.${encodeURIComponent(period)}&select=count`,
      { headers: pgHeaders },
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return rows?.[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

async function incrementUsage(
  api: string,
  scope: string,
  period: string,
  amount = 1,
): Promise<void> {
  try {
    // Use RPC or upsert with ON CONFLICT to avoid race conditions
    const res = await fetch(
      `${REST}/api_usage?api=eq.${encodeURIComponent(api)}&scope=eq.${encodeURIComponent(scope)}&period=eq.${encodeURIComponent(period)}&select=count`,
      { headers: pgHeaders },
    );
    if (!res.ok) return;
    const rows = await res.json();
    if (rows?.length) {
      await fetch(
        `${REST}/api_usage?api=eq.${encodeURIComponent(api)}&scope=eq.${encodeURIComponent(scope)}&period=eq.${encodeURIComponent(period)}`,
        {
          method: "PATCH",
          headers: pgHeaders,
          body: JSON.stringify({
            count: rows[0].count + amount,
            updated_at: new Date().toISOString(),
          }),
        },
      );
    } else {
      await fetch(`${REST}/api_usage`, {
        method: "POST",
        headers: { ...pgHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ api, scope, period, count: amount }),
      });
    }
  } catch {
    /* best-effort */
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ── Google helpers ──────────────────────────────────────────────────────────

async function autocomplete(q: string, types?: string): Promise<unknown> {
  const body: Record<string, unknown> = { input: q, languageCode: "en" };
  if (types) body.includedPrimaryTypes = [types];
  const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Autocomplete error: ${await res.text()}`);
  return res.json();
}

// Google Text Search and Photo URI removed — zero Google photo charges

// ── TripAdvisor helpers ─────────────────────────────────────────────────────

const TA_BASE = "https://api.content.tripadvisor.com/api/v1";

// hotelName: the bare hotel name (without city), used for the name-match
// guard. latLong biases TripAdvisor's ranking to the verified coordinates.
// The guard exists because TA's top hit for a fuzzy query can be a DIFFERENT
// nearby hotel ("Coco Tam's Resort" → Anantara Bophut) — a wrong photo is
// worse than no photo.
async function taSearch(
  query: string,
  hotelName?: string,
  latLong?: string | null,
): Promise<string | null> {
  const res = await fetch(
    `${TA_BASE}/location/search?key=${TRIPADVISOR_KEY}&searchQuery=${encodeURIComponent(query)}&language=en&category=hotels${latLong ? `&latLong=${encodeURIComponent(latLong)}` : ""}`,
  );
  if (!res.ok) return null;
  const data: any = await res.json();
  const top = data?.data?.[0];
  if (!top?.location_id) return null;
  if (hotelName && top.name) {
    const GENERIC =
      /^(hotel|resort|the|at|and|inn|villa|villas|spa|beach|house|samui|koh)$/i;
    const tokens = (s: string) =>
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !GENERIC.test(t));
    const want = tokens(hotelName);
    const got = new Set(tokens(top.name));
    const hits = want.filter((t) => got.has(t)).length;
    // At least half of the distinctive name tokens must appear in the match
    if (want.length > 0 && hits / want.length < 0.5) {
      console.warn(
        `hotel-photo name guard: "${hotelName}" !~ TA "${top.name}" — rejecting`,
      );
      return null;
    }
  }
  return top.location_id;
}

async function taPhoto(locationId: string): Promise<string | null> {
  const res = await fetch(
    `${TA_BASE}/location/${locationId}/photos?key=${TRIPADVISOR_KEY}&language=en`,
  );
  if (!res.ok) return null;
  const data: any = await res.json();
  return (
    data?.data?.[0]?.images?.large?.url ??
    data?.data?.[0]?.images?.original?.url ??
    null
  );
}

// ── Smart escalation heuristics (Feature 8) ─────────────────────────────────
//
// Decide whether a place lookup needs Google Places (chain hotels, bad LLM hints)
// or can be served by Photon + sanity check (most uniquely-named places).

import {
  HOTEL_CHAIN_RE,
  RISKY_NAME_RE,
  nameSimilarity,
  normalizeName,
  validateGoogleResult,
} from "./_helpers.ts";

function preEscalateToGoogle(
  name: string,
  geocodeHint: string | null,
  city: string | null,
): { escalate: boolean; reason: string } {
  // 1. LLM gave us garbage (hint equals city name)
  if (
    geocodeHint &&
    city &&
    geocodeHint.trim().toLowerCase() === city.trim().toLowerCase()
  ) {
    return { escalate: true, reason: "hint_equals_city" };
  }
  // 2. Known chain hotel — Photon disambiguation is unreliable
  if (HOTEL_CHAIN_RE.test(name)) {
    return { escalate: true, reason: "chain_match" };
  }
  return { escalate: false, reason: "" };
}

function postEscalateCheck(
  coords: { lat: number; lng: number },
  biasLat?: number,
  biasLng?: number,
): { escalate: boolean; reason: string } {
  if (biasLat == null || biasLng == null)
    return { escalate: false, reason: "" };
  // If Photon returned the city centroid (within 200m), it failed to find the specific place
  const distFromCentroid = haversineKm(
    biasLat,
    biasLng,
    coords.lat,
    coords.lng,
  );
  if (distFromCentroid < 0.2) {
    return { escalate: true, reason: "matched_city_centroid" };
  }
  return { escalate: false, reason: "" };
}

// ── Google Places lookup (Feature 8 — chains + bad hints + escalation fallback) ─

async function googleFindPlace(
  name: string,
  city: string | null,
  type?: string,
): Promise<{
  lat: number;
  lng: number;
  place_id: string;
  business_status?: string;
  display_name?: string;
} | null> {
  if (!PLACES_KEY) return null;
  const query = city ? `${name}, ${city}` : name;
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "en",
    maxResultCount: 1,
  };
  if (type) body.includedType = type; // e.g., "lodging" for hotels
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY,
      "X-Goog-FieldMask":
        "places.id,places.location,places.businessStatus,places.displayName",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn("googleFindPlace error:", res.status, await res.text());
    return null;
  }
  const data: any = await res.json();
  const place = data?.places?.[0];
  if (!place?.location?.latitude || !place?.location?.longitude) return null;
  return {
    lat: place.location.latitude,
    lng: place.location.longitude,
    place_id: place.id,
    business_status: place.businessStatus,
    display_name: place.displayName?.text ?? null,
  };
}

// ── Credit deduction for Google calls (D24 pass-through, no founder margin) ──
//
// `costToCreditsPassthrough` uses user-value rate ($0.01/credit) not LLM-budget rate ($0.007/credit)
// so the founder breaks even (no margin) on Google API calls.

const GOOGLE_PLACES_CALL_USD = 0.017;
const USER_VALUE_PER_CREDIT = 0.01;

function costToCreditsPassthrough(usd: number): number {
  return Math.ceil((usd / USER_VALUE_PER_CREDIT) * 100) / 100;
}

async function authenticateUserId(req: Request): Promise<string | null> {
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  // Reject anon-key calls — must be a real user token
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (anonKey && token === anonKey) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.id ?? null;
}

async function getUserCredits(userId: string): Promise<number> {
  const res = await fetch(`${REST}/profiles?id=eq.${userId}&select=credits`, {
    headers: pgHeaders,
  });
  if (!res.ok) return 0;
  const rows = await res.json();
  return Number(rows?.[0]?.credits ?? 0);
}

async function chargeGoogleCall(
  userId: string,
  costUsd: number,
  reason: string,
  tripId?: string | null,
): Promise<boolean> {
  const credits = costToCreditsPassthrough(costUsd);
  try {
    // Use the existing deduct_credits RPC; on staging it may not exist, in which case we log and continue
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/deduct_credits`, {
      method: "POST",
      headers: pgHeaders,
      body: JSON.stringify({
        p_user_id: userId,
        p_amount: credits,
        p_reason: reason,
        p_function_name: "places-proxy",
        p_trip_id: tripId ?? null,
        p_llm_cost_usd: costUsd,
        p_metadata: { source: "google_places_passthrough" },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // If the RPC doesn't exist (staging in current state), don't block — just log
      if (res.status === 404 || text.includes("does not exist")) {
        console.warn(
          "deduct_credits RPC not found — skipping charge (staging?)",
        );
        return true;
      }
      console.warn("chargeGoogleCall failed:", res.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("chargeGoogleCall exception:", (e as Error).message);
    return false;
  }
}

// ── geocode_overrides lookup ─────────────────────────────────────────────────

async function checkOverride(
  name: string,
  city: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const normalized = name.trim().toLowerCase();
  const cityFilter = city
    ? `&city=eq.${encodeURIComponent(city.trim().toLowerCase())}`
    : "&city=is.null";
  try {
    const res = await fetch(
      `${REST}/geocode_overrides?place_normalized=eq.${encodeURIComponent(normalized)}${cityFilter}&select=lat,lng&limit=1`,
      { headers: pgHeaders },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length) return null;
    return { lat: Number(rows[0].lat), lng: Number(rows[0].lng) };
  } catch {
    return null;
  }
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleAutocomplete(req: Request): Promise<Response> {
  const { q, types } = await req.json();
  if (!q) return Response.json({ error: "q required" }, { status: 400 });

  // Cache ALL queries in DB — popular destination prefixes ("jap", "bali",
  // "sant", etc.) are highly reusable across users and the cache hit is
  // a single Postgres read (~5ms) vs. a Google API call (~150–400ms).
  // Previously only ≤4-char queries were cached; extending to all queries
  // dramatically reduces latency for returning/repeat users.
  const cacheKey = `autocomplete:${q.trim().toLowerCase()}:${types || ""}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    incrementUsage("autocomplete", "cache-hit", today()).catch(() => {});
    return Response.json(cached, { headers: corsHeaders });
  }
  const data = await autocomplete(q, types);
  incrementUsage("autocomplete", "google", today()).catch(() => {});
  // Cache results for 7 days — city/destination autocomplete results are
  // stable. A TTL of null (permanent) would also be safe here.
  cacheSet(cacheKey, "autocomplete", data, "google", 7).catch(() => {});
  return Response.json(data, { headers: corsHeaders });
}

async function handleHotelPhoto(req: Request): Promise<Response> {
  const {
    q,
    city,
    lat,
    lng,
    tripId: _tripId,
    context: _context,
  } = await req.json();
  if (!q)
    return Response.json({ url: null, source: null }, { headers: corsHeaders });

  const query = city ? `${q} ${city}` : q;
  const latLong = lat && lng ? `${lat},${lng}` : null;
  const cacheKey = `hotel-photo:${query.toLowerCase()}`;

  // 1. Check DB cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    incrementUsage("hotel-photo", "cache-hit", today()).catch(() => {});
    return Response.json(
      { url: cached.url, source: cached.source },
      { headers: corsHeaders },
    );
  }

  // 2. Try TripAdvisor (within rate limits: 1000/day, 4900/month — each hotel = 2 API calls)
  const dailyCount = await getUsage("tripadvisor", "daily", today());
  const monthlyCount = await getUsage("tripadvisor", "monthly", thisMonth());

  if (dailyCount < 1000 && monthlyCount < 4900 && TRIPADVISOR_KEY) {
    try {
      const locationId = await taSearch(query, q, latLong);
      // Count 1 API call for search
      await incrementUsage("tripadvisor", "daily", today());
      await incrementUsage("tripadvisor", "monthly", thisMonth());
      if (locationId) {
        const photoUrl = await taPhoto(locationId);
        // Count 1 API call for photo lookup
        await incrementUsage("tripadvisor", "daily", today());
        await incrementUsage("tripadvisor", "monthly", thisMonth());
        if (photoUrl) {
          await cacheSet(
            cacheKey,
            "hotel-photo",
            { url: photoUrl, source: "tripadvisor" },
            "tripadvisor",
            30,
          );
          return Response.json(
            { url: photoUrl, source: "tripadvisor" },
            { headers: corsHeaders },
          );
        }
      }
    } catch (e) {
      console.error("TripAdvisor error:", e.message);
    }
  }

  // 3. No photo found (Google fallback removed — zero Google photo charges)
  return Response.json({ url: null, source: null }, { headers: corsHeaders });
}

// ── Pexels stock food photos ────────────────────────────────────────────────
//
// Fallback for dish photos when Wikipedia/Commons have no image. Free tier
// (200 req/hr, 20k/mo). Attribution: "Photos provided by Pexels". No-op when
// PEXELS_API_KEY is unset (client then shows the dish emoji).

async function pexelsPhoto(query: string): Promise<string | null> {
  if (!PEXELS_KEY) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const p = data?.photos?.[0];
    return p?.src?.large || p?.src?.medium || null;
  } catch {
    return null;
  }
}

async function handleFoodPhoto(req: Request): Promise<Response> {
  const { q } = await req.json();
  if (!q)
    return Response.json({ url: null, source: null }, { headers: corsHeaders });

  const dish = String(q).trim().toLowerCase();
  const cacheKey = `food-photo:${dish}`;

  const cached = await cacheGet(cacheKey);
  if (cached) {
    incrementUsage("food-photo", "cache-hit", today()).catch(() => {});
    return Response.json(
      { url: cached.url, source: cached.source },
      { headers: corsHeaders },
    );
  }

  const url = await pexelsPhoto(`${dish} food dish`);
  if (url) {
    await cacheSet(
      cacheKey,
      "food-photo",
      { url, source: "pexels" },
      "pexels",
      30,
    );
    incrementUsage("food-photo", "pexels", today()).catch(() => {});
    return Response.json({ url, source: "pexels" }, { headers: corsHeaders });
  }

  // Cache the miss briefly so we don't re-hit Pexels for dishes with no match.
  cacheSet(
    cacheKey,
    "food-photo",
    { url: null, source: null },
    "miss",
    1,
  ).catch(() => {});
  return Response.json({ url: null, source: null }, { headers: corsHeaders });
}

// Haversine distance in km between two lat/lng points
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371,
    toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR,
    dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Photon search with optional location bias
async function photonSearch(
  q: string,
  biasLat?: number,
  biasLng?: number,
): Promise<{ lat: number; lng: number } | null> {
  const bias =
    biasLat != null && biasLng != null ? `&lat=${biasLat}&lon=${biasLng}` : "";
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1${bias}`,
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (coords && coords.length >= 2) return { lat: coords[1], lng: coords[0] };
  } catch {
    /* Photon unavailable */
  }
  return null;
}

// Nominatim fallback — better at finding named places like temples, streets, landmarks
async function nominatimSearch(
  q: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      {
        headers: { "User-Agent": "TripJam/1.0 (travel planning app)" },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    if (!res.ok) {
      console.log(`[nominatim] HTTP ${res.status} for "${q}"`);
      return null;
    }
    const data: any = await res.json();
    if (data?.[0]?.lat && data?.[0]?.lon) {
      console.log(`[nominatim] Found "${q}": ${data[0].lat}, ${data[0].lon}`);
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    console.log(`[nominatim] No results for "${q}"`);
  } catch (e: any) {
    console.log(`[nominatim] Error for "${q}": ${e.message}`);
  }
  return null;
}

async function handleGeocode(req: Request): Promise<Response> {
  const { q, city } = await req.json();
  if (!q)
    return Response.json({ lat: null, lng: null }, { headers: corsHeaders });

  // Extract the MAIN CITY from the city field — always the last comma-separated segment
  // "Shibuya & Shinjuku, Tokyo" → "Tokyo"
  // "Fushimi / Arashiyama, Kyoto" → "Kyoto"
  // "Budapest – Jewish Quarter" → "Budapest"
  // "Asakusa, Tokyo" → "Tokyo"
  // "Chaoyang" → "Chaoyang"
  const mainCity = (() => {
    const c = city || "";
    // Split by comma, take last segment
    const commaParts = c
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (commaParts.length > 1) return commaParts[commaParts.length - 1];
    // Split by dash/em-dash, take first segment
    const dashParts = c.split(/\s+[–—]\s+|\s+-\s+/);
    if (dashParts.length > 1) return dashParts[0].trim();
    // Split by &, /, take last
    const slashParts = c.split(/\s*[&/]\s*/);
    if (slashParts.length > 1) return slashParts[slashParts.length - 1].trim();
    return c;
  })();

  const cacheKey = `geocode:${q.toLowerCase()}|${(city || "").toLowerCase()}`;

  // 1. DB cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    incrementUsage("geocode", "cache-hit", today()).catch(() => {});
    return Response.json(cached, { headers: corsHeaders });
  }

  // 2. Resolve city bias using Nominatim (more reliable for city/country names).
  // Prefer the FULL city string over mainCity: for "Bali, Indonesia" the last
  // segment is a country whose centroid sits in Borneo, and that bias pulled
  // "Kintamani" onto Kalimantan. "Bali, Indonesia" resolves to Bali itself.
  let biasLat: number | undefined;
  let biasLng: number | undefined;
  const fullCity = (city || "").trim();
  const biasQueries =
    fullCity && fullCity.toLowerCase() !== mainCity.toLowerCase()
      ? [fullCity, mainCity]
      : [mainCity];
  for (const bq of biasQueries) {
    if (!bq) continue;
    const biasCacheKey = `geocode-bias:${bq.toLowerCase()}`;
    const biasCache = await cacheGet(biasCacheKey);
    if (biasCache?.lat) {
      biasLat = biasCache.lat;
      biasLng = biasCache.lng;
      break;
    }
    // Nominatim is reliable for city/country names (Photon returns wrong results from some datacenters)
    const nomResult = await nominatimSearch(bq);
    if (nomResult) {
      biasLat = nomResult.lat;
      biasLng = nomResult.lng;
      cacheSet(biasCacheKey, "geocode", nomResult, "nominatim").catch(() => {});
      break;
    }
    // Photon fallback
    const coords = await photonSearch(bq);
    if (coords) {
      biasLat = coords.lat;
      biasLng = coords.lng;
      cacheSet(biasCacheKey, "geocode", coords, "photon").catch(() => {});
      break;
    }
  }

  // 3. Photon search — prioritized strategies, validated against bias
  // Use wider radius if mainCity looks like a country (no comma, long distance expected)
  const isCountryBias =
    mainCity &&
    !mainCity.includes(",") &&
    mainCity.length > 3 &&
    !/tokyo|kyoto|osaka|delhi|mumbai|budapest|bangkok|beijing|seoul|paris|london|istanbul|cairo|rome/i.test(
      mainCity,
    );
  const MAX_DISTANCE_KM = isCountryBias ? 1500 : 200;
  // Build query variations
  const dehyphenated = q.replace(/-/g, " "); // "Senso-ji" → "Senso ji"
  // Strip generic place suffixes AND activity-type suffixes iteratively, so multi-suffix
  // titles like "La Latina Neighbourhood Walk" shed both layers ("Walk" → "Neighbourhood") → "La Latina".
  const SUFFIX_RE =
    /\s+(temple|shrine|mosque|church|cathedral|market|road|street|beach|fort|palace|museum|park|garden|square|bridge|tower|station|walk|tour|crawl|hike|trip|trail|experience|cruise|exploration|stroll|wander|visit|neighbourhood|neighborhood)$/i;
  let noSuffix = q;
  let prev;
  do {
    prev = noSuffix;
    noSuffix = noSuffix.replace(SUFFIX_RE, "");
  } while (noSuffix !== prev);
  const photonQueries = [
    // place + full context first ("Kintamani Bali Indonesia" ranks the real
    // Kintamani above fuzzy Kalimantan matches; mainCity alone loses the island)
    fullCity && fullCity.toLowerCase() !== mainCity.toLowerCase()
      ? `${q} ${fullCity.replace(/,/g, " ")}`
      : "",
    `${q} ${mainCity}`, // place + main city (best)
    q, // just the place name
    `${dehyphenated} ${mainCity}`, // dehyphenated + city
    dehyphenated, // dehyphenated alone
    q
      .replace(/,/g, " ")
      .replace(/[&/–—]/g, " ")
      .replace(/\s+/g, " ")
      .trim(), // cleaned full query
    q.split(/[,&/–—]/)[0].trim() + (mainCity ? ` ${mainCity}` : ""), // first segment + main city
    noSuffix !== q ? `${noSuffix} ${mainCity}` : "", // without generic suffix + city
  ].filter(Boolean);
  const seen = new Set<string>();
  for (const pq of photonQueries) {
    const clean = pq.replace(/\s+/g, " ").trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    const coords = await photonSearch(clean, biasLat, biasLng);
    if (coords) {
      if (biasLat != null && biasLng != null) {
        const dist = haversineKm(biasLat, biasLng, coords.lat, coords.lng);
        if (dist > MAX_DISTANCE_KM) continue;
      }
      const result = { lat: coords.lat, lng: coords.lng };
      incrementUsage("geocode", "photon", today()).catch(() => {});
      cacheSet(cacheKey, "geocode", result, "photon").catch(() => {});
      return Response.json(result, { headers: corsHeaders });
    }
  }

  // 4. Nominatim fallback — better at named POIs (temples, streets, landmarks)
  const nominatimQueries = [`${q}, ${mainCity || ""}`.trim(), q, dehyphenated];
  const seenNom = new Set<string>();
  for (const nq of nominatimQueries) {
    const clean = nq.replace(/\s+/g, " ").trim();
    if (!clean || seenNom.has(clean.toLowerCase())) continue;
    seenNom.add(clean.toLowerCase());
    const coords = await nominatimSearch(clean);
    if (coords) {
      if (biasLat != null && biasLng != null) {
        const dist = haversineKm(biasLat, biasLng, coords.lat, coords.lng);
        if (dist > MAX_DISTANCE_KM) continue;
      }
      const result = { lat: coords.lat, lng: coords.lng };
      incrementUsage("geocode", "nominatim", today()).catch(() => {});
      cacheSet(cacheKey, "geocode", result, "nominatim").catch(() => {});
      return Response.json(result, { headers: corsHeaders });
    }
  }

  // 5. No result — cache miss with short TTL (5 min). A 1-day TTL was poisoning trips:
  // a single transient failure for a hard-to-geocode place would keep returning null for 24h,
  // making the client's "Get directions" fallback persistent even after the underlying issue cleared.
  incrementUsage("geocode", "miss", today()).catch(() => {});
  cacheSet(
    cacheKey,
    "geocode",
    { lat: null, lng: null },
    "miss",
    5 / 1440,
  ).catch(() => {});
  return Response.json({ lat: null, lng: null }, { headers: corsHeaders });
}

// ── Feature 8: lookup-place (direct Google Places, when we know Photon will fail) ──
//
// Charged to user at pass-through rate (D24) — no founder margin.
// Used by selectHotel when the hotel matches a chain or the geocode hint is bad,
// and by the resolve-coords fallback when Photon's result fails sanity checks.

async function handleLookupPlace(req: Request): Promise<Response> {
  const { name, city, type, tripId } = await req.json();
  if (!name)
    return Response.json(
      { error: "name required" },
      { status: 400, headers: corsHeaders },
    );

  // 1. User override always wins
  const override = await checkOverride(name, city);
  if (override) {
    return Response.json(
      {
        lat: override.lat,
        lng: override.lng,
        source: "user_corrected",
        confidence: "high",
      },
      { headers: corsHeaders },
    );
  }

  // 2. Cache hit?
  const cacheKey = `lookup-place:${name.trim().toLowerCase()}|${(city || "").toLowerCase()}|${type || ""}`;
  const cached = await cacheGet(cacheKey);
  if (cached?.lat) {
    incrementUsage("lookup-place", "cache-hit", today()).catch(() => {});
    return Response.json(
      {
        ...cached,
        source: cached.source || "google_places",
        confidence: "high",
        cached: true,
      },
      { headers: corsHeaders },
    );
  }

  // 3. Need to call Google — authenticate + charge user
  const userId = await authenticateUserId(req);
  if (!userId)
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );

  const balance = await getUserCredits(userId);
  const credits = costToCreditsPassthrough(GOOGLE_PLACES_CALL_USD);
  if (balance < credits) {
    return Response.json(
      {
        error: "Out of credits",
        code: "insufficient_credits",
        credits: balance,
      },
      { status: 402, headers: corsHeaders },
    );
  }

  // 4. Call Google
  const result = await googleFindPlace(name, city, type);
  if (!result) {
    incrementUsage("lookup-place", "google-miss", today()).catch(() => {});
    return Response.json(
      { lat: null, lng: null, source: null, confidence: "low" },
      { headers: corsHeaders },
    );
  }

  // 5. Charge user (only on success — failed lookups are on the house)
  await chargeGoogleCall(
    userId,
    GOOGLE_PLACES_CALL_USD,
    `lookup-place:${name}`,
    tripId || null,
  );

  // 6. Cache (90d TTL for Google results)
  const payload = {
    lat: result.lat,
    lng: result.lng,
    place_id: result.place_id,
    business_status: result.business_status,
    source: "google_places",
  };
  cacheSet(cacheKey, "lookup-place", payload, "google", 90).catch(() => {});
  incrementUsage("lookup-place", "google", today()).catch(() => {});

  return Response.json(
    { ...payload, confidence: "high" },
    { headers: corsHeaders },
  );
}

// ── Feature 8: resolve-coords (smart escalation — Photon-first + heuristic + Google fallback) ──
//
// Used by selectHotel and (in future) background activity-geocode pipeline.
// Tries the cheapest path first; only calls Google when Photon clearly fails.

async function handleResolveCoords(req: Request): Promise<Response> {
  const { name, city, hint, type, tripId } = await req.json();
  if (!name)
    return Response.json(
      { error: "name required" },
      { status: 400, headers: corsHeaders },
    );

  // 1. Override always wins
  const override = await checkOverride(name, city);
  if (override) {
    return Response.json(
      {
        lat: override.lat,
        lng: override.lng,
        source: "user_corrected",
        confidence: "high",
      },
      { headers: corsHeaders },
    );
  }

  // 2. Pre-escalation heuristic — skip Photon for known-bad cases
  const pre = preEscalateToGoogle(name, hint || null, city || null);
  if (pre.escalate) {
    // Delegate to lookup-place (it handles auth + charging)
    const proxyReq = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({ name, city, type, tripId }),
    });
    return await handleLookupPlace(proxyReq);
  }

  // 3. Try Photon first — free, fast
  // Resolve city bias
  let biasLat: number | undefined;
  let biasLng: number | undefined;
  if (city) {
    const biasCacheKey = `geocode-bias:${city.toLowerCase()}`;
    const biasCache = await cacheGet(biasCacheKey);
    if (biasCache?.lat) {
      biasLat = biasCache.lat;
      biasLng = biasCache.lng;
    } else {
      const nomResult = await nominatimSearch(city);
      if (nomResult) {
        biasLat = nomResult.lat;
        biasLng = nomResult.lng;
        cacheSet(biasCacheKey, "geocode", nomResult, "nominatim").catch(
          () => {},
        );
      }
    }
  }

  const photonQ = hint || name;
  const photonResult = await photonSearch(
    `${photonQ} ${city || ""}`.trim(),
    biasLat,
    biasLng,
  );
  if (photonResult) {
    // Post-escalation check — is the Photon result actually the city centroid?
    const post = postEscalateCheck(photonResult, biasLat, biasLng);
    if (!post.escalate) {
      // Photon result is good
      incrementUsage("resolve-coords", "photon", today()).catch(() => {});
      return Response.json(
        {
          lat: photonResult.lat,
          lng: photonResult.lng,
          source: "photon",
          confidence: "medium",
        },
        { headers: corsHeaders },
      );
    }
    // Photon returned city centroid — escalate to Google
  }

  // 4. Escalate to Google
  const proxyReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ name, city, type, tripId }),
  });
  return await handleLookupPlace(proxyReq);
}

// ── Verify-place ladder (Phase 1 — hardened geocoding) ─────────────────────
//
// 5-tier verification cascade that catches LLM hallucinations (the "Westin
// Sapporo doesn't exist" class of bug) and confidently-wrong silent matches
// (Photon returning a US consulate for a Westin search). Cached aggressively
// against the ORIGINAL name so repeat hallucinations cost 0 credits.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const NAME_SIM_THRESHOLD = 0.5; // Tier 1/2 acceptance threshold

// Cache TTLs (days)
const VERIFY_TTL_DAYS = 90;
const HAIKU_REPAIR_TTL_DAYS = 30;
const HAIKU_ALTS_TTL_DAYS = 7;

const REPAIR_SYSTEM_PROMPT = `You are a place-name verification assistant. Given a place name claimed to be in a specific city, decide if it refers to a real place.

Return strict JSON ONLY (no markdown, no code fences):
{"canonical": string | null, "reason": string}

Rules:
- If the place is real and the name is correct, return {"canonical": "<the same name>", "reason": "real place"}.
- If the place is real but has a different canonical name (translation, official name, recent rename), return the canonical name.
- If the place name is hallucinated (does not exist), return the CLOSEST real equivalent in the SAME CATEGORY (hotel→hotel, sight→sight, restaurant→restaurant) in the same region or country. Include "[hallucinated; suggesting X]" in the reason.
- If no plausible real equivalent exists, return {"canonical": null, "reason": "no real equivalent"}.
- The canonical name must be specific enough to geocode (e.g. "The Westin Rusutsu Resort" not "a Westin in Japan").
- Keep reason under 120 characters.`;

const ALTS_SYSTEM_PROMPT = `You are a place-name alternative-suggestion assistant. Given a place name in a city that we could not verify, suggest 2-3 real, specific alternatives in the same category (hotel/sight/restaurant) in the same city or nearby.

Return strict JSON ONLY (no markdown, no code fences):
{"alternatives": [{"name": "...", "hint": "...", "reason": "..."}, ...]}

Rules:
- Each "name" must be specific enough to geocode (e.g. "JR Tower Hotel Nikko Sapporo" not "a tower hotel in Sapporo").
- "hint" is a fully-qualified place description for geocoding: "<name>, <neighborhood>, <city>, <country>".
- "reason" is a 1-line "why this is a good fit" (under 80 chars). Mention category match and locality.
- 2-3 alternatives only. Quality over quantity.`;

// Anthropic Haiku call wrapper. Logs llm_usage + deducts credits.
// Returns parsed JSON or null on failure.
async function callHaiku(args: {
  userId: string | null;
  tripId: string | null;
  functionTag: string; // e.g. "verify-place:repair"
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
}): Promise<{ json: any; inputTokens: number; outputTokens: number } | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) {
    console.warn(
      `[${args.functionTag}] ANTHROPIC_API_KEY missing — skipping Haiku call`,
    );
    return null;
  }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: args.maxTokens,
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userMessage }],
      }),
    });
    if (!res.ok) {
      console.warn(
        `[${args.functionTag}] Anthropic ${res.status}: ${await res.text()}`,
      );
      return null;
    }
    const data: any = await res.json();
    const text = data?.content?.[0]?.text?.trim() ?? "";
    const inputTokens = data?.usage?.input_tokens || 0;
    const outputTokens = data?.usage?.output_tokens || 0;

    // Log llm_usage (fire-and-forget)
    fetch(`${REST}/llm_usage`, {
      method: "POST",
      headers: pgHeaders,
      body: JSON.stringify({
        trip_id: args.tripId,
        function_name: `places-proxy:${args.functionTag}`,
        model: HAIKU_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      }),
    }).catch(() => {});

    // Charge credits (fire-and-forget). Only if we have a user.
    if (args.userId) {
      deductCredits({
        userId: args.userId,
        model: HAIKU_MODEL,
        inputTokens,
        outputTokens,
        functionName: `places-proxy:${args.functionTag}`,
        tripId: args.tripId,
      }).catch(() => {});
    }

    // Parse JSON object from response — strip fences if any
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return { json: null, inputTokens, outputTokens };
    try {
      return { json: JSON.parse(match[0]), inputTokens, outputTokens };
    } catch {
      return { json: null, inputTokens, outputTokens };
    }
  } catch (e) {
    console.warn(`[${args.functionTag}] exception: ${(e as Error).message}`);
    return null;
  }
}

// Tier 3: ask Haiku to repair or suggest a canonical name.
async function haikuRepair(args: {
  name: string;
  city: string | null;
  userId: string | null;
  tripId: string | null;
}): Promise<{ canonical: string | null; reason: string }> {
  // Cache by original name + city — repairs are stable
  const cacheKey = `haiku-repair:${args.name.trim().toLowerCase()}|${(args.city || "").toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached && typeof cached === "object" && "canonical" in cached) {
    return cached as { canonical: string | null; reason: string };
  }

  const userMessage = `Place: "${args.name}"
${args.city ? `City: "${args.city}"` : ""}`;

  const result = await callHaiku({
    userId: args.userId,
    tripId: args.tripId,
    functionTag: "verify-place:repair",
    systemPrompt: REPAIR_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 200,
  });

  if (!result?.json) {
    return { canonical: null, reason: "haiku call failed" };
  }
  const canonical =
    typeof result.json.canonical === "string" && result.json.canonical.trim()
      ? result.json.canonical.trim()
      : null;
  const reason =
    typeof result.json.reason === "string"
      ? result.json.reason.slice(0, 200)
      : "";

  const payload = { canonical, reason };
  cacheSet(
    cacheKey,
    "haiku-repair",
    payload,
    "anthropic-haiku",
    HAIKU_REPAIR_TTL_DAYS,
  ).catch(() => {});
  return payload;
}

// Tier 5: ask Haiku for 2-3 alternatives we can render in a picker.
async function haikuAlternatives(args: {
  name: string;
  city: string | null;
  userId: string | null;
  tripId: string | null;
}): Promise<Array<{ name: string; hint: string; reason: string }>> {
  const cacheKey = `haiku-alternatives:${args.name.trim().toLowerCase()}|${(args.city || "").toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached && Array.isArray(cached.alternatives)) {
    return cached.alternatives;
  }

  const userMessage = `Place we could not verify: "${args.name}"
${args.city ? `City: "${args.city}"` : ""}`;

  const result = await callHaiku({
    userId: args.userId,
    tripId: args.tripId,
    functionTag: "verify-place:alts",
    systemPrompt: ALTS_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 400,
  });

  if (!result?.json || !Array.isArray(result.json.alternatives)) return [];
  const alts: Array<{ name: string; hint: string; reason: string }> = [];
  for (const a of result.json.alternatives.slice(0, 3)) {
    if (typeof a?.name !== "string" || !a.name.trim()) continue;
    alts.push({
      name: a.name.trim(),
      hint: typeof a.hint === "string" ? a.hint.trim() : a.name.trim(),
      reason: typeof a.reason === "string" ? a.reason.slice(0, 120) : "",
    });
  }
  cacheSet(
    cacheKey,
    "haiku-alternatives",
    { alternatives: alts },
    "anthropic-haiku",
    HAIKU_ALTS_TTL_DAYS,
  ).catch(() => {});
  return alts;
}

// Resolve city bias via Nominatim/cache. Returns null on failure.
async function resolveCityBias(
  city: string | null,
): Promise<{ lat: number; lng: number } | null> {
  if (!city) return null;
  const key = `geocode-bias:${city.toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached?.lat) return { lat: cached.lat, lng: cached.lng };
  const nom = await nominatimSearch(city);
  if (nom) {
    cacheSet(key, "geocode", nom, "nominatim").catch(() => {});
    return nom;
  }
  const photon = await photonSearch(city);
  if (photon) {
    cacheSet(key, "geocode", photon, "photon").catch(() => {});
    return photon;
  }
  return null;
}

// Photon search that ALSO returns the matched name so we can run similarity
// against the query. Standalone version so we don't break existing photonSearch.
async function photonSearchNamed(
  q: string,
  biasLat?: number,
  biasLng?: number,
): Promise<{ lat: number; lng: number; name: string } | null> {
  const bias =
    biasLat != null && biasLng != null ? `&lat=${biasLat}&lon=${biasLng}` : "";
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1${bias}`,
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const feat = data?.features?.[0];
    const coords = feat?.geometry?.coordinates;
    if (coords && coords.length >= 2) {
      const name = feat?.properties?.name ?? "";
      return { lat: coords[1], lng: coords[0], name };
    }
  } catch {
    /* photon down */
  }
  return null;
}

// Nominatim search that ALSO returns matched name.
async function nominatimSearchNamed(
  q: string,
): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      {
        headers: { "User-Agent": "TripJam/1.0 (travel planning app)" },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data: any = await res.json();
    const row = data?.[0];
    if (!row?.lat || !row?.lon) return null;
    return {
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lon),
      name: row.name || row.display_name || "",
    };
  } catch {
    return null;
  }
}

// Verify-place orchestrator. Runs the 5-tier ladder.
//
// Response shapes:
//   Success:        { lat, lng, source, confidence, corrected_from?, place_id?, business_status?, repaired? }
//   Needs picker:   { status: "needs_user_choice", alternatives: [{ name, hint, reason }], reason }
//   Unresolved:     { status: "unresolved", reason }
async function handleVerifyPlace(req: Request): Promise<Response> {
  const { name, city, hint, type, tripId } = await req.json();
  if (!name) {
    return Response.json(
      { error: "name required" },
      { status: 400, headers: corsHeaders },
    );
  }

  const normName = name.trim().toLowerCase();
  const cityKey = (city || "").toLowerCase();
  const cacheKey = `verify-place:${normName}|${cityKey}|${type || ""}`;

  // 0. Cache hit — full verified result keyed by ORIGINAL name (so repeat
  //    hallucinations cost zero).
  const cached = await cacheGet(cacheKey);
  if (cached) {
    incrementUsage("verify-place", "cache-hit", today()).catch(() => {});
    return Response.json({ ...cached, cached: true }, { headers: corsHeaders });
  }

  // 0b. User override always wins.
  const override = await checkOverride(name, city);
  if (override) {
    const payload = {
      lat: override.lat,
      lng: override.lng,
      source: "user_corrected",
      confidence: "high",
    };
    cacheSet(
      cacheKey,
      "verify-place",
      payload,
      "user_corrected",
      VERIFY_TTL_DAYS,
    ).catch(() => {});
    incrementUsage("verify-place", "override", today()).catch(() => {});
    return Response.json(payload, { headers: corsHeaders });
  }

  // Auth — needed for any tier that may spend credits (Haiku / Google).
  const userId = await authenticateUserId(req);
  if (!userId) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // Resolve city centroid once. Used both for Photon bias and Google validation.
  const centroid = await resolveCityBias(city || null);

  const queryForLookups = (hint || name).trim();
  const isRisky = RISKY_NAME_RE.test(name);

  // ── Tier 1: Photon with name-similarity check ──
  if (!isRisky) {
    const photonQ = `${queryForLookups} ${city || ""}`.trim();
    const r1 = await photonSearchNamed(photonQ, centroid?.lat, centroid?.lng);
    if (r1) {
      const sim = nameSimilarity(name, r1.name);
      const post = postEscalateCheck(r1, centroid?.lat, centroid?.lng);
      if (sim >= NAME_SIM_THRESHOLD && !post.escalate) {
        const payload = {
          lat: r1.lat,
          lng: r1.lng,
          source: "photon",
          confidence: "medium" as const,
        };
        cacheSet(
          cacheKey,
          "verify-place",
          payload,
          "photon",
          VERIFY_TTL_DAYS,
        ).catch(() => {});
        incrementUsage("verify-place", "tier1-photon", today()).catch(() => {});
        return Response.json(payload, { headers: corsHeaders });
      }
      // similarity too low → fall through. Don't trust the wrong-named match.
    }
  }

  // ── Tier 2: Nominatim direct ──
  const r2 = await nominatimSearchNamed(
    `${queryForLookups}, ${city || ""}`.trim(),
  );
  if (r2) {
    const sim = nameSimilarity(name, r2.name);
    if (sim >= NAME_SIM_THRESHOLD) {
      const payload = {
        lat: r2.lat,
        lng: r2.lng,
        source: "nominatim",
        confidence: "medium" as const,
      };
      cacheSet(
        cacheKey,
        "verify-place",
        payload,
        "nominatim",
        VERIFY_TTL_DAYS,
      ).catch(() => {});
      incrementUsage("verify-place", "tier2-nominatim", today()).catch(
        () => {},
      );
      return Response.json(payload, { headers: corsHeaders });
    }
  }

  // ── Tier 3: Haiku name-repair, then re-verify ──
  const repair = await haikuRepair({
    name,
    city: city || null,
    userId,
    tripId: tripId || null,
  });
  if (
    repair.canonical &&
    repair.canonical.toLowerCase() !== name.trim().toLowerCase()
  ) {
    // Re-run Photon + Nominatim against the repaired name.
    const repairQ = `${repair.canonical} ${city || ""}`.trim();
    const r3a = await photonSearchNamed(repairQ, centroid?.lat, centroid?.lng);
    if (r3a) {
      const sim = nameSimilarity(repair.canonical, r3a.name);
      const post = postEscalateCheck(r3a, centroid?.lat, centroid?.lng);
      if (sim >= NAME_SIM_THRESHOLD && !post.escalate) {
        const payload = {
          lat: r3a.lat,
          lng: r3a.lng,
          source: "haiku-then-photon",
          confidence: "medium" as const,
          corrected_from: name,
          corrected_to: repair.canonical,
          repair_reason: repair.reason,
          repaired: true,
        };
        cacheSet(
          cacheKey,
          "verify-place",
          payload,
          "haiku-then-photon",
          VERIFY_TTL_DAYS,
        ).catch(() => {});
        incrementUsage("verify-place", "tier3-haiku-pass", today()).catch(
          () => {},
        );
        return Response.json(payload, { headers: corsHeaders });
      }
    }
    const r3b = await nominatimSearchNamed(
      `${repair.canonical}, ${city || ""}`.trim(),
    );
    if (r3b) {
      const sim = nameSimilarity(repair.canonical, r3b.name);
      if (sim >= NAME_SIM_THRESHOLD) {
        const payload = {
          lat: r3b.lat,
          lng: r3b.lng,
          source: "haiku-then-nominatim",
          confidence: "medium" as const,
          corrected_from: name,
          corrected_to: repair.canonical,
          repair_reason: repair.reason,
          repaired: true,
        };
        cacheSet(
          cacheKey,
          "verify-place",
          payload,
          "haiku-then-nominatim",
          VERIFY_TTL_DAYS,
        ).catch(() => {});
        incrementUsage("verify-place", "tier3-haiku-pass", today()).catch(
          () => {},
        );
        return Response.json(payload, { headers: corsHeaders });
      }
    }
  }

  // ── Tier 4: Google Places with strict validation ──
  // Query Google with the repaired name if we have one, else original.
  const googleQuery = repair.canonical || name;
  const balance = await getUserCredits(userId);
  const googleCredits = costToCreditsPassthrough(GOOGLE_PLACES_CALL_USD);

  if (balance >= googleCredits) {
    try {
      const result = await googleFindPlace(googleQuery, city || null, type);
      if (result) {
        // Need displayName for validation — re-call with a fuller field mask
        // OR rely on what googleFindPlace returns. Currently googleFindPlace
        // returns place_id but not displayName as a separate field; the
        // FieldMask includes places.displayName so we can extend. For now
        // validate with what we have (business_status + distance).
        const validation = validateGoogleResult({
          query: googleQuery,
          displayName: result.display_name ?? null,
          businessStatus: result.business_status ?? null,
          resultLat: result.lat,
          resultLng: result.lng,
          centroidLat: centroid?.lat,
          centroidLng: centroid?.lng,
          type: type ?? null,
        });
        await chargeGoogleCall(
          userId,
          GOOGLE_PLACES_CALL_USD,
          `verify-place:google:${name}`,
          tripId || null,
        );
        incrementUsage("verify-place", "tier4-google-call", today()).catch(
          () => {},
        );
        if (validation.ok) {
          const payload: Record<string, unknown> = {
            lat: result.lat,
            lng: result.lng,
            source: repair.canonical ? "haiku-then-google" : "google_places",
            confidence: "high" as const,
            place_id: result.place_id,
            business_status: result.business_status,
          };
          if (
            repair.canonical &&
            repair.canonical.toLowerCase() !== name.trim().toLowerCase()
          ) {
            payload.corrected_from = name;
            payload.corrected_to = repair.canonical;
            payload.repair_reason = repair.reason;
            payload.repaired = true;
          }
          cacheSet(
            cacheKey,
            "verify-place",
            payload,
            payload.source as string,
            VERIFY_TTL_DAYS,
          ).catch(() => {});
          incrementUsage("verify-place", "tier4-google-pass", today()).catch(
            () => {},
          );
          return Response.json(payload, { headers: corsHeaders });
        }
        // Google returned something but it failed validation — fall to Tier 5
        console.log(
          `[verify-place] Google validation rejected "${googleQuery}": ${validation.reason}`,
        );
      }
    } catch (e) {
      console.warn(
        `[verify-place] Google call exception: ${(e as Error).message}`,
      );
    }
  }

  // ── Tier 5: Haiku alternatives → user picker ──
  const alts = await haikuAlternatives({
    name,
    city: city || null,
    userId,
    tripId: tripId || null,
  });
  if (alts.length > 0) {
    const payload = {
      status: "needs_user_choice" as const,
      alternatives: alts,
      reason: repair.reason || "Could not verify automatically — please pick.",
    };
    // Cache the "needs picker" outcome too, with a shorter TTL — if user picks one,
    // selectHotel-style replace will trigger a fresh verify on the new name.
    cacheSet(
      cacheKey,
      "verify-place",
      payload,
      "needs-picker",
      HAIKU_ALTS_TTL_DAYS,
    ).catch(() => {});
    incrementUsage("verify-place", "tier5-alternatives", today()).catch(
      () => {},
    );
    return Response.json(payload, { headers: corsHeaders });
  }

  // ── Fallback: unresolved ──
  const fallback = {
    status: "unresolved" as const,
    reason: repair.reason || "Could not resolve this place.",
  };
  // Short TTL on unresolved so we re-try in a few hours (transient API failures).
  cacheSet(cacheKey, "verify-place", fallback, "unresolved", 1).catch(() => {});
  incrementUsage("verify-place", "unresolved", today()).catch(() => {});
  return Response.json(fallback, { headers: corsHeaders });
}

// ── router ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "autocomplete") return await handleAutocomplete(req);
    if (action === "hotel-photo") return await handleHotelPhoto(req);
    if (action === "food-photo") return await handleFoodPhoto(req);
    if (action === "geocode") return await handleGeocode(req);
    if (action === "lookup-place") return await handleLookupPlace(req);
    if (action === "resolve-coords") return await handleResolveCoords(req);
    if (action === "verify-place") return await handleVerifyPlace(req);
    return Response.json(
      { error: "Unknown action" },
      { status: 400, headers: corsHeaders },
    );
  } catch (err) {
    console.error("places-proxy error:", err.message);
    return Response.json(
      { error: err.message },
      { status: 500, headers: corsHeaders },
    );
  }
});
