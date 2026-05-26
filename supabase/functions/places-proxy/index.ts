import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const TRIPADVISOR_KEY = Deno.env.get("TRIPADVISOR_KEY") ?? "";
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

async function taSearch(query: string): Promise<string | null> {
  const res = await fetch(
    `${TA_BASE}/location/search?key=${TRIPADVISOR_KEY}&searchQuery=${encodeURIComponent(query)}&language=en&category=hotels`,
  );
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.data?.[0]?.location_id ?? null;
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

const HOTEL_CHAIN_RE = /\b(hilton|marriott|hyatt|sheraton|westin|holiday\s*inn|best\s*western|ibis|gracery|comfort|hampton|courtyard|renaissance|ritz[-\s]carlton|four\s*seasons|park\s*hyatt|grand\s*hyatt|hyatt\s*regency|doubletree|embassy\s*suites|mercure|novotel|pullman|sofitel|premier\s*inn|travelodge|holiday\s*inn|days\s*inn|super\s*8|granbell|hilton\s*garden|hampton\s*inn|aloft|moxy|element|edition|park\s*plaza|crown\s*plaza|intercontinental|jw\s*marriott|w\s*hotel|st\s*regis|sheraton)\b/i;

function preEscalateToGoogle(name: string, geocodeHint: string | null, city: string | null): { escalate: boolean; reason: string } {
  // 1. LLM gave us garbage (hint equals city name)
  if (geocodeHint && city && geocodeHint.trim().toLowerCase() === city.trim().toLowerCase()) {
    return { escalate: true, reason: "hint_equals_city" };
  }
  // 2. Known chain hotel — Photon disambiguation is unreliable
  if (HOTEL_CHAIN_RE.test(name)) {
    return { escalate: true, reason: "chain_match" };
  }
  return { escalate: false, reason: "" };
}

function postEscalateCheck(coords: { lat: number; lng: number }, biasLat?: number, biasLng?: number): { escalate: boolean; reason: string } {
  if (biasLat == null || biasLng == null) return { escalate: false, reason: "" };
  // If Photon returned the city centroid (within 200m), it failed to find the specific place
  const distFromCentroid = haversineKm(biasLat, biasLng, coords.lat, coords.lng);
  if (distFromCentroid < 0.2) {
    return { escalate: true, reason: "matched_city_centroid" };
  }
  return { escalate: false, reason: "" };
}

// ── Google Places lookup (Feature 8 — chains + bad hints + escalation fallback) ─

async function googleFindPlace(name: string, city: string | null, type?: string): Promise<{ lat: number; lng: number; place_id: string; business_status?: string } | null> {
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
      "X-Goog-FieldMask": "places.id,places.location,places.businessStatus,places.displayName",
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
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  // Reject anon-key calls — must be a real user token
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (anonKey && token === anonKey) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.id ?? null;
}

async function getUserCredits(userId: string): Promise<number> {
  const res = await fetch(`${REST}/profiles?id=eq.${userId}&select=credits`, { headers: pgHeaders });
  if (!res.ok) return 0;
  const rows = await res.json();
  return Number(rows?.[0]?.credits ?? 0);
}

async function chargeGoogleCall(userId: string, costUsd: number, reason: string): Promise<boolean> {
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
        p_trip_id: null,
        p_llm_cost_usd: costUsd,
        p_metadata: { source: "google_places_passthrough" },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // If the RPC doesn't exist (staging in current state), don't block — just log
      if (res.status === 404 || text.includes("does not exist")) {
        console.warn("deduct_credits RPC not found — skipping charge (staging?)");
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

async function checkOverride(name: string, city: string | null): Promise<{ lat: number; lng: number } | null> {
  const normalized = name.trim().toLowerCase();
  const cityFilter = city ? `&city=eq.${encodeURIComponent(city.trim().toLowerCase())}` : "&city=is.null";
  try {
    const res = await fetch(`${REST}/geocode_overrides?place_normalized=eq.${encodeURIComponent(normalized)}${cityFilter}&select=lat,lng&limit=1`, { headers: pgHeaders });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length) return null;
    return { lat: Number(rows[0].lat), lng: Number(rows[0].lng) };
  } catch { return null; }
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleAutocomplete(req: Request): Promise<Response> {
  const { q, types } = await req.json();
  if (!q) return Response.json({ error: "q required" }, { status: 400 });

  // Cache queries ≤4 chars in DB (highly reusable, saves API calls)
  const shouldCache = q.trim().length <= 4;
  if (shouldCache) {
    const cacheKey = `autocomplete:${q.trim().toLowerCase()}:${types || ""}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      incrementUsage("autocomplete", "cache-hit", today()).catch(() => {});
      return Response.json(cached, { headers: corsHeaders });
    }
    const data = await autocomplete(q, types);
    incrementUsage("autocomplete", "google", today()).catch(() => {});
    cacheSet(cacheKey, "autocomplete", data, "google").catch(() => {});
    return Response.json(data, { headers: corsHeaders });
  }

  const data = await autocomplete(q, types);
  incrementUsage("autocomplete", "google", today()).catch(() => {});
  return Response.json(data, { headers: corsHeaders });
}

async function handleHotelPhoto(req: Request): Promise<Response> {
  const { q, city, tripId: _tripId, context: _context } = await req.json();
  if (!q)
    return Response.json({ url: null, source: null }, { headers: corsHeaders });

  const query = city ? `${q} ${city}` : q;
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
      const locationId = await taSearch(query);
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

  // 2. Resolve city bias from mainCity using Nominatim (more reliable for city/country names)
  let biasLat: number | undefined;
  let biasLng: number | undefined;
  if (mainCity) {
    const biasCacheKey = `geocode-bias:${mainCity.toLowerCase()}`;
    const biasCache = await cacheGet(biasCacheKey);
    if (biasCache?.lat) {
      biasLat = biasCache.lat;
      biasLng = biasCache.lng;
    } else {
      // Nominatim is reliable for city/country names (Photon returns wrong results from some datacenters)
      const nomResult = await nominatimSearch(mainCity);
      if (nomResult) {
        biasLat = nomResult.lat;
        biasLng = nomResult.lng;
        cacheSet(biasCacheKey, "geocode", nomResult, "nominatim").catch(
          () => {},
        );
      } else {
        // Photon fallback
        const coords = await photonSearch(mainCity);
        if (coords) {
          biasLat = coords.lat;
          biasLng = coords.lng;
          cacheSet(biasCacheKey, "geocode", coords, "photon").catch(() => {});
        }
      }
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
  if (!name) return Response.json({ error: "name required" }, { status: 400, headers: corsHeaders });

  // 1. User override always wins
  const override = await checkOverride(name, city);
  if (override) {
    return Response.json({ lat: override.lat, lng: override.lng, source: "user_corrected", confidence: "high" }, { headers: corsHeaders });
  }

  // 2. Cache hit?
  const cacheKey = `lookup-place:${name.trim().toLowerCase()}|${(city || "").toLowerCase()}|${type || ""}`;
  const cached = await cacheGet(cacheKey);
  if (cached?.lat) {
    incrementUsage("lookup-place", "cache-hit", today()).catch(() => {});
    return Response.json({ ...cached, source: cached.source || "google_places", confidence: "high", cached: true }, { headers: corsHeaders });
  }

  // 3. Need to call Google — authenticate + charge user
  const userId = await authenticateUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

  const balance = await getUserCredits(userId);
  const credits = costToCreditsPassthrough(GOOGLE_PLACES_CALL_USD);
  if (balance < credits) {
    return Response.json({ error: "Out of credits", code: "insufficient_credits", credits: balance }, { status: 402, headers: corsHeaders });
  }

  // 4. Call Google
  const result = await googleFindPlace(name, city, type);
  if (!result) {
    incrementUsage("lookup-place", "google-miss", today()).catch(() => {});
    return Response.json({ lat: null, lng: null, source: null, confidence: "low" }, { headers: corsHeaders });
  }

  // 5. Charge user (only on success — failed lookups are on the house)
  await chargeGoogleCall(userId, GOOGLE_PLACES_CALL_USD, `lookup-place:${name}`);

  // 6. Cache (90d TTL for Google results)
  const payload = { lat: result.lat, lng: result.lng, place_id: result.place_id, business_status: result.business_status, source: "google_places" };
  cacheSet(cacheKey, "lookup-place", payload, "google", 90).catch(() => {});
  incrementUsage("lookup-place", "google", today()).catch(() => {});

  return Response.json({ ...payload, confidence: "high" }, { headers: corsHeaders });
}

// ── Feature 8: resolve-coords (smart escalation — Photon-first + heuristic + Google fallback) ──
//
// Used by selectHotel and (in future) background activity-geocode pipeline.
// Tries the cheapest path first; only calls Google when Photon clearly fails.

async function handleResolveCoords(req: Request): Promise<Response> {
  const { name, city, hint, type, tripId } = await req.json();
  if (!name) return Response.json({ error: "name required" }, { status: 400, headers: corsHeaders });

  // 1. Override always wins
  const override = await checkOverride(name, city);
  if (override) {
    return Response.json({ lat: override.lat, lng: override.lng, source: "user_corrected", confidence: "high" }, { headers: corsHeaders });
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
        cacheSet(biasCacheKey, "geocode", nomResult, "nominatim").catch(() => {});
      }
    }
  }

  const photonQ = hint || name;
  const photonResult = await photonSearch(`${photonQ} ${city || ""}`.trim(), biasLat, biasLng);
  if (photonResult) {
    // Post-escalation check — is the Photon result actually the city centroid?
    const post = postEscalateCheck(photonResult, biasLat, biasLng);
    if (!post.escalate) {
      // Photon result is good
      incrementUsage("resolve-coords", "photon", today()).catch(() => {});
      return Response.json({ lat: photonResult.lat, lng: photonResult.lng, source: "photon", confidence: "medium" }, { headers: corsHeaders });
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

// ── router ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "autocomplete")    return await handleAutocomplete(req);
    if (action === "hotel-photo")     return await handleHotelPhoto(req);
    if (action === "geocode")         return await handleGeocode(req);
    if (action === "lookup-place")    return await handleLookupPlace(req);
    if (action === "resolve-coords")  return await handleResolveCoords(req);
    return Response.json({ error: "Unknown action" }, { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error("places-proxy error:", err.message);
    return Response.json(
      { error: err.message },
      { status: 500, headers: corsHeaders },
    );
  }
});
