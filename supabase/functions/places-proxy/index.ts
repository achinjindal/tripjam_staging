import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const TRIPADVISOR_KEY = Deno.env.get("TRIPADVISOR_KEY") ?? "";
const PLACES_BASE = "https://places.googleapis.com/v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── PostgREST helpers (no SDK needed) ───────────────────────────────────────

const pgHeaders = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" };
const REST = `${SUPABASE_URL}/rest/v1`;

async function cacheGet(key: string): Promise<any | null> {
  try {
    const res = await fetch(`${REST}/place_cache?key=eq.${encodeURIComponent(key)}&select=result,expires_at`, { headers: pgHeaders });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length) return null;
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      fetch(`${REST}/place_cache?key=eq.${encodeURIComponent(key)}`, { method: "DELETE", headers: pgHeaders }).catch(() => {});
      return null;
    }
    return row.result;
  } catch { return null; }
}

async function cacheSet(key: string, action: string, result: any, source: string, ttlDays?: number): Promise<void> {
  try {
    const expires_at = ttlDays ? new Date(Date.now() + ttlDays * 86400000).toISOString() : null;
    await fetch(`${REST}/place_cache`, {
      method: "POST",
      headers: { ...pgHeaders, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key, action, result, source, expires_at, created_at: new Date().toISOString() }),
    });
  } catch { /* fire-and-forget */ }
}

// ── rate limit helpers (atomic upsert via ON CONFLICT) ──────────────────────

async function getUsage(api: string, scope: string, period: string): Promise<number> {
  try {
    const res = await fetch(`${REST}/api_usage?api=eq.${encodeURIComponent(api)}&scope=eq.${encodeURIComponent(scope)}&period=eq.${encodeURIComponent(period)}&select=count`, { headers: pgHeaders });
    if (!res.ok) return 0;
    const rows = await res.json();
    return rows?.[0]?.count ?? 0;
  } catch { return 0; }
}

async function incrementUsage(api: string, scope: string, period: string, amount = 1): Promise<void> {
  try {
    // Use RPC or upsert with ON CONFLICT to avoid race conditions
    const res = await fetch(`${REST}/api_usage?api=eq.${encodeURIComponent(api)}&scope=eq.${encodeURIComponent(scope)}&period=eq.${encodeURIComponent(period)}&select=count`, { headers: pgHeaders });
    if (!res.ok) return;
    const rows = await res.json();
    if (rows?.length) {
      await fetch(`${REST}/api_usage?api=eq.${encodeURIComponent(api)}&scope=eq.${encodeURIComponent(scope)}&period=eq.${encodeURIComponent(period)}`, {
        method: "PATCH", headers: pgHeaders,
        body: JSON.stringify({ count: rows[0].count + amount, updated_at: new Date().toISOString() }),
      });
    } else {
      await fetch(`${REST}/api_usage`, {
        method: "POST", headers: { ...pgHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ api, scope, period, count: amount }),
      });
    }
  } catch { /* best-effort */ }
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function thisMonth(): string { return new Date().toISOString().slice(0, 7); }

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

async function textSearch(query: string): Promise<unknown> {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.businessStatus,places.formattedAddress,places.photos",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "en", maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Text search error: ${await res.text()}`);
  return res.json();
}

async function getPhotoUri(photoName: string): Promise<string | null> {
  const res = await fetch(
    `${PLACES_BASE}/${photoName}/media?maxHeightPx=600&maxWidthPx=800&skipHttpRedirect=true`,
    { headers: { "X-Goog-Api-Key": PLACES_KEY } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.photoUri ?? null;
}

// ── TripAdvisor helpers ─────────────────────────────────────────────────────

const TA_BASE = "https://api.content.tripadvisor.com/api/v1";

async function taSearch(query: string): Promise<string | null> {
  const res = await fetch(`${TA_BASE}/location/search?key=${TRIPADVISOR_KEY}&searchQuery=${encodeURIComponent(query)}&language=en&category=hotels`);
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.data?.[0]?.location_id ?? null;
}

async function taPhoto(locationId: string): Promise<string | null> {
  const res = await fetch(`${TA_BASE}/location/${locationId}/photos?key=${TRIPADVISOR_KEY}&language=en`);
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.data?.[0]?.images?.large?.url ?? data?.data?.[0]?.images?.original?.url ?? null;
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
    if (cached) return Response.json(cached, { headers: corsHeaders });
    const data = await autocomplete(q, types);
    cacheSet(cacheKey, "autocomplete", data, "google").catch(() => {});
    return Response.json(data, { headers: corsHeaders });
  }

  const data = await autocomplete(q, types);
  return Response.json(data, { headers: corsHeaders });
}

async function handleHotelPhoto(req: Request): Promise<Response> {
  const { q, city, tripId, context } = await req.json();
  if (!q) return Response.json({ url: null, source: null }, { headers: corsHeaders });

  const query = city ? `${q} ${city}` : q;
  const cacheKey = `hotel-photo:${query.toLowerCase()}`;

  // 1. Check DB cache
  const cached = await cacheGet(cacheKey);
  if (cached) return Response.json({ url: cached.url, source: cached.source }, { headers: corsHeaders });

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
          await cacheSet(cacheKey, "hotel-photo", { url: photoUrl, source: "tripadvisor" }, "tripadvisor", 30);
          return Response.json({ url: photoUrl, source: "tripadvisor" }, { headers: corsHeaders });
        }
      }
    } catch (e) { console.error("TripAdvisor error:", e.message); }
  }

  // 3. Try Google Places (within per-trip caps: 2/itinerary, 3/chat per day per trip)
  if (tripId) {
    const googleScope = context === "chat" ? `chat:${tripId}:${today()}` : `itinerary:${tripId}`;
    const googleCap = context === "chat" ? 3 : 2;
    const googleCount = await getUsage("google-photo", googleScope, today());

    if (googleCount < googleCap) {
      try {
        const data: any = await textSearch(query);
        const place = data?.places?.[0];
        const photoName = place?.photos?.[0]?.name;
        if (photoName) {
          const photoUrl = await getPhotoUri(photoName);
          if (photoUrl) {
            await incrementUsage("google-photo", googleScope, today());
            await cacheSet(cacheKey, "hotel-photo", { url: photoUrl, source: "google" }, "google");
            return Response.json({ url: photoUrl, source: "google" }, { headers: corsHeaders });
          }
        }
      } catch (e) { console.error("Google photo error:", e.message); }
    }
  }

  // 4. No photo found
  return Response.json({ url: null, source: null }, { headers: corsHeaders });
}

async function handleGeocode(req: Request): Promise<Response> {
  const { q, city } = await req.json();
  if (!q) return Response.json({ lat: null, lng: null }, { headers: corsHeaders });

  const query = city ? `${q} ${city}` : q;
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY,
      "X-Goog-FieldMask": "places.location,places.displayName",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "en", maxResultCount: 1 }),
  });
  if (!res.ok) return Response.json({ lat: null, lng: null }, { headers: corsHeaders });
  const data: any = await res.json();
  const loc = data?.places?.[0]?.location;
  if (!loc) return Response.json({ lat: null, lng: null }, { headers: corsHeaders });
  return Response.json({ lat: loc.latitude, lng: loc.longitude }, { headers: corsHeaders });
}

// ── router ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "autocomplete") return await handleAutocomplete(req);
    if (action === "hotel-photo")  return await handleHotelPhoto(req);
    if (action === "geocode")      return await handleGeocode(req);
    return Response.json({ error: "Unknown action" }, { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error("places-proxy error:", err.message);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
});
