import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const PLACES_BASE = "https://places.googleapis.com/v1";

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleAutocomplete(req: Request): Promise<Response> {
  const { q, types } = await req.json();
  if (!q) return Response.json({ error: "q required" }, { status: 400 });
  const data = await autocomplete(q, types);
  return Response.json(data, { headers: corsHeaders });
}

async function handlePhoto(req: Request): Promise<Response> {
  const { q, city } = await req.json();
  if (!q) return Response.json({ url: null }, { headers: corsHeaders });

  const query = city ? `${q} ${city}` : q;
  const data: any = await textSearch(query);
  const place = data?.places?.[0];
  if (!place) return Response.json({ url: null }, { headers: corsHeaders });

  const photoName = place.photos?.[0]?.name;
  if (!photoName) return Response.json({ url: null }, { headers: corsHeaders });

  const url = await getPhotoUri(photoName);
  return Response.json({ url, placeId: place.id }, { headers: corsHeaders });
}

async function handleValidate(req: Request): Promise<Response> {
  const { activities } = await req.json(); // [{ title, city }]
  if (!activities?.length) return Response.json({ results: [] }, { headers: corsHeaders });

  const results = await Promise.all(
    activities.map(async ({ title, city }: { title: string; city: string }) => {
      try {
        const data: any = await textSearch(`${title} ${city}`);
        const place = data?.places?.[0];
        if (!place) return { title, placeId: null, businessStatus: "NOT_FOUND", exists: false };
        return {
          title,
          placeId: place.id,
          businessStatus: place.businessStatus ?? "OPERATIONAL",
          exists: true,
        };
      } catch {
        return { title, placeId: null, businessStatus: "UNKNOWN", exists: false };
      }
    })
  );

  return Response.json({ results }, { headers: corsHeaders });
}

// ── router ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "autocomplete") return await handleAutocomplete(req);
    if (action === "photo")        return await handlePhoto(req);
    if (action === "validate")     return await handleValidate(req);
    return Response.json({ error: "Unknown action" }, { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error("places-proxy error:", err.message);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
});
